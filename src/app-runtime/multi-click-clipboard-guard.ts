// On multi-click selection mouseUp opentui's finishSelection() fires the
// 'selection' event *after* our handleTerminalMouseUp has already written
// the clipboard from drag.capturedLines (anchored at click time). The event
// handler would then call computeStreamSelectedText against the *current*
// tab.viewport.lines and overwrite our write with a value that can diverge
// by a few rows when output landed between mouseDown and mouseUp.
//
// To avoid that, handleTerminalMouseUp pings the guard right after it
// copies; handleSelection consults the guard and skips its own copy for a
// short window.

const SUPPRESS_WINDOW_MS = 100
let lastMultiClickWriteAt = 0

export function recordMultiClickClipboardWrite(): void {
  lastMultiClickWriteAt = Date.now()
}

export function shouldSuppressSelectionCopy(): boolean {
  return Date.now() - lastMultiClickWriteAt < SUPPRESS_WINDOW_MS
}
