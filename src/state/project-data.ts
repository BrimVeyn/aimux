import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getProfileConfigDir } from '../profile-paths'

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
