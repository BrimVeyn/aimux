import { type CSSProperties, Fragment, type ReactNode } from "react";
import type { ThemedToken } from "shiki";

import type { FileDiffMetadata } from "@aimux/diff-parser";
import {
  type DiffSegment,
  expandSplitSegment,
  gutterWidth,
  type SplitCell,
  type SplitRowOrHeader,
} from "@aimux/ui/components/git/diff-renderer/build-rows";

import { theme } from "@/lib/theme";

import { renderTokenSpans } from "./diff-tokens";

interface SplitViewProps {
  // Per-side tokens, indexed by line index in file.additionLines / deletionLines.
  addTokens: ThemedToken[][];
  delTokens: ThemedToken[][];
  file: FileDiffMetadata;
  segments: DiffSegment[];
}

// Visual constants. We mirror the TUI's 1ch gutter padding + marker column so
// the GUI feels familiar; sizes are scaled up slightly since text is rendered
// at the browser's font-size (vs. cell-grid in the TUI).
const GUTTER_PAD_CH = 1;
const MARKER_WIDTH_CH = 2;

function gutterStyle(width: number): CSSProperties {
  return {
    color: theme.textMuted,
    flexShrink: 0,
    paddingLeft: `${GUTTER_PAD_CH}ch`,
    paddingRight: `${GUTTER_PAD_CH}ch`,
    textAlign: "right",
    userSelect: "none",
    width: `${width + GUTTER_PAD_CH * 2}ch`,
  };
}

function markerStyle(color: string): CSSProperties {
  return {
    color,
    flexShrink: 0,
    textAlign: "center",
    userSelect: "none",
    width: `${MARKER_WIDTH_CH}ch`,
  };
}

function cellBackground(type: SplitCell["type"]): string | undefined {
  if (type === "addition") return theme.diffAdded;
  if (type === "deletion") return theme.diffRemoved;
  return undefined;
}

function cellMarker(type: SplitCell["type"]): { glyph: string; color: string } {
  if (type === "addition") return { color: theme.success, glyph: "+" };
  if (type === "deletion") return { color: theme.error, glyph: "-" };
  return { color: theme.textMuted, glyph: " " };
}

interface SideCellProps {
  cell: SplitCell;
  gutterWidthCh: number;
  tokens?: ThemedToken[];
}

function SideCell({ cell, gutterWidthCh, tokens }: SideCellProps): ReactNode {
  if (cell.type === "fold" || cell.type === "filler") {
    return (
      <div
        className="flex min-w-0 flex-1"
        style={{ backgroundColor: theme.backgroundElement, opacity: cell.type === "filler" ? 0.5 : 1 }}
      >
        <div style={gutterStyle(gutterWidthCh)}> </div>
        <div style={markerStyle(theme.textMuted)}> </div>
        <div className="min-w-0 flex-1" style={{ whiteSpace: "pre" }}>
          {cell.type === "fold" ? `… ${cell.fold.hidden} hidden lines` : " "}
        </div>
      </div>
    );
  }
  const marker = cellMarker(cell.type);
  const bg = cellBackground(cell.type);
  return (
    <div
      className="flex min-w-0 flex-1"
      style={{ backgroundColor: bg, color: theme.text }}
    >
      <div style={gutterStyle(gutterWidthCh)}>{cell.lineNumber}</div>
      <div style={markerStyle(marker.color)}>{marker.glyph}</div>
      <div className="min-w-0 flex-1" style={{ whiteSpace: "pre" }}>
        {renderTokenSpans({ fallback: cell.content, tokens })}
      </div>
    </div>
  );
}

export function SplitView({ addTokens, delTokens, file, segments }: SplitViewProps): ReactNode {
  const gw = gutterWidth(file);
  const rows: SplitRowOrHeader[] = [];
  for (const segment of segments) {
    rows.push(...expandSplitSegment(file, segment));
  }
  return (
    <div
      className="h-full overflow-auto font-mono text-xs"
      data-git-diff-scroll
      style={{ backgroundColor: theme.background, color: theme.text }}
    >
      {rows.map((row, idx) => {
        if (row.type === "hunk-header") {
          return (
            <div
              // Hunk headers are positional and may repeat with identical specs.
              // eslint-disable-next-line react/no-array-index-key
              key={`h:${idx}`}
              className="px-3 py-0.5"
              style={{ backgroundColor: theme.backgroundElement, color: theme.textMuted }}
            >
              {row.spec}
              {row.context !== undefined && row.context !== "" ? (
                <span> {row.context}</span>
              ) : null}
            </div>
          );
        }
        const leftTokens =
          row.left.type === "deletion"
            ? delTokens[row.left.lineIdx]
            : row.left.type === "context" || row.left.type === "addition"
              ? addTokens[row.left.lineIdx]
              : undefined;
        const rightTokens =
          row.right.type === "addition" || row.right.type === "context"
            ? addTokens[row.right.lineIdx]
            : row.right.type === "deletion"
              ? delTokens[row.right.lineIdx]
              : undefined;
        return (
          // Row keys are positional but stable for a given diff render.
          // eslint-disable-next-line react/no-array-index-key
          <Fragment key={`r:${idx}`}>
            <div className="flex w-full">
              <div className="flex min-w-0 flex-1 border-r" style={{ borderColor: theme.border }}>
                <SideCell cell={row.left} gutterWidthCh={gw} tokens={leftTokens} />
              </div>
              <div className="flex min-w-0 flex-1">
                <SideCell cell={row.right} gutterWidthCh={gw} tokens={rightTokens} />
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
