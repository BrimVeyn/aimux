import type { GuiIntent } from '@aimux/gui-protocol'

import type { AppAction, GitFileSection } from '../state/types'
import type { GuiRuntime } from './runtime'

import { logDebug } from '../debug/input-log'

// Discriminated intent → existing reducer-action / pipeline-call dispatch.
// Hard rule (roadmap, DB1): "Tout intent GUI doit aboutir à une action du
// reducer partagé." This file MUST NOT introduce a parallel state machine or
// touch shared reducer code — every branch composes pre-existing actions /
// side-effects through `runtime.dispatch` and `runtime.pipeline`.
export function dispatchIntent(intent: GuiIntent, runtime: GuiRuntime): void {
  switch (intent.kind) {
    case 'modal.setField':
      // The existing reducer has no `(field, value)` setter — modal buffers are
      // mutated char-by-char through `update-command-edit`. P1.3 will migrate
      // the snippet-editor pilot to a client-authoritative `useState` buffer
      // with a single committed-value intent (`modal.snippet.submit`); the
      // generic per-field setter has no host-side semantics until then.
      // Until P1.3 lands, this branch is a logged no-op rather than a guess.
      logDebug('gui.intent.modalSetField.unimplemented', {
        field: intent.field,
        valueLen: intent.value.length,
      })
      return
    case 'modal.submit':
      runtime.pipeline.confirmActiveModal()
      return
    case 'modal.cancel':
      runtime.dispatch({ type: 'close-modal' })
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
  }
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
