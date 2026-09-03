// Patch `~/.claude/settings.json` so Claude Code invokes aimux's hook bridge
// for the lifecycle events that drive per-tab activity detection. Idempotent:
// existing aimux entries (marked via `__aimux: true`) are replaced; unrelated
// hooks the user has configured are preserved.
//
// Hooks reference: https://code.claude.com/docs/en/hooks.md

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logDebug } from '../../debug/input-log'
import { claudeHome } from '../../platform/assistant-home'

const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'Notification',
] as const

type HookEvent = (typeof HOOK_EVENTS)[number]

interface HookCommandEntry {
  type: 'command'
  command: string
  __aimux?: true
}

interface HookGroupEntry {
  matcher?: string
  hooks: HookCommandEntry[]
}

function settingsFilePath(): string {
  return join(claudeHome(), 'settings.json')
}

function writeAtomic(target: string, contents: string): void {
  const tmp = `${target}.aimux.tmp`
  writeFileSync(tmp, contents, 'utf8')
  try {
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw error
  }
}

function logSyncWarn(reason: string, details?: Record<string, unknown>): void {
  logDebug('claude-hooks-install:warn', { reason, ...details })
}

/**
 * Absolute path to the shipped hook script. Resolved from this module's URL so
 * it works from the install directory regardless of how aimux was launched.
 * Walks up from `src/integrations` / built equivalent until it finds the
 * `assets/claude-hooks` directory.
 */
export function resolveHookScriptPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..', 'assets', 'claude-hooks', 'aimux-agent-state.sh'),
    resolve(here, '..', '..', '..', 'assets', 'claude-hooks', 'aimux-agent-state.sh'),
    resolve(here, '..', 'assets', 'claude-hooks', 'aimux-agent-state.sh'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  logSyncWarn('hook-script-not-found', { candidates })
  return null
}

function isHookCommandEntry(value: unknown): value is HookCommandEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'command' &&
    typeof (value as { command?: unknown }).command === 'string'
  )
}

function isHookGroupEntry(value: unknown): value is HookGroupEntry {
  if (typeof value !== 'object' || value === null) return false
  const hooks = (value as { hooks?: unknown }).hooks
  return Array.isArray(hooks)
}

function isAimuxEntry(entry: HookGroupEntry): boolean {
  return entry.hooks.some((hook) => {
    if (!isHookCommandEntry(hook)) return false
    if (hook.__aimux === true) return true
    return hook.command.includes('aimux-agent-state')
  })
}

function buildAimuxEntry(event: HookEvent, scriptPath: string): HookGroupEntry {
  // PreToolUse / PostToolUse expect a tool matcher. `*` matches every tool.
  // The other events ignore `matcher` entirely.
  const needsMatcher = event === 'PreToolUse' || event === 'PostToolUse'
  return {
    ...(needsMatcher ? { matcher: '*' } : {}),
    hooks: [{ __aimux: true, command: scriptPath, type: 'command' }],
  }
}

/**
 * Idempotently install aimux hook entries into `~/.claude/settings.json`.
 * Returns true when settings were written (or already correct), false on a
 * hard failure that should be logged. Errors never throw — a failed install
 * just means activity detection falls back to the visual detector.
 */
export function ensureClaudeSettingsHooks(): boolean {
  const scriptPath = resolveHookScriptPath()
  if (scriptPath === null || scriptPath === '') return false

  const target = settingsFilePath()

  let parsed: Record<string, unknown> = {}
  if (existsSync(target)) {
    let raw: string
    try {
      raw = readFileSync(target, 'utf8')
    } catch (error) {
      logSyncWarn('settings-read-failed', { err: String(error), path: target })
      return false
    }
    if (raw.trim().length > 0) {
      try {
        const json = JSON.parse(raw) as unknown
        if (typeof json !== 'object' || json === null || Array.isArray(json)) {
          logSyncWarn('settings-not-object', { path: target })
          return false
        }
        parsed = json as Record<string, unknown>
      } catch (error) {
        logSyncWarn('settings-parse-failed', { err: String(error), path: target })
        return false
      }
    }
  }

  const existingHooks = (
    typeof parsed.hooks === 'object' && parsed.hooks !== null && !Array.isArray(parsed.hooks)
      ? parsed.hooks
      : {}
  ) as Record<string, unknown>

  const nextHooks: Record<string, HookGroupEntry[]> = {}
  let changed = false

  for (const event of HOOK_EVENTS) {
    const raw = existingHooks[event]
    const arr: HookGroupEntry[] = Array.isArray(raw) ? raw.filter(isHookGroupEntry) : []
    const filtered = arr.filter((entry) => !isAimuxEntry(entry))
    const desired = buildAimuxEntry(event, scriptPath)
    const next = [...filtered, desired]
    nextHooks[event] = next
    if (!arraysShallowEqual(arr, next)) changed = true
  }

  // Preserve any non-aimux hook events the user already had.
  for (const [event, value] of Object.entries(existingHooks)) {
    if (HOOK_EVENTS.includes(event as HookEvent)) continue
    if (Array.isArray(value)) nextHooks[event] = value as HookGroupEntry[]
  }

  if (!changed && parsed.hooks !== undefined) return true

  parsed.hooks = nextHooks

  try {
    mkdirSync(claudeHome(), { recursive: true })
    writeAtomic(target, `${JSON.stringify(parsed, null, 2)}\n`)
    logDebug('claude-hooks-install:wrote', { events: HOOK_EVENTS, path: target, scriptPath })
    return true
  } catch (error) {
    logSyncWarn('settings-write-failed', { err: String(error), path: target })
    return false
  }
}

function arraysShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
  }
  return true
}
