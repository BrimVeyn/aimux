import type { Terminal } from "@xterm/headless";

import type { TerminalLine, TerminalSnapshot, TerminalSpan } from "../state/types";

const DEFAULT_TERMINAL_FG = "#edf4ff";
const DEFAULT_TERMINAL_BG = "#11151b";

const ANSI_PALETTE = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function paletteToHex(index: number): string {
  if (index < ANSI_PALETTE.length) {
    return ANSI_PALETTE[index] ?? ANSI_PALETTE[0]!;
  }

  if (index >= 232) {
    const shade = 8 + (index - 232) * 10;
    return toHex((shade << 16) | (shade << 8) | shade);
  }

  const normalized = index - 16;
  const r = Math.floor(normalized / 36);
  const g = Math.floor((normalized % 36) / 6);
  const b = normalized % 6;
  const channel = [0, 95, 135, 175, 215, 255];

  return toHex(
    ((channel[r] ?? 0) << 16) |
      ((channel[g] ?? 0) << 8) |
      (channel[b] ?? 0),
  );
}

function getColorHex(color: number, mode: "rgb" | "palette" | "default"): string | undefined {
  if (mode === "default") {
    return undefined;
  }

  return mode === "rgb" ? toHex(color) : paletteToHex(color);
}

function pushSpan(spans: TerminalSpan[], span: TerminalSpan): void {
  const previous = spans.at(-1);
  if (
    previous &&
    previous.fg === span.fg &&
    previous.bg === span.bg &&
    previous.bold === span.bold &&
    previous.italic === span.italic &&
    previous.underline === span.underline &&
    previous.cursor === span.cursor
  ) {
    previous.text += span.text;
    return;
  }

  spans.push(span);
}

function buildLine(terminal: Terminal, lineIndex: number, cursorColumn: number | null): TerminalLine {
  const line = terminal.buffer.active.getLine(lineIndex);

  if (!line) {
    return { spans: [] };
  }

  const cell = terminal.buffer.active.getNullCell();
  const spans: TerminalSpan[] = [];

  for (let column = 0; column < terminal.cols; column += 1) {
    const current = line.getCell(column, cell);
    if (!current || current.getWidth() === 0) {
      continue;
    }

    const text = current.getChars() || " ";
    const fgMode = current.isFgRGB()
      ? "rgb"
      : current.isFgPalette()
        ? "palette"
        : "default";
    const bgMode = current.isBgRGB()
      ? "rgb"
      : current.isBgPalette()
        ? "palette"
        : "default";

    let fg = getColorHex(current.getFgColor(), fgMode);
    let bg = getColorHex(current.getBgColor(), bgMode);

    if (current.isInverse()) {
      const resolvedFg = fg ?? DEFAULT_TERMINAL_FG;
      const resolvedBg = bg ?? DEFAULT_TERMINAL_BG;
      [fg, bg] = [resolvedBg, resolvedFg];
    }

    const isCursorCell = cursorColumn === column;
    if (isCursorCell) {
      const resolvedFg = fg ?? DEFAULT_TERMINAL_FG;
      const resolvedBg = bg ?? DEFAULT_TERMINAL_BG;
      [fg, bg] = [resolvedBg, resolvedFg];
    }

    pushSpan(spans, {
      text,
      fg,
      bg,
      bold: current.isBold() ? true : undefined,
      italic: current.isItalic() ? true : undefined,
      underline: current.isUnderline() ? true : undefined,
      cursor: isCursorCell ? true : undefined,
    });
  }

  return { spans };
}

export function snapshotTerminal(terminal: Terminal): TerminalSnapshot {
  const buffer = terminal.buffer.active;
  const startLine = buffer.viewportY;
  const cursorRow = buffer.cursorY;
  const cursorColumn = Math.min(buffer.cursorX, Math.max(terminal.cols - 1, 0));
  const lines: TerminalLine[] = [];

  for (let row = 0; row < terminal.rows; row += 1) {
    lines.push(buildLine(terminal, startLine + row, row === cursorRow ? cursorColumn : null));
  }

  return {
    lines,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
  };
}

function areSpansEqual(left: TerminalSpan, right: TerminalSpan): boolean {
  return (
    left.text === right.text &&
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.cursor === right.cursor
  );
}

function areLinesEqual(left: TerminalLine, right: TerminalLine): boolean {
  if (left.spans.length !== right.spans.length) {
    return false;
  }

  return left.spans.every((span, index) => {
    const other = right.spans[index];
    return other ? areSpansEqual(span, other) : false;
  });
}

export function areTerminalSnapshotsEqual(
  left?: TerminalSnapshot,
  right?: TerminalSnapshot,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  if (left.lines.length !== right.lines.length) {
    return false;
  }

  if (left.viewportY !== right.viewportY || left.baseY !== right.baseY) {
    return false;
  }

  return left.lines.every((line, index) => {
    const other = right.lines[index];
    return other ? areLinesEqual(line, other) : false;
  });
}
