import { type CSSProperties, type ReactNode } from "react";
import type { ThemedToken } from "shiki";

import type { FileDiffMetadata } from "@aimux/diff-parser";
import {
  type DiffSegment,
  expandUnifiedSegment,
  gutterWidth,
  type UnifiedRowOrHeader,
} from "@aimux/ui/components/git/diff-renderer/build-rows";

import { theme } from "@/lib/theme";

import { renderTokenSpans } from "./diff-tokens";

interface StackedViewProps {
  addTokens: ThemedToken[][];
  delTokens: ThemedToken[][];
  file: FileDiffMetadata;
  segments: DiffSegment[];
}

const GUTTER_PAD_CH = 1;
const MARKER_WIDTH_CH = 2;

function gutterCellStyle(width: number): CSSProperties {
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

interface RowProps {
  row: UnifiedRowOrHeader;
  gutterW: number;
  addTokens: ThemedToken[][];
  delTokens: ThemedToken[][];
}

function Row({ addTokens, delTokens, gutterW, row }: RowProps): ReactNode {
  if (row.type === "hunk-header") {
    return (
      <div
        className="px-3 py-0.5"
        style={{ backgroundColor: theme.backgroundElement, color: theme.textMuted }}
      >
        {row.spec}
        {row.context !== undefined && row.context !== "" ? <span> {row.context}</span> : null}
      </div>
    );
  }
  if (row.type === "fold") {
    return (
      <div
        className="flex w-full"
        style={{ backgroundColor: theme.backgroundElement, color: theme.textMuted }}
      >
        <div style={gutterCellStyle(gutterW * 2 + 1)}>…</div>
        <div style={markerStyle(theme.textMuted)}> </div>
        <div className="min-w-0 flex-1" style={{ whiteSpace: "pre" }}>
          {`${row.fold.hidden} hidden lines`}
        </div>
      </div>
    );
  }
  if (row.type === "context") {
    const tokens = addTokens[row.lineIdx];
    return (
      <div className="flex w-full" style={{ color: theme.text }}>
        <div style={gutterCellStyle(gutterW)}>{row.delLineNumber}</div>
        <div style={gutterCellStyle(gutterW)}>{row.addLineNumber}</div>
        <div style={markerStyle(theme.textMuted)}> </div>
        <div className="min-w-0 flex-1" style={{ whiteSpace: "pre" }}>
          {renderTokenSpans({ fallback: row.content, tokens })}
        </div>
      </div>
    );
  }
  const isAddition = row.type === "addition";
  const bg = isAddition ? theme.diffAdded : theme.diffRemoved;
  const markerColor = isAddition ? theme.success : theme.error;
  const glyph = isAddition ? "+" : "-";
  const tokens = isAddition ? addTokens[row.lineIdx] : delTokens[row.lineIdx];
  return (
    <div className="flex w-full" style={{ backgroundColor: bg, color: theme.text }}>
      <div style={gutterCellStyle(gutterW)}>{isAddition ? "" : row.lineNumber}</div>
      <div style={gutterCellStyle(gutterW)}>{isAddition ? row.lineNumber : ""}</div>
      <div style={markerStyle(markerColor)}>{glyph}</div>
      <div className="min-w-0 flex-1" style={{ whiteSpace: "pre" }}>
        {renderTokenSpans({ fallback: row.content, tokens })}
      </div>
    </div>
  );
}

export function StackedView({
  addTokens,
  delTokens,
  file,
  segments,
}: StackedViewProps): ReactNode {
  const gw = gutterWidth(file);
  const rows: UnifiedRowOrHeader[] = [];
  for (const segment of segments) {
    rows.push(...expandUnifiedSegment(file, segment));
  }
  return (
    <div
      className="h-full overflow-auto font-mono text-xs"
      style={{ backgroundColor: theme.background, color: theme.text }}
    >
      {rows.map((row, idx) => (
        // Row keys are positional but stable for a given diff render.
        // eslint-disable-next-line react/no-array-index-key
        <Row
          key={`u:${idx}`}
          addTokens={addTokens}
          delTokens={delTokens}
          gutterW={gw}
          row={row}
        />
      ))}
    </div>
  );
}
