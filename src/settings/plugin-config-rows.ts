import type { PluginConfigField } from '@brimveyn/aimux-plugin'

import type { PluginRecord } from '../plugins/types'
import type { PluginSettingRow, SettingRow, SettingSection, SettingValue } from './types'

import {
  describePluginConfig,
  type PluginConfigFieldReport,
  SECRET_PLACEHOLDER,
} from '../plugins/config-origin'
import { pluginStore } from '../plugins/plugin-store'
import { getPluginOverride, setPluginOverride } from '../plugins/registry-file'
import { refreshPluginsGlobal } from '../ui/plugin-refresh-ref'

/**
 * One settings section per plugin that declares a `config` schema.
 *
 * The schema is the manifest's, because the host has to read it before running
 * a line of the plugin's code — so generating the rows from it is what keeps
 * the settings screen and the plugin from disagreeing. The alternative is
 * every author writing their schema twice and one copy rotting.
 *
 * Built for *every* plugin, disabled and daemon-only ones included. A section
 * a plugin registered itself would vanish the moment the plugin stopped
 * loading, which is exactly when someone needs to change its configuration.
 */

/**
 * Writes are debounced because `←`/`→` on a number row calls `writeRow` once
 * per keypress, and each write rebuilds the plugin's fiber. Holding `→` on a
 * poll interval would otherwise restart it sixty times.
 */
const WRITE_SETTLE_MS = 300

let settleTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    refreshPluginsGlobal()
  }, WRITE_SETTLE_MS)
}

function fallbackFor(field: PluginConfigField): SettingValue {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return 0
  return ''
}

/** `<pluginId>.<field>` — the row id, and what a test names. */
export function pluginSettingRowId(pluginId: string, field: string): string {
  return `plugin.${pluginId}.${field}`
}

function writeValue(pluginId: string, field: string, value: SettingValue | undefined): void {
  setPluginOverride(pluginId, { config: { [field]: value } })
  scheduleRefresh()
}

function rowFor(record: PluginRecord, report: PluginConfigFieldReport): PluginSettingRow {
  const field = record.manifest.config?.[report.key]
  const base = {
    field: report.key,
    // Both marks come from the plugin's own layers: this row's value is not in
    // either settings store, so hydration recorded nothing about it.
    fromConfigFile: report.shadowedBy !== undefined,
    id: pluginSettingRowId(record.id, report.key),
    isSet: report.isSet,
    label: report.label,
    pluginId: record.id,
    read: (): SettingValue => {
      const current = record.config[report.key]
      // The reader redacts, not the renderer: a token must not reach the row's
      // value, the footer's full-value line, or the edit modal's seed.
      if (report.secret) return current === undefined ? '' : SECRET_PLACEHOLDER
      return typeof current === 'string' ||
        typeof current === 'number' ||
        typeof current === 'boolean'
        ? current
        : fallbackFor(field ?? { type: 'string' })
    },
    reset: (): void => {
      writeValue(record.id, report.key, undefined)
    },
    storage: 'plugin' as const,
    write: (value: SettingValue): void => {
      writeValue(record.id, report.key, value)
    },
    ...(report.description === undefined ? {} : { description: report.description }),
    ...(report.secret ? { secret: true } : {}),
  }

  if (report.type === 'boolean') return { ...base, kind: 'toggle' }
  if (report.type === 'number') {
    // The schema declares a type, not a domain, so the row takes the widest
    // bounds that still read as a number rather than inventing a range.
    return {
      ...base,
      kind: 'number',
      max: Number.MAX_SAFE_INTEGER,
      min: Number.MIN_SAFE_INTEGER,
      step: 1,
    }
  }
  return {
    ...base,
    kind: 'text',
    ...(report.secret ? { placeholder: SECRET_PLACEHOLDER } : {}),
  }
}

/** The section for one plugin, or null when its manifest declares no config. */
export function buildPluginConfigSection(
  record: PluginRecord,
  userConfig: Record<string, unknown> | undefined
): SettingSection | null {
  const schema = record.manifest.config
  if (!schema || Object.keys(schema).length === 0) return null

  const override = getPluginOverride(record.id)
  const reports = describePluginConfig(record.manifest, record.config, {
    ...(override === undefined ? {} : { override }),
    ...(userConfig === undefined ? {} : { userConfig }),
  })
  const rows: SettingRow[] = reports.map((report) => rowFor(record, report))

  return {
    // One cell, text presentation — the rule every section glyph follows.
    glyph: '\u{2699}',
    id: `plugin.${record.id}`,
    label: record.manifest.name ?? record.id,
    rows,
    ...(record.manifest.description === undefined
      ? {}
      : { description: record.manifest.description }),
  }
}

/** A section per configurable plugin, in the order discovery found them. */
export function pluginConfigSections(
  userPlugins: readonly { id?: string; config?: Record<string, unknown> }[] = []
): SettingSection[] {
  const byId = new Map(userPlugins.filter((entry) => entry.id !== undefined).map((e) => [e.id, e]))
  const sections: SettingSection[] = []
  for (const record of pluginStore.getState().records) {
    const section = buildPluginConfigSection(record, byId.get(record.id)?.config)
    if (section) sections.push(section)
  }
  return sections
}
