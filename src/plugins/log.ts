import type { PluginLogger } from '@brimveyn/aimux-plugin'

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import { logDebug } from '../debug/input-log'
import { getPluginLogPath } from './paths'

/**
 * Every plugin gets its own log file. A plugin that misbehaves at 3am has to
 * leave a trail somewhere the user can find without a debug build, and mixing
 * plugin output into aimux's own debug log would make both unreadable.
 *
 * Writes are synchronous appends. A plugin log is low-volume by construction
 * and ordering matters more than throughput — an async writer that reorders
 * "starting" after "failed" costs more than the syscall saves.
 */

const MAX_LOG_BYTES = 1_000_000

export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface PluginLogLine {
  at: string
  level: PluginLogLevel
  host: string
  message: string
  data?: Record<string, unknown>
}

function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size < MAX_LOG_BYTES) return
    renameSync(path, `${path}.1`)
  } catch {
    // No file yet, or a rotation race with the other host process. Either way
    // the append below still works.
  }
}

export function appendPluginLog(pluginId: string, line: PluginLogLine): void {
  const path = getPluginLogPath(pluginId)
  try {
    mkdirSync(dirname(path), { recursive: true })
    rotateIfLarge(path)
    appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8')
  } catch (error) {
    logDebug('plugin.log.writeFailed', {
      error: error instanceof Error ? error.message : String(error),
      pluginId,
    })
  }
}

/**
 * The logger handed to a plugin as `ctx.log`. Mirrors into aimux's debug log
 * so a plugin's version of events lines up with the host's on one timeline.
 */
export function createPluginLogger(pluginId: string, host: string): PluginLogger {
  const write =
    (level: PluginLogLevel) =>
    (message: string, data?: Record<string, unknown>): void => {
      appendPluginLog(pluginId, {
        at: new Date().toISOString(),
        ...(data === undefined ? {} : { data }),
        host,
        level,
        message,
      })
      logDebug(`plugin.${pluginId}.${level}`, { host, message, ...data })
    }

  return { debug: write('debug'), error: write('error'), info: write('info'), warn: write('warn') }
}

export interface ReadPluginLogOptions {
  /** Tail size. The whole file is read; plugin logs are capped at 1 MB. */
  lines?: number
  level?: PluginLogLevel
}

/**
 * Reads a plugin's log back for `aimux plugin log`. Unparseable lines are
 * surfaced rather than dropped: a truncated write is a symptom worth seeing.
 */
export function readPluginLog(
  pluginId: string,
  options: ReadPluginLogOptions = {}
): PluginLogLine[] {
  const path = getPluginLogPath(pluginId)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }

  const parsed: PluginLogLine[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      parsed.push(JSON.parse(line) as PluginLogLine)
    } catch {
      parsed.push({
        at: '',
        host: '?',
        level: 'warn',
        message: `unparseable log line: ${line.slice(0, 200)}`,
      })
    }
  }

  const filtered = options.level ? parsed.filter((entry) => entry.level === options.level) : parsed
  return options.lines === undefined ? filtered : filtered.slice(-options.lines)
}
