import type { PluginPaths } from '@brimveyn/aimux-plugin'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { getProfileConfigDir } from '../profile-paths'

/**
 * Plugin storage is profile-scoped, exactly like the sockets: the `dev`
 * profile has its own plugins, its own registry, and its own state, so
 * hacking on a plugin cannot disturb a running default profile.
 *
 * Three roots, deliberately separate:
 *   plugins/       the code — owned by aimux for installs, a symlink for links
 *   plugins-config/  files a human edits; survives an uninstall/reinstall
 *   plugins-state/   caches, logs, build artifacts; safe to delete at any time
 */

export const PLUGIN_REGISTRY_FILENAME = 'aimux-plugins.json'

export function getPluginsRootDir(): string {
  return join(getProfileConfigDir(), 'plugins')
}

export function getPluginsConfigRootDir(): string {
  return join(getProfileConfigDir(), 'plugins-config')
}

export function getPluginsStateRootDir(): string {
  return join(getProfileConfigDir(), 'plugins-state')
}

export function getPluginRegistryFilePath(): string {
  return join(getProfileConfigDir(), PLUGIN_REGISTRY_FILENAME)
}

/** Where `plugin install` clones a plugin. Links live wherever the user put them. */
export function getInstalledPluginDir(id: string): string {
  return join(getPluginsRootDir(), id)
}

export function getPluginConfigDir(id: string): string {
  return join(getPluginsConfigRootDir(), id)
}

export function getPluginStateDir(id: string): string {
  return join(getPluginsStateRootDir(), id)
}

/** Build artifacts, one per reload. Disposable — pruned as they accumulate. */
export function getPluginHotDir(id: string): string {
  return join(getPluginStateDir(id), '.hot')
}

export function getPluginLogPath(id: string): string {
  return join(getPluginStateDir(id), 'plugin.log')
}

export function getPluginPaths(id: string, root: string): PluginPaths {
  return {
    config: getPluginConfigDir(id),
    log: getPluginLogPath(id),
    root,
    state: getPluginStateDir(id),
  }
}

/**
 * Created lazily at load time rather than at boot: a profile with no plugins
 * should not grow three empty directories it never uses.
 */
export function ensurePluginDirs(id: string): void {
  mkdirSync(getPluginConfigDir(id), { recursive: true })
  mkdirSync(getPluginStateDir(id), { recursive: true })
}
