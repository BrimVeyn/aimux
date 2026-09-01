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
  // Clicking a project heading. It lands on the checkout, so the host has to
  // resolve the primary workspace — the renderer does not decide that.
  | { kind: 'project.activate'; projectId: string }
  // The fold arrow on a project heading.
  | { kind: 'project.toggleCollapsed'; projectId: string }
  // The `+` on a project heading. The modal always targets the current
  // project, so the host switches first when the click landed on another one.
  | { kind: 'project.newWorkspace'; projectId: string }
  // The `+` in the sidebar header.
  | { kind: 'project.new' }
  // Dragging a project heading to a new slot in the sidebar.
  | { kind: 'projects.reorder'; orderedIds: string[] }
  // The bar footer's two entries. Both are full-screen views the panes step
  // aside for, and the only ones a mouse can reach at all.
  | { kind: 'view.settings' }
  | { kind: 'view.stats' }
  // Opening a link belongs to the host: aimux runs on the machine with the
  // browser the user actually uses, which the renderer may not be on.
  | { kind: 'url.open'; url: string }
  // The PR row's one button. Which of merge / branch-checkout / workspace
  // removal it means is `row.action` + `row.cleanup` in the projection; the
  // host re-derives it rather than trusting the renderer's copy.
  | { kind: 'pr.act' }
  // Almost every `gh` failure is "this account can't see this repo", so the
  // error state offers the one fix worth a click.
  | { kind: 'gh.switchAccount' }
  | { kind: 'git.toggleFileListMode' }
  // The setup widget's buttons. Each maps to the side effect of the same name.
  | {
      kind: 'setup.action'
      action: 'run' | 'stop' | 'configure' | 'ask-agent' | 'promote'
    }
  // A bar / widget context-menu entry. The renderer builds the menu from the
  // shared descriptors in `state/bar-menu.ts` and sends the chosen action back
  // verbatim, so both front-ends offer the same items under the same guards.
  | {
      kind: 'bar.menuAction'
      action:
        | { type: 'move-widget'; widgetId: string; side: 'left' | 'right'; index: number }
        | { type: 'toggle-widget'; widgetId: string }
        | { type: 'toggle-bar'; side: 'left' | 'right' }
    }

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
    case 'project.activate':
      if (typeof obj.projectId !== 'string') return null
      return { kind: 'project.activate', projectId: obj.projectId }
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
    case 'view.settings':
      return { kind: 'view.settings' }
    case 'view.stats':
      return { kind: 'view.stats' }
    case 'url.open':
      if (typeof obj.url !== 'string') return null
      return { kind: 'url.open', url: obj.url }
    case 'pr.act':
      return { kind: 'pr.act' }
    case 'gh.switchAccount':
      return { kind: 'gh.switchAccount' }
    case 'git.toggleFileListMode':
      return { kind: 'git.toggleFileListMode' }
    case 'setup.action': {
      const actions = ['run', 'stop', 'configure', 'ask-agent', 'promote'] as const
      const action = actions.find((candidate) => candidate === obj.action)
      return action === undefined ? null : { action, kind: 'setup.action' }
    }
    case 'bar.menuAction': {
      const action = obj.action as Record<string, unknown> | undefined
      if (typeof action?.type !== 'string') return null
      const side = action.side
      const sideOk = side === 'left' || side === 'right'
      if (action.type === 'toggle-bar') {
        return sideOk ? { action: { side, type: 'toggle-bar' }, kind: 'bar.menuAction' } : null
      }
      if (typeof action.widgetId !== 'string') return null
      if (action.type === 'toggle-widget') {
        return {
          action: { type: 'toggle-widget', widgetId: action.widgetId },
          kind: 'bar.menuAction',
        }
      }
      if (action.type === 'move-widget' && sideOk && typeof action.index === 'number') {
        return {
          action: { index: action.index, side, type: 'move-widget', widgetId: action.widgetId },
          kind: 'bar.menuAction',
        }
      }
      return null
    }
    default:
      return null
  }
}
