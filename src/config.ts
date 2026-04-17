import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { WorkspaceSnapshotV1 } from './state/types'

import { logDebug } from './debug/input-log'
import { getProfileConfigDir } from './profile-paths'
import { isWorkspaceSnapshotV1 } from './state/validation'
import { THEME_IDS, type ThemeId } from './ui/themes'

export const CONFIG_PATH = `${getProfileConfigDir()}/aimux.json`

export interface AimuxConfig {
  version: 2
  customCommands: Record<string, string>
  themeId?: ThemeId
  gitPanelVisible?: boolean
  gitPanelRatio?: number
  workspaceSnapshot?: WorkspaceSnapshotV1
  skippedUpdateVersion?: string
}

const DEFAULT_CONFIG: AimuxConfig = {
  customCommands: {},
  version: 2,
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
      return { config: DEFAULT_CONFIG, issues: [], source: 'defaults' }
    }

    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as {
      version?: number
      customCommands?: unknown
      themeId?: unknown
      gitPanelVisible?: unknown
      gitPanelRatio?: unknown
      workspaceSnapshot?: unknown
      skippedUpdateVersion?: unknown
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

    const validGitPanelVisible =
      typeof parsed.gitPanelVisible === 'boolean' ? parsed.gitPanelVisible : undefined
    if (parsed.gitPanelVisible !== undefined && validGitPanelVisible === undefined) {
      issues.push('ignored invalid gitPanelVisible')
    }

    const validGitPanelRatio =
      typeof parsed.gitPanelRatio === 'number' &&
      Number.isFinite(parsed.gitPanelRatio) &&
      parsed.gitPanelRatio > 0 &&
      parsed.gitPanelRatio < 1
        ? parsed.gitPanelRatio
        : undefined
    if (parsed.gitPanelRatio !== undefined && validGitPanelRatio === undefined) {
      issues.push('ignored invalid gitPanelRatio')
    }

    if (
      parsed.workspaceSnapshot !== undefined &&
      !isWorkspaceSnapshotV1(parsed.workspaceSnapshot)
    ) {
      issues.push('ignored invalid workspaceSnapshot')
    }

    const validSkippedUpdateVersion =
      typeof parsed.skippedUpdateVersion === 'string' && parsed.skippedUpdateVersion.length > 0
        ? parsed.skippedUpdateVersion
        : undefined
    if (parsed.skippedUpdateVersion !== undefined && validSkippedUpdateVersion === undefined) {
      issues.push('ignored invalid skippedUpdateVersion')
    }

    if (issues.length > 0) {
      logDebug('config.load.validationIssue', { issues, path: CONFIG_PATH })
    }

    return {
      config: {
        customCommands: isCustomCommandsRecord(parsed.customCommands) ? parsed.customCommands : {},
        gitPanelRatio: validGitPanelRatio,
        gitPanelVisible: validGitPanelVisible,
        skippedUpdateVersion: validSkippedUpdateVersion,
        themeId: isThemeId(parsed.themeId) ? parsed.themeId : undefined,
        version: 2,
        workspaceSnapshot: isWorkspaceSnapshotV1(parsed.workspaceSnapshot)
          ? parsed.workspaceSnapshot
          : undefined,
      },
      issues,
      source: 'file',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('config.load.error', { error: message, path: CONFIG_PATH })
    return {
      config: DEFAULT_CONFIG,
      issues: [`failed to load config: ${message}`],
      source: 'defaults',
    }
  }
}

export function loadConfig(): AimuxConfig {
  return loadConfigResult().config
}

export function saveConfig(config: AimuxConfig): boolean {
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
    return true
  } catch (error) {
    logDebug('config.save.error', {
      error: error instanceof Error ? error.message : String(error),
      path: CONFIG_PATH,
    })
    return false
  }
}
