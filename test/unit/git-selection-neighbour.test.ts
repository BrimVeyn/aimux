import { actions, getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { AppState, GitFileEntry } from '../../src/state/types'

import { buildKeymapHandlers } from '../../src/input/keymap/build-handlers'
import { deriveModeId, registerModeDerivation } from '../../src/input/modes/bridge'
import { appReducer, createInitialState } from '../../src/state/store'

const entry = (path: string): GitFileEntry => ({
  added: 1,
  path,
  removed: 0,
  section: 'unstaged',
  status: 'M',
})

const FILES = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(entry)

function withFiles(files: GitFileEntry[], state: AppState = createInitialState()): AppState {
  return appReducer(state, {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
}

describe('git mode selection when its file goes', () => {
  test('a discarded file hands the selection to the next one, not to the top', () => {
    let state = withFiles(FILES)
    state = appReducer(state, { key: 'unstaged:c.ts', type: 'git-mode-select-entry-by-key' })
    state = withFiles(
      FILES.filter((f) => f.path !== 'c.ts'),
      state
    )
    expect(state.gitMode.selectedEntryKey).toBe('unstaged:d.ts')
  })

  test('the last file going hands it to the one before', () => {
    let state = withFiles(FILES)
    state = appReducer(state, { key: 'unstaged:d.ts', type: 'git-mode-select-entry-by-key' })
    state = withFiles(
      FILES.filter((f) => f.path !== 'd.ts'),
      state
    )
    expect(state.gitMode.selectedEntryKey).toBe('unstaged:c.ts')
  })

  test('the optimistic removal a discard makes does the same, before git answers', () => {
    let state = withFiles(FILES)
    state = appReducer(state, { key: 'unstaged:b.ts', type: 'git-mode-select-entry-by-key' })
    state = appReducer(state, {
      fromSection: 'unstaged',
      path: 'b.ts',
      toSection: null,
      type: 'git-mode-optimistic-move',
    })
    expect(state.gitMode.selectedEntryKey).toBe('unstaged:c.ts')
  })
})

describe('git mode folders', () => {
  test('l opens a closed folder and closes an open one', () => {
    let state = withFiles([entry('src/a/x.ts'), entry('src/b.ts')])
    expect(state.gitMode.selectedEntryKey).toBe('unstaged:dir:src')
    const handler = buildKeymapHandlers(getDefaultKeymapConfig()).find((h) => h.id === 'git-mode')
    const press = (): void => {
      const result = handler?.handleKey(
        { ctrl: false, meta: false, name: 'l', sequence: 'l', shift: false },
        { state } as never
      )
      for (const action of result?.actions ?? []) state = appReducer(state, action)
    }
    press()
    expect(state.gitMode.collapsedFolders['unstaged:dir:src']).toBe(true)
    press()
    expect(state.gitMode.collapsedFolders['unstaged:dir:src']).toBeUndefined()
  })
})

describe('a plugin text field', () => {
  test('owns the keys over the plugin view, edits as typed, and reports how it closed', () => {
    let state = createInitialState()
    state = { ...state, activePluginView: 'acme.thing.view', focusMode: 'plugin-view' }
    const dispose = registerModeDerivation((s) =>
      s.focusMode === 'plugin-view' && s.modal.type === null
        ? ('plugin.acme.thing.view' as never)
        : null
    )
    try {
      expect(deriveModeId(state)).toBe('plugin.acme.thing.view')
      state = appReducer(state, {
        initial: 'ab',
        pluginId: 'acme.thing',
        type: 'open-plugin-input',
      })
      expect(deriveModeId(state)).toBe('modal.plugin-input')
      state = appReducer(state, { char: 'c', type: 'update-command-edit' })
      expect(state.modal.editBuffer).toBe('abc')

      const submitted = actions.submitPluginInput({ state } as never)
      expect(submitted?.effects).toEqual([
        {
          effectId: actions.PLUGIN_INPUT_SUBMIT,
          payload: 'abc',
          pluginId: 'acme.thing',
          type: 'plugin-effect',
        },
      ])
      for (const action of submitted?.actions ?? []) state = appReducer(state, action)
      // Back on the plugin's own screen, which never left.
      expect(state.focusMode).toBe('plugin-view')
      expect(deriveModeId(state)).toBe('plugin.acme.thing.view')
    } finally {
      dispose()
    }
  })
})
