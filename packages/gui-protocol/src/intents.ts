// GUI-only intent envelope (DB1 / roadmap P1.1). Discriminated union of verbs
// the GUI can express that don't map cleanly to a single TUI keystroke. Every
// intent must resolve, on the host, to existing reducer actions / pipeline
// calls — the GUI does NOT own a parallel state machine. New kinds added here
// require a matching branch in `src/gui/intent-handlers.ts`.

/** Modal field identifier (matches `modal.activeField` unions in src/state/types.ts). */
export type ModalFieldId =
  // shared
  | 'assistant'
  | 'branch-name'
  | 'target-worktree'
  | 'worktree-name'
  // git-commit
  | 'title'
  | 'body'
  // create-session
  | 'directory'
  // snippet-editor
  | 'name'
  | 'trigger'
  | 'content'

export type GuiIntent =
  | { kind: 'modal.setField'; field: ModalFieldId; value: string }
  | { kind: 'modal.submit' }
  | { kind: 'modal.cancel' }
  | { kind: 'git.stageFile'; path: string }
  | { kind: 'git.unstageFile'; path: string }
  | { kind: 'git.discardFile'; path: string }

const MODAL_FIELD_IDS = new Set<ModalFieldId>([
  'assistant',
  'body',
  'branch-name',
  'content',
  'directory',
  'name',
  'target-worktree',
  'title',
  'trigger',
  'worktree-name',
])

function isModalFieldId(value: unknown): value is ModalFieldId {
  return typeof value === 'string' && MODAL_FIELD_IDS.has(value as ModalFieldId)
}

/** Parse and validate a candidate intent payload; null if malformed. */
export function parseGuiIntent(value: unknown): GuiIntent | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.kind !== 'string') return null
  switch (obj.kind) {
    case 'modal.setField':
      if (!isModalFieldId(obj.field) || typeof obj.value !== 'string') return null
      return { field: obj.field, kind: 'modal.setField', value: obj.value }
    case 'modal.submit':
      return { kind: 'modal.submit' }
    case 'modal.cancel':
      return { kind: 'modal.cancel' }
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
