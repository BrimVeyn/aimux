import { createTestContext, type DaemonPluginContext } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DaemonTabEntry } from '../../src/daemon/daemon'

import {
  createDaemonContextExtender,
  type DaemonPluginBackings,
} from '../../src/daemon/plugin-services'

/**
 * The daemon half's phase 9 services against recorded backings: what a tab's
 * session is, what it has spent, how a resume respawns it — and a workspace
 * write that says why it cannot, on a daemon that gave no registrar.
 */
const SESSION = '0e9b2d8a-1c5f-4a7e-9b3d-2f6c8e1a4b5d'
const originalHome = process.env.HOME
let tempHome = ''
let spawned: unknown[] = []
let closed: string[] = []

function backings(tabs: Map<string, DaemonTabEntry>): DaemonPluginBackings {
  return {
    activeTabId: () => null,
    closeTab: async (tabId) => {
      closed.push(tabId)
    },
    focus: async () => {},
    hookServer: () => null,
    renameTab: () => {},
    spawnTab: async (input) => {
      spawned.push(input)
      return 'tab-new'
    },
    tabs: () => tabs,
    write: async () => {},
  }
}

function entry(command: string, assistant = 'claude'): DaemonTabEntry {
  return {
    assistant,
    command,
    projectId: 'p1',
    title: 'Claude',
    viewport: undefined,
    viewportSeq: 0,
  }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-daemon-phase9-'))
  process.env.HOME = tempHome
  spawned = []
  closed = []
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tempHome, { force: true, recursive: true })
})

describe('ctx.assistants.session / usage / resume', () => {
  test('reads the conversation from the argv the daemon keeps', async () => {
    const dir = join(tempHome, '.claude', 'projects', '-Users-me-repo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${SESSION}.jsonl`),
      `${JSON.stringify({
        message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 3, output_tokens: 4 } },
        requestId: 'r1',
        timestamp: '2026-09-03T10:00:00.000Z',
      })}\n`
    )
    const tabs = new Map([['tab-1', entry(`claude --session-id ${SESSION} --model opus`)]])
    const t = createTestContext({
      extend: createDaemonContextExtender(backings(tabs)),
      host: 'daemon',
    })
    const ctx = t.ctx as DaemonPluginContext

    const session = ctx.assistants.session('tab-1')
    expect(session?.sessionId).toBe(SESSION)
    expect(session?.model).toBe('opus')
    expect(session?.transcriptPath).toBe(join(dir, `${SESSION}.jsonl`))
    expect(ctx.assistants.session('nope')).toBeUndefined()

    const usage = await ctx.assistants.usage('tab-1')
    expect(usage?.total).toBe(7)
    expect(usage?.turns).toBe(1)

    const newId = await ctx.assistants.resume('tab-1')
    expect(newId).toBe('tab-new')
    expect(closed).toEqual(['tab-1'])
    expect(spawned[0]).toMatchObject({
      args: ['--resume', SESSION],
      assistant: 'claude',
      command: 'claude',
      projectId: 'p1',
    })
  })

  test('a shell tab has no session, and cannot be resumed', async () => {
    const tabs = new Map([['tab-1', entry('/bin/zsh', 'terminal')]])
    const t = createTestContext({
      extend: createDaemonContextExtender(backings(tabs)),
      host: 'daemon',
    })
    const ctx = t.ctx as DaemonPluginContext
    expect(ctx.assistants.session('tab-1')?.sessionId).toBeNull()
    expect((await ctx.assistants.usage('tab-1'))?.total).toBe(0)
    expect(ctx.assistants.resume('tab-1')).rejects.toThrow('no session')
  })
})

describe('ctx.workspaces.create', () => {
  test('says why when the daemon gave no registrar', async () => {
    const t = createTestContext({
      extend: createDaemonContextExtender(backings(new Map())),
      host: 'daemon',
    })
    const ctx = t.ctx as DaemonPluginContext
    expect(ctx.workspaces.create({ name: 'x', projectId: 'p1' })).rejects.toThrow(
      'cannot register workspaces'
    )
  })
})
