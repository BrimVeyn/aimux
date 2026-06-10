import { describe, expect, test } from 'bun:test'

import { isWorktreeTemplate } from '../../src/config'

const validMinimal = {
  id: 'solo',
  name: 'Solo',
  tabs: [{ panes: [{ assistant: 'claude', id: 'main' }] }],
}

const validMultiTab = {
  description: 'Two tabs, one with a split',
  id: 'fullstack',
  name: 'Fullstack',
  tabs: [
    {
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
    },
    {
      panes: [{ assistant: 'terminal', id: 'shell', send: 'git status' }],
    },
  ],
}

describe('isWorktreeTemplate', () => {
  test('accepts a minimal one-tab one-pane template', () => {
    expect(isWorktreeTemplate(validMinimal)).toBe(true)
  })

  test('accepts a multi-tab template with splits and sends', () => {
    expect(isWorktreeTemplate(validMultiTab)).toBe(true)
  })

  test('reuses pane ids across tabs without conflict', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          { panes: [{ assistant: 'claude', id: 'main' }] },
          { panes: [{ assistant: 'terminal', id: 'main' }] },
        ],
      })
    ).toBe(true)
  })

  test('rejects empty id or name', () => {
    expect(isWorktreeTemplate({ ...validMinimal, id: '' })).toBe(false)
    expect(isWorktreeTemplate({ ...validMinimal, name: '' })).toBe(false)
  })

  test('rejects empty tabs array', () => {
    expect(isWorktreeTemplate({ ...validMinimal, tabs: [] })).toBe(false)
  })

  test('rejects a tab with empty panes array', () => {
    expect(isWorktreeTemplate({ ...validMinimal, tabs: [{ panes: [] }] })).toBe(false)
  })

  test('rejects a root pane that declares splitFrom', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [{ panes: [{ assistant: 'claude', id: 'main', splitFrom: 'other' }] }],
      })
    ).toBe(false)
  })

  test('rejects a non-root pane missing splitFrom or direction', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          {
            panes: [
              { assistant: 'claude', id: 'main' },
              { assistant: 'terminal', id: 'lint' },
            ],
          },
        ],
      })
    ).toBe(false)
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          {
            panes: [
              { assistant: 'claude', id: 'main' },
              { assistant: 'terminal', id: 'lint', splitFrom: 'main' },
            ],
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects splitFrom referencing a pane in another tab', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          { panes: [{ assistant: 'claude', id: 'main' }] },
          {
            panes: [
              { assistant: 'terminal', id: 'shell' },
              {
                assistant: 'terminal',
                direction: 'horizontal',
                id: 'extra',
                splitFrom: 'main',
              },
            ],
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects duplicate pane ids within a tab', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          {
            panes: [
              { assistant: 'claude', id: 'main' },
              {
                assistant: 'terminal',
                direction: 'horizontal',
                id: 'main',
                splitFrom: 'main',
              },
            ],
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects ratio outside [0.15, 0.85]', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          {
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
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects invalid direction', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [
          {
            panes: [
              { assistant: 'claude', id: 'main' },
              {
                assistant: 'terminal',
                direction: 'diagonal',
                id: 'lint',
                splitFrom: 'main',
              },
            ],
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects non-string send', () => {
    expect(
      isWorktreeTemplate({
        ...validMinimal,
        tabs: [{ panes: [{ assistant: 'claude', id: 'main', send: 42 }] }],
      })
    ).toBe(false)
  })

  test('rejects non-object input', () => {
    expect(isWorktreeTemplate(null)).toBe(false)
    expect(isWorktreeTemplate('hi')).toBe(false)
    expect(isWorktreeTemplate(undefined)).toBe(false)
  })

  test('rejects template missing tabs field', () => {
    expect(isWorktreeTemplate({ id: 'x', name: 'X' })).toBe(false)
  })
})
