import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getProfileConfigDir } from '../profile-paths'

const SETUP_HEADER = `#!/usr/bin/env bash
set -euo pipefail

`

const SETUP_STUB = `#!/usr/bin/env bash
set -euo pipefail

# aimux setup script.
#
# Runs once per newly created workspace, with the working directory set to that
# workspace's root. A workspace is a fresh \`git worktree\`, so it contains only
# files tracked by git — no .env, no node_modules, no .venv, no build cache.
#
# Keep it idempotent and non-interactive. A non-zero exit is surfaced in the
# setup widget and recorded on the workspace.

echo "nothing to do yet — edit this script"
`

// Resolved per call, never module-cached: --profile is applied after module
// import, so a cached path would point at the wrong profile.
export function getProjectDataDir(projectId: string): string {
  return join(getProfileConfigDir(), 'projects', projectId)
}

export function getSetupScriptPath(projectId: string): string {
  return join(getProjectDataDir(projectId), 'setup.sh')
}

export function hasSetupScript(projectId: string): boolean {
  return existsSync(getSetupScriptPath(projectId))
}

/** Returns the script path, creating an executable stub if there is none. */
export function ensureSetupScriptStub(projectId: string): string {
  const path = getSetupScriptPath(projectId)
  if (existsSync(path)) return path
  mkdirSync(getProjectDataDir(projectId), { recursive: true })
  writeFileSync(path, SETUP_STUB)
  chmodSync(path, 0o755)
  return path
}

const EMPTY_LINES: string[] = []

/**
 * Keyed by path, not project id: the path depends on the active profile, which is
 * resolved per call. Holds one small array per project that has a setup script.
 */
const setupLinesCache = new Map<string, { mtimeMs: number; lines: string[] }>()

/** A line that does something, as opposed to a shebang, an option or a comment. */
function isWorkLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed !== '' &&
    !trimmed.startsWith('#') &&
    !/^set\s+-[a-zA-Z]/.test(trimmed) &&
    !/^set\s+-o\s/.test(trimmed)
  )
}

function parseSetupScript(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => isWorkLine(line))
    .map((line) => line.trim())
}

/**
 * The script's actual work, with the boilerplate stripped: the shebang, the
 * `set -e…` line, comments and blank lines. One line left means the script is a
 * command, and a single text field can hold all of it; more than one means it is
 * a script, and a text field would silently truncate it.
 *
 * Cached against the file's mtime, because the settings screen builds its Setup
 * rows from this: the search filter runs it for every project on every keystroke,
 * and `getModalOptionCount` runs it from inside the reducer. A `statSync` per
 * project is a syscall; a read-and-parse per project per keystroke is a habit
 * that gets worse with every project the user adds. An edit made outside aimux
 * still lands — that is what the mtime is for.
 */
export function readSetupScriptLines(projectId: string): string[] {
  const path = getSetupScriptPath(projectId)
  try {
    const { mtimeMs } = statSync(path)
    const cached = setupLinesCache.get(path)
    if (cached?.mtimeMs === mtimeMs) return cached.lines
    const lines = parseSetupScript(readFileSync(path, 'utf8'))
    setupLinesCache.set(path, { lines, mtimeMs })
    return lines
  } catch {
    // Missing or unreadable. Not the same thing, but the caller has nothing
    // better to show for either, and the editor path still works.
    setupLinesCache.delete(path)
    return EMPTY_LINES
  }
}

/**
 * Put this one command in the script, replacing the work line that was there.
 * Round-trips with `readSetupScriptLines`.
 *
 * Everything that is not that line survives: the shebang, the `set -e…`, and any
 * comments. Rewriting the file from a fixed header was simpler and quietly threw
 * away whatever the user had written around their one command — a field that
 * deletes the notes next to what it edits is not an editor.
 */
export function writeSetupCommand(projectId: string, command: string): void {
  mkdirSync(getProjectDataDir(projectId), { recursive: true })
  const path = getSetupScriptPath(projectId)
  writeFileSync(path, nextSetupSource(path, command.trim()))
  chmodSync(path, 0o755)
  // Not left to the mtime: a write and the read that follows it can land in the
  // same millisecond, and the cache would hand back what was there before.
  setupLinesCache.delete(path)
}

function nextSetupSource(path: string, command: string): string {
  let existing: string
  try {
    existing = readFileSync(path, 'utf8')
  } catch {
    // No script yet (or none we can read): the template is all there is to keep.
    return `${SETUP_HEADER}${command}\n`
  }

  const lines = existing.split('\n')
  const first = lines.findIndex((line) => isWorkLine(line))
  // Nothing to replace — the stub, or comments only. Append rather than drop them.
  if (first === -1) return `${existing.replace(/\n*$/, '')}\n\n${command}\n`
  lines[first] = command
  return lines.join('\n')
}
