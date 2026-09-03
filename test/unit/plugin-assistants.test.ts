import { afterEach, describe, expect, test } from 'bun:test'

import type { TerminalSnapshot } from '../../src/state/types'

import { extractQuestion } from '../../src/pty/assistant-question-extractor'
import {
  clearAssistants,
  getAssistantDefinition,
  pluginAssistantOptions,
  registerAssistant,
} from '../../src/pty/assistant-registry'
import { AssistantStatusDetector } from '../../src/pty/assistant-status-detector'
import { getAllAssistantOptions } from '../../src/pty/command-registry'

/**
 * An assistant is not one thing: a spawn command, a way of reading its TUI, a
 * way of parsing a blocked prompt's choices, maybe a usage endpoint. A plugin
 * declares them together because from the outside they are one thing — a tab
 * that spawns and then never reports a status is a half-integration, not a
 * feature.
 */

const OPTION = {
  command: 'acme-robot',
  description: 'Acme robot CLI',
  id: 'acme.robot',
  label: 'Acme robot',
}

function screen(...lines: string[]): TerminalSnapshot {
  return {
    baseY: 0,
    cursorVisible: true,
    lines: lines.map((text) => ({ spans: [{ text }] })),
    viewportY: 0,
  }
}

afterEach(() => {
  clearAssistants()
})

describe('plugin assistants', () => {
  test('a registered assistant appears in the pick list, after the built-ins', () => {
    registerAssistant({ option: OPTION })
    const ids = getAllAssistantOptions({}).map((option) => option.id)

    expect(ids).toContain('acme.robot')
    expect(ids.indexOf('acme.robot')).toBeGreaterThan(ids.indexOf('claude'))
    expect(pluginAssistantOptions()).toHaveLength(1)
  })

  test('a custom command for a plugin id overrides it rather than duplicating it', () => {
    registerAssistant({ option: OPTION })
    const options = getAllAssistantOptions({ 'acme.robot': 'acme-robot --dev' })
    // That is what `customCommands` has always meant for a built-in id.
    expect(options.filter((option) => option.id === 'acme.robot')).toHaveLength(1)
  })

  test('an unregistered custom command is still its own entry', () => {
    const ids = getAllAssistantOptions({ mystery: 'mystery-cli' }).map((option) => option.id)
    expect(ids).toContain('mystery')
  })

  test('the status detector consults the registered classifier', () => {
    registerAssistant({
      detectStatus: ({ haystack }) => (haystack.includes('whirring') ? 'working' : null),
      option: OPTION,
    })
    const detector = new AssistantStatusDetector()

    expect(
      detector.classify({
        assistant: 'acme.robot',
        command: 'acme-robot',
        tabId: 't1',
        viewport: screen('Whirring away'),
      })
    ).toBe('working')
  })

  test('a classifier returning null hands over to the generic heuristic', () => {
    registerAssistant({ detectStatus: () => null, option: OPTION })
    const detector = new AssistantStatusDetector()

    // Same contract the built-in classifiers have: null is "no opinion", not
    // "idle".
    expect(
      detector.classify({
        assistant: 'acme.robot',
        command: 'acme-robot',
        tabId: 't1',
        viewport: screen('Do you want to proceed?'),
      })
    ).toBe('waiting-input')
  })

  test('an unregistered assistant still classifies generically', () => {
    const detector = new AssistantStatusDetector()
    expect(
      detector.classify({
        assistant: 'acme.gone',
        command: 'acme-gone',
        tabId: 't1',
        viewport: screen('Do you want to proceed?'),
      })
    ).toBe('waiting-input')
  })

  test('the question extractor prefers the plugin parser', () => {
    registerAssistant({
      extractOptions: () => ['Beep', 'Boop'],
      option: OPTION,
    })

    const detail = extractQuestion(
      'acme.robot',
      screen('Do you want to proceed?', '1. Yes', '2. No')
    )
    // The plugin knows its own menu shape; the shared parser is a fallback that
    // happens to work for most CLIs, not a rule any of them follow.
    expect(detail?.options).toEqual(['Beep', 'Boop'])
    // The prompt is still the captured text, and still authoritative.
    expect(detail?.prompt).toContain('Do you want to proceed?')
  })

  test('a plugin parser declining falls back to the shared one', () => {
    registerAssistant({
      extractOptions: () => {
        /* declines */
      },
      option: OPTION,
    })
    const detail = extractQuestion('acme.robot', screen('Pick one', '1. Yes', '2. No'))
    expect(detail?.options).toEqual(['Yes', 'No'])
  })

  test('disposing removes the definition without touching anything else', () => {
    const dispose = registerAssistant({ detectStatus: () => 'working', option: OPTION })
    expect(getAssistantDefinition('acme.robot')).toBeDefined()

    dispose()
    expect(getAssistantDefinition('acme.robot')).toBeUndefined()
    expect(getAllAssistantOptions({}).map((option) => option.id)).not.toContain('acme.robot')
  })

  test('a stale disposer does not remove the replacement', () => {
    const stale = registerAssistant({ option: OPTION })
    registerAssistant({ detectStatus: () => 'working', option: OPTION })
    stale()
    // A reload registers again; the old fiber's disposer must not take the new
    // definition — and with it every tab's status reporting — down with it.
    expect(getAssistantDefinition('acme.robot')?.detectStatus).toBeDefined()
  })
})
