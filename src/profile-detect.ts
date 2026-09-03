import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_PROFILE } from './profile-paths'

/**
 * Which aimux profiles are actually running, and which one a bare command
 * should therefore talk to.
 *
 * `AIMUX_PROFILE` is how a profile is chosen, and a shell that never exported
 * it gets `default`. That is right for a person — their shell and their aimux
 * share an environment — and wrong for an agent, whose shell has none of it:
 * `aimux plugin link .` would register the plugin into a profile nobody is
 * looking at, report success, and leave the author wondering why nothing
 * appeared. Nothing in the output could have told them.
 *
 * So when nothing was asked for, the answer is what is running.
 */

interface RuntimeCandidate {
  profile: string
  pid: number
}

function runtimeRoot(): string {
  const xdg = process.env.XDG_RUNTIME_DIR
  if (xdg != null && xdg !== '') return xdg
  return join(process.env.HOME ?? '.', '.local', 'state')
}

/** A pid that no longer exists is a crashed daemon's leftovers, not a profile. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Profiles with a live daemon, by the pid file it writes on bind. The socket
 * alone is not evidence: it survives a crash, and a stale one would send every
 * command to a profile that is not there.
 */
export function listRunningProfiles(): string[] {
  const root = runtimeRoot()
  if (!existsSync(root)) return []
  const running: RuntimeCandidate[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.startsWith('aimux-')) continue
    const pidFile = join(root, entry, 'daemon.pid')
    if (!existsSync(pidFile)) continue
    let pid = Number.NaN
    try {
      pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
    } catch {
      continue
    }
    if (!Number.isInteger(pid) || !isAlive(pid)) continue
    running.push({ pid, profile: entry.slice('aimux-'.length) })
  }
  return running.map((candidate) => candidate.profile).sort()
}

export type ProfileOrigin = 'env' | 'only-running' | 'default' | 'ambiguous'

export interface ProfileChoice {
  profile: string
  from: ProfileOrigin
  running: string[]
}

/**
 * The profile a command with no `AIMUX_PROFILE` should use.
 *
 * One running profile is not a guess — it is the only aimux there is. Several
 * with `default` among them keeps the documented default. Several *without* it
 * is the one case with no honest answer, so it says so and the caller refuses
 * rather than picking someone's other session.
 */
export function resolveAmbientProfile(): ProfileChoice {
  const configured = process.env.AIMUX_PROFILE ?? process.env.AIMUX_RUNTIME_PROFILE
  const running = listRunningProfiles()
  if (configured != null && configured !== '') {
    return { from: 'env', profile: configured, running }
  }
  if (running.length === 1 && running[0] !== undefined) {
    return { from: 'only-running', profile: running[0], running }
  }
  if (running.length > 1 && !running.includes(DEFAULT_PROFILE)) {
    return { from: 'ambiguous', profile: DEFAULT_PROFILE, running }
  }
  return { from: 'default', profile: DEFAULT_PROFILE, running }
}
