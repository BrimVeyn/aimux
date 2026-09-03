import { watch } from 'node:fs'
import { sep } from 'node:path'

import type { PluginRecord } from './types'

import { logDebug } from '../debug/input-log'

/**
 * Watches linked plugins for edits and reloads them. This is the whole point
 * of the reversible-registration rule: because a fiber's disposal is total,
 * "the file changed" can safely mean "unload and re-apply" with nothing to
 * reconcile by hand.
 *
 * Installed plugins are not watched — nobody edits a managed checkout in
 * place, and a recursive watcher per plugin is not free.
 */

const DEBOUNCE_MS = 150

/** Editors write more than the file you touched; none of this is plugin source. */
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', '.hot', 'dist', 'build'])

export function isWatchDisabled(): boolean {
  return process.env.AIMUX_PLUGIN_WATCH === '0'
}

function isIgnored(filename: string): boolean {
  if (filename === '') return true
  for (const segment of filename.split(sep)) {
    if (IGNORED_SEGMENTS.has(segment)) return true
  }
  // Editor scratch files: vim's `4913`, `.swp`, emacs `#file#`, atomic-save tmp.
  const base = filename.split(sep).at(-1) ?? ''
  return base.startsWith('.') || base.startsWith('#') || base.endsWith('~') || base.endsWith('.tmp')
}

export interface WatchPluginsOptions {
  records: readonly PluginRecord[]
  /** Called once per debounce window, with the ids whose files changed. */
  onChange: (pluginIds: string[]) => void
}

/**
 * Starts one recursive watcher per watchable plugin and coalesces every event
 * into a single `onChange` per window. A save in an editor produces a burst;
 * reloading a plugin five times for one keystroke is worse than not reloading.
 */
export function watchPlugins(options: WatchPluginsOptions): () => void {
  if (isWatchDisabled()) {
    logDebug('plugin.watch.disabled', {})
    return () => {
      /* nothing started */
    }
  }

  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const closers: (() => void)[] = []

  const flush = (): void => {
    timer = null
    if (pending.size === 0) return
    const ids = [...pending]
    pending.clear()
    logDebug('plugin.watch.change', { pluginIds: ids })
    options.onChange(ids)
  }

  for (const record of options.records) {
    if (record.source === 'install') continue
    try {
      const watcher = watch(record.root, { recursive: true }, (_event, filename) => {
        if (typeof filename === 'string' && isIgnored(filename)) return
        pending.add(record.id)
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(flush, DEBOUNCE_MS)
      })
      watcher.on('error', (error) => {
        logDebug('plugin.watch.error', { error: error.message, pluginId: record.id })
      })
      closers.push(() => {
        watcher.close()
      })
    } catch (error) {
      // A watcher is a convenience. Failing to start one (descriptor limits,
      // an unsupported filesystem) must not stop the plugin from loading.
      logDebug('plugin.watch.startFailed', {
        error: error instanceof Error ? error.message : String(error),
        pluginId: record.id,
        root: record.root,
      })
    }
  }

  return () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    for (const close of closers) close()
    closers.length = 0
  }
}
