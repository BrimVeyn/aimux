import { runCli } from '../services/ai-usage/spawn'

export type PrCheckState = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'

export interface PrCheck {
  name: string
  workflow: string
  state: PrCheckState
  url: string
  durationMs: number | null
}

export interface PrSummary {
  number: number
  title: string
  body: string
  state: string
  isDraft: boolean
  base: string
  head: string
  reviewDecision: string
  /** MERGEABLE | CONFLICTING | UNKNOWN */
  mergeable: string
  /** CLEAN | BLOCKED | BEHIND | UNSTABLE | DIRTY | DRAFT | HAS_HOOKS | UNKNOWN */
  mergeStateStatus: string
  additions: number
  deletions: number
  changedFiles: number
  url: string
}

export type PrStatusResult =
  | { kind: 'ok'; pr: PrSummary; checks: PrCheck[] }
  | { kind: 'no-pr' }
  | { kind: 'no-gh' }
  | { kind: 'error'; message: string }

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'body',
  'state',
  'isDraft',
  'url',
  'baseRefName',
  'headRefName',
  'reviewDecision',
  'mergeable',
  'mergeStateStatus',
  'additions',
  'deletions',
  'changedFiles',
  'statusCheckRollup',
].join(',')

const NOT_AN_ERROR = [
  'no pull requests found',
  'no git remotes',
  'not a git repository',
  'none of the git remotes',
  'no default remote',
]

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function duration(startedAt: unknown, completedAt: unknown): number | null {
  const start = Date.parse(str(startedAt))
  const end = Date.parse(str(completedAt))
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return end - start
}

// `gh` documents these buckets for `pr checks --json bucket`; we derive the same
// classification from the raw rollup so a single `pr view` call covers both the
// summary and the checks.
function checkRunState(status: string, conclusion: string): PrCheckState {
  if (status !== 'COMPLETED') return 'pending'
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') return 'pass'
  if (conclusion === 'SKIPPED') return 'skipping'
  if (conclusion === 'CANCELLED') return 'cancel'
  return 'fail'
}

function statusContextState(state: string): PrCheckState {
  if (state === 'SUCCESS') return 'pass'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return 'fail'
}

function toCheck(raw: unknown): PrCheck | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  if (entry.__typename === 'StatusContext') {
    const name = str(entry.context)
    if (name === '') return null
    return {
      durationMs: null,
      name,
      state: statusContextState(str(entry.state)),
      url: str(entry.targetUrl),
      workflow: '',
    }
  }
  const name = str(entry.name)
  if (name === '') return null
  return {
    durationMs: duration(entry.startedAt, entry.completedAt),
    name,
    state: checkRunState(str(entry.status), str(entry.conclusion)),
    url: str(entry.detailsUrl),
    workflow: str(entry.workflowName),
  }
}

export function parsePrView(raw: unknown): PrStatusResult {
  if (typeof raw !== 'object' || raw === null) return { kind: 'no-pr' }
  const pr = raw as Record<string, unknown>
  if (typeof pr.number !== 'number') return { kind: 'no-pr' }
  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
  return {
    checks: rollup.map(toCheck).filter((c): c is PrCheck => c !== null),
    kind: 'ok',
    pr: {
      additions: num(pr.additions),
      base: str(pr.baseRefName),
      body: str(pr.body).trim(),
      changedFiles: num(pr.changedFiles),
      deletions: num(pr.deletions),
      head: str(pr.headRefName),
      isDraft: pr.isDraft === true,
      mergeable: str(pr.mergeable),
      mergeStateStatus: str(pr.mergeStateStatus),
      number: pr.number,
      reviewDecision: str(pr.reviewDecision),
      state: str(pr.state),
      title: str(pr.title),
      url: str(pr.url),
    },
  }
}

export type PrAction = 'cleanup' | 'merge' | null

export interface PrActionState {
  label: string
  action: PrAction
  tone: 'ok' | 'blocked' | 'neutral'
}

/**
 * The headline GitHub puts on the merge box, and the one action worth wiring to
 * it. Order matters: a terminal state beats everything, then a hard blocker
 * (conflicts, draft), then whatever the checks are doing. Anything we can't
 * offer an action for still gets an honest label rather than a dead button.
 */
export function prActionState(pr: PrSummary, checks: PrCheck[]): PrActionState {
  // Merged is the one terminal state with something left to do: the workspace
  // that carried the branch is now dead weight. The row offers the removal
  // right where the merge happened; whether it's actually removable (not the
  // primary workspace) is the caller's call, not the PR's.
  if (pr.state === 'MERGED') return { action: 'cleanup', label: 'Merged', tone: 'ok' }
  if (pr.state === 'CLOSED') return { action: null, label: 'Closed', tone: 'blocked' }
  if (pr.isDraft) return { action: null, label: 'Draft', tone: 'neutral' }
  if (pr.mergeable === 'CONFLICTING') {
    return { action: null, label: 'Merge conflicts', tone: 'blocked' }
  }
  if (checks.some((c) => c.state === 'pending')) {
    return { action: null, label: 'Checks running', tone: 'neutral' }
  }
  if (pr.mergeStateStatus === 'BLOCKED') return { action: null, label: 'Blocked', tone: 'blocked' }
  if (pr.mergeStateStatus === 'BEHIND')
    return { action: null, label: 'Out of date', tone: 'blocked' }
  // UNSTABLE means a non-required check failed; GitHub still lets you merge.
  if (pr.mergeStateStatus === 'UNSTABLE') {
    return { action: 'merge', label: 'Checks failing', tone: 'blocked' }
  }
  if (pr.mergeStateStatus === 'CLEAN') {
    return { action: 'merge', label: 'Ready to merge', tone: 'ok' }
  }
  return { action: null, label: 'Checking…', tone: 'neutral' }
}

export type PrCleanupKind = 'branch' | 'worktree' | null

/**
 * What "clean up" means for a merged PR, which depends on where its branch
 * lives. A linked workspace is disposable, so it goes. The repo checkout is not
 * — the equivalent is leaving the merged branch for the one it landed on, which
 * the PR names, so a PR into `develop` doesn't drop you on `main`.
 *
 * `gh pr view` resolves the PR from the checked-out branch, so a PR on screen
 * means we're on its head — but a base already equal to it has nowhere to go.
 */
export function prCleanupKind(
  action: PrAction,
  pr: Pick<PrSummary, 'base' | 'head'>,
  workspaceIsRemovable: boolean
): PrCleanupKind {
  if (action !== 'cleanup') return null
  if (workspaceIsRemovable) return 'worktree'
  if (pr.base === '' || pr.base === pr.head) return null
  return 'branch'
}

export interface ClampedBody {
  text: string
  truncated: boolean
}

/**
 * A PR body is a whole document; a bar widget gets a preview of it. Clamping on
 * lines alone breaks on a wall-of-text paragraph and clamping on characters
 * alone breaks on a bullet list, so whichever limit bites first wins.
 */
export function clampPrBody(body: string, maxLines = 5, maxChars = 260): ClampedBody {
  const full = body.trimEnd()
  const lines = full.split('\n')
  let text = lines.slice(0, maxLines).join('\n')
  if (text.length > maxChars) {
    const space = text.lastIndexOf(' ', maxChars)
    // Only respect a word boundary that isn't absurdly early, else hard-cut.
    text = text.slice(0, space > maxChars / 2 ? space : maxChars)
  }
  text = text.trimEnd()
  return { text, truncated: text.length < full.length }
}

export async function collectPrStatus(cwd: string): Promise<PrStatusResult> {
  const gh = Bun.which('gh')
  if (gh === null) return { kind: 'no-gh' }

  const result = await runCli(gh, ['pr', 'view', '--json', PR_VIEW_FIELDS], 15_000, cwd)
  if (!result.ok) {
    // `gh` exits non-zero for every "there is simply nothing to show" case too:
    // no PR on the branch, no GitHub remote, or a directory that isn't a repo
    // at all (aimux projects can point anywhere). None of those is an error.
    const stderr = result.stderr.toLowerCase()
    if (NOT_AN_ERROR.some((needle) => stderr.includes(needle))) return { kind: 'no-pr' }
    return { kind: 'error', message: (result.error ?? 'gh failed').slice(0, 200) }
  }

  try {
    return parsePrView(JSON.parse(result.stdout))
  } catch {
    return { kind: 'no-pr' }
  }
}
