import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

// Keep-alive terminal registry (VSCode-style). One xterm instance lives per
// tabId for the whole page session; switching tabs MOVES its DOM element into
// the visible slot instead of unmounting/recreating it. Because the instance —
// and its scrollback — is created exactly once, the initial dump is requested
// exactly once, so tab switches can never stack duplicate output.

interface XtermHandle {
  clipboard: ClipboardAddon;
  fit: FitAddon;
  onBytes: (e: Event) => void;
  onBytesReset: (e: Event) => void;
  term: Terminal;
  webgl: WebglAddon | null;
}

interface CreateDeps {
  bytesEmitter: EventTarget;
  onRequestBytes: (tabId: string) => void;
}

const registry = new Map<string, XtermHandle>();

// Read the aimux palette out of the live CSS variables set by useTheme. aimux
// only exposes semantic chrome tokens (background, text, primary, ...) — no
// 16-color ANSI palette — so we map bg/fg/cursor/selection only and let xterm
// fall back to its built-in ANSI defaults for the rest.
function readXtermTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    background: get("--aimux-background"),
    cursor: get("--aimux-primary"),
    cursorAccent: get("--aimux-background"),
    foreground: get("--aimux-text"),
    selectionBackground: get("--aimux-backgroundElement"),
  };
}

// The detached terminals' DOM elements are parked here (display:none) so xterm
// keeps a valid parent — writes/renders to a hidden tab stay correct and the
// buffer survives until the element is re-attached to a visible slot.
let parkingLot: HTMLElement | null = null;

function getParkingLot(): HTMLElement {
  if (parkingLot === null) {
    const el = document.createElement("div");
    el.id = "xterm-parking";
    el.style.display = "none";
    document.body.append(el);
    parkingLot = el;
  }
  return parkingLot;
}

function createTerminal(tabId: string, deps: CreateDeps): XtermHandle {
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: "'JetBrainsMono Nerd Font Mono', ui-monospace, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.1,
    theme: readXtermTheme(),
  });
  const fit = new FitAddon();
  const clipboard = new ClipboardAddon();
  term.loadAddon(fit);
  term.loadAddon(clipboard);
  // Build term.element by opening into the parking lot; the React slot moves it
  // into the visible container on attach.
  term.open(getParkingLot());
  // WebGL must load AFTER open. Wrap in try/catch — falls back to canvas/DOM
  // if WebGL is unavailable.
  let webgl: WebglAddon | null = null;
  try {
    webgl = new WebglAddon();
    term.loadAddon(webgl);
  } catch (err) {
    console.warn("xterm WebGL addon failed to load; falling back", err);
  }
  // Don't let xterm consume keys — all input flows through the window keydown
  // listener in App.tsx and the host's keymap pipeline.
  term.attachCustomKeyEventHandler(() => false);

  const onBytes = (e: Event): void => {
    term.write((e as CustomEvent<string>).detail);
  };
  const onBytesReset = (e: Event): void => {
    // Full scrollback dump: RIS-reset the buffer first so receiving it 1× or N×
    // yields identical state. Live `bytes` after this append normally.
    term.reset();
    term.write((e as CustomEvent<string>).detail);
  };
  deps.bytesEmitter.addEventListener(`bytes-${tabId}`, onBytes);
  deps.bytesEmitter.addEventListener(`bytesReset-${tabId}`, onBytesReset);

  // Pull the scrollback dump ONCE, at creation. Switching tabs never recreates
  // the instance, so this never fires again — the source of the old duplication.
  deps.onRequestBytes(tabId);

  return { clipboard, fit, onBytes, onBytesReset, term, webgl };
}

/** Get the live handle for a tab, creating (and dumping) it once if absent. */
export function getOrCreateTerminal(tabId: string, deps: CreateDeps): XtermHandle {
  const existing = registry.get(tabId);
  if (existing !== undefined) {
    return existing;
  }
  const handle = createTerminal(tabId, deps);
  registry.set(tabId, handle);
  return handle;
}

/** Move a tab's terminal element into a visible container and fit it. */
export function attachTerminal(
  tabId: string,
  container: HTMLElement,
  onResize: (tabId: string, cols: number, rows: number) => void,
): void {
  const handle = registry.get(tabId);
  if (handle === undefined || handle.term.element === undefined) {
    return;
  }
  container.append(handle.term.element);
  // The container is visible now, so fit can measure. Defer one microtask so
  // layout has settled after the DOM move.
  queueMicrotask(() => {
    try {
      handle.fit.fit();
      onResize(tabId, handle.term.cols, handle.term.rows);
    } catch {
      // container not measurable yet
    }
  });
}

/** Refit a visible tab (called from a ResizeObserver on its container). */
export function fitTerminal(
  tabId: string,
  onResize: (tabId: string, cols: number, rows: number) => void,
): void {
  const handle = registry.get(tabId);
  if (handle === undefined) {
    return;
  }
  try {
    handle.fit.fit();
    onResize(tabId, handle.term.cols, handle.term.rows);
  } catch {
    // container not measurable (hidden) yet
  }
}

/** Detach a tab's terminal back to the parking lot — keeps it alive. */
export function detachTerminal(tabId: string): void {
  const handle = registry.get(tabId);
  if (handle === undefined || handle.term.element === undefined) {
    return;
  }
  getParkingLot().append(handle.term.element);
}

/** Push the current aimux palette into a live terminal (theme change). */
export function applyTerminalTheme(tabId: string): void {
  const handle = registry.get(tabId);
  if (handle !== undefined) {
    handle.term.options.theme = readXtermTheme();
  }
}

/** Fully dispose a tab's terminal — only when the tab is actually closed. */
export function disposeTerminal(tabId: string, bytesEmitter: EventTarget): void {
  const handle = registry.get(tabId);
  if (handle === undefined) {
    return;
  }
  bytesEmitter.removeEventListener(`bytes-${tabId}`, handle.onBytes);
  bytesEmitter.removeEventListener(`bytesReset-${tabId}`, handle.onBytesReset);
  handle.webgl?.dispose();
  handle.term.dispose();
  registry.delete(tabId);
}

/** Tab ids with a live terminal instance (for the close-diff in App). */
export function liveTerminalIds(): string[] {
  return [...registry.keys()];
}
