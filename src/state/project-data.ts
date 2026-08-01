import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * The script's actual work, with the boilerplate stripped: the shebang, the
 * `set -e…` line, comments and blank lines. One line left means the script is a
 * command, and a single text field can hold all of it; more than one means it is
 * a script, and a text field would silently truncate it.
 */
export function readSetupScriptLines(projectId: string): string[] {
  const path = getSetupScriptPath(projectId)
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line !== '' &&
          !line.startsWith('#') &&
          !/^set\s+-[a-zA-Z]/.test(line) &&
          !/^set\s+-o\s/.test(line)
      )
  } catch {
    // Unreadable is not empty, but the caller has nothing better to show and the
    // editor path still works.
    return []
  }
}

/**
 * Replace the script with this one command, keeping the header that makes it a
 * bash script that stops on the first failure. Round-trips with
 * `readSetupScriptLines`.
 */
export function writeSetupCommand(projectId: string, command: string): void {
  mkdirSync(getProjectDataDir(projectId), { recursive: true })
  const path = getSetupScriptPath(projectId)
  writeFileSync(path, `${SETUP_HEADER}${command.trim()}\n`)
  chmodSync(path, 0o755)
}
