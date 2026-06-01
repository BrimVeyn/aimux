import type { Terminal } from '@xterm/headless'

import type { TerminalLine, TerminalSnapshot, TerminalSpan } from '../state/types'

import { getCurrentTheme } from '../ui/theme'

const SNAPSHOT_TAIL_LINE_COUNT = 10

// CellColor preserves whether the cell emitted an indexed (ANSI 0-255) color
// or an RGB color, so the renderer process can resolve indices against the
// host terminal's actual palette (queried via OSC 4 at startup). Converting
// indices to RGB here would lock in xterm defaults and silently override the
// user's terminal theme — that's the very bug we're fixing.
type CellColor = { kind: 'rgb'; hex: string } | { kind: 'palette'; index: number } | undefined

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

function readCellColor(value: number, isRgb: boolean, isPalette: boolean): CellColor {
  if (isRgb) return { hex: toHex(value), kind: 'rgb' }
  if (isPalette) return { index: value, kind: 'palette' }
  return undefined
}

function applySpanColor(span: TerminalSpan, color: CellColor, side: 'fg' | 'bg'): void {
  if (!color) return
  if (color.kind === 'rgb') {
    span[side] = color.hex
  } else {
    span[side === 'fg' ? 'fgPalette' : 'bgPalette'] = color.index
  }
}

function pushSpan(spans: TerminalSpan[], span: TerminalSpan): void {
  const previous = spans.at(-1)
  if (
    previous &&
    previous.fg === span.fg &&
    previous.bg === span.bg &&
    previous.fgPalette === span.fgPalette &&
    previous.bgPalette === span.bgPalette &&
    previous.bold === span.bold &&
    previous.italic === span.italic &&
    previous.underline === span.underline &&
    previous.cursor === span.cursor
  ) {
    previous.text += span.text
    return
  }

  spans.push(span)
}

function buildLine(
  terminal: Terminal,
  lineIndex: number,
  cursorColumn: number | null,
  cursorVisible: boolean
): TerminalLine {
  const line = terminal.buffer.active.getLine(lineIndex)

  if (!line) {
    return { spans: [] }
  }

  const cell = terminal.buffer.active.getNullCell()
  const spans: TerminalSpan[] = []
  let visualColumns = 0

  for (let column = 0; column < terminal.cols; column += 1) {
    const current = line.getCell(column, cell)
    if (!current || current.getWidth() === 0) {
      continue
    }

    const text = current.getChars() || ' '

    let fg: CellColor = readCellColor(
      current.getFgColor(),
      current.isFgRGB(),
      current.isFgPalette()
    )
    let bg: CellColor = readCellColor(
      current.getBgColor(),
      current.isBgRGB(),
      current.isBgPalette()
    )

    if (current.isInverse()) {
      const tokens = getCurrentTheme()
      const resolvedFg: CellColor = fg ?? { hex: tokens.text, kind: 'rgb' }
      const resolvedBg: CellColor = bg ?? { hex: tokens.background, kind: 'rgb' }
      fg = resolvedBg
      bg = resolvedFg
    }

    const isCursorCell = cursorVisible && cursorColumn === column
    if (isCursorCell) {
      const tokens = getCurrentTheme()
      const resolvedFg: CellColor = fg ?? { hex: tokens.text, kind: 'rgb' }
      const resolvedBg: CellColor = bg ?? { hex: tokens.background, kind: 'rgb' }
      fg = resolvedBg
      bg = resolvedFg
    }

    const span: TerminalSpan = {
      bold: current.isBold() ? true : undefined,
      cursor: isCursorCell ? true : undefined,
      italic: current.isItalic() ? true : undefined,
      text,
      underline: current.isUnderline() ? true : undefined,
    }
    applySpanColor(span, fg, 'fg')
    applySpanColor(span, bg, 'bg')
    pushSpan(spans, span)

    visualColumns += current.getWidth()
  }

  // Pad the row to the full terminal width so opentui overwrites every cell.
  // Without padding, cells past the last written character retain content
  // from the previous frame (opentui's `blendCells` preserves the existing
  // char when an overlay space lands on it — see modal-shell.tsx for the
  // same class of bug solved differently for transparent modals).
  if (visualColumns < terminal.cols) {
    const padCount = terminal.cols - visualColumns
    const cursorInPad =
      cursorVisible &&
      cursorColumn !== null &&
      cursorColumn >= visualColumns &&
      cursorColumn < terminal.cols

    if (cursorInPad && cursorColumn !== null) {
      // cursorColumn is a buffer column while visualColumns is a sum of cell
      // widths; they diverge when wide glyphs precede the gap. Clamp the offset
      // into the pad so leading + cursor + trailing always equals padCount and
      // the row never over/undershoots terminal.cols (cursor may be a column
      // off in pathological wide-char rows, but the row width stays correct).
      const cursorOffset = Math.min(cursorColumn - visualColumns, padCount - 1)
      const leading = cursorOffset
      const trailing = padCount - cursorOffset - 1
      if (leading > 0) {
        pushSpan(spans, { text: ' '.repeat(leading) })
      }
      const tokens = getCurrentTheme()
      pushSpan(spans, {
        bg: tokens.text,
        cursor: true,
        fg: tokens.background,
        text: ' ',
      })
      if (trailing > 0) {
        pushSpan(spans, { text: ' '.repeat(trailing) })
      }
    } else {
      pushSpan(spans, { text: ' '.repeat(padCount) })
    }
  }

  return { spans }
}

export function snapshotTerminal(terminal: Terminal, cursorVisible = true): TerminalSnapshot {
  const buffer = terminal.buffer.active
  const startLine = buffer.viewportY
  const tailStartLine = Math.max(0, buffer.baseY + terminal.rows - SNAPSHOT_TAIL_LINE_COUNT)
  const cursorRow = buffer.cursorY
  const cursorColumn = Math.min(buffer.cursorX, Math.max(terminal.cols - 1, 0))
  const lines: TerminalLine[] = []
  const tailLines: TerminalLine[] = []

  // The window starts at viewportY, but cursorY is relative to baseY. The
  // cursor belongs on a rendered row only when its absolute buffer line
  // (baseY + cursorY) equals that row's buffer line (startLine + row).
  // Comparing row === cursorY was correct only while scrolled to the bottom
  // (viewportY === baseY) and misplaced the cursor otherwise.
  const cursorLine = buffer.baseY + cursorRow
  for (let row = 0; row < terminal.rows; row += 1) {
    const lineIndex = startLine + row
    lines.push(
      buildLine(terminal, lineIndex, lineIndex === cursorLine ? cursorColumn : null, cursorVisible)
    )
  }

  for (
    let lineIndex = tailStartLine;
    lineIndex <= buffer.baseY + terminal.rows - 1;
    lineIndex += 1
  ) {
    const relativeCursorRow = lineIndex - buffer.baseY
    tailLines.push(
      buildLine(
        terminal,
        lineIndex,
        relativeCursorRow === cursorRow ? cursorColumn : null,
        cursorVisible
      )
    )
  }

  return {
    baseY: buffer.baseY,
    cursorVisible,
    lines,
    tailLines,
    viewportY: buffer.viewportY,
  }
}

function areSpansEqual(left: TerminalSpan, right: TerminalSpan): boolean {
  return (
    left.text === right.text &&
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.fgPalette === right.fgPalette &&
    left.bgPalette === right.bgPalette &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.cursor === right.cursor
  )
}

function areLinesEqual(left: TerminalLine, right: TerminalLine): boolean {
  if (left.spans.length !== right.spans.length) {
    return false
  }

  return left.spans.every((span, index) => {
    const other = right.spans[index]
    return other ? areSpansEqual(span, other) : false
  })
}

export function areTerminalSnapshotsEqual(
  left?: TerminalSnapshot,
  right?: TerminalSnapshot
): boolean {
  if (!left || !right) {
    return left === right
  }

  if (left.lines.length !== right.lines.length) {
    return false
  }

  const leftTailLines = left.tailLines ?? []
  const rightTailLines = right.tailLines ?? []

  if (leftTailLines.length !== rightTailLines.length) {
    return false
  }

  if (
    left.viewportY !== right.viewportY ||
    left.baseY !== right.baseY ||
    left.cursorVisible !== right.cursorVisible
  ) {
    return false
  }

  return (
    left.lines.every((line, index) => {
      const other = right.lines[index]
      return other ? areLinesEqual(line, other) : false
    }) &&
    leftTailLines.every((line, index) => {
      const other = rightTailLines[index]
      return other ? areLinesEqual(line, other) : false
    })
  )
}
