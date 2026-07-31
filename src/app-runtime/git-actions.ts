import { $ } from 'bun'

import type { SideEffectContext } from './side-effect-context'

import { toast } from '../state/toast-store'
import { triggerAutoCommitNow } from './auto-commit-ref'

export async function runGitAction(
  ctx: SideEffectContext,
  args: string[],
  pathToInvalidate?: string
): Promise<void> {
  const fallback = ctx.getCurrentProjectProjectPath()
  const repoPath =
    pathToInvalidate != null && pathToInvalidate !== ''
      ? ctx.state.gitPanel.files.find((f) => f.path === pathToInvalidate)?.repoPath
      : undefined
  const cwd = repoPath ?? fallback
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathToInvalidate != null && pathToInvalidate !== '') {
    ctx.dispatch({ path: pathToInvalidate, type: 'git-mode-clear-diff-cache' })
  }
}

export async function runGitActionAll(
  ctx: SideEffectContext,
  args: string[],
  pathsToInvalidate: string[]
): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathsToInvalidate.length > 0) {
    ctx.dispatch({ paths: pathsToInvalidate, type: 'git-mode-invalidate-diffs' })
  }
}

export async function runGitRm(ctx: SideEffectContext, path: string): Promise<void> {
  const repoPath = ctx.state.gitPanel.files.find((f) => f.path === path)?.repoPath
  const cwd = repoPath ?? ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const absolute = `${cwd}/${path}`
  try {
    const stat = await Bun.file(absolute).stat()
    await (stat.isDirectory()
      ? Bun.$`rm -rf -- ${absolute}`.quiet().nothrow()
      : Bun.file(absolute).unlink())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to delete file'
    ctx.dispatch({ message, type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  ctx.dispatch({ path, type: 'git-mode-clear-diff-cache' })
}

export async function runGitCommit(
  ctx: SideEffectContext,
  title: string,
  body: string
): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const result = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(stderr || 'Commit failed')
    return
  }
  clearAutoCommitForCurrentProject(ctx)
  // Match the push flow: clear any inline git-pane message and surface the
  // result as a toast so it's seen even after leaving git mode.
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  toast.success(`Committed: ${title}`)
}

export async function runGitCommitAuto(
  ctx: SideEffectContext,
  title: string,
  body: string
): Promise<void> {
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return

  // If the user has manually staged files, respect that intent and commit
  // only the staged set — don't run `git add -A` which would sweep up
  // unrelated unstaged/untracked changes. With nothing staged, `add -A`
  // keeps the "commit everything" behaviour the user expects from auto-commit.
  const hasStaged = ctx.state.gitPanel.files.some((f) => f.section === 'staged')
  if (!hasStaged) {
    const addArgs = ['add', '-A']
    const addResult = await $`git -C ${cwd} ${addArgs}`.quiet().nothrow()
    if (addResult.exitCode !== 0) {
      ctx.dispatch({ message: null, type: 'git-mode-set-message' })
      toast.error(addResult.stderr.toString().trim() || 'Auto-commit: git add failed')
      return
    }
  }

  const commitResult = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()

  if (commitResult.exitCode !== 0) {
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(commitResult.stderr.toString().trim() || 'Auto-commit: commit failed')
    return
  }

  clearAutoCommitForCurrentProject(ctx)
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

export function clearAutoCommitForCurrentProject(ctx: SideEffectContext): void {
  const projectId = ctx.state.currentProjectId
  if (!(projectId != null && projectId !== '')) return
  ctx.dispatch({ projectId, type: 'auto-commit-clear' })
}

export async function runGenerateAutoCommitNow(
  ctx: SideEffectContext,
  projectId: string
): Promise<void> {
  const project = ctx.state.projects.find((s) => s.id === projectId)
  const panel = ctx.state.gitPanel
  if (panel.error !== null) {
    toast.warning('Auto-commit: git panel unavailable')
    ctx.dispatch({ projectId, type: 'auto-commit-clear' })
    return
  }
  const tab = ctx.activeTab
  if (!tab) {
    toast.warning('Auto-commit: no active assistant tab — open a claude/codex tab first')
    ctx.dispatch({ projectId, type: 'auto-commit-clear' })
    return
  }
  await triggerAutoCommitNow({
    assistant: tab.assistant,
    git: {
      ahead: panel.ahead,
      behind: panel.behind,
      branch: panel.branch,
      files: panel.files,
    },
    projectId,
    projectPath: project?.projectPath,
    tabId: tab.id,
  })
}

export async function runGitPush(ctx: SideEffectContext): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  ctx.dispatch({ message: 'pushing…', type: 'git-mode-set-message' })

  const upstream = await $`git -C ${cwd} rev-parse --abbrev-ref --symbolic-full-name @{u}`
    .quiet()
    .nothrow()
  const hasUpstream = upstream.exitCode === 0

  const result = hasUpstream
    ? await $`git -C ${cwd} push`.quiet().nothrow()
    : await $`git -C ${cwd} push --set-upstream origin HEAD`.quiet().nothrow()

  // Clear the inline "pushing…" progress; surface the result as a toast so it's
  // visible even after leaving git mode (and so push failures aren't missed).
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (result.exitCode !== 0) {
    toast.error(result.stderr.toString().trim() || 'Push failed')
    return
  }
  toast.success('Pushed')
}
