import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where each assistant CLI keeps its state.
 *
 * Both relocate wholesale through an environment variable, so anything reading
 * or writing inside those directories has to go through here — three hand-rolled
 * copies of `join(homedir(), '.claude')` used to disagree about whether
 * `CLAUDE_CONFIG_DIR` existed, which sent the hook installer and the theme sync
 * to a directory Claude Code was not reading.
 */
function envHome(variable: string, fallback: string): string {
  const value = process.env[variable]?.trim()
  if (value != null && value !== '') return value
  return join(homedir(), fallback)
}

export function claudeHome(): string {
  return envHome('CLAUDE_CONFIG_DIR', '.claude')
}

export function codexHome(): string {
  return envHome('CODEX_HOME', '.codex')
}
