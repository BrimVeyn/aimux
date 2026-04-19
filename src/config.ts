import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { GitFileListMode, SessionBarPosition, WorkspaceSnapshotV1 } from './state/types'

import { logDebug } from './debug/input-log'
import { getProfileConfigDir } from './profile-paths'
import { isWorkspaceSnapshotV1 } from './state/validation'
import { THEME_IDS, type ThemeId } from './ui/themes'

const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  'everforest': 'everforest-dark',
  'gruvbox-dark': 'gruvbox-dark-hard',
  'kanagawa': 'kanagawa-wave',
  'one-dark': 'one-dark-pro',
}

function migrateThemeId(value: unknown): ThemeId | undefined {
  if (typeof value !== 'string') return undefined
  if (THEME_IDS.includes(value as ThemeId)) return value as ThemeId
  return LEGACY_THEME_ALIASES[value]
}

export const CONFIG_PATH = `${getProfileConfigDir()}/aimux.json`

export interface PersistedGitPane {
  diffModeRatio?: number
  fileListMode?: GitFileListMode
  treeCompaction?: boolean
  prefetchRadius?: number
  visible: boolean
  mode: 'embedded' | 'pane'
  position: 'top' | 'bottom' | 'left' | 'right'
  ratio: number
}

export interface AimuxConfig {
  version: 2
  customCommands: Record<string, string>
  themeId?: ThemeId
  themeTransparent?: boolean
  gitPane?: PersistedGitPane
  sessionBarVisible?: boolean
  sessionBarPosition?: SessionBarPosition
  workspaceSnapshot?: WorkspaceSnapshotV1
  skippedUpdateVersion?: string
}

function isPersistedGitPane(value: unknown): value is PersistedGitPane {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const modeOk = v.mode === 'embedded' || v.mode === 'pane'
  const positionOk =
    v.position === 'top' ||
    v.position === 'bottom' ||
    v.position === 'left' ||
    v.position === 'right'
  const ratioOk =
    typeof v.ratio === 'number' && Number.isFinite(v.ratio) && v.ratio > 0 && v.ratio < 1
  const diffModeRatioOk =
    v.diffModeRatio === undefined ||
    (typeof v.diffModeRatio === 'number' &&
      Number.isFinite(v.diffModeRatio) &&
      v.diffModeRatio > 0 &&
      v.diffModeRatio < 1)
  const visibleOk = typeof v.visible === 'boolean'
  const fileListModeOk =
    v.fileListMode === undefined || v.fileListMode === 'tree' || v.fileListMode === 'flat'
  const treeCompactionOk = v.treeCompaction === undefined || typeof v.treeCompaction === 'boolean'
  const prefetchRadiusOk =
    v.prefetchRadius === undefined ||
    (typeof v.prefetchRadius === 'number' &&
      Number.isFinite(v.prefetchRadius) &&
      v.prefetchRadius >= 0 &&
      v.prefetchRadius <= 50)
  if (
    !modeOk ||
    !positionOk ||
    !ratioOk ||
    !diffModeRatioOk ||
    !visibleOk ||
    !fileListModeOk ||
    !treeCompactionOk ||
    !prefetchRadiusOk
  ) {
    return false
  }
  // cross-field coherence: embedded => top|bottom; pane => left|right
  if (v.mode === 'embedded' && v.position !== 'top' && v.position !== 'bottom') return false
  if (v.mode === 'pane' && v.position !== 'left' && v.position !== 'right') return false
  return true
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
  return migrateThemeId(value) !== undefined
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
      themeTransparent?: unknown
      gitPane?: unknown
      gitPanelVisible?: unknown
      gitPanelRatio?: unknown
      sessionBarVisible?: unknown
      sessionBarPosition?: unknown
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

    const validThemeTransparent =
      typeof parsed.themeTransparent === 'boolean' ? parsed.themeTransparent : undefined
    if (parsed.themeTransparent !== undefined && validThemeTransparent === undefined) {
      issues.push('ignored invalid themeTransparent')
    }

    let validGitPane = isPersistedGitPane(parsed.gitPane) ? parsed.gitPane : undefined
    if (parsed.gitPane !== undefined && validGitPane === undefined) {
      issues.push('ignored invalid gitPane')
    }

    // Legacy migration: previous schema stored gitPanelVisible/gitPanelRatio at
    // top level. If the new `gitPane` field is absent, synthesize it from legacy
    // keys so users don't lose their toggle/ratio on upgrade.
    if (validGitPane === undefined) {
      const legacyVisible =
        typeof parsed.gitPanelVisible === 'boolean' ? parsed.gitPanelVisible : undefined
      const legacyRatio =
        typeof parsed.gitPanelRatio === 'number' &&
        Number.isFinite(parsed.gitPanelRatio) &&
        parsed.gitPanelRatio > 0 &&
        parsed.gitPanelRatio < 1
          ? parsed.gitPanelRatio
          : undefined
      if (legacyVisible !== undefined || legacyRatio !== undefined) {
        validGitPane = {
          mode: 'embedded',
          position: 'bottom',
          ratio: legacyRatio ?? 0.5,
          visible: legacyVisible ?? true,
        }
      }
    }

    const validSessionBarVisible =
      typeof parsed.sessionBarVisible === 'boolean' ? parsed.sessionBarVisible : undefined
    if (parsed.sessionBarVisible !== undefined && validSessionBarVisible === undefined) {
      issues.push('ignored invalid sessionBarVisible')
    }

    const validSessionBarPosition =
      parsed.sessionBarPosition === 'top' || parsed.sessionBarPosition === 'bottom'
        ? parsed.sessionBarPosition
        : undefined
    if (parsed.sessionBarPosition !== undefined && validSessionBarPosition === undefined) {
      issues.push('ignored invalid sessionBarPosition')
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
        gitPane: validGitPane,
        sessionBarPosition: validSessionBarPosition,
        sessionBarVisible: validSessionBarVisible,
        skippedUpdateVersion: validSkippedUpdateVersion,
        themeId: migrateThemeId(parsed.themeId),
        themeTransparent: validThemeTransparent,
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
