import { describe, expect, test } from 'bun:test'

import type { ProjectRecord, TabSession, WorkspaceRecord } from '../../src/state/types'

import { collectSetupCandidates } from '../../src/app-runtime/use-setup-runner'

function workspace(id: string, source: WorkspaceRecord['source'] = 'aimux-temp'): WorkspaceRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    createdByAimux: source !== 'primary',
    id,
    name: id,
    path: `/repo/${id}`,
    repoRoot: '/repo',
    source,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function project(workspaces: WorkspaceRecord[], id = 'proj-1'): ProjectRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    id,
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    name: id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    workspaces,
  }
}

function setupTab(workspaceId: string): TabSession {
  return {
    assistant: 'terminal',
    buffer: '',
    command: 'bash',
    hidden: true,
    id: 'setup-tab',
    role: 'setup',
    status: 'running',
    terminalModes: {
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    },
    title: 'Setup',
    workspaceId,
  }
}

const always = () => true
const never = () => false

describe('collectSetupCandidates', () => {
  test('runs nothing on first sight of a project', () => {
    const seen = new Map<string, Set<string>>()
    const projects = [project([workspace('ws-primary', 'primary'), workspace('ws-a')])]

    expect(collectSetupCandidates(projects, [], seen, always)).toEqual([])
    // Everything it already had is now seen, so it can never retro-fire.
    expect([...(seen.get('proj-1') ?? [])]).toEqual(['ws-primary', 'ws-a'])
  })

  test('runs for a workspace that appears after first sight', () => {
    const seen = new Map<string, Set<string>>()
    const before = [project([workspace('ws-a')])]
    collectSetupCandidates(before, [], seen, always)

    const after = [project([workspace('ws-a'), workspace('ws-b')])]
    expect(collectSetupCandidates(after, [], seen, always).map((c) => c.workspace.id)).toEqual([
      'ws-b',
    ])
  })

  test('runs only once per workspace, however often it is re-examined', () => {
    const seen = new Map<string, Set<string>>()
    collectSetupCandidates([project([])], [], seen, always)

    const grown = [project([workspace('ws-b')])]
    expect(collectSetupCandidates(grown, [], seen, always)).toHaveLength(1)
    // The scroll-bomb guard: re-running the gate on every projects change — and
    // `j`/`k` changes it constantly — must not fire again.
    expect(collectSetupCandidates(grown, [], seen, always)).toEqual([])
    expect(collectSetupCandidates(grown, [], seen, always)).toEqual([])
  })

  test('never runs for the primary workspace', () => {
    const seen = new Map<string, Set<string>>()
    collectSetupCandidates([project([])], [], seen, always)

    // A brand-new project's `root` workspace IS the user's real checkout.
    const withPrimary = [project([workspace('ws-primary', 'primary')])]
    expect(collectSetupCandidates(withPrimary, [], seen, always)).toEqual([])
  })

  test('does not run without a script', () => {
    const seen = new Map<string, Set<string>>()
    collectSetupCandidates([project([])], [], seen, never)

    expect(collectSetupCandidates([project([workspace('ws-b')])], [], seen, never)).toEqual([])
  })

  test('does not run when a setup tab is already live for that workspace', () => {
    const seen = new Map<string, Set<string>>()
    collectSetupCandidates([project([])], [], seen, always)

    const grown = [project([workspace('ws-b')])]
    expect(collectSetupCandidates(grown, [setupTab('ws-b')], seen, always)).toEqual([])
  })

  test('tracks projects independently', () => {
    const seen = new Map<string, Set<string>>()
    collectSetupCandidates([project([workspace('ws-a')], 'proj-1')], [], seen, always)

    // proj-2 is seen for the first time here, so its existing workspaces are
    // seeded rather than run — even though proj-1 is already past first sight.
    const both = [
      project([workspace('ws-a'), workspace('ws-new')], 'proj-1'),
      project([workspace('ws-x')], 'proj-2'),
    ]
    expect(collectSetupCandidates(both, [], seen, always).map((c) => c.workspace.id)).toEqual([
      'ws-new',
    ])
  })
})
