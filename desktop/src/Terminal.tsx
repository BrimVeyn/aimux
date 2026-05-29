import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { TerminalSnapshot } from "@/lib/types";

const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace";
const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const DEFAULT_FG = "#edf4ff";
const DEFAULT_BG = "#11151b";
const MEASURE_CHARS = 50;

export const FONT_FAMILY_GRID = FONT_FAMILY;
export const FONT_SIZE_GRID = FONT_SIZE;
export const LINE_HEIGHT_GRID = LINE_HEIGHT;
export const DEFAULT_FG_GRID = DEFAULT_FG;
export const DEFAULT_BG_GRID = DEFAULT_BG;
export const MEASURE_CHARS_GRID = MEASURE_CHARS;

export function TerminalGrid({ snapshot }: { snapshot: TerminalSnapshot | null }) {
  const cursorVisible = snapshot?.cursorVisible === true;
  return (
    <>
      {snapshot?.lines.map((line, rowIndex) => (
        <div key={rowIndex} style={{ height: LINE_HEIGHT }}>
          {line.spans.length === 0
            ? " "
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
    </>
  );
}

interface TerminalProps {
  snapshot: TerminalSnapshot | null;
  onResize: (cols: number, rows: number) => void;
  onScroll: (deltaLines: number) => void;
}

// Renders a backend TerminalSnapshot to a DOM grid and reports its measured
// size. Keyboard/paste are handled at the window level (App.tsx) and routed
// through the host's keymap pipeline.
export function Terminal({ snapshot, onResize, onScroll }: TerminalProps) {
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

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const lines = Math.round(e.deltaY / LINE_HEIGHT) || (e.deltaY > 0 ? 1 : -1);
      onScroll(-lines);
    },
    [onScroll],
  );

  return (
    <div
      ref={screenRef}
      onWheel={handleWheel}
      className="h-full w-full overflow-hidden"
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
      <TerminalGrid snapshot={snapshot} />
    </div>
  );
}
