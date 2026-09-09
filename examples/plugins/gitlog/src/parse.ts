/**
 * The one part of this plugin that is neither process: the shape a commit has,
 * and how `git log`'s bytes become it.
 *
 * Separators are `%x1f` and `%x1e` — the two control bytes ASCII put there for
 * exactly this — rather than a pipe or a tab. A commit subject contains pipes
 * and tabs routinely; it cannot contain a unit separator, which is what makes
 * this parse a split rather than a guess.
 */

const FIELD = '\u001f'
const RECORD = '\u001e'

/** The `--pretty=format:` git is asked for. Fields in the order `parseLog` reads them. */
export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'

export interface Commit {
  sha: string
  short: string
  author: string
  /** ISO 8601, author date. Formatted for reading in the UI half. */
  date: string
  subject: string
}

export interface LogResult {
  branch: string | null
  repoRoot: string
  commits: Commit[]
}

export interface ShowResult {
  sha: string
  /** Body, `--stat` and, when asked for, the patch — already truncated. */
  text: string
  /** True when the patch was cut short, so the UI says so rather than lies. */
  truncated: boolean
}

export interface Failure {
  error: string
}

export function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && typeof (value as Failure).error === 'string'
}

export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const record of stdout.split(RECORD)) {
    // git puts a newline between records; the split leaves it leading.
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed === '') continue
    const [sha, short, author, date, ...rest] = trimmed.split(FIELD)
    if (sha === undefined || short === undefined) continue
    commits.push({
      author: author ?? '',
      date: date ?? '',
      sha,
      short,
      // A subject cannot contain a unit separator, so `rest` has one entry —
      // joining rather than indexing costs nothing and cannot lose a byte.
      subject: rest.join(FIELD),
    })
  }
  return commits
}

/** `2026-09-07T18:12:04+02:00` → `2 d`. Empty for a date git did not give. */
export function relative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days} d`
  const months = Math.round(days / 30.44)
  if (months < 12) return `${months} mo`
  return `${Math.round(days / 365.25)} y`
}
