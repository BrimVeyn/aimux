import { describe, expect, test } from 'bun:test'

import type { TabSession } from '../../src/state/types'

import { stripInjectedSessionArgs } from '../../src/pty/command-registry'
import { restoreTabsFromProject } from '../../src/state/project-persistence'
import { appReducer, createInitialState } from '../../src/state/store'

const SESSION_ID = '11111111-2222-3333-4444-555555555555'

function tab(overrides: Partial<TabSession> = {}): TabSession {
  return {
    activity: 'idle',
    assistant: 'claude',
    buffer: '',
    command: 'claude',
    id: 'tab-a',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'Claude',
    ...overrides,
  }
}

describe('hydrate-project', () => {
  // The daemon rebuilds `command` as `[command, ...args].join(' ')` and carries
  // no `sessionId` on the wire at all. Adopting its tabs wholesale used to bake
  // this spawn's `--session-id <uuid>` into the string the *next* spawn parses,
  // and to drop the id the resume depends on.
  test("keeps the client's own command and session id", () => {
    const base = createInitialState()
    const seeded = appReducer(base, {
      tab: tab({ sessionId: SESSION_ID }),
      type: 'add-tab',
    })

    const hydrated = appReducer(seeded, {
      activeTabId: 'tab-a',
      tabs: [tab({ command: `claude --session-id ${SESSION_ID}`, status: 'disconnected' })],
      type: 'hydrate-project',
    })

    const restored = hydrated.tabs.find((entry) => entry.id === 'tab-a')
    expect(restored?.command).toBe('claude')
    expect(restored?.sessionId).toBe(SESSION_ID)
    // Everything else still comes from the daemon.
    expect(restored?.status).toBe('disconnected')
  })

  test('adopts a tab it has never seen as-is', () => {
    const hydrated = appReducer(createInitialState(), {
      activeTabId: 'tab-z',
      tabs: [tab({ command: 'claude --model opus', id: 'tab-z' })],
      type: 'hydrate-project',
    })
    expect(hydrated.tabs[0]?.command).toBe('claude --model opus')
  })
})

describe('stripInjectedSessionArgs', () => {
  test('drops the session flags a previous spawn left behind', () => {
    expect(stripInjectedSessionArgs('claude', {}, ['--session-id', SESSION_ID])).toEqual([])
    expect(
      stripInjectedSessionArgs('claude', {}, ['--model', 'opus', '--resume', SESSION_ID])
    ).toEqual(['--model', 'opus'])
  })

  test('leaves flags a user wrote themselves alone', () => {
    const custom = { claude: `claude --resume ${SESSION_ID}` }
    expect(stripInjectedSessionArgs('claude', custom, ['--resume', SESSION_ID])).toEqual([
      '--resume',
      SESSION_ID,
    ])
    // Only a uuid-shaped value is ours to remove.
    expect(stripInjectedSessionArgs('claude', {}, ['--resume', 'yesterday'])).toEqual([
      '--resume',
      'yesterday',
    ])
  })
})

describe('restoreTabsFromProject', () => {
  // Snapshots written before the fix carry the uuid in `command` and nothing in
  // `sessionId`. The conversation is still recoverable from that string.
  test('recovers a session id the old hydrate wiped', () => {
    const restored = restoreTabsFromProject({
      activeTabId: 'tab-a',
      savedAt: new Date().toISOString(),
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: '',
          command: `claude --session-id ${SESSION_ID}`,
          id: 'tab-a',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Claude',
        },
      ],
      version: 1,
    })
    expect(restored[0]?.sessionId).toBe(SESSION_ID)
  })
})
