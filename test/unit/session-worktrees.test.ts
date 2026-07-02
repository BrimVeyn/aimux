import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SessionRecord } from '../../src/state/types'

import {
  assertSafeAimuxWorktreePath,
  isInsideAimuxWorktreeRoot,
  makeWorktreePath,
} from '../../src/platform/worktree-paths'
import {
  ensureSessionWorktrees,
  getSessionProjectPath,
  withActiveWorktree,
} from '../../src/state/session-worktrees'

function makeSession(projectPath = '/repo/main'): SessionRecord {
  return {
    createdAt: '2024-01-01T00:00:00.000Z',
    id: 'session-1',
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    name: 'repo',
    projectPath,
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('session worktrees', () => {
  test('normalizes a legacy projectPath into a primary worktree', () => {
    const session = ensureSessionWorktrees(makeSession(), '2024-01-02T00:00:00.000Z')

    expect(session.worktrees).toHaveLength(1)
    expect(session.worktrees?.[0]?.path).toBe('/repo/main')
    expect(session.worktrees?.[0]?.source).toBe('primary')
    expect(session.worktrees?.[0]?.createdByAimux).toBe(false)
    expect(session.activeWorktreeId).toBe(session.worktrees?.[0]?.id)
  })

  test('active worktree updates legacy projectPath mirror', () => {
    const session = ensureSessionWorktrees(makeSession())
    const first = session.worktrees?.[0]
    if (!first) throw new Error('expected primary worktree')
    const second = {
      ...first,
      id: 'worktree-2',
      name: 'feature',
      path: '/repo/feature',
    }

    const switched = withActiveWorktree({ ...session, worktrees: [first, second] }, second.id)

    expect(switched.activeWorktreeId).toBe(second.id)
    expect(getSessionProjectPath(switched)).toBe('/repo/feature')
    expect(switched.projectPath).toBe('/repo/feature')
  })

  test('generated temp worktree paths stay inside the Aimux root', () => {
    const path = makeWorktreePath({
      repoRoot: '/Users/me/repo',
      worktreeId: 'worktree-1',
      worktreeName: '../feature bad with an absurdly long human name that should not leak',
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
      worktreeId: 'worktree-1',
      worktreeName: 'feature',
    })
    const second = makeWorktreePath({
      repoRoot: '/Users/b/repo',
      worktreeId: 'worktree-1',
      worktreeName: 'feature',
    })

    expect(first).not.toBe(second)
  })

  test('prunes missing Aimux temp worktrees on normalization', () => {
    const session = ensureSessionWorktrees(makeSession('/repo/main'))
    const primary = session.worktrees?.[0]
    if (!primary) throw new Error('expected primary worktree')
    const missingTemp = {
      ...primary,
      createdByAimux: true,
      id: 'worktree-missing',
      name: 'missing',
      path: makeWorktreePath({
        repoRoot: '/repo/main',
        worktreeId: 'worktree-missing',
        worktreeName: 'missing',
      }),
      source: 'aimux-temp' as const,
    }

    const normalized = ensureSessionWorktrees({
      ...session,
      activeWorktreeId: missingTemp.id,
      projectPath: missingTemp.path,
      worktrees: [primary, missingTemp],
    })

    expect(normalized.worktrees?.map((worktree) => worktree.id)).toEqual([primary.id])
    expect(normalized.activeWorktreeId).toBe(primary.id)
    expect(normalized.projectPath).toBe(primary.path)
  })

  test('/private/tmp aliases are treated as inside the Aimux worktree root', () => {
    expect(isInsideAimuxWorktreeRoot('/private/tmp/aimux-wt/r-test/wt-test')).toBe(true)
  })

  test('accepts the first worktree of a repo before its repo-scoped parent exists', async () => {
    const previousRoot = process.env.AIMUX_WORKTREE_ROOT
    const root = await mkdtemp(join(tmpdir(), 'aimux-wt-test-'))
    process.env.AIMUX_WORKTREE_ROOT = root
    try {
      const targetPath = makeWorktreePath({
        repoRoot: '/Users/me/first-worktree-repo',
        worktreeId: 'worktree-1',
        worktreeName: 'feature',
      })
      // The repo-scoped parent (<root>/r-<hash>) does not exist yet — this is
      // the first worktree for the repo. It must not throw ENOENT.
      await assertSafeAimuxWorktreePath(targetPath)
      // and the parent must now exist so git worktree add can populate it.
      expect((await stat(dirname(targetPath))).isDirectory()).toBe(true)
    } finally {
      if (previousRoot === undefined) delete process.env.AIMUX_WORKTREE_ROOT
      else process.env.AIMUX_WORKTREE_ROOT = previousRoot
      await rm(root, { force: true, recursive: true })
    }
  })
})
