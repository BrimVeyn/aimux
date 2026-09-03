import type { PluginManifest } from '@brimveyn/aimux-plugin'

/**
 * The manifest for one plugin id, for completion only.
 *
 * Deliberately not `discoverPlugins`: TAB must stay cheap, and discovery reads
 * every registered directory and resolves the user's config file. This reads
 * exactly one manifest, or none at all for a built-in — whose manifest is a
 * literal already in memory.
 */
export async function manifestForPluginId(id: string): Promise<PluginManifest | undefined> {
  const { builtinPlugins } = await import('../../builtin-plugins')
  const builtin = builtinPlugins().find((entry) => entry.manifest.id === id)
  if (builtin) return { ...builtin.manifest, entries: {} }

  const { loadPluginRegistryResult } = await import('../../plugins/registry-file')
  const row = loadPluginRegistryResult().registry.plugins.find((entry) => entry.id === id)
  if (!row) return undefined

  const { readManifest } = await import('../../plugins/manifest')
  const result = await readManifest(row.path)
  return result.ok ? result.manifest : undefined
}
