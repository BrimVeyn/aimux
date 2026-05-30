import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

interface XtermPaneProps {
  bytesEmitter: EventTarget;
  onRequestBytes: (tabId: string) => void;
  onResize: (tabId: string, cols: number, rows: number) => void;
  tabId: string;
  themeId: string;
}

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

export function XtermPane({
  bytesEmitter,
  onRequestBytes,
  onResize,
  tabId,
  themeId,
}: XtermPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
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
    term.open(container);
    // WebGL must load AFTER open. Wrap in try/catch — falls back to canvas/DOM
    // if WebGL is unavailable.
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch (err) {
      console.warn("xterm WebGL addon failed to load; falling back", err);
    }
    // Don't let xterm consume keys — all input flows through the window
    // keydown listener in App.tsx and the host's keymap pipeline.
    term.attachCustomKeyEventHandler(() => false);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + first resize report.
    queueMicrotask(() => {
      try {
        fit.fit();
        onResize(tabId, term.cols, term.rows);
      } catch (err) {
        console.warn("initial xterm fit failed", err);
      }
    });

    const onBytes = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      term.write(detail);
    };
    bytesEmitter.addEventListener(`bytes-${tabId}`, onBytes);

    // Pull the scrollback dump for this tab now that the listener is attached.
    // Pull-based (vs the host pushing on paneActivate) so a fresh xterm mount
    // is the single trigger — no duplicate splash when clicking the active tab.
    onRequestBytes(tabId);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        onResize(tabId, term.cols, term.rows);
      } catch {
        // container not measurable yet
      }
    });
    ro.observe(container);

    return () => {
      bytesEmitter.removeEventListener(`bytes-${tabId}`, onBytes);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // tabId / bytesEmitter / onResize / onRequestBytes stable for the pane's
    // lifetime (TerminalPane keys on tabId, so a switch remounts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live theme change: update the running terminal without remounting.
  useEffect(() => {
    if (termRef.current !== null) {
      termRef.current.options.theme = readXtermTheme();
    }
  }, [themeId]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
