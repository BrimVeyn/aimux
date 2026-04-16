import type { AimuxUserConfig } from './types'

/**
 * Define an aimux configuration.
 * This is the entry point for user config files (`~/.config/aimux/aimux.config.ts`).
 *
 * ```ts
 * import { defineConfig, actions } from '@brimveyn/aimux-config'
 *
 * export default defineConfig({
 *   keymaps: (k) => k
 *     .mode('navigation', (m) => m
 *       .map('j', actions.nextTab)
 *       .map('k', actions.prevTab)),
 * })
 * ```
 */
export function defineConfig(config: AimuxUserConfig): AimuxUserConfig {
  return config
}
