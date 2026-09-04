import type { SettingRow, SettingSection } from '../types'

import { pluginError, pluginStateSummary, pluginStore } from '../../plugins/plugin-store'
import { setPluginEnabled } from '../../plugins/registry-file'
import { refreshPluginsGlobal } from '../../ui/plugin-refresh-ref'
import { pluginConfigRows, pluginKeymapRows } from '../plugin-config-rows'
import { isExpanded, toggleDrawer } from '../plugin-drawers'

/**
 * Every plugin aimux knows, with a switch.
 *
 * A section rather than a screen of its own. A screen would cost arms on
 * `FocusMode`, `BuiltinModeId`, the transition table, a mode handler, help
 * headings, two actions, a side effect, a reducer and a keybinding — for a
 * list of things with a toggle and a value, which is this screen's exact job.
 * It also means a plugin's switch and its configuration sit in one place
 * instead of two, which is the point of the feature.
 */

let pluginUserConfigRef: readonly {
  id?: string
  config?: Record<string, unknown>
  keymaps?: Record<string, string | null>
}[] = []

export function setPluginUserConfig(entries: typeof pluginUserConfigRef): void {
  pluginUserConfigRef = entries
}

function describe(id: string, source: string, version: string): string {
  const state = pluginStateSummary(id)
  const error = pluginError(id)
  const head = `${state} · ${source} · ${version}`
  // The error's first line only: the row has one line, and the rest is in
  // `aimux plugin show`.
  return error === undefined ? head : `${head} — ${error.split('\n')[0] ?? ''}`
}

function rowsFor(): SettingRow[] {
  const rows: SettingRow[] = []
  for (const record of pluginStore.getState().records) {
    const name = record.manifest.name ?? record.id
    rows.push({
      description: describe(record.id, record.source, record.manifest.version),
      id: `plugins.${record.id}`,
      kind: 'action',
      label: name,
      run: () => toggleDrawer(record.id),
      value: () => (isExpanded(record.id) ? '▾' : '▸'),
    })
    if (!isExpanded(record.id)) continue
    const user = pluginUserConfigRef.find((entry) => entry.id === record.id)
    rows.push({
      id: `plugins.${record.id}.enabled`,
      kind: 'toggle',
      label: '  Enabled',
      // `app` storage, not `settings`: the value's home is the plugin
      // registry, and this row is a view over it like every other `app` row.
      read: () => pluginStore.getState().records.find((r) => r.id === record.id)?.enabled ?? false,
      storage: 'app',
      write: (value) => {
        setPluginEnabled(record.id, value === true)
        refreshPluginsGlobal()
      },
    })
    rows.push(...pluginConfigRows(record, user?.config))
    rows.push(...pluginKeymapRows(record, user?.keymaps))
    rows.push({
      description: record.root,
      id: `plugins.${record.id}.detail`,
      kind: 'info',
      label: `  ${record.id}`,
      // Everything a row cannot hold — the stack, the log, the missing
      // services — is one command away, and naming it beats half-showing it.
      value: () => `aimux plugin show ${record.id}`,
    })
  }
  return rows
}

export const PLUGINS_SECTION: SettingSection = {
  description: 'Switch one off to find out whether it is the problem.',
  glyph: '\u{29C9}',
  id: 'plugins',
  label: 'Plugins',
  rowCount: () => {
    let count = 0
    for (const record of pluginStore.getState().records) {
      count += 1
      if (!isExpanded(record.id)) continue
      count +=
        2 +
        Object.keys(record.manifest.config ?? {}).length +
        (record.manifest.contributes?.keymaps?.length ?? 0)
    }
    return count
  },
  rows: () => rowsFor(),
}
