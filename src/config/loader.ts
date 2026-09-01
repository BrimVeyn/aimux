import { type AimuxUserConfig, resolveConfig, type ResolvedConfig } from '@brimveyn/aimux-config'
import { join } from 'node:path'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'

const CONFIG_FILENAMES = ['aimux.config.ts', 'aimux.config.js']

export interface LoadedUserConfig {
  resolved: ResolvedConfig
  /**
   * The file as written, before defaults are merged in. The settings screen needs
   * this one: `resolved` has a value for every key, so it cannot tell a setting
   * the user declared from one that merely defaulted — and only a declared
   * setting outranks what the screen has written.
   */
  user: AimuxUserConfig
}

/**
 * Load the user's aimux.config.ts (or .js) and merge it with defaults. Falls back
 * to pure defaults if no config file exists.
 */
export async function loadUserConfig(): Promise<LoadedUserConfig> {
  const configDir = getProfileConfigDir()

  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(configDir, filename)

    try {
      const file = Bun.file(configPath)
      if (!(await file.exists())) continue

      const mod = await import(configPath)
      const userConfig: AimuxUserConfig = mod.default ?? mod

      logDebug('config.user.loaded', { path: configPath })
      return { resolved: resolveConfig(userConfig), user: userConfig }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logDebug('config.user.error', { error: message, path: configPath })
      // Fall through to try next filename or use defaults
    }
  }

  return { resolved: resolveConfig({}), user: {} }
}
