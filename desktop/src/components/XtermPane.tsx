import { useEffect, useRef } from "react";

import {
  applyTerminalTheme,
  attachTerminal,
  detachTerminal,
  fitTerminal,
  getOrCreateTerminal,
} from "@/lib/terminal-registry";

interface XtermPaneProps {
  bytesEmitter: EventTarget;
  onRequestBytes: (tabId: string) => void;
  onResize: (tabId: string, cols: number, rows: number) => void;
  tabId: string;
  themeId: string;
}

// Thin slot for a keep-alive xterm instance. The terminal itself lives in the
// module-level registry for the whole page session; this component just owns a
// visible container and moves the persistent terminal element into it on mount,
// parking it again on unmount (a tab switch). The instance is never recreated
// here, so the scrollback dump is requested exactly once (at first creation) —
// switching tabs can't stack duplicate output.
export function XtermPane({
  bytesEmitter,
  onRequestBytes,
  onResize,
  tabId,
  themeId,
}: XtermPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // Idempotent: a re-mount (incl. StrictMode's double invoke) reuses the same
    // handle and does NOT re-request the dump.
    getOrCreateTerminal(tabId, { bytesEmitter, onRequestBytes });
    attachTerminal(tabId, container, onResize);

    const ro = new ResizeObserver(() => fitTerminal(tabId, onResize));
    ro.observe(container);

    return () => {
      ro.disconnect();
      // Keep the instance alive — just park its element until the next attach.
      detachTerminal(tabId);
    };
    // tabId / bytesEmitter / onResize / onRequestBytes are stable for the pane's
    // lifetime (TerminalPane keys on tabId, so a switch remounts this slot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live theme change: repaint the running terminal without remounting.
  useEffect(() => {
    applyTerminalTheme(tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
