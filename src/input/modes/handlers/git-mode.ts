import type { AppAction, GitFileEntry } from '../../../state/types'
import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { result } from './shared'

const PAGE_SCROLL = 20

function selectedFile(ctx: ModeContext): GitFileEntry | undefined {
  return ctx.state.gitPanel.files[ctx.state.gitMode.selectedFileIndex]
}

function selectFile(ctx: ModeContext, delta: -1 | 1): KeyResult {
  const total = ctx.state.gitPanel.files.length
  if (total === 0) return result([])
  const next = (ctx.state.gitMode.selectedFileIndex + delta + total) % total
  if (next === ctx.state.gitMode.selectedFileIndex) return result([])
  const actions: AppAction[] = [{ delta, type: 'git-mode-select-file' }]
  return result(actions)
}

function scrollDiff(delta: number): KeyResult {
  return result([], [{ delta, type: 'scroll-git-diff' }])
}

function clearPendingIfAny(ctx: ModeContext): AppAction[] {
  if (ctx.state.gitMode.pendingDeletePath === null) return []
  return [{ path: null, type: 'git-mode-set-pending-delete' }]
}

function handleStageKey(ctx: ModeContext): KeyResult {
  const file = selectedFile(ctx)
  if (!file) return result(clearPendingIfAny(ctx))
  const actions = clearPendingIfAny(ctx)
  if (file.section === 'staged') {
    return result(actions)
  }
  actions.push({
    fromSection: file.section,
    path: file.path,
    toSection: 'staged',
    type: 'git-mode-optimistic-move',
  })
  return result(actions, [{ path: file.path, type: 'git-stage' }])
}

function handleDestructiveKey(ctx: ModeContext): KeyResult {
  const file = selectedFile(ctx)
  if (!file) return result(clearPendingIfAny(ctx))

  if (file.section === 'staged') {
    const actions = clearPendingIfAny(ctx)
    const toSection = file.status === 'A' ? 'untracked' : 'unstaged'
    actions.push({
      fromSection: 'staged',
      path: file.path,
      toSection,
      type: 'git-mode-optimistic-move',
    })
    return result(actions, [{ path: file.path, type: 'git-unstage' }])
  }

  const isUntracked = file.section === 'untracked'
  const pending = ctx.state.gitMode.pendingDeletePath

  if (pending === file.path) {
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
    return result(actions, [{ path: file.path, type: effectType }])
  }

  return result([{ path: file.path, type: 'git-mode-set-pending-delete' }])
}

function handleCommitKey(ctx: ModeContext): KeyResult {
  return result(
    [...clearPendingIfAny(ctx), { type: 'open-git-commit-modal' }],
    [],
    'modal.git-commit'
  )
}

function handlePushKey(ctx: ModeContext): KeyResult {
  return result(clearPendingIfAny(ctx), [{ type: 'git-push' }])
}

export const gitMode: ModeHandler = {
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return result([{ type: 'exit-git-mode' }], [], 'navigation')
    }

    if (key.name === 'j') return selectFile(ctx, 1)
    if (key.name === 'k') return selectFile(ctx, -1)

    if (key.ctrl && key.name === 'd') return scrollDiff(PAGE_SCROLL)
    if (key.ctrl && key.name === 'u') return scrollDiff(-PAGE_SCROLL)
    if (key.name === 'down') return scrollDiff(1)
    if (key.name === 'up') return scrollDiff(-1)

    if (key.name === 'a' && !key.ctrl && !key.meta) return handleStageKey(ctx)
    if (key.name === 'd' && !key.ctrl && !key.meta) return handleDestructiveKey(ctx)
    if (key.name === 'c' && !key.ctrl && !key.meta) return handleCommitKey(ctx)
    if (key.name === 'p' && !key.ctrl && !key.meta) return handlePushKey(ctx)

    return result(clearPendingIfAny(ctx))
  },

  id: 'git-mode',
}
