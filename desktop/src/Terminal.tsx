import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { encodeKey } from "@/lib/keys";
import type { TerminalModeState, TerminalSnapshot } from "@/lib/types";

const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace";
const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const DEFAULT_FG = "#edf4ff";
const DEFAULT_BG = "#11151b";
const MEASURE_CHARS = 50;

interface TerminalProps {
  snapshot: TerminalSnapshot | null;
  modes: TerminalModeState | null;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onScroll: (deltaLines: number) => void;
}

export function Terminal({ snapshot, modes, onInput, onResize, onScroll }: TerminalProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const cellRef = useRef({ height: LINE_HEIGHT, width: 8 });
  const lastSizeRef = useRef({ cols: 0, rows: 0 });

  const recomputeSize = useCallback(() => {
    const screen = screenRef.current;
    if (!screen) {
      return;
    }
    const { height, width } = cellRef.current;
    const cols = Math.max(1, Math.floor(screen.clientWidth / width));
    const rows = Math.max(1, Math.floor(screen.clientHeight / height));
    if (cols !== lastSizeRef.current.cols || rows !== lastSizeRef.current.rows) {
      lastSizeRef.current = { cols, rows };
      onResize(cols, rows);
    }
  }, [onResize]);

  // Measure one monospace cell, then size the terminal to the window.
  useLayoutEffect(() => {
    const measure = () => {
      if (measureRef.current) {
        cellRef.current = {
          height: LINE_HEIGHT,
          width: measureRef.current.getBoundingClientRect().width / MEASURE_CHARS,
        };
      }
      recomputeSize();
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [recomputeSize]);

  useEffect(() => {
    const observer = new ResizeObserver(() => recomputeSize());
    if (screenRef.current) {
      observer.observe(screenRef.current);
    }
    return () => observer.disconnect();
  }, [recomputeSize]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const data = encodeKey(e.nativeEvent);
      if (data !== null) {
        e.preventDefault();
        onInput(data);
      }
    },
    [onInput],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      if (text === "") {
        return;
      }
      const wrapped = modes?.bracketedPasteMode === true ? `\x1b[200~${text}\x1b[201~` : text;
      onInput(wrapped);
    },
    [modes, onInput],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const lines = Math.round(e.deltaY / LINE_HEIGHT) || (e.deltaY > 0 ? 1 : -1);
      onScroll(-lines);
    },
    [onScroll],
  );

  const cursorVisible = snapshot?.cursorVisible === true;

  return (
    <div
      ref={screenRef}
      tabIndex={0}
      autoFocus
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onWheel={handleWheel}
      onMouseDown={() => screenRef.current?.focus()}
      className="h-full w-full overflow-hidden outline-none"
      style={{
        backgroundColor: DEFAULT_BG,
        color: DEFAULT_FG,
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        lineHeight: `${LINE_HEIGHT}px`,
        whiteSpace: "pre",
      }}
    >
      <span
        ref={measureRef}
        aria-hidden
        style={{ left: -9999, position: "absolute", visibility: "hidden" }}
      >
        {"0".repeat(MEASURE_CHARS)}
      </span>
      {snapshot?.lines.map((line, rowIndex) => (
        <div key={rowIndex} style={{ height: LINE_HEIGHT }}>
          {line.spans.length === 0
            ? " "
            : line.spans.map((span, spanIndex) => {
                const isCursor = span.cursor === true && cursorVisible;
                return (
                  <span
                    key={spanIndex}
                    style={{
                      backgroundColor: isCursor ? (span.fg ?? DEFAULT_FG) : span.bg,
                      color: isCursor ? (span.bg ?? DEFAULT_BG) : span.fg,
                      fontStyle: span.italic === true ? "italic" : undefined,
                      fontWeight: span.bold === true ? "bold" : undefined,
                      textDecoration: span.underline === true ? "underline" : undefined,
                    }}
                  >
                    {span.text}
                  </span>
                );
              })}
        </div>
      ))}
    </div>
  );
}
