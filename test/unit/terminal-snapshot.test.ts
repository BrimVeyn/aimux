import { Terminal } from '@xterm/headless'
import { describe, expect, test } from 'bun:test'

import { areTerminalSnapshotsEqual, snapshotTerminal } from '../../src/pty/terminal-snapshot'

describe('snapshotTerminal', () => {
  test('preserves ANSI foreground colors', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('\u001b[31mred\u001b[0m', resolve)
    })

    const snapshot = snapshotTerminal(terminal)
    const firstLine = snapshot.lines[0]

    expect(firstLine?.spans[0]?.text.trim()).toBe('red')
    // Palette indices are no longer pre-converted to hex; the renderer
    // resolves them against the host terminal's queried OSC 4 palette.
    expect(firstLine?.spans[0]?.fgPalette).toBe(1)
    expect(firstLine?.spans[0]?.fg).toBeUndefined()
    expect(snapshot.viewportY).toBe(0)
    expect(snapshot.baseY).toBe(0)
    expect(snapshot.cursorVisible).toBe(true)

    terminal.dispose()
  })

  test('renders inverse video with fallback terminal defaults', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('\u001b[7mrev\u001b[0m', resolve)
    })

    const snapshot = snapshotTerminal(terminal)
    const firstLine = snapshot.lines[0]

    expect(firstLine?.spans[0]?.text.trim()).toBe('rev')
    // inverse video: fg ← resolved `background`, bg ← resolved `text`.
    expect(firstLine?.spans[0]?.fg).toBe('#11151b')
    expect(firstLine?.spans[0]?.bg).toBe('#edf4ff')

    terminal.dispose()
  })

  test('compares identical snapshots as equal', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hello', resolve)
    })

    const left = snapshotTerminal(terminal)
    const right = snapshotTerminal(terminal)

    expect(areTerminalSnapshotsEqual(left, right)).toBe(true)
    terminal.dispose()
  })

  test('detects changed text between snapshots', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hello', resolve)
    })
    const before = snapshotTerminal(terminal)

    await new Promise<void>((resolve) => {
      terminal.write(' world', resolve)
    })
    const after = snapshotTerminal(terminal)

    expect(areTerminalSnapshotsEqual(before, after)).toBe(false)
    terminal.dispose()
  })

  test('marks the cursor cell in the snapshot', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hello', resolve)
    })

    const snapshot = snapshotTerminal(terminal)
    expect(snapshot.lines[0]?.spans.some((span) => span.cursor === true)).toBe(true)
    terminal.dispose()
  })

  test('detects cursor-only movement between snapshots', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hello', resolve)
    })
    const before = snapshotTerminal(terminal)

    await new Promise<void>((resolve) => {
      terminal.write('\u001b[D', resolve)
    })
    const after = snapshotTerminal(terminal)

    expect(areTerminalSnapshotsEqual(before, after)).toBe(false)
    terminal.dispose()
  })

  test('detects viewport scroll changes between snapshots', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4, scrollback: 100 })

    await new Promise<void>((resolve) => {
      terminal.write('1\r\n2\r\n3\r\n4\r\n5\r\n6', resolve)
    })
    const before = snapshotTerminal(terminal)

    terminal.scrollLines(-1)
    const after = snapshotTerminal(terminal)

    expect(before.viewportY).not.toBe(after.viewportY)
    expect(areTerminalSnapshotsEqual(before, after)).toBe(false)
    terminal.dispose()
  })

  test('captures buffer tail separately from the visible viewport', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4, scrollback: 100 })

    await new Promise<void>((resolve) => {
      terminal.write('1\r\n2\r\n3\r\n4\r\n5\r\n6', resolve)
    })

    terminal.scrollLines(-1)
    const snapshot = snapshotTerminal(terminal)

    expect(
      snapshot.lines.map((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .trim()
      )
    ).toEqual(['2', '3', '4', '5'])
    expect(
      snapshot.tailLines?.map((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .trim()
      )
    ).toEqual(['1', '2', '3', '4', '5', '6'])

    terminal.dispose()
  })

  test('hides cursor highlight when cursor visibility is off', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hello', resolve)
    })

    const snapshot = snapshotTerminal(terminal, false)
    expect(snapshot.cursorVisible).toBe(false)
    expect(snapshot.lines[0]?.spans.some((span) => span.cursor === true)).toBe(false)
    terminal.dispose()
  })

  test('pads short rows to the full terminal width to prevent ghosting', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hi', resolve)
    })

    const snapshot = snapshotTerminal(terminal, false)
    const firstLine = snapshot.lines[0]
    const width = firstLine?.spans.reduce((sum, span) => sum + span.text.length, 0)
    expect(width).toBe(20)
    expect(firstLine?.spans.map((span) => span.text).join('')).toBe('hi'.padEnd(20))
    terminal.dispose()
  })

  test('renders the cursor in the pad without changing the row width', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 })

    await new Promise<void>((resolve) => {
      terminal.write('hi', resolve)
    })

    // Cursor sits at column 2, in the unwritten tail.
    const snapshot = snapshotTerminal(terminal, true)
    const firstLine = snapshot.lines[0]
    const width = firstLine?.spans.reduce((sum, span) => sum + span.text.length, 0)
    expect(width).toBe(20)
    const cursorSpan = firstLine?.spans.find((span) => span.cursor === true)
    expect(cursorSpan?.text).toBe(' ')
    terminal.dispose()
  })
})
