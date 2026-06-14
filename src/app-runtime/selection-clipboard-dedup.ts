// opentui re-emits 'finishSelection' on re-renders, focus changes, and
// viewport refreshes. Each of those would call copyToSystemClipboard with the
// *same* text, blindly clobbering whatever the user just copied in another
// app. We dedupe by content: aimux never writes the same selection twice in
// a row to the system clipboard, so an external copy survives any phantom
// re-emit of the previous in-aimux selection.
//
// The dedup state is reset when the renderer reports an empty selection
// (deselect), so a user who deliberately reselects the same text after
// clicking elsewhere still gets it copied.
let lastWrittenText: string | null = null

export function shouldWriteSelectionToClipboard(text: string): boolean {
  if (text === lastWrittenText) return false
  lastWrittenText = text
  return true
}

export function resetSelectionClipboardDedup(): void {
  lastWrittenText = null
}
