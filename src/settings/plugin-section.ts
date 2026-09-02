import type { PluginConfigField, PluginManifest } from '@brimveyn/aimux-plugin'

import type { SettingRow, SettingSection, SettingValue } from './types'

/**
 * Turns a plugin's manifest `config` schema into a settings section.
 *
 * A plugin declares its configuration once, in the manifest, because the host
 * has to read it before running any code. Generating the settings rows from
 * that same declaration is what keeps the two from disagreeing — the
 * alternative is every plugin author writing their schema twice and one of the
 * copies rotting.
 *
 * Rows are stored ones, keyed `plugin.<id>.<field>`, so they share the
 * `aimux.json` settings block with everything else and need no second storage
 * path.
 */

/** The `settings` key a plugin config field is stored under. */
export function pluginSettingRowId(pluginId: string, field: string): string {
  return `plugin.${pluginId}.${field}`
}

function fallbackFor(field: PluginConfigField): SettingValue {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return 0
  return ''
}

function rowFor(pluginId: string, key: string, field: PluginConfigField): SettingRow {
  const base = {
    description: field.description,
    id: pluginSettingRowId(pluginId, key),
    label: field.label ?? key,
  }
  const fallback = fallbackFor(field)

  if (field.type === 'boolean') {
    return { ...base, fallback, kind: 'toggle', storage: 'settings' }
  }
  if (field.type === 'number') {
    // No bounds in the schema, so the row takes the widest ones that still
    // read as a number rather than inventing a range the plugin never asked
    // for.
    return {
      ...base,
      fallback,
      kind: 'number',
      max: Number.MAX_SAFE_INTEGER,
      min: Number.MIN_SAFE_INTEGER,
      step: 1,
      storage: 'settings',
    }
  }
  return {
    ...base,
    fallback,
    kind: 'text',
    // A secret shows its placeholder rather than its value; the row edits it
    // through the same one-field modal either way.
    placeholder: field.secret === true ? '<secret>' : undefined,
    storage: 'settings',
  }
}

/**
 * The section for a plugin, or null when its manifest declares no config —
 * an empty section would be a heading with nothing under it, which the
 * settings screen's cursor logic already goes out of its way to avoid.
 */
export function buildPluginSettingSection(manifest: PluginManifest): SettingSection | null {
  const schema = manifest.config
  if (!schema || Object.keys(schema).length === 0) return null

  const rows: SettingRow[] = Object.entries(schema).map(([key, field]) =>
    rowFor(manifest.id, key, field)
  )

  return {
    // One cell, text presentation — the rule every section glyph follows.
    glyph: '\u{2699}',
    id: `plugin.${manifest.id}`,
    label: manifest.name ?? manifest.id,
    rows,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
  }
}
