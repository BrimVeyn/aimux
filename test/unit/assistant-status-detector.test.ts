import { describe, expect, test } from 'bun:test'

import type { TerminalLine, TerminalSnapshot } from '../../src/state/types'

import { AssistantStatusDetector, isShellCommand } from '../../src/pty/assistant-status-detector'

function snapshot(lines: string[], tailLines: string[] = lines): TerminalSnapshot {
  const terminalLines: TerminalLine[] = lines.map((text) => ({
    spans: [{ text }],
  }))
  const scrolledUp = tailLines !== lines
  return {
    baseY: scrolledUp ? 10 : 0,
    cursorVisible: true,
    lines: terminalLines,
    tailLines: tailLines.map((text) => ({ spans: [{ text }] })),
    viewportY: 0,
  }
}

describe('AssistantStatusDetector', () => {
  test('terminal assistant is always idle', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'terminal',
      command: 'zsh',
      tabId: 't',
      viewport: snapshot(['$ echo hi', 'hi']),
    })
    expect(s).toBe('idle')
  })

  test('claude: detects working from interrupt hint', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot(['✱ Thinking…', '  esc/ctrl+c to interrupt']),
    })
    expect(s).toBe('working')
  })

  test('claude: detects waiting-input on do-you-want prompt', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot(['Do you want to proceed?', '> 1. Yes  2. No']),
    })
    expect(s).toBe('waiting-input')
  })

  test('claude: idle when tail has no sentinels', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot(['❯ type your prompt']),
    })
    expect(s).toBe('idle')
  })

  test('claude: idle welcome screen is not mistaken for a spinner', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot([
        'Claude Code v2.1.150',
        'Opus 4.7 (1M context) with xhigh effort · Claude Max',
        '/private/tmp/aimux-wt/r-73931791/wt-test-bd759',
        '',
        '> Try "edit app.tsx to..."',
        '',
        '  ▶▶ bypass permissions on (shift+tab to cycle) · ← for agents',
      ]),
    })
    expect(s).toBe('idle')
  })

  test('claude: spinner line without an interrupt hint is working', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot(['✱ Thinking…']),
    })
    expect(s).toBe('working')
  })

  test('codex: detects working and waiting-input', () => {
    const d = new AssistantStatusDetector()
    expect(
      d.classify({
        assistant: 'codex',
        tabId: 't1',
        viewport: snapshot(['• Working (12s)', '  esc to interrupt']),
      })
    ).toBe('working')
    expect(
      d.classify({
        assistant: 'codex',
        tabId: 't2',
        viewport: snapshot(['Continue? [y/n]']),
      })
    ).toBe('waiting-input')
  })

  test('opencode: permission prompt is waiting-input', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'opencode',
      tabId: 't',
      viewport: snapshot(['△ Permission required to run command']),
    })
    expect(s).toBe('waiting-input')
  })

  test('grok: detects working from Thought for trace + interrupt', () => {
    const d = new AssistantStatusDetector()
    expect(
      d.classify({
        assistant: 'grok',
        tabId: 't1',
        viewport: snapshot(['Thought for 3.4s', '  esc to interrupt']),
      })
    ).toBe('working')
    expect(
      d.classify({
        assistant: 'grok',
        tabId: 't2',
        viewport: snapshot(['Thinking… some reasoning']),
      })
    ).toBe('working')
  })

  test('grok: plan approval prompt is waiting-input', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'grok',
      tabId: 't',
      viewport: snapshot(['[ a ] pprove [ c ] omment [ q ] uit plan']),
    })
    expect(s).toBe('waiting-input')
  })

  test('grok: waiting on answers Q&A + enter select is waiting-input', () => {
    const d = new AssistantStatusDetector()
    expect(
      d.classify({
        assistant: 'grok',
        tabId: 't',
        viewport: snapshot(['Waiting on answers for 3 questions', 'Enter :select']),
      })
    ).toBe('waiting-input')
  })

  test('grok: do you want / permission style prompt is waiting-input', () => {
    const d = new AssistantStatusDetector()
    expect(
      d.classify({
        assistant: 'grok',
        tabId: 't',
        viewport: snapshot(['Do you want to proceed with this change?']),
      })
    ).toBe('waiting-input')
  })

  test('grok: idle when tail has no sentinels (plain prompt screen)', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'grok',
      tabId: 't',
      viewport: snapshot(['grok-4.5 · ask', '❯ type your prompt here']),
    })
    expect(s).toBe('idle')
  })

  test('custom CLI: shell command is always idle regardless of activity', () => {
    const d = new AssistantStatusDetector()
    const now = 1000
    d.classify({
      assistant: 'my-shell',
      command: '/bin/bash',
      now,
      tabId: 't',
      viewport: snapshot(['$ running something']),
    })
    const s = d.classify({
      assistant: 'my-shell',
      command: '/bin/bash',
      now: now + 10,
      tabId: 't',
      viewport: snapshot(['$ different output']),
    })
    expect(s).toBe('idle')
  })

  test('custom CLI: generic y/n prompt → waiting-input', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'my-agent',
      command: 'my-agent',
      tabId: 't',
      viewport: snapshot(['Proceed with changes? (y/n)']),
    })
    expect(s).toBe('waiting-input')
  })

  test('uses true tail lines instead of the scrolled viewport bottom', () => {
    const d = new AssistantStatusDetector()
    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport: snapshot(
        ['old output', 'still scrolled up'],
        ['✱ Thinking…', '  esc/ctrl+c to interrupt']
      ),
    })
    expect(s).toBe('working')
  })

  test('custom CLI: tail changing → working, then stable → idle', () => {
    const d = new AssistantStatusDetector()
    const now = 5_000
    d.classify({
      assistant: 'my-agent',
      command: 'my-agent',
      now,
      tabId: 't',
      viewport: snapshot(['line A']),
    })
    // Very shortly after, tail changed → should classify as working
    const working = d.classify({
      assistant: 'my-agent',
      command: 'my-agent',
      now: now + 100,
      tabId: 't',
      viewport: snapshot(['line A', 'line B']),
    })
    expect(working).toBe('working')

    // Much later with the same tail → idle
    const idle = d.classify({
      assistant: 'my-agent',
      command: 'my-agent',
      now: now + 5_000,
      tabId: 't',
      viewport: snapshot(['line A', 'line B']),
    })
    expect(idle).toBe('idle')
  })

  test('works when terminal output does not fill the viewport height', () => {
    const d = new AssistantStatusDetector()
    const emptyLine = { spans: [{ text: '' }] }
    const viewport: TerminalSnapshot = {
      baseY: 0,
      cursorVisible: true,
      lines: [
        { spans: [{ text: '✱ Thinking…' }] },
        { spans: [{ text: '  esc/ctrl+c to interrupt' }] },
        ...Array.from({ length: 38 }, () => emptyLine),
      ],
      tailLines: Array.from({ length: 10 }, () => emptyLine),
      viewportY: 0,
    }

    const s = d.classify({
      assistant: 'claude',
      tabId: 't',
      viewport,
    })
    expect(s).toBe('working')
  })
})

describe('isShellCommand', () => {
  test('matches common shells', () => {
    expect(isShellCommand('bash')).toBe(true)
    expect(isShellCommand('/bin/zsh')).toBe(true)
    expect(isShellCommand('/usr/local/bin/fish -l')).toBe(true)
    expect(isShellCommand('pwsh.exe')).toBe(true)
  })

  test('rejects AI CLIs and unknown commands', () => {
    expect(isShellCommand('claude')).toBe(false)
    expect(isShellCommand('codex')).toBe(false)
    expect(isShellCommand('opencode')).toBe(false)
    expect(isShellCommand('grok')).toBe(false)
    expect(isShellCommand('my-agent')).toBe(false)
    expect(isShellCommand(undefined)).toBe(false)
    expect(isShellCommand('')).toBe(false)
  })
})
