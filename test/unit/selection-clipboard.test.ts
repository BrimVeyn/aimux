import { expect, test } from 'bun:test'

import type { TabSession, TerminalLine } from '../../src/state/types'

import {
  type OtuiSelection,
  resolveSelectionClipboardText,
} from '../../src/app-runtime/selection-clipboard'

function makeLine(text: string): TerminalLine {
  return { spans: [{ text }] }
}

function makeTab(lines: TerminalLine[]): TabSession {
  return { viewport: { lines } } as unknown as TabSession
}

function makeSelection(opts: {
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
  viewportOrigin?: { x: number; y: number }
  blockText?: string
  isDragging?: boolean
}): OtuiSelection {
  const origin = opts.viewportOrigin ?? { x: 0, y: 0 }
  return {
    anchor: opts.anchor,
    focus: opts.focus,
    getSelectedText: () => opts.blockText ?? '',
    isDragging: opts.isDragging ?? false,
    touchedRenderables: [{ x: origin.x, y: origin.y }],
  }
}

test('resolveSelectionClipboardText returns stream text across lines (regression)', () => {
  const tab = makeTab([
    makeLine('first line here'),
    makeLine('middle full line'),
    makeLine('last line end'),
  ])
  const selection = makeSelection({
    anchor: { x: 6, y: 0 },
    blockText: 'line\nfull\nlast',
    focus: { x: 4, y: 2 },
  })

  const result = resolveSelectionClipboardText(selection, tab)

  expect(result.selectedText).toBe('line here\nmiddle full line\nlast')
  expect(result.streamLength).toBe(result.selectedText.length)
  expect(result.fallbackLength).toBe('line\nfull\nlast'.length)
})

test('resolveSelectionClipboardText applies viewport origin offset', () => {
  const tab = makeTab([makeLine('hello world'), makeLine('second row text')])
  const selection = makeSelection({
    anchor: { x: 12, y: 20 },
    focus: { x: 16, y: 21 },
    viewportOrigin: { x: 6, y: 20 },
  })

  const result = resolveSelectionClipboardText(selection, tab)

  expect(result.selectedText).toBe('world\nsecond row')
})

test('resolveSelectionClipboardText falls back when tab has no viewport', () => {
  const selection = makeSelection({
    anchor: { x: 0, y: 0 },
    blockText: 'native-fallback',
    focus: { x: 5, y: 0 },
  })

  const result = resolveSelectionClipboardText(selection, undefined)

  expect(result.selectedText).toBe('native-fallback')
  expect(result.streamLength).toBeNull()
})

test('resolveSelectionClipboardText falls back when no touched renderables', () => {
  const tab = makeTab([makeLine('abc')])
  const selection: OtuiSelection = {
    anchor: { x: 0, y: 0 },
    focus: { x: 3, y: 0 },
    getSelectedText: () => 'native',
    touchedRenderables: [],
  }

  const result = resolveSelectionClipboardText(selection, tab)

  expect(result.selectedText).toBe('native')
})

test('resolveSelectionClipboardText normalises reversed drag', () => {
  const tab = makeTab([makeLine('alpha'), makeLine('beta'), makeLine('gamma')])
  const reversed = makeSelection({
    anchor: { x: 3, y: 2 },
    focus: { x: 2, y: 0 },
  })

  const result = resolveSelectionClipboardText(reversed, tab)

  expect(result.selectedText).toBe('pha\nbeta\ngam')
})

test('resolveSelectionClipboardText uses linesOverride over tab.viewport.lines', () => {
  // The tab's live viewport has scrolled by one row since mouseDown — anchor
  // y=1 in the live state points at "beta" but the user clicked when the
  // pre-scroll snapshot was on screen and anchor y=1 was "alpha". Passing the
  // captured snapshot as override must trump the live state.
  const liveTab = makeTab([makeLine('beta-new-top'), makeLine('beta'), makeLine('gamma')])
  const capturedAtMouseDown: TerminalLine[] = [
    makeLine('captured-zero'),
    makeLine('captured-one'),
    makeLine('captured-two'),
  ]
  const selection = makeSelection({
    anchor: { x: 0, y: 1 },
    focus: { x: 13, y: 1 },
  })

  const withOverride = resolveSelectionClipboardText(selection, liveTab, capturedAtMouseDown)
  const withoutOverride = resolveSelectionClipboardText(selection, liveTab)

  expect(withOverride.selectedText).toBe('captured-one')
  expect(withoutOverride.selectedText).toBe('beta')
})
