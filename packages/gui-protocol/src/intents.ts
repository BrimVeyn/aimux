// GUI-only intent envelope (DB1 / roadmap P1.1). Discriminated union of verbs
// the GUI can express that don't map cleanly to a single TUI keystroke. Every
// intent must resolve, on the host, to existing reducer actions / pipeline
// calls — the GUI does NOT own a parallel state machine. New kinds added here
// require a matching branch in `src/gui/intent-handlers.ts`.

export type GuiIntent =
  | {
      kind: 'modal.snippet.submit'
      name: string
      trigger: string
      content: string
      // Present when editing an existing snippet (host populated
      // `modal.sessionTargetId` from the `openSnippetEditor` message);
      // absent for creation.
      snippetId?: string
    }
  | { kind: 'modal.submit' }
  | { kind: 'modal.cancel' }
  // Esc inside the snippet-editor: mirrors the TUI's `backToSnippetPicker`
  // which dispatches `open-snippet-picker` (transitions modal.type from
  // snippet-editor back to snippet-picker). `modal.cancel` would just close
  // the modal and lose the picker context.
  | { kind: 'modal.snippet.cancel' }
  | { kind: 'git.stageFile'; path: string }
  | { kind: 'git.unstageFile'; path: string }
  | { kind: 'git.discardFile'; path: string }

/** Parse and validate a candidate intent payload; null if malformed. */
export function parseGuiIntent(value: unknown): GuiIntent | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.kind !== 'string') return null
  switch (obj.kind) {
    case 'modal.snippet.submit': {
      if (
        typeof obj.name !== 'string' ||
        typeof obj.trigger !== 'string' ||
        typeof obj.content !== 'string'
      )
        return null
      // `snippetId` is optional but, when present, must be a string. A
      // wrong-typed value is a client bug; reject rather than silently coerce.
      if (obj.snippetId !== undefined && typeof obj.snippetId !== 'string') return null
      const intent: GuiIntent = {
        content: obj.content,
        kind: 'modal.snippet.submit',
        name: obj.name,
        trigger: obj.trigger,
      }
      if (typeof obj.snippetId === 'string') intent.snippetId = obj.snippetId
      return intent
    }
    case 'modal.submit':
      return { kind: 'modal.submit' }
    case 'modal.cancel':
      return { kind: 'modal.cancel' }
    case 'modal.snippet.cancel':
      return { kind: 'modal.snippet.cancel' }
    case 'git.stageFile':
      if (typeof obj.path !== 'string') return null
      return { kind: 'git.stageFile', path: obj.path }
    case 'git.unstageFile':
      if (typeof obj.path !== 'string') return null
      return { kind: 'git.unstageFile', path: obj.path }
    case 'git.discardFile':
      if (typeof obj.path !== 'string') return null
      return { kind: 'git.discardFile', path: obj.path }
    default:
      return null
  }
}
