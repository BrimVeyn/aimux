import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectRecord, WorkspaceRecord } from '../../src/state/types'

import { ensureProjectWorkspaces } from '../../src/state/project-workspaces'

const NOW = '2024-01-02T00:00:00.000Z'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeWorkspaceRecord(overrides: Partial<WorkspaceRecord> & Pick<WorkspaceRecord, 'id'>) {
  return {
    createdAt: NOW,
    createdByAimux: false,
    name: overrides.id,
    path: '/unset',
    repoRoot: '/unset',
    source: 'external' as const,
    updatedAt: NOW,
    ...overrides,
  } satisfies WorkspaceRecord
}

describe('workspace repoRoot healing', () => {
  let base: string
  let mainRepo: string
  let linkedWorkspace: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-wt-heal-')))
    mainRepo = join(base, 'main')
    linkedWorkspace = join(base, 'wt-a')
    execFileSync('git', ['init', mainRepo], { stdio: 'ignore' })
    git(mainRepo, 'config', 'user.email', 'test@example.com')
    git(mainRepo, 'config', 'user.name', 'Test')
    git(mainRepo, 'commit', '--allow-empty', '-m', 'init')
    git(mainRepo, 'worktree', 'add', '-b', 'feature', linkedWorkspace)
  })

  afterEach(() => {
    rmSync(base, { force: true, recursive: true })
  })

  test('repairs a record whose repoRoot points at a since-deleted sibling workspace', () => {
    const deletedSibling = join(base, 'deleted-sibling')
    const project: ProjectRecord = {
      activeWorkspaceId: 'wt-linked',
      createdAt: NOW,
      id: 'project-heal',
      lastOpenedAt: NOW,
      name: 'main',
      projectPath: linkedWorkspace,
      updatedAt: NOW,
      workspaces: [
        makeWorkspaceRecord({
          id: 'wt-primary',
          name: 'main',
          path: mainRepo,
          repoRoot: mainRepo,
          source: 'primary',
        }),
        makeWorkspaceRecord({
          branch: 'feature',
          id: 'wt-linked',
          name: 'wt-a',
          path: linkedWorkspace,
          // The sibling that created this workspace was already deleted, so its
          // path no longer exists — this is the incoherent state to heal.
          repoRoot: deletedSibling,
        }),
      ],
    }

    expect(existsSync(deletedSibling)).toBe(false)

    const healed = ensureProjectWorkspaces(project, NOW)
    const linked = healed.workspaces?.find((entry) => entry.id === 'wt-linked')

    expect(linked).toBeDefined()
    expect(linked?.repoRoot).not.toBe(deletedSibling)
    expect(existsSync(linked?.repoRoot ?? '')).toBe(true)
  })

  test('drops a deleted external workspace and prunes its stale git entry', () => {
    // Simulate the directory vanishing (e.g. a temp dir cleared on reboot)
    // while git still tracks it — git marks such workspaces "prunable".
    rmSync(linkedWorkspace, { force: true, recursive: true })

    const project: ProjectRecord = {
      activeWorkspaceId: 'wt-primary',
      createdAt: NOW,
      id: 'project-prune',
      lastOpenedAt: NOW,
      name: 'main',
      projectPath: mainRepo,
      updatedAt: NOW,
      workspaces: [
        makeWorkspaceRecord({
          id: 'wt-primary',
          name: 'main',
          path: mainRepo,
          repoRoot: mainRepo,
          source: 'primary',
        }),
        makeWorkspaceRecord({
          branch: 'feature',
          id: 'wt-ghost',
          name: 'wt-a',
          path: linkedWorkspace,
          repoRoot: mainRepo,
        }),
      ],
    }

    const reconciled = ensureProjectWorkspaces(project, NOW)

    expect(reconciled.workspaces?.map((entry) => entry.id)).toEqual(['wt-primary'])
    expect(reconciled.workspaces?.some((entry) => entry.path === linkedWorkspace)).toBe(false)

    // git no longer reports the prunable workspace once reconciliation runs.
    const list = execFileSync('git', ['-C', mainRepo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    })
    expect(list).not.toContain(linkedWorkspace)
  })
})
