import { describe, expect, test } from 'bun:test'

import { ASSISTANT_OPTIONS, getAllAssistantOptions } from '../../src/pty/command-registry'
import { appReducer, createInitialState } from '../../src/state/store'

describe('custom assistants', () => {
  test('getAllAssistantOptions includes built-in + custom assistants', () => {
    const options = getAllAssistantOptions({
      'my-ai': '/usr/local/bin/my-ai',
      'another-cli': 'another-cli --flag',
    })

    expect(options.length).toBe(ASSISTANT_OPTIONS.length + 2)

    const customAi = options.find((o) => o.id === 'my-ai')
    expect(customAi).toBeDefined()
    expect(customAi?.command).toBe('/usr/local/bin/my-ai')
    expect(customAi?.label).toBe('My-ai')

    const another = options.find((o) => o.id === 'another-cli')
    expect(another).toBeDefined()
    expect(another?.command).toBe('another-cli --flag')
  })

  test('custom command override for built-in does not create duplicate', () => {
    const options = getAllAssistantOptions({
      claude: 'claude --model opus',
    })

    expect(options.length).toBe(ASSISTANT_OPTIONS.length)
    const claudeOptions = options.filter((o) => o.id === 'claude')
    expect(claudeOptions.length).toBe(1)
  })

  test('new-tab modal option count includes custom assistants', () => {
    const state = createInitialState({ 'my-ai': '/usr/local/bin/my-ai' }, [], [], false)

    // Open new-tab modal
    let next = appReducer(state, { type: 'open-new-tab-modal' })
    expect(next.modal.type).toBe('new-tab')

    // Navigate past built-in options to custom one
    for (let i = 0; i < ASSISTANT_OPTIONS.length; i++) {
      next = appReducer(next, { type: 'move-modal-selection', delta: 1 })
    }

    // Should be on the custom assistant (index = ASSISTANT_OPTIONS.length)
    expect(next.modal.selectedIndex).toBe(ASSISTANT_OPTIONS.length)

    // Moving one more should wrap to 0
    next = appReducer(next, { type: 'move-modal-selection', delta: 1 })
    expect(next.modal.selectedIndex).toBe(0)
  })

  test('begin-command-edit works for custom assistant', () => {
    const state = {
      ...createInitialState({ 'my-ai': '/usr/local/bin/my-ai' }, [], [], false),
      focusMode: 'modal' as const,
      modal: {
        type: 'new-tab' as const,
        selectedIndex: ASSISTANT_OPTIONS.length, // custom assistant index
        editBuffer: null,
        sessionTargetId: null,
      },
    }

    const next = appReducer(state, { type: 'begin-command-edit' })
    expect(next.focusMode).toBe('command-edit')
    expect(next.modal.editBuffer).toBe('/usr/local/bin/my-ai')
  })

  test('commit-command-edit saves custom command for custom assistant', () => {
    const state = {
      ...createInitialState({ 'my-ai': '/usr/local/bin/my-ai' }, [], [], false),
      focusMode: 'command-edit' as const,
      modal: {
        type: 'new-tab' as const,
        selectedIndex: ASSISTANT_OPTIONS.length,
        editBuffer: '/new/path/my-ai --verbose',
        sessionTargetId: null,
      },
    }

    const next = appReducer(state, { type: 'commit-command-edit' })
    expect(next.customCommands['my-ai']).toBe('/new/path/my-ai --verbose')
    expect(next.modal.editBuffer).toBeNull()
    expect(next.focusMode).toBe('modal')
  })

  test('state initializes with custom commands from config', () => {
    const state = createInitialState(
      {
        'claude': 'claude --model opus',
        'my-custom-ai': '/path/to/ai',
      },
      [],
      [],
      false
    )

    expect(state.customCommands.claude).toBe('claude --model opus')
    expect(state.customCommands['my-custom-ai']).toBe('/path/to/ai')
  })
})
