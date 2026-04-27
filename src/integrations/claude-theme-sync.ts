// Beta — bridge the active aimux theme into Claude Code by writing a
// custom theme JSON to ~/.claude/themes/aimux.json and selecting it via
// `theme: "custom:aimux"` in ~/.claude/settings.json. Claude Code watches
// the themes dir, so writes propagate live without restarting the CLI.
//
// Spec: https://code.claude.com/docs/en/terminal-config#create-a-custom-theme

import {
  type ClaudeThemeFile,
  resolveClaudeTheme,
  type ResolvedTuiTheme,
  type ThemeMode,
} from '@brimveyn/aimux-config'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { logDebug } from '../debug/input-log'

const THEME_SLUG = 'aimux'
const THEME_PREF_VALUE = `custom:${THEME_SLUG}`

function claudeDir(): string {
  return join(homedir(), '.claude')
}

function themeFilePath(): string {
  return join(claudeDir(), 'themes', `${THEME_SLUG}.json`)
}

function settingsFilePath(): string {
  return join(claudeDir(), 'settings.json')
}

function writeAtomic(target: string, contents: string): void {
  const tmp = `${target}.aimux.tmp`
  writeFileSync(tmp, contents, 'utf8')
  try {
    renameSync(tmp, target)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

function logSyncWarn(reason: string, details?: Record<string, unknown>): void {
  logDebug('claude-theme-sync:warn', { reason, ...details })
}

/**
 * Write `~/.claude/themes/aimux.json` from the active aimux theme.
 * Idempotent — overwriting the same content is a no-op for Claude's watcher.
 * Errors are swallowed (logged) so a failed sync never crashes aimux.
 */
export function syncClaudeTheme(resolved: ResolvedTuiTheme, mode: ThemeMode): void {
  let theme: ClaudeThemeFile
  try {
    theme = resolveClaudeTheme(resolved, mode)
  } catch (err) {
    logSyncWarn('resolve-failed', { err: String(err) })
    return
  }

  const target = themeFilePath()
  try {
    mkdirSync(join(claudeDir(), 'themes'), { recursive: true })
    writeAtomic(target, `${JSON.stringify(theme, null, 2)}\n`)
  } catch (err) {
    logSyncWarn('write-failed', { err: String(err), path: target })
  }
}

/**
 * Patch `~/.claude/settings.json` once so Claude picks up the synced theme.
 * Preserves all other fields. No-op if the preference already matches.
 */
export function ensureClaudeSettingsThemePref(): void {
  const target = settingsFilePath()

  let parsed: Record<string, unknown> = {}
  if (existsSync(target)) {
    let raw: string
    try {
      raw = readFileSync(target, 'utf8')
    } catch (err) {
      logSyncWarn('settings-read-failed', { err: String(err), path: target })
      return
    }
    if (raw.trim().length > 0) {
      try {
        const json = JSON.parse(raw) as unknown
        if (typeof json !== 'object' || json === null || Array.isArray(json)) {
          logSyncWarn('settings-not-object', { path: target })
          return
        }
        parsed = json as Record<string, unknown>
      } catch (err) {
        logSyncWarn('settings-parse-failed', { err: String(err), path: target })
        return
      }
    }
  }

  if (parsed.theme === THEME_PREF_VALUE) return

  parsed.theme = THEME_PREF_VALUE

  try {
    mkdirSync(claudeDir(), { recursive: true })
    writeAtomic(target, `${JSON.stringify(parsed, null, 2)}\n`)
  } catch (err) {
    logSyncWarn('settings-write-failed', { err: String(err), path: target })
  }
}
