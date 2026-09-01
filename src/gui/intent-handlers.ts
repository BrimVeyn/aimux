import type { GuiIntent } from '@aimux/gui-protocol'

import type { AppAction } from '../state/actions'
import type { AppState, GitFileSection, SnippetRecord } from '../state/types'
import type { GuiRuntime } from './runtime'

import { createPrefixedId } from '../platform/id'
import { isConfigSnippetId, saveSnippetCatalog } from '../state/snippet-catalog'

// Discriminated intent → existing reducer-action / pipeline-call dispatch.
// Hard rule (roadmap, DB1): "Tout intent GUI doit aboutir à une action du
// reducer partagé." This file MUST NOT introduce a parallel state machine or
// touch shared reducer code — every branch composes pre-existing actions /
// side-effects through `runtime.dispatch` and `runtime.pipeline`.
export function dispatchIntent(intent: GuiIntent, runtime: GuiRuntime): void {
  switch (intent.kind) {
    case 'modal.snippet.submit':
      // Roadmap P1.3 — client-authoritative snippet editor. The committed
      // values are carried in the intent payload (the React modal owns the
      // in-flight buffers), so this branch can't go through
      // `actions.saveSnippetEditor` (which reads buffers from `state.modal`).
      // We mirror the TUI's reducer/side-effect tail (catalog write +
      // `set-snippets` dispatch) via `applySnippetSubmit`, then close the
      // modal — same observable outcome as the keyboard-driven save.
      handleSnippetSubmit(intent, runtime)
      return
    case 'modal.submit':
      runtime.pipeline.confirmActiveModal()
      return
    case 'modal.cancel':
      runtime.dispatch({ type: 'close-modal' })
      return
    case 'modal.snippet.cancel':
      // Mirrors TUI `backToSnippetPicker` (packages/aimux-config/src/actions.ts:306):
      // single reducer action that transitions modal.type from snippet-editor
      // back to snippet-picker, preserving the picker context.
      runtime.dispatch({ type: 'open-snippet-picker' })
      return
    case 'git.stageFile':
      handleGitStage(intent.path, runtime)
      return
    case 'git.unstageFile':
      handleGitUnstage(intent.path, runtime)
      return
    case 'git.discardFile':
      handleGitDiscard(intent.path, runtime)
      return
    case 'git.toggleFolder':
      // Mirrors the TUI FolderRow onMouseDown handler (src/ui/components/git/git-panel.tsx:183-185):
      // a bare `git-mode-toggle-folder` dispatch with the row's key.
      runtime.dispatch({ key: intent.key, type: 'git-mode-toggle-folder' })
      return
  }
}

function handleSnippetSubmit(
  intent: Extract<GuiIntent, { kind: 'modal.snippet.submit' }>,
  runtime: GuiRuntime
): void {
  const state = runtime.getState()
  // The host owns `modal.projectTargetId` (set by `openSnippetEditor`); when
  // the intent omits `snippetId` (creation), we fall back to whatever the
  // open modal recorded. The intent value still wins when present — that's
  // the contract documented in `parseGuiIntent`.
  let snippetId: string | undefined = intent.snippetId
  if (snippetId === undefined && state.modal.type === 'snippet-editor') {
    snippetId = state.modal.projectTargetId ?? undefined
  }
  persistSnippetSubmit(
    {
      content: intent.content,
      name: intent.name,
      snippetId,
      trigger: intent.trigger,
    },
    state,
    runtime.dispatch
  )
  runtime.dispatch({ type: 'close-modal' })
}

// GUI-local persistence for the client-authoritative snippet editor (P1.3).
// Mirrors the validation rules of saveSnippetEditorState (trim, skip empty,
// config-pinned read-only) but reads from a caller-provided payload instead
// of state.modal.* — the modal owns its in-flight buffers in React. Reuses
// the same persistence tail (saveSnippetCatalog + set-snippets action) as
// the TUI's handleSaveSnippetEditorEffect, so both flows converge on the
// same on-disk + in-memory shape.
function persistSnippetSubmit(
  payload: { name: string; trigger: string; content: string; snippetId?: string },
  state: AppState,
  dispatch: (action: AppAction) => void
): void {
  const name = payload.name.trim()
  const content = payload.content.trim()
  const trimmedTrigger = payload.trigger.trim()
  if (name === '' || content === '') return

  const snippetId = payload.snippetId
  if (snippetId !== undefined && snippetId !== '' && isConfigSnippetId(snippetId)) return

  const trigger = trimmedTrigger.length > 0 ? trimmedTrigger : undefined

  const updated: SnippetRecord[] =
    snippetId !== undefined && snippetId !== ''
      ? state.snippets.map((snippet) =>
          snippet.id === snippetId ? { ...snippet, content, name, trigger } : snippet
        )
      : [...state.snippets, { content, id: createPrefixedId('snip'), name, trigger }]

  saveSnippetCatalog(updated)
  dispatch({ snippets: updated, type: 'set-snippets' })
}

// Mirrors `gitToggleSelected` in packages/aimux-config/src/actions.ts:611-628:
// optimistic-move into 'staged' + side-effect `git-stage`. The path-based
// intent skips the selection lookup but composes the same action/effect pair
// so the reducer + git pipeline see an identical sequence.
function handleGitStage(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section === 'staged') return
  const actions: AppAction[] = [
    {
      fromSection: file.section,
      path: file.path,
      toSection: 'staged',
      type: 'git-mode-optimistic-move',
    },
  ]
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: 'git-stage' }] },
    'git-mode'
  )
}

// Mirrors the staged-section branch of `gitDestructiveSelected`
// (packages/aimux-config/src/actions.ts:642-652).
function handleGitUnstage(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section !== 'staged') return
  const toSection: GitFileSection = file.status === 'A' ? 'untracked' : 'unstaged'
  const actions: AppAction[] = [
    {
      fromSection: 'staged',
      path: file.path,
      toSection,
      type: 'git-mode-optimistic-move',
    },
  ]
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: 'git-unstage' }] },
    'git-mode'
  )
}

// Mirrors the destructive (non-staged) branch of `gitDestructiveSelected`
// (packages/aimux-config/src/actions.ts:654-668), bypassing the pending-delete
// confirmation step — the GUI surfaces its own confirmation UI before sending
// the intent. Untracked → `git-rm`, tracked → `git-restore`.
function handleGitDiscard(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section === 'staged') return
  const isUntracked = file.section === 'untracked'
  const actions: AppAction[] = [
    { path: null, type: 'git-mode-set-pending-delete' },
    {
      fromSection: file.section,
      path: file.path,
      toSection: null,
      type: 'git-mode-optimistic-move',
    },
  ]
  const effectType = isUntracked ? 'git-rm' : 'git-restore'
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: effectType }] },
    'git-mode'
  )
}
