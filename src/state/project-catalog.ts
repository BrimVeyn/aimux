import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectRecord } from './types'

import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { ensureProjectWorkspaces } from './project-workspaces'
import { toast } from './toast-store'
import { isProjectRecord } from './validation'

const CATALOG_VERSION = 2

interface ProjectCatalogFile {
  version: typeof CATALOG_VERSION
  projects: ProjectRecord[]
}

// Resolved per call, never module-cached: $HOME is read at call time so tests
// that redirect it cannot clobber the real catalog.
function projectsPath(): string {
  return join(getProfileConfigDir(), 'aimux-projects.json')
}

// ponytail: the v1 file is left on disk so a downgrade still works. Drop this
// helper, migrateV1 and the fallback branch a release or two out.
function legacySessionsPath(): string {
  return join(getProfileConfigDir(), 'aimux-sessions.json')
}

/** The v1 shape, before project/workspace naming. Only what migrateV1 reads. */
interface LegacyProjectRecordV1 {
  projectPath?: string
  workspaceSnapshot?: {
    tabs?: { worktreeId?: string }[]
    lastActiveTabByWorktree?: Record<string, string>
  }
  worktrees?: { source?: string; repoRoot?: string }[]
  activeWorktreeId?: string
}

/**
 * v1 -> v2: `worktrees` became `workspaces`, `workspaceSnapshot` became
 * `projectSnapshot`, and each tab's `worktreeId` became `workspaceId`. Record
 * ids are deliberately left alone — they are opaque and may be scripted.
 *
 * `projectPath` is also healed here: v1 rewrote it with the *active worktree's*
 * path, so it usually pointed inside the worktree root rather than at the repo.
 */
function migrateV1(records: LegacyProjectRecordV1[]): unknown[] {
  return records.map((record) => {
    const { activeWorktreeId, workspaceSnapshot, worktrees, ...rest } = record
    const primaryRepoRoot = worktrees?.find((w) => w.source === 'primary')?.repoRoot
    return {
      ...rest,
      ...(primaryRepoRoot != null && primaryRepoRoot !== ''
        ? { projectPath: primaryRepoRoot }
        : null),
      ...(worktrees ? { workspaces: worktrees } : null),
      ...(activeWorktreeId != null ? { activeWorkspaceId: activeWorktreeId } : null),
      ...(workspaceSnapshot
        ? {
            projectSnapshot: (() => {
              const { lastActiveTabByWorktree, tabs, ...snapshot } = workspaceSnapshot
              return {
                ...snapshot,
                ...(lastActiveTabByWorktree
                  ? { lastActiveTabByWorkspace: lastActiveTabByWorktree }
                  : null),
                ...(tabs
                  ? {
                      tabs: tabs.map(({ worktreeId, ...tab }) => ({
                        ...tab,
                        ...(worktreeId != null ? { workspaceId: worktreeId } : null),
                      })),
                    }
                  : null),
              }
            })(),
          }
        : null),
    }
  })
}

function parseCatalog(path: string, version: number): { projects: unknown[] } | { issue: string } {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    version?: unknown
    projects?: unknown
    sessions?: unknown
  }
  if (parsed.version !== version) {
    return { issue: `invalid project catalog header in ${path}` }
  }
  // v1 called the array `sessions`.
  const records = parsed.projects ?? parsed.sessions
  if (!Array.isArray(records)) {
    return { issue: `invalid project catalog header in ${path}` }
  }
  return { projects: records }
}

function readCatalogFile(): { file: ProjectCatalogFile | null; issue?: string } {
  try {
    let records: unknown[]
    if (existsSync(projectsPath())) {
      const parsed = parseCatalog(projectsPath(), CATALOG_VERSION)
      if ('issue' in parsed) return { file: null, issue: parsed.issue }
      records = parsed.projects
    } else if (existsSync(legacySessionsPath())) {
      const parsed = parseCatalog(legacySessionsPath(), 1)
      if ('issue' in parsed) return { file: null, issue: parsed.issue }
      records = migrateV1(parsed.projects as LegacyProjectRecordV1[])
      logDebug('projects.catalog.migrateV1', { projectCount: records.length })
    } else {
      return { file: null }
    }

    if (!records.every(isProjectRecord)) {
      return { file: null, issue: 'invalid project catalog entries' }
    }

    return { file: { projects: records, version: CATALOG_VERSION } }
  } catch (error) {
    return {
      file: null,
      issue: `failed to load project catalog: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function loadProjectCatalog(): ProjectRecord[] {
  const { file, issue } = readCatalogFile()
  if (file) {
    logDebug('projects.catalog.load', { projectCount: file.projects.length })
    const normalized = normalizeProjects(file.projects)
    // A fresh migration has no v2 file yet, so write even when normalizing
    // changed nothing.
    if (
      !existsSync(projectsPath()) ||
      JSON.stringify(normalized) !== JSON.stringify(file.projects)
    ) {
      saveProjectCatalog(normalized)
    }
    return normalized
  }

  if (issue != null && issue !== '') {
    logDebug('projects.catalog.loadIssue', { issue, path: projectsPath() })
  }

  const config = loadConfig()
  if (!config.projectSnapshot) {
    logDebug('projects.catalog.load', { projectCount: 0 })
    return []
  }

  const now = new Date().toISOString()
  const migrated: ProjectRecord = {
    createdAt: now,
    id: `project-${Date.now()}`,
    lastOpenedAt: now,
    name: 'Last project',
    projectSnapshot: config.projectSnapshot,
    updatedAt: now,
  }

  const normalized = normalizeProjects([migrated])
  saveProjectCatalog(normalized)
  saveConfig({ ...config, projectSnapshot: undefined })
  logDebug('projects.catalog.migrateLegacyProject', {
    migratedProjectId: migrated.id,
    tabCount: migrated.projectSnapshot?.tabs.length ?? 0,
  })
  return normalized
}

export function saveProjectCatalog(projects: ProjectRecord[]): void {
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    writeFileSync(
      projectsPath(),
      `${JSON.stringify({ projects, version: CATALOG_VERSION }, null, 2)}\n`
    )
    logDebug('projects.catalog.save', { projectCount: projects.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('projects.catalog.saveError', {
      error: message,
      path: projectsPath(),
      projectCount: projects.length,
    })
    // Persisting the catalog underpins project/workspace state — a silent
    // failure means the user loses projects on restart. Surface it.
    toast.error(`Failed to save projects: ${message}`)
  }
}

export function getProjectCatalogPath(): string {
  return projectsPath()
}

export function findMostRecentProject(projects: ProjectRecord[]): ProjectRecord | undefined {
  let best: ProjectRecord | undefined
  for (const candidate of projects) {
    if (!best || candidate.lastOpenedAt.localeCompare(best.lastOpenedAt) > 0) {
      best = candidate
    }
  }
  return best
}

/**
 * Assign a stable `order` to every project. Records with an existing numeric
 * `order` keep their slot (sorted ascending); the rest are appended by
 * createdAt ascending so older projects come first.
 */
function normalizeOrder(projects: ProjectRecord[]): ProjectRecord[] {
  const withOrder: ProjectRecord[] = []
  const withoutOrder: ProjectRecord[] = []
  for (const s of projects) {
    if (typeof s.order === 'number' && Number.isFinite(s.order)) {
      withOrder.push(s)
    } else {
      withoutOrder.push(s)
    }
  }
  withOrder.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  withoutOrder.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const merged = [...withOrder, ...withoutOrder]
  return merged.map((s, i) => (s.order === i ? s : { ...s, order: i }))
}

function normalizeProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return normalizeOrder(projects).map((project) => ensureProjectWorkspaces(project))
}
