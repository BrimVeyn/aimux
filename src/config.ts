import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { SplitDirection } from './state/layout-tree'
import type { GitFileListMode, WorkspaceSnapshotV1 } from './state/types'

import { logDebug } from './debug/input-log'
import { getProfileConfigDir } from './profile-paths'
import { isWorkspaceSnapshotV1 } from './state/validation'
import { migrateThemeId as resolveLegacyThemeId, type ThemeId, type ThemeMode } from './ui/themes'

function migrateThemeId(value: unknown): ThemeId | undefined {
  if (typeof value !== 'string') return undefined
  return resolveLegacyThemeId(value)
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
  paneRatio?: number
  embeddedRatio?: number
  ratio?: number
}

export interface PersistedSidebar {
  visible: boolean
  width: number
}

export interface WorktreeTemplatePane {
  id: string
  assistant: string
  splitFrom?: string
  direction?: SplitDirection
  ratio?: number
  send?: string
}

export interface WorktreeTemplateTab {
  panes: WorktreeTemplatePane[]
}

export interface WorktreeTemplate {
  id: string
  name: string
  description?: string
  tabs: WorktreeTemplateTab[]
}

export interface AimuxConfig {
  version: 2
  customCommands: Record<string, string>
  themeId?: ThemeId
  themeTransparent?: boolean
  themeMode?: ThemeMode
  gitPane?: PersistedGitPane
  sidebar?: PersistedSidebar
  sessionBarVisible?: boolean
  workspaceSnapshot?: WorkspaceSnapshotV1
  skippedUpdateVersion?: string
  worktreeTemplates?: WorktreeTemplate[]
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
    v.ratio === undefined ||
    (typeof v.ratio === 'number' && Number.isFinite(v.ratio) && v.ratio > 0 && v.ratio < 1)
  const paneRatioOk =
    v.paneRatio === undefined ||
    (typeof v.paneRatio === 'number' &&
      Number.isFinite(v.paneRatio) &&
      v.paneRatio > 0 &&
      v.paneRatio < 1)
  const embeddedRatioOk =
    v.embeddedRatio === undefined ||
    (typeof v.embeddedRatio === 'number' &&
      Number.isFinite(v.embeddedRatio) &&
      v.embeddedRatio > 0 &&
      v.embeddedRatio < 1)
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
    !paneRatioOk ||
    !embeddedRatioOk ||
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

function isRatioValid(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0.15 && value < 0.85
}

function isWorktreeTemplateTab(value: unknown): value is WorktreeTemplateTab {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.panes) || v.panes.length === 0) return false
  const seenIds = new Set<string>()
  for (let i = 0; i < v.panes.length; i++) {
    const rawPane = v.panes[i]
    if (typeof rawPane !== 'object' || rawPane === null) return false
    const pane = rawPane as Record<string, unknown>
    if (typeof pane.id !== 'string' || pane.id.length === 0) return false
    if (seenIds.has(pane.id)) return false
    seenIds.add(pane.id)
    if (typeof pane.assistant !== 'string' || pane.assistant.length === 0) return false
    if (i === 0) {
      if (pane.splitFrom !== undefined) return false
      if (pane.direction !== undefined) return false
    } else {
      if (typeof pane.splitFrom !== 'string' || !seenIds.has(pane.splitFrom)) return false
      if (pane.splitFrom === pane.id) return false
      if (pane.direction !== 'horizontal' && pane.direction !== 'vertical') return false
    }
    if (pane.ratio !== undefined && !isRatioValid(pane.ratio)) return false
    if (pane.send !== undefined && typeof pane.send !== 'string') return false
  }
  return true
}

export function isWorktreeTemplate(value: unknown): value is WorktreeTemplate {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0) return false
  if (typeof v.name !== 'string' || v.name.length === 0) return false
  if (v.description !== undefined && typeof v.description !== 'string') return false
  if (!Array.isArray(v.tabs) || v.tabs.length === 0) return false
  for (const tab of v.tabs) {
    if (!isWorktreeTemplateTab(tab)) return false
  }
  return true
}

function parseWorktreeTemplates(value: unknown, issues: string[]): WorktreeTemplate[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push('ignored invalid worktreeTemplates (not an array)')
    return undefined
  }
  const seen = new Set<string>()
  const valid: WorktreeTemplate[] = []
  for (const entry of value) {
    if (!isWorktreeTemplate(entry)) {
      issues.push('ignored invalid worktreeTemplate entry')
      continue
    }
    if (seen.has(entry.id)) {
      issues.push(`ignored duplicate worktreeTemplate id "${entry.id}"`)
      continue
    }
    seen.add(entry.id)
    valid.push(entry)
  }
  return valid.length > 0 ? valid : undefined
}

function isPersistedSidebar(value: unknown): value is PersistedSidebar {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.visible === 'boolean' &&
    typeof v.width === 'number' &&
    Number.isFinite(v.width) &&
    v.width > 0
  )
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
      themeMode?: unknown
      gitPane?: unknown
      sidebar?: unknown
      gitPanelVisible?: unknown
      gitPanelRatio?: unknown
      sessionBarVisible?: unknown
      workspaceSnapshot?: unknown
      skippedUpdateVersion?: unknown
      worktreeTemplates?: unknown
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

    const validThemeMode: ThemeMode | undefined =
      parsed.themeMode === 'dark' || parsed.themeMode === 'light' ? parsed.themeMode : undefined
    if (parsed.themeMode !== undefined && validThemeMode === undefined) {
      issues.push('ignored invalid themeMode')
    }

    let validGitPane = isPersistedGitPane(parsed.gitPane) ? parsed.gitPane : undefined
    if (parsed.gitPane !== undefined && validGitPane === undefined) {
      issues.push('ignored invalid gitPane')
    }

    const validSidebar = isPersistedSidebar(parsed.sidebar) ? parsed.sidebar : undefined
    if (parsed.sidebar !== undefined && validSidebar === undefined) {
      issues.push('ignored invalid sidebar')
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
          embeddedRatio: legacyRatio ?? 0.5,
          mode: 'embedded',
          paneRatio: legacyRatio ?? 0.5,
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

    const validWorktreeTemplates = parseWorktreeTemplates(parsed.worktreeTemplates, issues)

    if (issues.length > 0) {
      logDebug('config.load.validationIssue', { issues, path: CONFIG_PATH })
    }

    return {
      config: {
        customCommands: isCustomCommandsRecord(parsed.customCommands) ? parsed.customCommands : {},
        gitPane: validGitPane,
        sessionBarVisible: validSessionBarVisible,
        sidebar: validSidebar,
        skippedUpdateVersion: validSkippedUpdateVersion,
        themeId: migrateThemeId(parsed.themeId),
        themeMode: validThemeMode,
        themeTransparent: validThemeTransparent,
        version: 2,
        workspaceSnapshot: isWorkspaceSnapshotV1(parsed.workspaceSnapshot)
          ? parsed.workspaceSnapshot
          : undefined,
        worktreeTemplates: validWorktreeTemplates,
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
