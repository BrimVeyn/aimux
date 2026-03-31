import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SessionRecord } from './types'

import { CONFIG_PATH, loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'

interface SessionCatalogFile {
  version: 1
  sessions: SessionRecord[]
}

const SESSIONS_PATH = join(dirname(CONFIG_PATH), 'aimux-sessions.json')

function readCatalogFile(): SessionCatalogFile | null {
  try {
    if (!existsSync(SESSIONS_PATH)) {
      return null
    }

    const parsed = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8')) as SessionCatalogFile
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function loadSessionCatalog(): SessionRecord[] {
  const file = readCatalogFile()
  if (file) {
    logDebug('sessions.catalog.load', { sessionCount: file.sessions.length })
    return file.sessions
  }

  const config = loadConfig()
  if (!config.workspaceSnapshot) {
    logDebug('sessions.catalog.load', { sessionCount: 0 })
    return []
  }

  const now = new Date().toISOString()
  const migrated: SessionRecord = {
    id: `session-${Date.now()}`,
    name: 'Last workspace',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
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
  mkdirSync(dirname(SESSIONS_PATH), { recursive: true })
  writeFileSync(SESSIONS_PATH, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`)
  logDebug('sessions.catalog.save', { sessionCount: sessions.length })
}

export function getSessionCatalogPath(): string {
  return SESSIONS_PATH
}
