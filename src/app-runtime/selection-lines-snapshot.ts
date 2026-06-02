import type { TerminalLine } from '../state/types'

// opentui's selection captures the rendered text at mouseDown time and reports
// it at mouseUp via getSelectedText(). The stream-text path in handleSelection
// instead reads activeTabRef.current.viewport.lines at mouseUp — if a snapshot
// landed between mouseDown and mouseUp, lines[] no longer matches what the
// user clicked on and the clipboard ends up with the next line down.
//
// This module mirrors opentui's behavior: capture viewport.lines on mouseDown,
// hand the same lines back at mouseUp so stream extraction works against the
// frame the user actually saw.

const captured = new Map<string, TerminalLine[]>()

export function captureSelectionLines(tabId: string, lines: readonly TerminalLine[]): void {
  captured.set(tabId, [...lines])
}

export function getSelectionLines(tabId: string): TerminalLine[] | null {
  return captured.get(tabId) ?? null
}

export function clearSelectionLines(tabId: string): void {
  captured.delete(tabId)
}
