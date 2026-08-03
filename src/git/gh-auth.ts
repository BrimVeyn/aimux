import { runCli } from '../services/ai-usage/spawn'

export interface GhAccount {
  host: string
  user: string
  active: boolean
}

/**
 * `gh auth status` has no `--json`, so its human output is the API: one
 * "Logged in to <host> account <user>" line per account, each followed by the
 * "Active account:" line that belongs to it.
 */
export function parseGhAuthStatus(output: string): GhAccount[] {
  const accounts: GhAccount[] = []
  for (const line of output.split('\n')) {
    const login = /Logged in to (\S+) account (\S+)/.exec(line)
    if (login !== null) {
      accounts.push({ active: false, host: login[1] ?? '', user: login[2] ?? '' })
      continue
    }
    const current = accounts.at(-1)
    if (current !== undefined && /Active account:\s*true/i.test(line)) current.active = true
  }
  return accounts
}

export async function listGhAccounts(): Promise<GhAccount[]> {
  const gh = Bun.which('gh')
  if (gh === null) return []
  // Non-zero exit when nothing is logged in, and the report has lived on both
  // streams across gh versions — read both and let the parser decide.
  const result = await runCli(gh, ['auth', 'status'], 10_000)
  return parseGhAuthStatus(`${result.stdout}\n${result.stderr}`)
}

/**
 * Where a "switch account" button goes next: the following account, cycling.
 * The order has to come from the names, not from `gh auth status`, which lists
 * the active account first — cycling that puts you back on the account you just
 * left, so a third account is never reachable.
 */
export function nextGhAccount(accounts: readonly GhAccount[]): GhAccount | null {
  if (accounts.length < 2) return null
  const sorted = [...accounts].sort(
    (a, b) => a.host.localeCompare(b.host) || a.user.localeCompare(b.user)
  )
  const index = sorted.findIndex((account) => account.active)
  return sorted[(index + 1) % sorted.length] ?? null
}

/** Returns an error message, or null when the switch landed. */
export async function switchGhAccount(account: GhAccount): Promise<string | null> {
  const gh = Bun.which('gh')
  if (gh === null) return 'gh CLI not found'
  // --user is what keeps this non-interactive: with three accounts on a host,
  // a bare `gh auth switch` opens a prompt no widget can answer.
  const args = ['auth', 'switch', '--hostname', account.host, '--user', account.user]
  const result = await runCli(gh, args, 15_000)
  if (result.ok) return null
  return result.stderr.trim().split('\n')[0] ?? 'gh auth switch failed'
}
