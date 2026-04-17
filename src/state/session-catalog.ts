import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionRecord } from './types'

import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { isSessionRecord } from './validation'

interface SessionCatalogFile {
  version: 1
  sessions: SessionRecord[]
}

const SESSIONS_PATH = join(getProfileConfigDir(), 'aimux-sessions.json')

function readCatalogFile(): { file: SessionCatalogFile | null; issue?: string } {
  try {
    if (!existsSync(SESSIONS_PATH)) {
      return { file: null }
    }

    const parsed = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8')) as {
      version?: unknown
      sessions?: unknown
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { file: null, issue: 'invalid session catalog header' }
    }

    if (!parsed.sessions.every(isSessionRecord)) {
      return { file: null, issue: 'invalid session catalog entries' }
    }

    return { file: { sessions: parsed.sessions, version: 1 } }
  } catch (error) {
    return {
      file: null,
      issue: `failed to load session catalog: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function loadSessionCatalog(): SessionRecord[] {
  const { file, issue } = readCatalogFile()
  if (file) {
    logDebug('sessions.catalog.load', { sessionCount: file.sessions.length })
    return normalizeOrder(file.sessions)
  }

  if (issue) {
    logDebug('sessions.catalog.loadIssue', { issue, path: SESSIONS_PATH })
  }

  const config = loadConfig()
  if (!config.workspaceSnapshot) {
    logDebug('sessions.catalog.load', { sessionCount: 0 })
    return []
  }

  const now = new Date().toISOString()
  const migrated: SessionRecord = {
    createdAt: now,
    id: `session-${Date.now()}`,
    lastOpenedAt: now,
    name: 'Last workspace',
    updatedAt: now,
    workspaceSnapshot: config.workspaceSnapshot,
  }

  saveSessionCatalog([migrated])
  saveConfig({ ...config, workspaceSnapshot: undefined })
  logDebug('sessions.catalog.migrateLegacyWorkspace', {
    migratedSessionId: migrated.id,
    tabCount: migrated.workspaceSnapshot?.tabs.length ?? 0,
  })
  return [migrated]
}

export function saveSessionCatalog(sessions: SessionRecord[]): void {
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    writeFileSync(SESSIONS_PATH, `${JSON.stringify({ sessions, version: 1 }, null, 2)}\n`)
    logDebug('sessions.catalog.save', { sessionCount: sessions.length })
  } catch (error) {
    logDebug('sessions.catalog.saveError', {
      error: error instanceof Error ? error.message : String(error),
      path: SESSIONS_PATH,
      sessionCount: sessions.length,
    })
  }
}

export function getSessionCatalogPath(): string {
  return SESSIONS_PATH
}

/**
 * Assign a stable `order` to every session. Records with an existing numeric
 * `order` keep their slot (sorted ascending); the rest are appended by
 * createdAt ascending so older sessions come first.
 */
function normalizeOrder(sessions: SessionRecord[]): SessionRecord[] {
  const withOrder: SessionRecord[] = []
  const withoutOrder: SessionRecord[] = []
  for (const s of sessions) {
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
