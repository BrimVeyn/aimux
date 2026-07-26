import { describe, expect, test } from 'bun:test'

import type { WorkspaceOrigin } from '../../src/cli/client/workspace-resolver'
import type { CliContext } from '../../src/cli/context'
import type { SessionRecord } from '../../src/state/types'

import {
  normalizeTurnOutcome,
  resolveWorkerTarget,
  validateWorkerName,
  workerEnvelope,
  workerOutcomeExitCode,
  workerView,
} from '../../src/cli/commands/worker/shared'
import { COMMANDS } from '../../src/cli/registry'
import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_WORKER_METADATA,
  type TabSessionSummary,
} from '../../src/ipc/protocol'

const workspace: SessionRecord = {
  createdAt: '2026-01-01T00:00:00.000Z',
  id: 'ws-1',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  name: 'main',
  updatedAt: '2026-01-01T00:00:00.000Z',
  worktrees: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByAimux: false,
      id: 'wt-primary',
      name: 'repo',
      path: '/repo',
      repoRoot: '/repo',
      source: 'primary',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      branch: 'aimux/auth',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByAimux: true,
      id: 'wt-1',
      name: 'auth',
      path: '/tmp/auth',
      repoRoot: '/repo',
      source: 'aimux-temp',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

/** A second catalogued workspace — the UI switching to this is what §1/§2 was. */
const otherWorkspace: SessionRecord = {
  createdAt: '2026-01-01T00:00:00.000Z',
  id: 'ws-2',
  lastOpenedAt: '2026-01-02T00:00:00.000Z',
  name: 'playground',
  updatedAt: '2026-01-01T00:00:00.000Z',
  worktrees: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByAimux: false,
      id: 'wt-primary-2',
      name: 'playground',
      path: '/playground',
      repoRoot: '/playground',
      source: 'primary',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

const tabs: TabSessionSummary[] = [
  {
    activity: 'working',
    assistant: 'claude',
    command: 'claude',
    id: 'tab-1',
    lastLine: 'Running tests',
    status: 'running',
    title: 'auth',
    workerName: 'auth',
    worktreeId: 'wt-1',
  },
  {
    activity: 'idle',
    assistant: 'codex',
    command: 'codex',
    id: 'tab-2',
    status: 'running',
    title: 'plain tab',
  },
]

function namedTab(): TabSessionSummary {
  const tab = tabs[0]
  if (!tab) throw new Error('worker fixture is missing')
  return tab
}

function context(options: { active?: SessionRecord; origin?: WorkspaceOrigin } = {}): CliContext {
  const bySession: Record<string, TabSessionSummary[]> = { 'ws-1': tabs, 'ws-2': [] }
  const daemon = {
    getCapabilities: () => [IPC_CAPABILITY_LIST_TABS, IPC_CAPABILITY_WORKER_METADATA],
    hasCapability: (name: string) =>
      name === IPC_CAPABILITY_LIST_TABS || name === IPC_CAPABILITY_WORKER_METADATA,
    listTabs: async (sessionId: string) => ({
      activeTabId: null,
      tabs: bySession[sessionId] ?? [],
    }),
  }
  return {
    args: { flags: {}, positionals: [] },
    getDaemon: async () => daemon as never,
    getWorkspace: () => options.active ?? workspace,
    getWorkspaceOrigin: () => options.origin ?? 'active',
    getWorkspaces: () => [workspace, otherWorkspace],
  }
}

describe('worker facade helpers', () => {
  test('registers the complete worker workflow surface', () => {
    expect(
      COMMANDS.filter((command) => command.group === 'worker')
        .map((command) => command.verb)
        .sort()
    ).toEqual(['await', 'doctor', 'list', 'prompt', 'run', 'stop', 'submit'])
  })

  test('validates stable worker names', () => {
    expect(() => validateWorkerName('api-auth_2')).not.toThrow()
    expect(() => validateWorkerName('')).toThrow('worker name must be')
    expect(() => validateWorkerName('has spaces')).toThrow('worker name must be')
  })

  test('resolves named workers by name or tab id and ignores unnamed tabs', async () => {
    expect((await resolveWorkerTarget(context(), 'auth')).tab.id).toBe('tab-1')
    expect((await resolveWorkerTarget(context(), 'tab-1')).tab.workerName).toBe('auth')
    expect(resolveWorkerTarget(context(), 'tab-2')).rejects.toThrow('worker not found')
  })

  test('binds a worker to the workspace that owns it when the active one moved', async () => {
    // The UI switched to `playground` mid-run. The worker still lives in `main`,
    // so addressing it must keep working instead of reporting an empty fleet.
    const target = await resolveWorkerTarget(context({ active: otherWorkspace }), 'auth')
    expect(target.workspace.id).toBe('ws-1')
    expect(target.tab.id).toBe('tab-1')
  })

  test('keeps an explicitly pinned workspace as a boundary but names the real one', async () => {
    expect(
      resolveWorkerTarget(context({ active: otherWorkspace, origin: 'flag' }), 'auth')
    ).rejects.toThrow('it lives in main (tab-1)')
  })

  test('joins worktree context into the stable worker view', () => {
    expect(workerView(workspace, namedTab())).toEqual({
      activity: 'working',
      assistant: 'claude',
      branch: 'aimux/auth',
      command: 'claude',
      lastLine: 'Running tests',
      name: 'auth',
      path: '/tmp/auth',
      repoRoot: '/repo',
      status: 'running',
      tabId: 'tab-1',
      title: 'auth',
      worktreeId: 'wt-1',
    })
  })

  test('normalizes turn outcomes and preserves exit semantics', () => {
    const question = normalizeTurnOutcome({
      durationMs: 12,
      kind: 'permission',
      outcome: 'question',
      question: 'Allow?',
    })
    expect(question.status).toBe('question')
    expect(workerOutcomeExitCode(question)).toBe(10)
    expect(workerOutcomeExitCode({ durationMs: 1, status: 'dispatched' })).toBe(0)
    expect(workerOutcomeExitCode({ durationMs: 1, status: 'timeout' })).toBe(124)
    // A worker holding an unsubmitted prompt is recoverable, not an error: it
    // gets its own code so a caller can `worker submit` instead of re-dispatching.
    expect(workerOutcomeExitCode({ durationMs: 1, status: 'pending-submit' })).toBe(11)
    expect(workerOutcomeExitCode({ durationMs: 1, status: 'error' })).toBe(3)
  })

  test('emits a versioned envelope carrying workspace identity', () => {
    const view = workerView(workspace, namedTab())
    expect(workerEnvelope(workspace, view, { durationMs: 4, status: 'completed' })).toMatchObject({
      outcome: { status: 'completed' },
      schemaVersion: 1,
      worker: { name: 'auth', repoRoot: '/repo', tabId: 'tab-1' },
      workspace: { id: 'ws-1', name: 'main', repoRoot: '/repo' },
    })
  })

  test('ships a wrapper-free skill whose references resolve', async () => {
    const skill = await Bun.file('skills/aimux-orchestrator/SKILL.md').text()
    expect(skill).toContain('name: aimux-orchestrator')
    expect(skill).toContain('aimux worker run')
    expect(skill).not.toContain('scripts/spawn.sh')
    expect(skill).not.toContain('jq ')
    expect(await Bun.file('skills/aimux-orchestrator/references/prompts.md').exists()).toBeTrue()
    expect(await Bun.file('skills/aimux-orchestrator/references/review.md').exists()).toBeTrue()
    expect(
      await Bun.file('skills/aimux-orchestrator/assets/ledger.template.md').exists()
    ).toBeTrue()
  })
})
