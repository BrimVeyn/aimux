import { describe, expect, test } from 'bun:test'

import type { CliContext } from '../../src/cli/context'
import type { SessionRecord } from '../../src/state/types'

import {
  normalizeTurnOutcome,
  resolveWorkerTab,
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

function context(): CliContext {
  const daemon = {
    getCapabilities: () => [IPC_CAPABILITY_LIST_TABS, IPC_CAPABILITY_WORKER_METADATA],
    hasCapability: (name: string) =>
      name === IPC_CAPABILITY_LIST_TABS || name === IPC_CAPABILITY_WORKER_METADATA,
    listTabs: async () => ({ activeTabId: 'tab-1', tabs }),
  }
  return {
    args: { flags: {}, positionals: [] },
    getDaemon: async () => daemon as never,
    getWorkspace: () => workspace,
  }
}

describe('worker facade helpers', () => {
  test('registers the complete worker workflow surface', () => {
    expect(
      COMMANDS.filter((command) => command.group === 'worker')
        .map((command) => command.verb)
        .sort()
    ).toEqual(['await', 'doctor', 'list', 'prompt', 'run', 'stop'])
  })

  test('validates stable worker names', () => {
    expect(() => validateWorkerName('api-auth_2')).not.toThrow()
    expect(() => validateWorkerName('')).toThrow('worker name must be')
    expect(() => validateWorkerName('has spaces')).toThrow('worker name must be')
  })

  test('resolves named workers by name or tab id and ignores unnamed tabs', async () => {
    expect((await resolveWorkerTab(context(), 'auth')).id).toBe('tab-1')
    expect((await resolveWorkerTab(context(), 'tab-1')).workerName).toBe('auth')
    expect(resolveWorkerTab(context(), 'tab-2')).rejects.toThrow('worker not found')
  })

  test('joins worktree context into the stable worker view', () => {
    expect(workerView(context(), namedTab())).toEqual({
      activity: 'working',
      assistant: 'claude',
      branch: 'aimux/auth',
      command: 'claude',
      lastLine: 'Running tests',
      name: 'auth',
      path: '/tmp/auth',
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
  })

  test('emits a versioned envelope', () => {
    const view = workerView(context(), namedTab())
    expect(workerEnvelope(view, { durationMs: 4, status: 'completed' })).toMatchObject({
      outcome: { status: 'completed' },
      schemaVersion: 1,
      worker: { name: 'auth', tabId: 'tab-1' },
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
