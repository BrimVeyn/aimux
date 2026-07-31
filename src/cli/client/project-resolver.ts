import type { ProjectRecord, WorkspaceRecord } from '../../state/types'

import { findMostRecentProject, loadProjectCatalog } from '../../state/project-catalog'

/**
 * Where a command's target project came from. An orchestrator needs this to
 * tell "I asked for pragma-once" from "aimux guessed, and the UI had moved on":
 * `active` is the only origin that can silently follow the UI to another repo.
 */
export type ProjectOrigin = 'flag' | 'env' | 'active'

export interface ResolvedProject {
  origin: ProjectOrigin
  record: ProjectRecord
}

/** Env pin for headless orchestrators — `--project` still wins over it. */
export const PROJECT_ENV_VAR = 'AIMUX_PROJECT'

/** The project's primary (root) workspace, i.e. the repository it is about. */
export function findPrimaryWorkspace(project: ProjectRecord): WorkspaceRecord | undefined {
  return project.workspaces?.find((workspace) => workspace.source === 'primary')
}

/**
 * The repo every fresh workspace for this project is cut from. Surfaced in
 * every worker envelope so an agent can see *which project* it just acted on
 * instead of inferring it from a workspace path hash.
 */
export function projectRepoRoot(project: ProjectRecord): string | null {
  return findPrimaryWorkspace(project)?.repoRoot ?? project.projectPath ?? null
}

/** Stable project identity block embedded in command output. */
export function projectIdentity(project: ProjectRecord): {
  id: string
  name: string
  repoRoot: string | null
} {
  return { id: project.id, name: project.name, repoRoot: projectRepoRoot(project) }
}

/**
 * Resolve `--project W` to a project record from the catalog, reporting where
 * the choice came from. Precedence: the explicit flag, then `AIMUX_PROJECT`,
 * then the most recently opened project. Throws when the catalog is empty (no
 * project has ever been created) or when the explicit name/id doesn't match.
 *
 * Matching: exact id wins; otherwise exact name (case-sensitive); otherwise
 * unique case-insensitive name match.
 */
export function resolveProjectWithOrigin(name: string | undefined): ResolvedProject {
  const projects = loadProjectCatalog()
  if (projects.length === 0) {
    throw new Error(
      'no projects found — create one from the aimux UI first (or pass --project once created)'
    )
  }

  const flag = name !== undefined && name !== '' ? name : undefined
  const env = process.env[PROJECT_ENV_VAR]
  const fromEnv = env != null && env !== '' ? env : undefined
  const selector = flag ?? fromEnv
  if (selector === undefined) {
    const active = findMostRecentProject(projects)
    if (!active) {
      throw new Error('no active project and the catalog is empty')
    }
    return { origin: 'active', record: active }
  }

  return {
    origin: flag !== undefined ? 'flag' : 'env',
    record: matchProject(projects, selector),
  }
}

export function resolveProject(name: string | undefined): ProjectRecord {
  return resolveProjectWithOrigin(name).record
}

function matchProject(projects: ProjectRecord[], name: string): ProjectRecord {
  const byId = projects.find((project) => project.id === name)
  if (byId) return byId

  const exactNameMatches = projects.filter((project) => project.name === name)
  if (exactNameMatches.length > 1) {
    throw new Error(
      `project "${name}" matches multiple projects: ${exactNameMatches.map((s) => s.id).join(', ')}`
    )
  }
  const exactOnly = exactNameMatches[0]
  if (exactOnly) return exactOnly

  const lower = name.toLowerCase()
  const ciMatches = projects.filter((project) => project.name.toLowerCase() === lower)
  if (ciMatches.length > 1) {
    throw new Error(
      `project "${name}" matches multiple projects: ${ciMatches.map((s) => s.id).join(', ')}`
    )
  }
  const ciOnly = ciMatches[0]
  if (ciOnly) return ciOnly

  throw new Error(`project not found: ${name}`)
}

export function listProjects(): ProjectRecord[] {
  return loadProjectCatalog()
}
