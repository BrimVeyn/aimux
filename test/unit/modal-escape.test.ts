import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'
import type { Action } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { deriveModeId } from '../../src/input/modes/bridge'
import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler, transitionTo } from '../../src/input/modes/registry'
import { appReducer, createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

const ESC: KeyInput = { ctrl: false, meta: false, name: 'escape', sequence: '\x1b', shift: false }

/** Open the modal, press Esc, apply everything the app would apply. */
function pressEscape(open: Action[]): AppState {
  let state: AppState = { ...createInitialState(), currentProjectId: 'sess-1' }
  for (const action of open) state = appReducer(state, action)
  expect(state.modal.type).not.toBeNull()

  const modeId = deriveModeId(state)
  const result = getHandler(modeId)?.handleKey(ESC, { state }) ?? null
  expect(result).toBeTruthy()
  if (!result) throw new Error('no Esc binding')

  for (const action of result.actions) state = appReducer(state, action)
  if (result.transition) {
    const trans = transitionTo(modeId, result.transition, { state })
    for (const action of trans.actions) state = appReducer(state, action)
  }
  return state
}

/** Modals Esc dismisses outright. */
const CLOSES: [string, Action[]][] = [
  ['new-tab', [{ type: 'open-new-tab-modal' }]],
  ['help', [{ type: 'open-help-modal' }]],
  ['split-picker', [{ direction: 'right', type: 'open-split-picker' }]],
  ['project-picker', [{ type: 'open-project-picker' }]],
  ['create-project', [{ returnToProjectPicker: false, type: 'open-create-project-modal' }]],
  ['create-workspace', [{ type: 'open-create-workspace-modal' }]],
  ['snippet-picker', [{ type: 'open-snippet-picker' }]],
  ['theme-picker', [{ type: 'open-theme-picker' }]],
  ['quotas', [{ type: 'open-quotas-modal' }]],
  ['flash-jump', [{ type: 'open-flash-jump-modal' }]],
  ['git-commit', [{ projectId: 'sess-1', type: 'open-git-commit-modal' }]],
  ['settings-search', [{ type: 'open-settings-search' }]],
  [
    'setting-text',
    [{ label: 'X', settingId: 'theme', type: 'open-setting-text-modal', value: 'v' }],
  ],
  ['workspace-move', [{ sourceWorkspaceId: 'ws-1', type: 'open-workspace-move-modal' }]],
  [
    'rename-workspace',
    [{ initialName: 'w', type: 'open-rename-workspace-modal', workspaceId: 'ws-1' }],
  ],
  [
    'update-available',
    [{ currentVersion: '1.0.0', latestVersion: '1.1.0', type: 'open-update-available-modal' }],
  ],
]

for (const [label, open] of CLOSES) {
  test(`Esc closes the ${label} modal`, () => {
    expect(pressEscape(open).modal.type).toBeNull()
  })
}

/** Sub-states Esc steps back out of — never into a mode that cannot handle keys. */
const STEPS_BACK: [string, Action[], string][] = [
  [
    'new-tab editing-command',
    [{ type: 'open-new-tab-modal' }, { assistantId: 'claude', type: 'open-edit-custom-command' }],
    'modal.new-tab.command-edit',
  ],
  [
    'project-name',
    [{ type: 'open-project-picker' }, { type: 'open-project-name-modal' }],
    'modal.project-picker.filtering',
  ],
  ['snippet-editor', [{ type: 'open-snippet-editor' }], 'modal.snippet-picker.filtering'],
  [
    'git-commit confirm',
    [{ projectId: 'sess-1', type: 'open-git-commit-modal' }, { type: 'git-commit-enter-confirm' }],
    'modal.git-commit',
  ],
  [
    'git-commit generating',
    [
      { projectId: 'sess-1', type: 'open-git-commit-modal' },
      { type: 'git-commit-enter-generating' },
    ],
    'modal.git-commit',
  ],
]

for (const [label, open, expectedMode] of STEPS_BACK) {
  test(`Esc steps ${label} back to ${expectedMode}`, () => {
    expect(deriveModeId(pressEscape(open))).toBe(expectedMode)
  })
}
