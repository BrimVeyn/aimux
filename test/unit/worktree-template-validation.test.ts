import { describe, expect, test } from 'bun:test'

import { isWorktreeTemplate } from '../../src/config'

const validMinimal = {
  id: 'solo',
  name: 'Solo',
  panes: [{ assistant: 'claude', id: 'main' }],
}

const validTwoPane = {
  description: 'Run lint in a side pane',
  id: 'claude+lint',
  name: 'Claude + lint',
  panes: [
    { assistant: 'claude', id: 'main' },
    {
      assistant: 'terminal',
      direction: 'horizontal',
      id: 'lint',
      ratio: 0.35,
      send: 'bun lint --watch',
      splitFrom: 'main',
    },
  ],
}

describe('isWorktreeTemplate', () => {
  test('accepts a minimal one-pane template', () => {
    expect(isWorktreeTemplate(validMinimal)).toBe(true)
  })

  test('accepts a multi-pane template with all optional fields', () => {
    expect(isWorktreeTemplate(validTwoPane)).toBe(true)
  })

  test('rejects empty id or name', () => {
    expect(isWorktreeTemplate({ ...validMinimal, id: '' })).toBe(false)
    expect(isWorktreeTemplate({ ...validMinimal, name: '' })).toBe(false)
  })

  test('rejects empty panes array', () => {
    expect(isWorktreeTemplate({ ...validMinimal, panes: [] })).toBe(false)
  })

  test('rejects a root pane that declares splitFrom', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        panes: [{ assistant: 'claude', id: 'main', splitFrom: 'other' }],
      })
    ).toBe(false)
  })

  test('rejects a non-root pane missing splitFrom or direction', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          { assistant: 'terminal', id: 'lint' },
        ],
      })
    ).toBe(false)
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          { assistant: 'terminal', id: 'lint', splitFrom: 'main' },
        ],
      })
    ).toBe(false)
  })

  test('rejects splitFrom referencing a not-yet-declared pane', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'horizontal',
            id: 'lint',
            splitFrom: 'unknown',
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects duplicate pane ids', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'horizontal',
            id: 'main',
            splitFrom: 'main',
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects ratio outside [0.15, 0.85]', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'horizontal',
            id: 'lint',
            ratio: 0.05,
            splitFrom: 'main',
          },
        ],
      })
    ).toBe(false)
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'horizontal',
            id: 'lint',
            ratio: 0.95,
            splitFrom: 'main',
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects invalid direction', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'diagonal',
            id: 'lint',
            splitFrom: 'main',
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects non-string send', () => {
    expect(
      isWorktreeTemplate({
        ...validTwoPane,
        panes: [
          { assistant: 'claude', id: 'main' },
          {
            assistant: 'terminal',
            direction: 'horizontal',
            id: 'lint',
            send: 42,
            splitFrom: 'main',
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects non-object input', () => {
    expect(isWorktreeTemplate(null)).toBe(false)
    expect(isWorktreeTemplate('hi')).toBe(false)
    expect(isWorktreeTemplate(undefined)).toBe(false)
  })
})
