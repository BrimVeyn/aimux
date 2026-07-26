import type { SessionRecord, WorktreeRecord } from '../../state/types'

import { findMostRecentSession, loadSessionCatalog } from '../../state/session-catalog'

/**
 * Where a command's target workspace came from. An orchestrator needs this to
 * tell "I asked for pragma-once" from "aimux guessed, and the UI had moved on":
 * `active` is the only origin that can silently follow the UI to another repo.
 */
export type WorkspaceOrigin = 'flag' | 'env' | 'active'

export interface ResolvedWorkspace {
  origin: WorkspaceOrigin
  record: SessionRecord
}

/** Env pin for headless orchestrators — `--workspace` still wins over it. */
export const WORKSPACE_ENV_VAR = 'AIMUX_WORKSPACE'

/** The workspace's primary (root) worktree, i.e. the repository it is about. */
export function findPrimaryWorktree(session: SessionRecord): WorktreeRecord | undefined {
  return session.worktrees?.find((worktree) => worktree.source === 'primary')
}

/**
 * The repo every fresh worktree for this workspace is cut from. Surfaced in
 * every worker envelope so an agent can see *which project* it just acted on
 * instead of inferring it from a worktree path hash.
 */
export function workspaceRepoRoot(session: SessionRecord): string | null {
  return findPrimaryWorktree(session)?.repoRoot ?? session.projectPath ?? null
}

/** Stable workspace identity block embedded in command output. */
export function workspaceIdentity(session: SessionRecord): {
  id: string
  name: string
  repoRoot: string | null
} {
  return { id: session.id, name: session.name, repoRoot: workspaceRepoRoot(session) }
}

/**
 * Resolve `--workspace W` to a session record from the catalog, reporting where
 * the choice came from. Precedence: the explicit flag, then `AIMUX_WORKSPACE`,
 * then the most recently opened session. Throws when the catalog is empty (no
 * session has ever been created) or when the explicit name/id doesn't match.
 *
 * Matching: exact id wins; otherwise exact name (case-sensitive); otherwise
 * unique case-insensitive name match.
 */
export function resolveWorkspaceWithOrigin(name: string | undefined): ResolvedWorkspace {
  const sessions = loadSessionCatalog()
  if (sessions.length === 0) {
    throw new Error(
      'no sessions found — create one from the aimux UI first (or pass --workspace once created)'
    )
  }

  const flag = name !== undefined && name !== '' ? name : undefined
  const env = process.env[WORKSPACE_ENV_VAR]
  const fromEnv = env != null && env !== '' ? env : undefined
  const selector = flag ?? fromEnv
  if (selector === undefined) {
    const active = findMostRecentSession(sessions)
    if (!active) {
      throw new Error('no active workspace and the catalog is empty')
    }
    return { origin: 'active', record: active }
  }

  return {
    origin: flag !== undefined ? 'flag' : 'env',
    record: matchWorkspace(sessions, selector),
  }
}

export function resolveWorkspace(name: string | undefined): SessionRecord {
  return resolveWorkspaceWithOrigin(name).record
}

function matchWorkspace(sessions: SessionRecord[], name: string): SessionRecord {
  const byId = sessions.find((session) => session.id === name)
  if (byId) return byId

  const exactNameMatches = sessions.filter((session) => session.name === name)
  if (exactNameMatches.length > 1) {
    throw new Error(
      `workspace "${name}" matches multiple sessions: ${exactNameMatches.map((s) => s.id).join(', ')}`
    )
  }
  const exactOnly = exactNameMatches[0]
  if (exactOnly) return exactOnly

  const lower = name.toLowerCase()
  const ciMatches = sessions.filter((session) => session.name.toLowerCase() === lower)
  if (ciMatches.length > 1) {
    throw new Error(
      `workspace "${name}" matches multiple sessions: ${ciMatches.map((s) => s.id).join(', ')}`
    )
  }
  const ciOnly = ciMatches[0]
  if (ciOnly) return ciOnly

  throw new Error(`workspace not found: ${name}`)
}

export function listWorkspaces(): SessionRecord[] {
  return loadSessionCatalog()
}
