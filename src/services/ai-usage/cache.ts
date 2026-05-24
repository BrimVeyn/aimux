import type { AIUsageTool } from '@brimveyn/aimux-config'

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { UsageSnapshot } from './types'

const CACHE_DIR = join(homedir(), '.cache', 'aimux')
const CACHE_PATH = join(CACHE_DIR, 'ai-usage.json')

interface CacheEntry {
  fetchedAt: number
  snapshot: UsageSnapshot
}

type CacheFile = Partial<Record<AIUsageTool, CacheEntry>>

function readCacheFile(): CacheFile {
  try {
    if (!existsSync(CACHE_PATH)) return {}
    const raw = readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as CacheFile
  } catch {
    return {}
  }
}

export interface CachedSnapshot {
  snapshot: UsageSnapshot
  ageMs: number
}

export function loadCachedSnapshot(tool: AIUsageTool, maxAgeMs: number): CachedSnapshot | null {
  const cache = readCacheFile()
  const entry = cache[tool]
  if (!entry) return null
  if (typeof entry.fetchedAt !== 'number') return null
  const ageMs = Date.now() - entry.fetchedAt
  if (ageMs > maxAgeMs) return null
  if (entry.snapshot.tool !== tool) return null
  return { ageMs, snapshot: entry.snapshot }
}

export function saveCachedSnapshot(snapshot: UsageSnapshot): void {
  if (snapshot.error != null && snapshot.error !== '') return
  if (snapshot.percent === null) return
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    const cache = readCacheFile()
    cache[snapshot.tool] = { fetchedAt: Date.now(), snapshot }
    const tmpPath = `${CACHE_PATH}.${process.pid}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(cache, null, 2)}\n`)
    renameSync(tmpPath, CACHE_PATH)
  } catch {
    // swallow — cache is best-effort
  }
}
