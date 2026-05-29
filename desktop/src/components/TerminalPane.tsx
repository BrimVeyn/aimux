import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import {
  DEFAULT_BG_GRID,
  DEFAULT_FG_GRID,
  FONT_FAMILY_GRID,
  FONT_SIZE_GRID,
  LINE_HEIGHT_GRID,
  MEASURE_CHARS_GRID,
  TerminalGrid,
} from "@/Terminal";
import { theme } from "@/lib/theme";
import type { ProjectedTab, TerminalSnapshot } from "@/lib/types";

interface TerminalPaneProps {
  tabId: string;
  tab: ProjectedTab | undefined;
  snapshot: TerminalSnapshot | null;
  isActive: boolean;
  onResizeTab: (tabId: string, cols: number, rows: number) => void;
  onActivate: (tabId: string) => void;
  onScroll: (deltaLines: number) => void;
}

// One split pane: title bar + bordered terminal grid that measures itself and
// reports its size to the host (resizeTab). Input stays host-driven; clicking
// the pane only sends paneActivate.
export function TerminalPane({
  tabId,
  tab,
  snapshot,
  isActive,
  onResizeTab,
  onActivate,
  onScroll,
}: TerminalPaneProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const cellRef = useRef({ height: LINE_HEIGHT_GRID, width: 8 });
  const lastSizeRef = useRef({ cols: 0, rows: 0 });

  const recompute = useCallback(() => {
    const screen = screenRef.current;
    if (!screen) {
      return;
    }
    const { height, width } = cellRef.current;
    const cols = Math.max(1, Math.floor(screen.clientWidth / width));
    const rows = Math.max(1, Math.floor(screen.clientHeight / height));
    if (cols !== lastSizeRef.current.cols || rows !== lastSizeRef.current.rows) {
      lastSizeRef.current = { cols, rows };
      onResizeTab(tabId, cols, rows);
    }
  }, [onResizeTab, tabId]);

  useLayoutEffect(() => {
    const measure = () => {
      if (measureRef.current) {
        cellRef.current = {
          height: LINE_HEIGHT_GRID,
          width: measureRef.current.getBoundingClientRect().width / MEASURE_CHARS_GRID,
        };
      }
      recompute();
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [recompute]);

  useEffect(() => {
    const observer = new ResizeObserver(() => recompute());
    if (screenRef.current) {
      observer.observe(screenRef.current);
    }
    return () => observer.disconnect();
  }, [recompute]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isActive) {
        return;
      }
      const lines = Math.round(e.deltaY / LINE_HEIGHT_GRID) || (e.deltaY > 0 ? 1 : -1);
      onScroll(-lines);
    },
    [isActive, onScroll],
  );

  const borderColor = isActive ? theme.primary : theme.border;
  const title = tab ? `${tab.title} · ${tab.status}` : tabId;

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded border"
      style={{ borderColor }}
      onMouseDown={() => onActivate(tabId)}
    >
      <div
        className="flex items-center gap-1 px-2 py-0.5 font-mono text-xs"
        style={{
          backgroundColor: theme.backgroundPanel,
          borderBottom: `1px solid ${theme.border}`,
          color: isActive ? theme.primary : theme.textMuted,
        }}
      >
        <span>{isActive ? "▸" : " "}</span>
        <span className="truncate">{title}</span>
      </div>
      <div
        ref={screenRef}
        onWheel={handleWheel}
        className="min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundColor: DEFAULT_BG_GRID,
          color: DEFAULT_FG_GRID,
          fontFamily: FONT_FAMILY_GRID,
          fontSize: FONT_SIZE_GRID,
          lineHeight: `${LINE_HEIGHT_GRID}px`,
          whiteSpace: "pre",
        }}
      >
        <span
          ref={measureRef}
          aria-hidden
          style={{ left: -9999, position: "absolute", visibility: "hidden" }}
        >
          {"0".repeat(MEASURE_CHARS_GRID)}
        </span>
        <TerminalGrid snapshot={snapshot} />
      </div>
    </div>
  );
}
