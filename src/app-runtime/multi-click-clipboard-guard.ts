// On multi-click selection mouseUp opentui's finishSelection() fires the
// 'selection' event *after* our handleTerminalMouseUp has already written
// the clipboard from drag.capturedLines (anchored in absolute buffer rows).
// The event handler would then call computeStreamSelectedText against the
// *current* tab.viewport.lines and overwrite our write with a value that can
// diverge by a few rows when output/auto-scroll moved the viewport between
// mouseDown and mouseUp.
//
// finishSelection() emits exactly one 'selection' event, so we suppress
// exactly one — a consume-once flag rather than a time window (which could
// either expire before the event arrived, letting a wrong value through, or
// swallow an unrelated selection that happened to land in the window).
//
// A short guard window bounds the flag: if the expected event never arrives
// (no finishSelection fired), the flag self-heals instead of silently eating
// the user's next genuine selection.
const ARM_WINDOW_MS = 250
let armedAt = 0

export function recordMultiClickClipboardWrite(): void {
  armedAt = Date.now()
}

export function shouldSuppressSelectionCopy(): boolean {
  if (armedAt === 0) {
    return false
  }
  const withinWindow = Date.now() - armedAt < ARM_WINDOW_MS
  // Consume the arm regardless: the one finishSelection event is now handled,
  // and a stale arm must not suppress a later, unrelated selection.
  armedAt = 0
  return withinWindow
}
