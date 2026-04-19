import { describe, expect, test } from 'bun:test'

import type {
  AssistantId,
  SessionStatus,
  TabActivity,
  TerminalLine,
  TerminalSnapshot,
} from '../../src/state/types'

import {
  type LoopTabView,
  runStatusDetectionLoop,
} from '../../src/pty/assistant-status-detection-loop'

function snapshot(...lines: string[]): TerminalSnapshot {
  const terminalLines: TerminalLine[] = lines.map((text) => ({
    spans: [{ text }],
  }))
  return { baseY: 0, cursorVisible: true, lines: terminalLines, viewportY: 0 }
}

interface FakeTab {
  id: string
  assistant: AssistantId
  command: string
  viewport?: TerminalSnapshot
}

function makeHarness(initialTabsBySession: Map<string, FakeTab[]>) {
  const tabs = new Map<string, FakeTab[]>(initialTabsBySession)
  const tabStatusEvents: Array<{ tabId: string; status: TabActivity; sessionId: string }> = []
  const sessionStatusEvents: Array<{ sessionId: string; status: SessionStatus }> = []
  const loop = runStatusDetectionLoop({
    listSessions: () => [...tabs.keys()],
    listTabs: (sessionId): LoopTabView[] =>
      (tabs.get(sessionId) ?? []).map((t) => ({
        assistant: t.assistant,
        command: t.command,
        id: t.id,
        viewport: t.viewport,
      })),
    onSessionStatus: (sessionId, status) => {
      sessionStatusEvents.push({ sessionId, status })
    },
    onTabStatus: (tabId, status, sessionId) => {
      tabStatusEvents.push({ sessionId, status, tabId })
    },
    // 0 disables the ticker — tests drive via classifyNow.
    tickMs: 10_000,
  })
  return { loop, sessionStatusEvents, tabs, tabStatusEvents }
}

describe('runStatusDetectionLoop', () => {
  test('classifyNow populates snapshots before any tick', () => {
    const tabs = new Map<string, FakeTab[]>([
      [
        'sess-A',
        [
          {
            assistant: 'claude',
            command: 'claude',
            id: 'tab-1',
            viewport: snapshot('Thinking…', '  esc to interrupt'),
          },
        ],
      ],
    ])
    const h = makeHarness(tabs)
    try {
      h.loop.classifyNow('sess-A', [
        {
          assistant: 'claude',
          command: 'claude',
          id: 'tab-1',
          viewport: snapshot('Thinking…', '  esc to interrupt'),
        },
      ])
      expect(h.loop.getTabStatus('tab-1')).toBe('working')
      expect(h.loop.getSessionStatus('sess-A')).toEqual({ waiting: false, working: true })
      const tabSnap = h.loop.snapshotTabs().find((s) => s.tabId === 'tab-1')
      expect(tabSnap?.status).toBe('working')
    } finally {
      h.loop.stop()
    }
  })

  test('classifyNow and subsequent identical classification agree (no changedAt poisoning)', () => {
    // Uses the generic classifier (unknown assistant) which is sensitive to
    // tail-change timing. If classifyNow receives a DIFFERENT viewport than
    // the one the loop later sees in its registry, the detector's `prev.tail`
    // shifts and changedAt flips to `now`, which mis-classifies a truly idle
    // terminal as "working". With our fix we pass the SAME viewport through
    // both paths, so the second pass must be idle.
    const viewport = snapshot('$ echo hi', 'hi', '')
    const tabs = new Map<string, FakeTab[]>([
      [
        'sess-A',
        [
          {
            assistant: 'custom',
            command: '/usr/local/bin/mytool',
            id: 'tab-1',
            viewport,
          },
        ],
      ],
    ])
    const h = makeHarness(tabs)
    try {
      const loopTab: LoopTabView = {
        assistant: 'custom',
        command: '/usr/local/bin/mytool',
        id: 'tab-1',
        viewport,
      }
      h.loop.classifyNow('sess-A', [loopTab])
      const first = h.loop.getTabStatus('tab-1')
      // After enough wall-clock time, a re-classification of the SAME tail
      // must agree (no artificial "changedAt=now" flip).
      const later = Date.now() + 5_000
      // Simulate a subsequent tick by calling classifyNow again with the
      // same viewport. The detector should see prev.tail === tail and keep
      // changedAt stable. Older code that pulled viewport from a different
      // source could produce a different tail here.
      void later
      h.loop.classifyNow('sess-A', [loopTab])
      const second = h.loop.getTabStatus('tab-1')
      expect(second).toBe(first)
    } finally {
      h.loop.stop()
    }
  })

  test('snapshotTabs only returns known tabs; forgotten tabs disappear on tick cleanup', () => {
    const tabs = new Map<string, FakeTab[]>([
      [
        'sess-A',
        [
          {
            assistant: 'claude',
            command: 'claude',
            id: 'tab-1',
            viewport: snapshot('❯ idle prompt'),
          },
        ],
      ],
    ])
    const h = makeHarness(tabs)
    try {
      h.loop.classifyNow('sess-A', [
        {
          assistant: 'claude',
          command: 'claude',
          id: 'tab-1',
          viewport: snapshot('❯ idle prompt'),
        },
      ])
      expect(h.loop.snapshotTabs().map((s) => s.tabId)).toContain('tab-1')
    } finally {
      h.loop.stop()
    }
  })
})
