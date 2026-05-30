import { writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

// Tauri's WebView blocks navigator.clipboard without the clipboard-manager
// permission, so inside the desktop bundle we route writes through the
// plugin (allow-listed in capabilities/default.json) — it shares the real
// macOS NSPasteboard, so Cmd+V in any other app pastes what was copied here.
// In plain browser dev (Vite at localhost) the Tauri import isn't available,
// so we call navigator.clipboard SYNCHRONOUSLY inside the same gesture frame
// — awaiting a Tauri-attempt first would lose the gesture and the browser
// would silently refuse the write.
const IS_TAURI =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

// Last-resort fallback when navigator.clipboard refuses (no permission,
// document not focused, …): the legacy execCommand('copy') path that pre-dates
// the modern async clipboard API and tends to work in more contexts.
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.append(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (err) {
    console.warn("[aimux] legacy copy failed", err);
    return false;
  }
}

function writeClipboard(text: string): void {
  if (IS_TAURI) {
    void tauriWriteText(text).catch((err: unknown) => {
      console.warn("[aimux] tauri clipboard write failed, trying legacy", err);
      legacyCopy(text);
    });
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(text).catch((err: unknown) => {
      console.warn("[aimux] navigator clipboard write failed, trying legacy", err);
      legacyCopy(text);
    });
    return;
  }
  legacyCopy(text);
}

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
    // No xterm-driven blink: the inner program (shell prompt, Claude, vim…)
    // already renders its own cursor and may also drive DECSCUSR. A second,
    // xterm-side blink on top of that flashed cursor/cursorAccent over the
    // app's own colors — looked broken, especially in terminal-input mode.
    cursorBlink: false,
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
  // listener in App.tsx and the host's keymap pipeline. Copy is wired to
  // selection-change (drag-to-copy) below; paste stays on the window-level
  // `paste` listener so the host bracket-wraps it.
  term.attachCustomKeyEventHandler(() => false);

  // TUI parity (src/app-runtime/use-renderer-bindings.ts:256-257): drag-to-copy.
  // Pushing the current selection to the OS clipboard on each selection-change
  // mirrors the TUI mouseup behaviour, so there's nothing for the user to
  // remember — finishing a drag IS the copy.
  term.onSelectionChange(() => {
    if (!term.hasSelection()) return;
    const text = term.getSelection();
    if (text === "") return;
    writeClipboard(text);
  });

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
