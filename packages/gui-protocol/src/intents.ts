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
      // `modal.projectTargetId` from the `openSnippetEditor` message);
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
  // `key` is the composite `${section}:dir:${folderPath}` from `gitFolderKey`
  // — same identity the reducer's `git-mode-toggle-folder` action expects.
  | { kind: 'git.toggleFolder'; key: string }
  // Dragging a tab along the strip. No single keystroke expresses "put this
  // entry at that index", which is exactly what this envelope is for. The
  // list is the FULL visible order after the drop, flattened through split
  // groups, matching what the `reorder-tabs` reducer expects.
  | { kind: 'tabs.reorder'; orderedTabIds: string[] }
  // Clicking a workspace row. Which of the two TUI paths this takes — a plain
  // `set-active-workspace`, or a project switch carrying the workspace — is
  // the host's call, since only it knows which project is current.
  | { kind: 'workspace.activate'; projectId: string; workspaceId: string }
  // The fold arrow on a project heading.
  | { kind: 'project.toggleCollapsed'; projectId: string }
  // The `+` on a project heading. The modal always targets the current
  // project, so the host switches first when the click landed on another one.
  | { kind: 'project.newWorkspace'; projectId: string }
  // The `+` in the sidebar header.
  | { kind: 'project.new' }
  // Dragging a project heading to a new slot in the sidebar.
  | { kind: 'projects.reorder'; orderedIds: string[] }

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
    case 'git.toggleFolder':
      if (typeof obj.key !== 'string') return null
      return { key: obj.key, kind: 'git.toggleFolder' }
    case 'tabs.reorder':
      if (!Array.isArray(obj.orderedTabIds)) return null
      if (!obj.orderedTabIds.every((id) => typeof id === 'string')) return null
      return { kind: 'tabs.reorder', orderedTabIds: obj.orderedTabIds as string[] }
    case 'workspace.activate':
      if (typeof obj.projectId !== 'string' || typeof obj.workspaceId !== 'string') return null
      return {
        kind: 'workspace.activate',
        projectId: obj.projectId,
        workspaceId: obj.workspaceId,
      }
    case 'project.toggleCollapsed':
      if (typeof obj.projectId !== 'string') return null
      return { kind: 'project.toggleCollapsed', projectId: obj.projectId }
    case 'project.newWorkspace':
      if (typeof obj.projectId !== 'string') return null
      return { kind: 'project.newWorkspace', projectId: obj.projectId }
    case 'project.new':
      return { kind: 'project.new' }
    case 'projects.reorder':
      if (!Array.isArray(obj.orderedIds)) return null
      if (!obj.orderedIds.every((id) => typeof id === 'string')) return null
      return { kind: 'projects.reorder', orderedIds: obj.orderedIds as string[] }
    default:
      return null
  }
}
