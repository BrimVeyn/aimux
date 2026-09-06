import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { loadPluginRegistryResult, savePluginRegistry } from './registry-file'

/**
 * One-shot moves of a setting that used to live somewhere else.
 *
 * A migrated feature keeps the keys it was configured under — that is the rule
 * `builtinPlugins` follows for `aimux.config.ts`, which aimux may read but must
 * never rewrite. The files aimux writes itself are the other half: a key this
 * screen wrote and no longer reads has to be carried to its new home, or the
 * user's answer is silently thrown away.
 *
 * Idempotent and cheap: each one leaves after a single config read once it has
 * nothing left to do, so both the UI and the daemon can call it at startup
 * without coordinating.
 */

const AI_USAGE_PLUGIN_ID = 'aimux.ai-usage'
/** The settings row that was a second switch beside the plugin's own. */
const LEGACY_AI_USAGE_ENABLED = 'statusBar.aiUsage.enabled'

/**
 * `statusBar.aiUsage.enabled: true` becomes `aimux.ai-usage` being loaded.
 *
 * The plugin ships off — it reads a keychain entry and calls two OAuth
 * endpoints — so someone who had asked for the indicator would otherwise lose
 * it on upgrade, which is exactly the failure that prompted the cleanup. A
 * stored `false` needs no override: it is what the plugin already defaults to.
 */
export function migrateAiUsageToggle(): void {
  const config = loadConfig()
  const legacy = config.settings?.[LEGACY_AI_USAGE_ENABLED]
  if (legacy === undefined) return

  if (legacy === true) {
    const { registry } = loadPluginRegistryResult()
    const override = registry.overrides[AI_USAGE_PLUGIN_ID]
    if (override?.enabled === undefined) {
      registry.overrides[AI_USAGE_PLUGIN_ID] = { ...override, enabled: true }
      // The key stays put if the write fails, so the next launch tries again
      // rather than dropping the answer on the floor.
      if (!savePluginRegistry(registry)) return
    }
  }

  const settings = { ...config.settings }
  delete settings[LEGACY_AI_USAGE_ENABLED]
  saveConfig({ ...config, settings })
  logDebug('plugin.migration.aiUsageToggle', { enabled: legacy })
}

/** Every migration, in one call, for the two processes that start plugins. */
export function runPluginMigrations(): void {
  migrateAiUsageToggle()
}
