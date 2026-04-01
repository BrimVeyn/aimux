import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { WorkspaceSnapshotV1 } from './state/types'
import type { ThemeId } from './ui/themes'

import { logDebug } from './debug/input-log'
import { isWorkspaceSnapshotV1 } from './state/validation'
import { THEME_IDS } from './ui/themes'

export const CONFIG_PATH = join(process.env.HOME ?? '~', '.config', 'aimux.json')

export interface AimuxConfig {
  version: 2
  customCommands: Record<string, string>
  themeId?: ThemeId
  workspaceSnapshot?: WorkspaceSnapshotV1
}

const DEFAULT_CONFIG: AimuxConfig = {
  version: 2,
  customCommands: {},
}

export interface ConfigLoadResult {
  config: AimuxConfig
  source: 'defaults' | 'file'
  issues: string[]
}

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId)
}

function isCustomCommandsRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Object.entries(value).every(
    ([key, entryValue]) =>
      typeof key === 'string' && key.length > 0 && typeof entryValue === 'string'
  )
}

export function loadConfigResult(): ConfigLoadResult {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return { config: DEFAULT_CONFIG, source: 'defaults', issues: [] }
    }

    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as {
      version?: number
      customCommands?: unknown
      themeId?: unknown
      workspaceSnapshot?: unknown
    }

    const issues: string[] = []

    if (parsed.version !== undefined && parsed.version !== 2) {
      issues.push(`unsupported config version ${String(parsed.version)}`)
    }

    if (parsed.customCommands !== undefined && !isCustomCommandsRecord(parsed.customCommands)) {
      issues.push('ignored invalid customCommands')
    }

    if (parsed.themeId !== undefined && !isThemeId(parsed.themeId)) {
      issues.push('ignored invalid themeId')
    }

    if (
      parsed.workspaceSnapshot !== undefined &&
      !isWorkspaceSnapshotV1(parsed.workspaceSnapshot)
    ) {
      issues.push('ignored invalid workspaceSnapshot')
    }

    if (issues.length > 0) {
      logDebug('config.load.validationIssue', { path: CONFIG_PATH, issues })
    }

    return {
      config: {
        version: 2,
        customCommands: isCustomCommandsRecord(parsed.customCommands) ? parsed.customCommands : {},
        themeId: isThemeId(parsed.themeId) ? parsed.themeId : undefined,
        workspaceSnapshot: isWorkspaceSnapshotV1(parsed.workspaceSnapshot)
          ? parsed.workspaceSnapshot
          : undefined,
      },
      source: 'file',
      issues,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('config.load.error', { path: CONFIG_PATH, error: message })
    return {
      config: DEFAULT_CONFIG,
      source: 'defaults',
      issues: [`failed to load config: ${message}`],
    }
  }
}

export function loadConfig(): AimuxConfig {
  return loadConfigResult().config
}

export function saveConfig(config: AimuxConfig): boolean {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
    return true
  } catch (error) {
    logDebug('config.save.error', {
      path: CONFIG_PATH,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
