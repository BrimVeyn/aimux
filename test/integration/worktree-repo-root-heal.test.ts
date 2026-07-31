import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectRecord, WorktreeRecord } from '../../src/state/types'

import { ensureProjectWorktrees } from '../../src/state/project-worktrees'

const NOW = '2024-01-02T00:00:00.000Z'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeWorktreeRecord(overrides: Partial<WorktreeRecord> & Pick<WorktreeRecord, 'id'>) {
  return {
    createdAt: NOW,
    createdByAimux: false,
    name: overrides.id,
    path: '/unset',
    repoRoot: '/unset',
    source: 'external' as const,
    updatedAt: NOW,
    ...overrides,
  } satisfies WorktreeRecord
}

describe('worktree repoRoot healing', () => {
  let base: string
  let mainRepo: string
  let linkedWorktree: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aimux-wt-heal-')))
    mainRepo = join(base, 'main')
    linkedWorktree = join(base, 'wt-a')
    execFileSync('git', ['init', mainRepo], { stdio: 'ignore' })
    git(mainRepo, 'config', 'user.email', 'test@example.com')
    git(mainRepo, 'config', 'user.name', 'Test')
    git(mainRepo, 'commit', '--allow-empty', '-m', 'init')
    git(mainRepo, 'worktree', 'add', '-b', 'feature', linkedWorktree)
  })

  afterEach(() => {
    rmSync(base, { force: true, recursive: true })
  })

  test('repairs a record whose repoRoot points at a since-deleted sibling worktree', () => {
    const deletedSibling = join(base, 'deleted-sibling')
    const project: ProjectRecord = {
      activeWorktreeId: 'wt-linked',
      createdAt: NOW,
      id: 'project-heal',
      lastOpenedAt: NOW,
      name: 'main',
      projectPath: linkedWorktree,
      updatedAt: NOW,
      worktrees: [
        makeWorktreeRecord({
          id: 'wt-primary',
          name: 'main',
          path: mainRepo,
          repoRoot: mainRepo,
          source: 'primary',
        }),
        makeWorktreeRecord({
          branch: 'feature',
          id: 'wt-linked',
          name: 'wt-a',
          path: linkedWorktree,
          // The sibling that created this worktree was already deleted, so its
          // path no longer exists — this is the incoherent state to heal.
          repoRoot: deletedSibling,
        }),
      ],
    }

    expect(existsSync(deletedSibling)).toBe(false)

    const healed = ensureProjectWorktrees(project, NOW)
    const linked = healed.worktrees?.find((entry) => entry.id === 'wt-linked')

    expect(linked).toBeDefined()
    expect(linked?.repoRoot).not.toBe(deletedSibling)
    expect(existsSync(linked?.repoRoot ?? '')).toBe(true)
  })

  test('drops a deleted external worktree and prunes its stale git entry', () => {
    // Simulate the directory vanishing (e.g. a temp dir cleared on reboot)
    // while git still tracks it — git marks such worktrees "prunable".
    rmSync(linkedWorktree, { force: true, recursive: true })

    const project: ProjectRecord = {
      activeWorktreeId: 'wt-primary',
      createdAt: NOW,
      id: 'project-prune',
      lastOpenedAt: NOW,
      name: 'main',
      projectPath: mainRepo,
      updatedAt: NOW,
      worktrees: [
        makeWorktreeRecord({
          id: 'wt-primary',
          name: 'main',
          path: mainRepo,
          repoRoot: mainRepo,
          source: 'primary',
        }),
        makeWorktreeRecord({
          branch: 'feature',
          id: 'wt-ghost',
          name: 'wt-a',
          path: linkedWorktree,
          repoRoot: mainRepo,
        }),
      ],
    }

    const reconciled = ensureProjectWorktrees(project, NOW)

    expect(reconciled.worktrees?.map((entry) => entry.id)).toEqual(['wt-primary'])
    expect(reconciled.worktrees?.some((entry) => entry.path === linkedWorktree)).toBe(false)

    // git no longer reports the prunable worktree once reconciliation runs.
    const list = execFileSync('git', ['-C', mainRepo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    })
    expect(list).not.toContain(linkedWorktree)
  })
})
