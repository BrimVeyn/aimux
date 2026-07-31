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
  state: string
  isDraft: boolean
  base: string
  head: string
  reviewDecision: string
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
  'state',
  'isDraft',
  'url',
  'baseRefName',
  'headRefName',
  'reviewDecision',
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
      changedFiles: num(pr.changedFiles),
      deletions: num(pr.deletions),
      head: str(pr.headRefName),
      isDraft: pr.isDraft === true,
      number: pr.number,
      reviewDecision: str(pr.reviewDecision),
      state: str(pr.state),
      title: str(pr.title),
      url: str(pr.url),
    },
  }
}

export async function collectPrStatus(cwd: string): Promise<PrStatusResult> {
  const gh = Bun.which('gh')
  if (gh === null) return { kind: 'no-gh' }

  const result = await runCli(gh, ['pr', 'view', '--json', PR_VIEW_FIELDS], 15_000, cwd)
  if (!result.ok) {
    // `gh` exits non-zero for every "there is simply nothing to show" case too:
    // no PR on the branch, no GitHub remote, or a directory that isn't a repo
    // at all (aimux sessions can point anywhere). None of those is an error.
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
