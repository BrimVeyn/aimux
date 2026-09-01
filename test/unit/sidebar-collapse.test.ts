import { describe, expect, test } from 'bun:test'

import type { ProjectRecord, WorkspaceRecord } from '../../src/state/types'

import { getSidebarWorkspaces } from '../../src/state/workspace-view'

function makeWorkspace(id: string, source: WorkspaceRecord['source']): WorkspaceRecord {
  return {
    createdAt: '2024-01-01T00:00:00Z',
    createdByAimux: source !== 'primary',
    id,
    name: id,
    path: `/tmp/${id}`,
    repoRoot: '/tmp/repo',
    source,
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

function makeProject(partial: Partial<ProjectRecord>): ProjectRecord {
  return {
    createdAt: '2024-01-01T00:00:00Z',
    id: 'p',
    lastOpenedAt: '2024-01-01T00:00:00Z',
    name: 'p',
    updatedAt: '2024-01-01T00:00:00Z',
    workspaces: [makeWorkspace('checkout', 'primary'), makeWorkspace('wt', 'aimux-temp')],
    ...partial,
  }
}

describe('getSidebarWorkspaces', () => {
  test('an expanded project shows every workspace', () => {
    const project = makeProject({})
    expect(getSidebarWorkspaces(project, false).map((w) => w.id)).toEqual(['checkout', 'wt'])
  })

  test('a folded current project keeps only the row the cursor is on', () => {
    const project = makeProject({ activeWorkspaceId: 'wt', collapsed: true })
    expect(getSidebarWorkspaces(project, true).map((w) => w.id)).toEqual(['wt'])
  })

  test('a folded project falls back to its checkout when nothing is active', () => {
    const project = makeProject({ collapsed: true })
    expect(getSidebarWorkspaces(project, true).map((w) => w.id)).toEqual(['checkout'])
  })

  test('a folded project you are not in shows nothing', () => {
    const project = makeProject({ activeWorkspaceId: 'wt', collapsed: true })
    expect(getSidebarWorkspaces(project, false)).toEqual([])
  })
})
