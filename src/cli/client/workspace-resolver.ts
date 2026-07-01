import type { SessionRecord } from '../../state/types'

import { findMostRecentSession, loadSessionCatalog } from '../../state/session-catalog'

/**
 * Resolve `--workspace W` to a session record from the catalog. Falls back to
 * the most recently opened session when the flag is absent. Throws when the
 * catalog is empty (no session has ever been created) or when the explicit
 * name/id doesn't match.
 *
 * Matching: exact id wins; otherwise exact name (case-sensitive); otherwise
 * unique case-insensitive name match.
 */
export function resolveWorkspace(name: string | undefined): SessionRecord {
  const sessions = loadSessionCatalog()
  if (sessions.length === 0) {
    throw new Error(
      'no sessions found — create one from the aimux UI first (or pass --workspace once created)'
    )
  }

  if (name === undefined || name === '') {
    const active = findMostRecentSession(sessions)
    if (!active) {
      throw new Error('no active workspace and the catalog is empty')
    }
    return active
  }

  const byId = sessions.find((session) => session.id === name)
  if (byId) return byId

  const byName = sessions.find((session) => session.name === name)
  if (byName) return byName

  const lower = name.toLowerCase()
  const ciMatches = sessions.filter((session) => session.name.toLowerCase() === lower)
  const onlyMatch = ciMatches.length === 1 ? ciMatches[0] : undefined
  if (onlyMatch) return onlyMatch
  if (ciMatches.length > 1) {
    throw new Error(
      `workspace "${name}" matches multiple sessions: ${ciMatches.map((s) => s.id).join(', ')}`
    )
  }

  throw new Error(`workspace not found: ${name}`)
}

export function listWorkspaces(): SessionRecord[] {
  return loadSessionCatalog()
}
