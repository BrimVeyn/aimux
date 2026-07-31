import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectRecord } from './types'

import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { ensureProjectWorktrees } from './project-worktrees'
import { toast } from './toast-store'
import { isProjectRecord } from './validation'

interface ProjectCatalogFile {
  version: 1
  projects: ProjectRecord[]
}

const PROJECTS_PATH = join(getProfileConfigDir(), 'aimux-sessions.json')

function readCatalogFile(): { file: ProjectCatalogFile | null; issue?: string } {
  try {
    if (!existsSync(PROJECTS_PATH)) {
      return { file: null }
    }

    const parsed = JSON.parse(readFileSync(PROJECTS_PATH, 'utf8')) as {
      version?: unknown
      projects?: unknown
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
      return { file: null, issue: 'invalid project catalog header' }
    }

    if (!parsed.projects.every(isProjectRecord)) {
      return { file: null, issue: 'invalid project catalog entries' }
    }

    return { file: { projects: parsed.projects, version: 1 } }
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
    if (JSON.stringify(normalized) !== JSON.stringify(file.projects)) {
      saveProjectCatalog(normalized)
    }
    return normalized
  }

  if (issue != null && issue !== '') {
    logDebug('projects.catalog.loadIssue', { issue, path: PROJECTS_PATH })
  }

  const config = loadConfig()
  if (!config.workspaceSnapshot) {
    logDebug('projects.catalog.load', { projectCount: 0 })
    return []
  }

  const now = new Date().toISOString()
  const migrated: ProjectRecord = {
    createdAt: now,
    id: `project-${Date.now()}`,
    lastOpenedAt: now,
    name: 'Last workspace',
    updatedAt: now,
    workspaceSnapshot: config.workspaceSnapshot,
  }

  const normalized = normalizeProjects([migrated])
  saveProjectCatalog(normalized)
  saveConfig({ ...config, workspaceSnapshot: undefined })
  logDebug('projects.catalog.migrateLegacyWorkspace', {
    migratedProjectId: migrated.id,
    tabCount: migrated.workspaceSnapshot?.tabs.length ?? 0,
  })
  return normalized
}

export function saveProjectCatalog(projects: ProjectRecord[]): void {
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    writeFileSync(PROJECTS_PATH, `${JSON.stringify({ projects, version: 1 }, null, 2)}\n`)
    logDebug('projects.catalog.save', { projectCount: projects.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('projects.catalog.saveError', {
      error: message,
      path: PROJECTS_PATH,
      projectCount: projects.length,
    })
    // Persisting the catalog underpins workspace/worktree state — a silent
    // failure means the user loses projects on restart. Surface it.
    toast.error(`Failed to save projects: ${message}`)
  }
}

export function getProjectCatalogPath(): string {
  return PROJECTS_PATH
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
  return normalizeOrder(projects).map((project) => ensureProjectWorktrees(project))
}
