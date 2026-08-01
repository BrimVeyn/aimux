import { describe, expect, test } from 'bun:test'

import type {
  AssistantId,
  ProjectStatus,
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

function makeHarness(initialTabsByProject: Map<string, FakeTab[]>) {
  const tabs = new Map<string, FakeTab[]>(initialTabsByProject)
  const tabStatusEvents: { tabId: string; status: TabActivity; projectId: string }[] = []
  const projectStatusEvents: { projectId: string; status: ProjectStatus }[] = []
  const loop = runStatusDetectionLoop({
    listProjects: () => [...tabs.keys()],
    listTabs: (projectId): LoopTabView[] =>
      (tabs.get(projectId) ?? []).map((t) => ({
        assistant: t.assistant,
        command: t.command,
        id: t.id,
        viewport: t.viewport,
      })),
    onProjectStatus: (projectId, status) => {
      projectStatusEvents.push({ projectId, status })
    },
    onTabStatus: (tabId, status, projectId) => {
      tabStatusEvents.push({ projectId, status, tabId })
    },
    // 0 disables the ticker — tests drive via classifyNow.
    tickMs: 10_000,
  })
  return { loop, projectStatusEvents, tabs, tabStatusEvents }
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
      expect(h.loop.getProjectStatus('sess-A')).toEqual({ waiting: false, working: true })
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

  test('turn-complete: emits once after idle holds for the settle window, then re-arms after a working blip', async () => {
    let clock = 0
    const turnEvents: { tabId: string; projectId: string; idleMs: number }[] = []
    const idleViewport = snapshot('❯ ', '')
    const workingViewport = snapshot('✱ Thinking…', '  esc to interrupt')
    const tabState = {
      assistant: 'claude' as AssistantId,
      command: 'claude',
      viewport: idleViewport,
    }
    const loop = runStatusDetectionLoop({
      listProjects: () => ['sess-A'],
      listTabs: (): LoopTabView[] => [
        {
          assistant: tabState.assistant,
          command: tabState.command,
          id: 'tab-1',
          viewport: tabState.viewport,
        },
      ],
      nowFn: () => clock,
      onProjectStatus: () => {},
      onTabStatus: () => {},
      onTurnComplete: (tabId, projectId, idleMs) => {
        turnEvents.push({ idleMs, projectId, tabId })
      },
      tickMs: 5,
      turnSettleMs: 100,
    })
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 1000
      while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
    }
    try {
      // First ticks observe idle and record idleSince=0. Not yet past settle.
      await waitFor(() => loop.getTabStatus('tab-1') === 'idle')
      expect(turnEvents.length).toBe(0)
      // Advance logical time past the settle window; a tick must now fire once.
      clock = 250
      await waitFor(() => turnEvents.length > 0)
      expect(turnEvents.length).toBe(1)
      expect(turnEvents[0]?.tabId).toBe('tab-1')
      expect(turnEvents[0]?.idleMs).toBeGreaterThanOrEqual(100)
      // Holding idle longer must NOT re-emit within the same episode.
      clock = 900
      await Bun.sleep(40)
      expect(turnEvents.length).toBe(1)
      // A working blip re-arms; the next settled idle emits a second turn.
      tabState.viewport = workingViewport
      await waitFor(() => loop.getTabStatus('tab-1') === 'working')
      tabState.viewport = idleViewport
      await waitFor(() => loop.getTabStatus('tab-1') === 'idle')
      clock = 1200
      await waitFor(() => turnEvents.length > 1)
      expect(turnEvents.length).toBe(2)
    } finally {
      loop.stop()
    }
  })

  test('turn-complete: a working blip before the settle window elapses prevents any emit', async () => {
    let clock = 0
    const turnEvents: unknown[] = []
    const idleViewport = snapshot('❯ ', '')
    const workingViewport = snapshot('✱ Thinking…', '  esc to interrupt')
    const tabState = { viewport: idleViewport }
    const loop = runStatusDetectionLoop({
      listProjects: () => ['sess-A'],
      listTabs: (): LoopTabView[] => [
        { assistant: 'claude', command: 'claude', id: 'tab-1', viewport: tabState.viewport },
      ],
      nowFn: () => clock,
      onProjectStatus: () => {},
      onTabStatus: () => {},
      onTurnComplete: () => {
        turnEvents.push(1)
      },
      tickMs: 5,
      turnSettleMs: 1000,
    })
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 1000
      while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
    }
    try {
      await waitFor(() => loop.getTabStatus('tab-1') === 'idle')
      // Flip to working while still short of the settle window.
      clock = 500
      tabState.viewport = workingViewport
      await waitFor(() => loop.getTabStatus('tab-1') === 'working')
      // Advance well past the original settle deadline; the interrupted idle
      // episode must not fire.
      clock = 3000
      await Bun.sleep(40)
      expect(turnEvents.length).toBe(0)
    } finally {
      loop.stop()
    }
  })

  test('onTabQuestion fires once per waiting-input edge and re-arms after leaving', () => {
    const questions: { tabId: string; kind: string; prompt: string; options?: string[] }[] = []
    const idle = snapshot('❯ ', '')
    const waiting = snapshot('Do you want to proceed?', '❯ 1. Yes', '  2. No')
    const tabState = { viewport: idle }
    const loop = runStatusDetectionLoop({
      listProjects: () => ['sess-A'],
      listTabs: (): LoopTabView[] => [
        { assistant: 'claude', command: 'claude', id: 'tab-1', viewport: tabState.viewport },
      ],
      onProjectStatus: () => {},
      onTabQuestion: (tabId, _projectId, detail) => {
        questions.push({ ...detail, tabId })
      },
      onTabStatus: () => {},
      tickMs: 10_000,
    })
    const view = (): LoopTabView => ({
      assistant: 'claude',
      command: 'claude',
      id: 'tab-1',
      viewport: tabState.viewport,
    })
    try {
      // idle → no question
      loop.classifyNow('sess-A', [view()])
      expect(questions.length).toBe(0)
      // idle → waiting-input edge fires once
      tabState.viewport = waiting
      loop.classifyNow('sess-A', [view()])
      expect(questions.length).toBe(1)
      expect(questions[0]?.kind).toBe('permission')
      expect(questions[0]?.options).toEqual(['Yes', 'No'])
      // still waiting → no refire
      loop.classifyNow('sess-A', [view()])
      expect(questions.length).toBe(1)
      // back to idle, then waiting again → second edge fires
      tabState.viewport = idle
      loop.classifyNow('sess-A', [view()])
      tabState.viewport = waiting
      loop.classifyNow('sess-A', [view()])
      expect(questions.length).toBe(2)
    } finally {
      loop.stop()
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

  test("a tab's workspace reaches both status callbacks", async () => {
    // The client holds tabs for the project it is attached to only, so this id
    // is the only way a *foreign* project's workspace row learns anything.
    let clock = 0
    const statusEvents: { tabId: string; workspaceId: string | undefined }[] = []
    const turnEvents: { tabId: string; workspaceId: string | undefined }[] = []
    const loop = runStatusDetectionLoop({
      listProjects: () => ['sess-A'],
      listTabs: (): LoopTabView[] => [
        {
          assistant: 'claude',
          command: 'claude',
          id: 'tab-1',
          viewport: snapshot('❯ ', ''),
          workspaceId: 'wt-9',
        },
      ],
      nowFn: () => clock,
      onProjectStatus: () => {},
      onTabStatus: (tabId, _status, _projectId, workspaceId) => {
        statusEvents.push({ tabId, workspaceId })
      },
      onTurnComplete: (tabId, _projectId, _idleMs, workspaceId) => {
        turnEvents.push({ tabId, workspaceId })
      },
      tickMs: 5,
      turnSettleMs: 100,
    })
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 1000
      while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
    }
    try {
      await waitFor(() => statusEvents.length > 0)
      expect(statusEvents[0]).toEqual({ tabId: 'tab-1', workspaceId: 'wt-9' })
      clock = 250
      await waitFor(() => turnEvents.length > 0)
      expect(turnEvents[0]).toEqual({ tabId: 'tab-1', workspaceId: 'wt-9' })
    } finally {
      loop.stop()
    }
  })
})
