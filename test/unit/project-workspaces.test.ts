import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ProjectRecord } from '../../src/state/types'

import {
  assertSafeAimuxWorktreePath,
  isInsideAimuxWorktreeRoot,
  makeWorktreePath,
  pruneEmptyWorktreeParent,
} from '../../src/platform/worktree-paths'
import {
  ensureProjectWorkspaces,
  getActiveWorkspacePath,
  withActiveWorkspace,
} from '../../src/state/project-workspaces'

function makeProject(projectPath = '/repo/main'): ProjectRecord {
  return {
    createdAt: '2024-01-01T00:00:00.000Z',
    id: 'project-1',
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    name: 'repo',
    projectPath,
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('project workspaces', () => {
  test('normalizes a legacy projectPath into a primary workspace', () => {
    const project = ensureProjectWorkspaces(makeProject(), '2024-01-02T00:00:00.000Z')

    expect(project.workspaces).toHaveLength(1)
    expect(project.workspaces?.[0]?.path).toBe('/repo/main')
    expect(project.workspaces?.[0]?.source).toBe('primary')
    expect(project.workspaces?.[0]?.createdByAimux).toBe(false)
    expect(project.activeWorkspaceId).toBe(project.workspaces?.[0]?.id)
  })

  test('an unresolved active workspace lands on a worktree, never the repo', () => {
    const now = '2024-01-02T00:00:00.000Z'
    const project = ensureProjectWorkspaces(
      {
        ...makeProject(),
        // Points at a workspace that no longer exists — a deleted one, or a
        // catalog written by another machine.
        activeWorkspaceId: 'gone',
        workspaces: [
          {
            createdAt: now,
            createdByAimux: false,
            id: 'wt-primary',
            name: 'repo',
            path: '/repo/main',
            repoRoot: '/repo/main',
            source: 'primary',
            updatedAt: now,
          },
          {
            // External, not aimux-temp: a temp workspace whose directory is
            // gone gets pruned before this rule is reached.
            createdAt: now,
            createdByAimux: false,
            id: 'wt-feature',
            name: 'Feature',
            path: '/repo/feature',
            repoRoot: '/repo/main',
            source: 'external',
            updatedAt: now,
          },
        ],
      },
      now
    )

    expect(project.activeWorkspaceId).toBe('wt-feature')
  })

  test('an explicit primary selection is honoured', () => {
    const now = '2024-01-02T00:00:00.000Z'
    const project = ensureProjectWorkspaces(
      {
        ...makeProject(),
        activeWorkspaceId: 'wt-primary',
        workspaces: [
          {
            createdAt: now,
            createdByAimux: false,
            id: 'wt-primary',
            name: 'repo',
            path: '/repo/main',
            repoRoot: '/repo/main',
            source: 'primary',
            updatedAt: now,
          },
          {
            // External, not aimux-temp: a temp workspace whose directory is
            // gone gets pruned before this rule is reached.
            createdAt: now,
            createdByAimux: false,
            id: 'wt-feature',
            name: 'Feature',
            path: '/repo/feature',
            repoRoot: '/repo/main',
            source: 'external',
            updatedAt: now,
          },
        ],
      },
      now
    )

    // Sitting on main to read the git panel stays possible; only opening tabs
    // there is refused.
    expect(project.activeWorkspaceId).toBe('wt-primary')
  })

  test('switching the active workspace leaves projectPath pinned to the repo', () => {
    const project = ensureProjectWorkspaces(makeProject())
    const first = project.workspaces?.[0]
    if (!first) throw new Error('expected primary workspace')
    const second = {
      ...first,
      id: 'workspace-2',
      name: 'feature',
      path: '/repo/feature',
    }

    const switched = withActiveWorkspace({ ...project, workspaces: [first, second] }, second.id)

    expect(switched.activeWorkspaceId).toBe(second.id)
    // The cwd follows the workspace; the project keeps naming the repo.
    expect(getActiveWorkspacePath(switched)).toBe('/repo/feature')
    expect(switched.projectPath).toBe('/repo/main')
  })

  test('generated temp workspace paths stay inside the Aimux root', () => {
    const path = makeWorktreePath({
      repoRoot: '/Users/me/repo',
      workspaceId: 'workspace-1',
      workspaceName: '../feature bad with an absurdly long human name that should not leak',
    })

    expect(path).toStartWith('/tmp/aimux-wt/')
    expect(path).not.toContain('..')
    expect(path.length).toBeLessThan(70)
    expect(isInsideAimuxWorktreeRoot(path)).toBe(true)
    expect(isInsideAimuxWorktreeRoot('/tmp/not-aimux/repo')).toBe(false)
  })

  test('different repos with the same basename do not collide', () => {
    const first = makeWorktreePath({
      repoRoot: '/Users/a/repo',
      workspaceId: 'workspace-1',
      workspaceName: 'feature',
    })
    const second = makeWorktreePath({
      repoRoot: '/Users/b/repo',
      workspaceId: 'workspace-1',
      workspaceName: 'feature',
    })

    expect(first).not.toBe(second)
  })

  test('prunes missing Aimux temp workspaces on normalization', () => {
    const project = ensureProjectWorkspaces(makeProject('/repo/main'))
    const primary = project.workspaces?.[0]
    if (!primary) throw new Error('expected primary workspace')
    const missingTemp = {
      ...primary,
      createdByAimux: true,
      id: 'workspace-missing',
      name: 'missing',
      path: makeWorktreePath({
        repoRoot: '/repo/main',
        workspaceId: 'workspace-missing',
        workspaceName: 'missing',
      }),
      source: 'aimux-temp' as const,
    }

    const normalized = ensureProjectWorkspaces({
      ...project,
      activeWorkspaceId: missingTemp.id,
      projectPath: missingTemp.path,
      workspaces: [primary, missingTemp],
    })

    expect(normalized.workspaces?.map((workspace) => workspace.id)).toEqual([primary.id])
    expect(normalized.activeWorkspaceId).toBe(primary.id)
    expect(normalized.projectPath).toBe(primary.path)
  })

  test('/private/tmp aliases are treated as inside the Aimux workspace root', () => {
    expect(isInsideAimuxWorktreeRoot('/private/tmp/aimux-wt/r-test/wt-test')).toBe(true)
  })

  test('accepts the first workspace of a repo before its repo-scoped parent exists', async () => {
    const previousRoot = process.env.AIMUX_WORKTREE_ROOT
    const root = await mkdtemp(join(tmpdir(), 'aimux-wt-test-'))
    process.env.AIMUX_WORKTREE_ROOT = root
    try {
      const targetPath = makeWorktreePath({
        repoRoot: '/Users/me/first-workspace-repo',
        workspaceId: 'workspace-1',
        workspaceName: 'feature',
      })
      // The repo-scoped parent (<root>/r-<hash>) does not exist yet — this is
      // the first workspace for the repo. It must not throw ENOENT.
      await assertSafeAimuxWorktreePath(targetPath)
      // and the parent must now exist so git worktree add can populate it.
      expect((await stat(dirname(targetPath))).isDirectory()).toBe(true)
    } finally {
      if (previousRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
      else process.env.AIMUX_WORKTREE_ROOT = previousRoot
      await rm(root, { force: true, recursive: true })
    }
  })

  test('prunes the repo-scoped parent only once it is empty, and never the root', async () => {
    const previousRoot = process.env.AIMUX_WORKTREE_ROOT
    const root = await mkdtemp(join(tmpdir(), 'aimux-wt-test-'))
    process.env.AIMUX_WORKTREE_ROOT = root
    try {
      const first = makeWorktreePath({
        repoRoot: '/Users/me/prune-repo',
        workspaceId: 'workspace-1',
        workspaceName: 'one',
      })
      const second = makeWorktreePath({
        repoRoot: '/Users/me/prune-repo',
        workspaceId: 'workspace-2',
        workspaceName: 'two',
      })
      await assertSafeAimuxWorktreePath(first)
      await mkdir(second, { recursive: true })

      // A sibling workspace is still live — the shared parent must survive.
      await pruneEmptyWorktreeParent(first)
      expect((await stat(dirname(first))).isDirectory()).toBe(true)

      await rm(second, { force: true, recursive: true })
      await pruneEmptyWorktreeParent(first)
      expect(existsSync(dirname(first))).toBe(false)

      // The root itself is shared by every repo; pruning must never reach it.
      await pruneEmptyWorktreeParent(join(root, 'r-abc'))
      expect((await stat(root)).isDirectory()).toBe(true)
    } finally {
      if (previousRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
      else process.env.AIMUX_WORKTREE_ROOT = previousRoot
      await rm(root, { force: true, recursive: true })
    }
  })

  test('a fresh project sits on its repo checkout, which is a place tabs can run', () => {
    const project = ensureProjectWorkspaces(makeProject())

    expect(project.workspaces?.[0]?.source).toBe('primary')
    // A worktree is not free — it starts without anything untracked — so the
    // checkout has to be usable as-is, not a waiting room for one.
    expect(getActiveWorkspacePath(project)).toBe('/repo/main')
  })

  test('the checkout is called root, not the directory the project already names', () => {
    const project = ensureProjectWorkspaces(makeProject())

    expect(project.workspaces?.[0]?.name).toBe('root')
  })

  test('a catalog naming the checkout after its directory is healed on load', () => {
    const now = '2024-01-02T00:00:00.000Z'
    const project = ensureProjectWorkspaces(
      {
        ...makeProject(),
        workspaces: [
          {
            createdAt: now,
            createdByAimux: false,
            id: 'wt-main',
            // What every catalog written before the checkout had its own row
            // carries: `basename('/repo/main')`.
            name: 'main',
            path: '/repo/main',
            repoRoot: '/repo/main',
            source: 'primary',
            updatedAt: now,
          },
        ],
      },
      now
    )

    expect(project.workspaces?.[0]?.name).toBe('root')
    // Ids are what tabs and snapshots are pinned by; only the label moves.
    expect(project.workspaces?.[0]?.id).toBe('wt-main')
  })

  test('a checkout the user named themselves is left alone', () => {
    const now = '2024-01-02T00:00:00.000Z'
    const project = ensureProjectWorkspaces(
      {
        ...makeProject(),
        workspaces: [
          {
            createdAt: now,
            createdByAimux: false,
            id: 'wt-main',
            name: 'my checkout',
            path: '/repo/main',
            repoRoot: '/repo/main',
            source: 'primary',
            updatedAt: now,
          },
        ],
      },
      now
    )

    expect(project.workspaces?.[0]?.name).toBe('my checkout')
  })
})
