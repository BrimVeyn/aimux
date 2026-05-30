// Smoke test for the GUI host pipeline's git-mode keyboard routing.
// Verifies the same chain TUI uses end-to-end:
//   key → deriveModeId → getHandler('git-mode').handleKey → processKeyResult.

import type { CliRenderer } from '@opentui/core'

import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { SessionBackend } from '../../src/session-backend/types'
import type { GitFileEntry } from '../../src/state/types'

import { createPipeline } from '../../src/gui/host-pipeline'
import { createStubRenderer, createTabTimeouts } from '../../src/gui/host-side-effect-ctx'
import { registerAllModes } from '../../src/input/modes/handlers'
import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

function bootHost(files: GitFileEntry[]) {
  const initial = createInitialState()
  appStore.setState(initial)
  appStore.getState().dispatch({
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  appStore.getState().dispatch({ type: 'enter-git-mode' })

  const writes: { tabId: string; bytes: string }[] = []
  const backend = {
    write: (tabId: string, bytes: string) => writes.push({ bytes, tabId }),
  } as unknown as SessionBackend
  const renderer = createStubRenderer() as CliRenderer
  const timeouts = createTabTimeouts()

  const pipeline = createPipeline({
    backend,
    getThemeId: () => 'aimux',
    renderer,
    setThemeId: () => {},
    timeouts,
  })

  return { backend, pipeline, writes }
}

describe('GUI host pipeline · git-mode keyboard', () => {
  const files: GitFileEntry[] = [
    { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
  ]

  test('routes `a` to gitStageSelected (git-stage effect fires)', () => {
    const { pipeline } = bootHost(files)
    // enter-git-mode auto-reconciles selectedEntryKey to the first entry.

    pipeline.handleKey({ ctrl: false, meta: false, name: 'a', sequence: 'a', shift: false })

    // Action should have moved the file to the staged section optimistically.
    const state = appStore.getState()
    const file = state.gitPanel.files.find((f) => f.path === 'a.ts')
    expect(file?.section).toBe('staged')
  })

  test('routes `]` to shiftGitHeadOffset (HEAD~N navigation)', () => {
    const { pipeline } = bootHost(files)
    const before = appStore.getState().gitMode.headOffset

    pipeline.handleKey({ ctrl: false, meta: false, name: ']', sequence: ']', shift: false })

    const after = appStore.getState().gitMode.headOffset
    // `]` (newer) reduces the offset; bottom-clamped at 0.
    expect(after).toBe(Math.max(0, before - 1))
  })

  test('routes `[` to shiftGitHeadOffset (older commit)', () => {
    const { pipeline } = bootHost(files)
    pipeline.handleKey({ ctrl: false, meta: false, name: '[', sequence: '[', shift: false })

    expect(appStore.getState().gitMode.headOffset).toBe(1)
  })

  test('routes `v` to toggleGitDiffView', () => {
    const { pipeline } = bootHost(files)
    const before = appStore.getState().gitMode.diffView

    pipeline.handleKey({ ctrl: false, meta: false, name: 'v', sequence: 'v', shift: false })

    expect(appStore.getState().gitMode.diffView).not.toBe(before)
  })

  test('routes Escape to exitGitMode (back to navigation)', () => {
    const { pipeline } = bootHost(files)
    expect(appStore.getState().focusMode).toBe('git')

    pipeline.handleKey({
      ctrl: false,
      meta: false,
      name: 'escape',
      sequence: '',
      shift: false,
    })

    expect(appStore.getState().focusMode).toBe('navigation')
  })
})
