import { actions } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import type { TabSession } from '../../src/state/types'

import { deriveModeId, restartPromptHasKeys } from '../../src/input/modes/bridge'
import { appReducer, createInitialState } from '../../src/state/store'

function tab(overrides: Partial<TabSession> = {}): TabSession {
  return {
    assistant: 'claude',
    buffer: '',
    command: 'claude',
    id: 'tab-a',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'Claude',
    ...overrides,
  }
}

describe('restart prompt', () => {
  test('opens once the attach confirms the death, without taking over the keyboard', () => {
    // A cold start restores every tab as disconnected before the backend has
    // said anything: no prompt yet, or it would flash over live sessions.
    const restored = {
      ...appReducer(createInitialState(), {
        tab: tab({ status: 'disconnected' }),
        type: 'add-tab',
      }),
      focusMode: 'terminal-input' as const,
    }
    expect(restartPromptHasKeys(restored)).toBe(false)

    const hydrate = {
      activeTabId: 'tab-a',
      tabs: [tab({ status: 'disconnected' })],
      type: 'hydrate-project' as const,
    }
    const dead = { ...appReducer(restored, hydrate), focusMode: 'terminal-input' as const }
    expect(dead.tabs[0]?.restartPrompt).toBe('restore')
    expect(restartPromptHasKeys(dead)).toBe(true)
    // A layer, not a mode: the panes' keymap is still the one in charge.
    expect(deriveModeId(dead)).toBe('terminal-input')
    expect(actions.confirmRestartOption({ state: dead })?.effects[0]?.type).toBe('restart-tab')

    // The selection survives a re-attach, and Enter follows it.
    const onClose = appReducer(dead, {
      option: 'close',
      tabId: 'tab-a',
      type: 'select-restart-option',
    })
    expect(appReducer(onClose, hydrate).tabs[0]?.restartPrompt).toBe('close')
    expect(actions.confirmRestartOption({ state: onClose })?.effects[0]).toEqual({
      tabId: 'tab-a',
      type: 'close-tab',
    })

    // A restart clears it; a failure reopens it.
    const restarted = appReducer(onClose, { tabId: 'tab-a', type: 'reset-tab-project' })
    expect(restarted.tabs[0]?.restartPrompt).toBeUndefined()
    const failed = appReducer(restarted, {
      message: 'spawn failed',
      tabId: 'tab-a',
      type: 'set-tab-error',
    })
    expect(failed.tabs[0]?.restartPrompt).toBe('restore')
  })
})
