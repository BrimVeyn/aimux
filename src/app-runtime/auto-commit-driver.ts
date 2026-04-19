import { $ } from 'bun'

import type {
  AppAction,
  AppState,
  AssistantId,
  AutoCommitState,
  GitRefreshPayload,
} from '../state/types'

import { buildHeadlessInvocation, isSupportedProvider } from '../auto-commit/headless-commands'
import { composePromptFromTemplate, loadBriefingTemplate } from '../auto-commit/prompt-loader'
import { stripAnsi } from '../auto-commit/strip-ansi'
import { runSuggestion } from '../auto-commit/suggestion-runner'
import { workingTreeHash } from '../auto-commit/working-tree-hash'
import { isCommandAvailable } from '../pty/command-registry'

export interface TriggerInput {
  enabled: boolean
  assistant: AssistantId
  hasProjectPath: boolean
  git: GitRefreshPayload
  sessionId: string
  state: AutoCommitState
  currentHash: string
}

export function shouldTriggerAutoCommit(input: TriggerInput): boolean {
  if (!input.enabled) return false
  if (!isSupportedProvider(input.assistant)) return false
  if (!input.hasProjectPath) return false
  if (input.git.files.length === 0) return false

  const existing = input.state.bySession[input.sessionId]
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
const SESSION_TAIL_BYTES_CAP = 8_000

export function extractSessionTail(buffer: string | undefined): string {
  if (!buffer) return '[no session tail available]'
  const stripped = stripAnsi(buffer).trimEnd()
  if (stripped.length === 0) return '[no session tail available]'
  return stripped.length > SESSION_TAIL_BYTES_CAP
    ? stripped.slice(stripped.length - SESSION_TAIL_BYTES_CAP)
    : stripped
}

interface GatheredContext {
  recentCommits: string
  diff: string
  branch: string
}

async function gatherContext(cwd: string): Promise<GatheredContext | null> {
  const logArgs = ['log', '-5', '--format=%h %s']
  const diffArgs = ['diff', 'HEAD']
  const untrackedArgs = ['ls-files', '--others', '--exclude-standard']
  const branchArgs = ['rev-parse', '--abbrev-ref', 'HEAD']
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
  sessionId: string
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
    hasProjectPath: !!args.projectPath,
    sessionId: args.sessionId,
    state: state.autoCommit,
  })
  if (!should) return

  const probe = buildHeadlessInvocation(args.assistant, '__probe__', config.models[args.assistant])
  if (!probe) return
  if (!isCommandAvailable(probe.executable)) return

  const controller = new AbortController()
  deps.dispatch({
    abortController: controller,
    sessionId: args.sessionId,
    startedAt: Date.now(),
    tabId: args.tabId,
    type: 'auto-commit-generation-started',
    workingTreeHash: currentHash,
  })

  const template = await getTemplate(deps)
  const ctx = await gatherContext(args.projectPath as string)
  if (!ctx) {
    deps.dispatch({ sessionId: args.sessionId, type: 'auto-commit-clear' })
    return
  }
  const tab = deps.getState().tabs.find((t) => t.id === args.tabId)
  const sessionTail = extractSessionTail(tab?.buffer)
  const prompt = composePromptFromTemplate(template, { ...ctx, sessionTail })
  const finalInvocation = buildHeadlessInvocation(
    args.assistant,
    prompt,
    config.models[args.assistant]
  )
  if (!finalInvocation) {
    deps.dispatch({ sessionId: args.sessionId, type: 'auto-commit-clear' })
    return
  }

  const parsed = await runSuggestion({
    invocation: finalInvocation,
    signal: controller.signal,
    timeoutMs: config.timeoutMs,
  })
  if (!parsed) {
    deps.dispatch({ sessionId: args.sessionId, type: 'auto-commit-clear' })
    return
  }
  deps.dispatch({
    body: parsed.body,
    generatedAt: Date.now(),
    sessionId: args.sessionId,
    title: parsed.title,
    type: 'auto-commit-generation-ready',
    workingTreeHash: currentHash,
  })
}

export function onGitRefresh(
  deps: DriverDeps,
  sessionId: string,
  payload: GitRefreshPayload
): void {
  const state = deps.getState()
  const current = state.autoCommit.bySession[sessionId]
  if (!current || current.kind === 'idle') return
  const newHash = workingTreeHash(payload)
  if (newHash !== current.workingTreeHash) {
    deps.dispatch({ sessionId, type: 'auto-commit-clear' })
  }
}
