import type { PluginCommitMessage, PluginCommitMessageRequest } from '@brimveyn/aimux-plugin'

import { $ } from 'bun'

import type { AppAction } from '../state/actions'
import type { AppState, AssistantId, AutoCommitState, GitRefreshPayload } from '../state/types'

import { buildHeadlessInvocation, isSupportedProvider } from '../auto-commit/headless-commands'
import { composePromptFromTemplate, loadBriefingTemplate } from '../auto-commit/prompt-loader'
import { hasStagedFiles } from '../auto-commit/staging-mode'
import { stripAnsi } from '../auto-commit/strip-ansi'
import { runSuggestion } from '../auto-commit/suggestion-runner'
import { workingTreeHash } from '../auto-commit/working-tree-hash'
import { getCommitMessageProvider } from '../git/commit-message-provider'
import { createPluginLogger } from '../plugins/log'
import { isCommandAvailable } from '../pty/command-registry'
import { toast } from '../state/toast-store'

export interface TriggerInput {
  enabled: boolean
  assistant: AssistantId
  hasProjectPath: boolean
  git: GitRefreshPayload
  projectId: string
  state: AutoCommitState
  currentHash: string
}

export function shouldTriggerAutoCommit(input: TriggerInput): boolean {
  if (!input.enabled) return false
  if (!isSupportedProvider(input.assistant)) return false
  if (!input.hasProjectPath) return false
  if (input.git.files.length === 0) return false

  const existing = input.state.byProject[input.projectId]
  if (!existing || existing.kind === 'idle') return true
  if (existing.workingTreeHash === input.currentHash) return false
  return true
}

export interface AutoCommitConfigSnapshot {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
}

export interface DriverDeps {
  getState: () => AppState
  dispatch: (action: AppAction) => void
  getConfig: () => AutoCommitConfigSnapshot
  getProfileConfigRoot: () => string
}

let cachedTemplate: string | null = null

async function getTemplate(deps: DriverDeps): Promise<string> {
  if (cachedTemplate !== null) return cachedTemplate
  cachedTemplate = await loadBriefingTemplate({ profileConfigRoot: deps.getProfileConfigRoot() })
  return cachedTemplate
}

const UNTRACKED_FILE_BYTES_CAP = 8_000
const PROJECT_TAIL_BYTES_CAP = 8_000

export function extractSessionTail(buffer: string | undefined): string {
  if (!(buffer != null && buffer !== '')) return '[no session tail available]'
  const stripped = stripAnsi(buffer).trimEnd()
  if (stripped.length === 0) return '[no session tail available]'
  return stripped.length > PROJECT_TAIL_BYTES_CAP
    ? stripped.slice(stripped.length - PROJECT_TAIL_BYTES_CAP)
    : stripped
}

interface GatheredContext {
  recentCommits: string
  diff: string
  branch: string
}

async function gatherContext(cwd: string, stagedOnly: boolean): Promise<GatheredContext | null> {
  const logArgs = ['log', '-5', '--format=%h %s']
  const diffArgs = stagedOnly ? ['diff', '--cached'] : ['diff', 'HEAD']
  const branchArgs = ['rev-parse', '--abbrev-ref', 'HEAD']

  // In staged-only mode we don't include untracked files: a file cannot be
  // staged without first being tracked. Only git-diff-HEAD mode needs the
  // untracked synthetic diffs.
  if (stagedOnly) {
    const [log, diff, branch] = await Promise.all([
      $`git -C ${cwd} ${logArgs}`.quiet().nothrow(),
      $`git -C ${cwd} ${diffArgs}`.quiet().nothrow(),
      $`git -C ${cwd} ${branchArgs}`.quiet().nothrow(),
    ])
    if (log.exitCode !== 0 || diff.exitCode !== 0) return null
    const branchName = branch.exitCode === 0 ? branch.stdout.toString().trim() : ''
    return {
      branch: branchName || '[unknown branch]',
      diff: diff.stdout.toString(),
      recentCommits: log.stdout.toString().trim(),
    }
  }

  const untrackedArgs = ['ls-files', '--others', '--exclude-standard']
  const [log, diff, untracked, branch] = await Promise.all([
    $`git -C ${cwd} ${logArgs}`.quiet().nothrow(),
    $`git -C ${cwd} ${diffArgs}`.quiet().nothrow(),
    $`git -C ${cwd} ${untrackedArgs}`.quiet().nothrow(),
    $`git -C ${cwd} ${branchArgs}`.quiet().nothrow(),
  ])
  if (log.exitCode !== 0 || diff.exitCode !== 0 || untracked.exitCode !== 0) return null

  const untrackedPaths = untracked.stdout
    .toString()
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const untrackedSections: string[] = []
  for (const path of untrackedPaths) {
    // git diff --no-index exits 1 when files differ (which they always do here);
    // .nothrow() lets us read stdout regardless.
    const diffNew = await $`git -C ${cwd} diff --no-index -- /dev/null ${path}`.quiet().nothrow()
    const text = diffNew.stdout.toString()
    const trimmed =
      text.length > UNTRACKED_FILE_BYTES_CAP
        ? `${text.slice(0, UNTRACKED_FILE_BYTES_CAP)}\n[truncated]`
        : text
    untrackedSections.push(trimmed || `[new file: ${path} — empty or unreadable]`)
  }

  const branchName = branch.exitCode === 0 ? branch.stdout.toString().trim() : ''
  return {
    branch: branchName || '[unknown branch]',
    diff:
      diff.stdout.toString() +
      (untrackedSections.length > 0 ? `\n${untrackedSections.join('\n')}` : ''),
    recentCommits: log.stdout.toString().trim(),
  }
}

export interface ActivityTransitionArgs {
  projectId: string
  tabId: string
  assistant: AssistantId
  projectPath: string | undefined
  git: GitRefreshPayload | null
}

export async function onActivityTransition(
  deps: DriverDeps,
  args: ActivityTransitionArgs
): Promise<void> {
  const config = deps.getConfig()
  if (!config.enabled) return
  if (!args.git) return
  const currentHash = workingTreeHash(args.git)

  const state = deps.getState()
  const should = shouldTriggerAutoCommit({
    assistant: args.assistant,
    currentHash,
    enabled: config.enabled,
    git: args.git,
    hasProjectPath: !!(args.projectPath != null && args.projectPath !== ''),
    projectId: args.projectId,
    state: state.autoCommit,
  })
  if (!should) return

  await runGeneration(deps, args, currentHash, config)
}

export async function onManualTrigger(
  deps: DriverDeps,
  args: ActivityTransitionArgs
): Promise<void> {
  const config = deps.getConfig()
  const fail = (reason: string): void => {
    // Manual auto-commit triggers can fire outside git mode, so surface the
    // reason as a toast rather than an inline git-pane message that's unseen.
    toast.warning(`Auto-commit: ${reason}`)
    deps.dispatch({ projectId: args.projectId, type: 'auto-commit-clear' })
  }
  if (!config.enabled) return fail('disabled in config')
  if (!args.git || args.git.files.length === 0) return fail('no changes to summarise')
  if (!(args.projectPath != null && args.projectPath !== ''))
    return fail('no project path for current project')

  const currentHash = workingTreeHash(args.git)
  const existing = deps.getState().autoCommit.byProject[args.projectId]
  // An in-flight generation will dispatch ready/clear; just wait for it.
  if (existing && existing.kind === 'generating') return
  // Manual trigger is always user-intent to regenerate, even if a ready
  // suggestion exists at the same hash — the user explicitly asked for it.

  // Same reason as in `runGeneration`: with a plugin answering, the absence of
  // a headless model is not a reason to refuse.
  if (getCommitMessageProvider() === null) {
    const probe = buildHeadlessInvocation(
      args.assistant,
      '__probe__',
      config.models[args.assistant]
    )
    if (!probe) return fail(`no headless invocation for ${args.assistant}`)
    if (!isCommandAvailable(probe.executable)) {
      return fail(`'${probe.executable}' not found in PATH`)
    }
  }

  await runGeneration(deps, args, currentHash, config)
}

/**
 * Asks the plugin holding the slot. Its failure is its own: a provider that
 * throws must cost this one message, not the feature — aimux falls back to its
 * own suggestion and says so in the plugin's log.
 */
async function askProvider(
  slot: NonNullable<ReturnType<typeof getCommitMessageProvider>>,
  request: PluginCommitMessageRequest,
  signal: AbortSignal
): Promise<PluginCommitMessage | null> {
  try {
    const answer = await slot.provide(request, signal)
    if (answer === null || answer === undefined) return null
    if (typeof answer.title !== 'string' || answer.title.trim() === '') return null
    return answer
  } catch (error) {
    createPluginLogger(slot.pluginId, 'ui').error('commit message provider failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function runGeneration(
  deps: DriverDeps,
  args: ActivityTransitionArgs,
  currentHash: string,
  config: AutoCommitConfigSnapshot
): Promise<void> {
  // A plugin holding the commit-message slot answers instead of a headless
  // model call, so the checks for *that* model must not gate the run: a plugin
  // that writes messages should work on a machine with no `claude` installed.
  const provider = getCommitMessageProvider()
  if (provider === null) {
    const probe = buildHeadlessInvocation(
      args.assistant,
      '__probe__',
      config.models[args.assistant]
    )
    if (!probe) return
    if (!isCommandAvailable(probe.executable)) return
  }

  // Supersede any in-flight generation for this project. Without this, a
  // rapid sequence of activity transitions (each with a different working
  // tree hash) would leak concurrent headless subprocesses until each hit
  // its 60 s timeout — burning real API credits.
  const existing = deps.getState().autoCommit.byProject[args.projectId]
  if (existing && existing.kind === 'generating') {
    try {
      existing.abortController.abort()
    } catch {
      // ignore
    }
  }

  const controller = new AbortController()
  deps.dispatch({
    abortController: controller,
    projectId: args.projectId,
    startedAt: Date.now(),
    tabId: args.tabId,
    type: 'auto-commit-generation-started',
    workingTreeHash: currentHash,
  })

  const template = await getTemplate(deps)
  const stagedOnly = args.git ? hasStagedFiles(args.git) : false
  const ctx = await gatherContext(args.projectPath as string, stagedOnly)
  if (!ctx) {
    deps.dispatch({ projectId: args.projectId, type: 'auto-commit-clear' })
    return
  }
  const tab = deps.getState().tabs.find((t) => t.id === args.tabId)
  const sessionTail = extractSessionTail(tab?.buffer)

  if (provider !== null) {
    const suggestion = await askProvider(
      provider,
      {
        branch: ctx.branch,
        diff: ctx.diff,
        files: (args.git?.files ?? []).map((file) => ({
          added: file.added,
          path: file.path,
          removed: file.removed,
          section: file.section,
          status: file.status,
        })),
        projectId: args.projectId,
        recentCommits: ctx.recentCommits,
        repoRoot: args.projectPath as string,
        ...(sessionTail === undefined ? {} : { sessionTail }),
      },
      controller.signal
    )
    if (suggestion !== null) {
      deps.dispatch({
        body: suggestion.body ?? '',
        generatedAt: Date.now(),
        projectId: args.projectId,
        title: suggestion.title,
        type: 'auto-commit-generation-ready',
        workingTreeHash: currentHash,
      })
      return
    }
    // A provider that declines is not a provider that failed: fall through to
    // aimux's own suggestion rather than leaving the user with nothing.
  }

  const prompt = composePromptFromTemplate(template, { ...ctx, sessionTail })
  const finalInvocation = buildHeadlessInvocation(
    args.assistant,
    prompt,
    config.models[args.assistant]
  )
  if (!finalInvocation) {
    deps.dispatch({ projectId: args.projectId, type: 'auto-commit-clear' })
    return
  }

  const parsed = await runSuggestion({
    invocation: finalInvocation,
    signal: controller.signal,
    timeoutMs: config.timeoutMs,
  })
  if (!parsed) {
    deps.dispatch({ projectId: args.projectId, type: 'auto-commit-clear' })
    return
  }
  deps.dispatch({
    body: parsed.body,
    generatedAt: Date.now(),
    projectId: args.projectId,
    title: parsed.title,
    type: 'auto-commit-generation-ready',
    workingTreeHash: currentHash,
  })
}

export function onGitRefresh(
  deps: DriverDeps,
  projectId: string,
  payload: GitRefreshPayload
): void {
  const state = deps.getState()
  const current = state.autoCommit.byProject[projectId]
  if (!current || current.kind === 'idle') return
  const newHash = workingTreeHash(payload)
  if (newHash !== current.workingTreeHash) {
    deps.dispatch({ projectId, type: 'auto-commit-clear' })
  }
}
