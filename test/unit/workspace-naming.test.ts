import { expect, test } from 'bun:test'

import type { WorkspaceRecord } from '../../src/state/types'

import {
  placeholderWorkspaceName,
  renameWorkspaceFromPrompt,
} from '../../src/app-runtime/workspace-naming'

const NOW = '2026-07-31T00:00:00.000Z'

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    branch: 'aimux/placeholder-abc',
    createdAt: NOW,
    createdByAimux: true,
    id: 'workspace-1',
    name: 'Placeholder',
    path: '/tmp/aimux-wt/repo/placeholder-abc',
    repoRoot: '/tmp/repo',
    source: 'aimux-temp',
    updatedAt: NOW,
    ...overrides,
  }
}

function modelReturning(text: string, exitCode = 0) {
  return async () => ({ exitCode, stdout: text })
}

function recorder() {
  const patches: { workspaceId: string; patch: Partial<WorkspaceRecord> }[] = []
  return {
    applyName: (_projectId: string, workspaceId: string, patch: Partial<WorkspaceRecord>) =>
      void patches.push({ patch, workspaceId }),
    patches,
  }
}

test('placeholderWorkspaceName derives a name from the prompt', () => {
  expect(placeholderWorkspaceName('please fix the scroll drift')).toBe('Fix the scroll drift')
})

test('placeholderWorkspaceName gives up on a prompt with no usable words', () => {
  expect(placeholderWorkspaceName('   ')).toBeUndefined()
})

test('a generated name renames the workspace, and the branch to the conventional one', async () => {
  const renames: string[][] = []
  const rec = recorder()
  await renameWorkspaceFromPrompt(
    {
      projectId: 'p1',
      prompt: 'corrige le décalage du scroll',
      provider: 'claude',
      workspace: workspace(),
    },
    {
      applyName: rec.applyName,
      renameBranch: async (repo, from, to) => {
        renames.push([repo, from, to])
        return true
      },
      // The title keeps the user's language; the branch does not.
      spawn: modelReturning('Corriger le décalage du scroll\nfix/scroll-drift-on-resize\n'),
    }
  )

  // Renamed from inside the worktree, where the branch is the current one.
  expect(renames).toEqual([
    ['/tmp/aimux-wt/repo/placeholder-abc', 'aimux/placeholder-abc', 'fix/scroll-drift-on-resize'],
  ])
  expect(rec.patches).toEqual([
    {
      patch: { branch: 'fix/scroll-drift-on-resize', name: 'Corriger le décalage du scroll' },
      workspaceId: 'workspace-1',
    },
  ])
})

test('a branch line in no known convention leaves the branch alone', async () => {
  const rec = recorder()
  await renameWorkspaceFromPrompt(
    { projectId: 'p1', prompt: 'fix the scroll drift', provider: 'claude', workspace: workspace() },
    {
      applyName: rec.applyName,
      renameBranch: async () => {
        throw new Error('must not rename to an unconventional branch')
      },
      spawn: modelReturning('Fix scroll drift\nscroll drift fix\n'),
    }
  )

  expect(rec.patches).toEqual([{ patch: { name: 'Fix scroll drift' }, workspaceId: 'workspace-1' }])
})

test('a refused branch rename still applies the name, and never claims the new branch', async () => {
  const rec = recorder()
  await renameWorkspaceFromPrompt(
    { projectId: 'p1', prompt: 'fix the scroll drift', provider: 'claude', workspace: workspace() },
    {
      applyName: rec.applyName,
      renameBranch: async () => false,
      spawn: modelReturning('Fix scroll drift\nfix/scroll-drift\n'),
    }
  )

  expect(rec.patches).toEqual([{ patch: { name: 'Fix scroll drift' }, workspaceId: 'workspace-1' }])
})

test('a failed generation leaves the placeholder alone', async () => {
  const rec = recorder()
  await renameWorkspaceFromPrompt(
    { projectId: 'p1', prompt: 'fix the scroll drift', provider: 'claude', workspace: workspace() },
    {
      applyName: rec.applyName,
      renameBranch: async () => true,
      spawn: modelReturning('', 1),
    }
  )

  expect(rec.patches).toEqual([])
})

test('a provider with no headless mode leaves the placeholder alone', async () => {
  const rec = recorder()
  await renameWorkspaceFromPrompt(
    {
      projectId: 'p1',
      prompt: 'fix the scroll drift',
      provider: 'antigravity',
      workspace: workspace(),
    },
    {
      applyName: rec.applyName,
      renameBranch: async () => true,
      spawn: modelReturning('Fix scroll drift\n'),
    }
  )

  expect(rec.patches).toEqual([])
})
