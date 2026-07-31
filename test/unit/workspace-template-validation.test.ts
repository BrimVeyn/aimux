import { describe, expect, test } from 'bun:test'

import { isWorkspaceTemplate, parseWorkspaceTemplates } from '../../src/config'

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

describe('isWorkspaceTemplate', () => {
  test('accepts a minimal one-tab one-pane template', () => {
    expect(isWorkspaceTemplate(validMinimal)).toBe(true)
  })

  test('accepts a multi-tab template with splits and sends', () => {
    expect(isWorkspaceTemplate(validMultiTab)).toBe(true)
  })

  test('reuses pane ids across tabs without conflict', () => {
    expect(
      isWorkspaceTemplate({
        ...validMinimal,
        tabs: [
          { panes: [{ assistant: 'claude', id: 'main' }] },
          { panes: [{ assistant: 'terminal', id: 'main' }] },
        ],
      })
    ).toBe(true)
  })

  test('rejects empty id or name', () => {
    expect(isWorkspaceTemplate({ ...validMinimal, id: '' })).toBe(false)
    expect(isWorkspaceTemplate({ ...validMinimal, name: '' })).toBe(false)
  })

  test('rejects empty tabs array', () => {
    expect(isWorkspaceTemplate({ ...validMinimal, tabs: [] })).toBe(false)
  })

  test('rejects a tab with empty panes array', () => {
    expect(isWorkspaceTemplate({ ...validMinimal, tabs: [{ panes: [] }] })).toBe(false)
  })

  test('rejects a root pane that declares splitFrom', () => {
    expect(
      isWorkspaceTemplate({
        ...validMinimal,
        tabs: [{ panes: [{ assistant: 'claude', id: 'main', splitFrom: 'other' }] }],
      })
    ).toBe(false)
  })

  test('rejects a non-root pane missing splitFrom or direction', () => {
    expect(
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
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
      isWorkspaceTemplate({
        ...validMinimal,
        tabs: [{ panes: [{ assistant: 'claude', id: 'main', send: 42 }] }],
      })
    ).toBe(false)
  })

  test('rejects non-object input', () => {
    expect(isWorkspaceTemplate(null)).toBe(false)
    expect(isWorkspaceTemplate('hi')).toBe(false)
    expect(isWorkspaceTemplate(undefined)).toBe(false)
  })

  test('rejects template missing tabs field', () => {
    expect(isWorkspaceTemplate({ id: 'x', name: 'X' })).toBe(false)
  })

  test('rejects a root pane that declares ratio', () => {
    expect(
      isWorkspaceTemplate({
        ...validMinimal,
        tabs: [{ panes: [{ assistant: 'claude', id: 'main', ratio: 0.5 }] }],
      })
    ).toBe(false)
  })
})

describe('parseWorkspaceTemplates', () => {
  test('returns undefined when value is missing', () => {
    const issues: string[] = []
    expect(parseWorkspaceTemplates(undefined, issues)).toBeUndefined()
    expect(issues).toEqual([])
  })

  test('reports and ignores non-array input', () => {
    const issues: string[] = []
    expect(parseWorkspaceTemplates({ not: 'an array' }, issues)).toBeUndefined()
    expect(issues).toHaveLength(1)
  })

  test('drops invalid entries individually and keeps valid ones', () => {
    const issues: string[] = []
    const result = parseWorkspaceTemplates(
      [validMinimal, { id: 'bad', name: 'Bad' /* missing tabs */ }, validMultiTab],
      issues
    )
    expect(result?.map((t) => t.id)).toEqual(['solo', 'fullstack'])
    expect(issues).toHaveLength(1)
  })

  test('dedups by id, keeping the first occurrence', () => {
    const issues: string[] = []
    const dup = { ...validMultiTab, id: 'solo' }
    const result = parseWorkspaceTemplates([validMinimal, dup], issues)
    expect(result?.map((t) => t.id)).toEqual(['solo'])
    expect(result?.[0]?.name).toBe('Solo')
    expect(issues.some((m) => m.includes('duplicate'))).toBe(true)
  })
})
