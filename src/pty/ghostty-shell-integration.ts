import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

export type PtyEnv = Record<string, string>

/**
 * Replicate Ghostty's automatic shell-integration injection for the nested
 * shells aimux spawns. Ghostty only performs it for shells it launches
 * directly (by pointing ZDOTDIR at its integration dir, whose .zshenv
 * restores the user's ZDOTDIR and then loads the integration), so aimux
 * panes would otherwise miss the integration's zle hooks — notably the
 * DECSCUSR cursor-shape reporting (bar at prompt, block in vicmd) that the
 * hardware-cursor pass-through relies on for native-parity rendering.
 */
export function applyGhosttyShellIntegration(
  env: PtyEnv,
  command: string,
  integrationFileExists: (path: string) => boolean = existsSync
): PtyEnv {
  const resourcesDir = env.GHOSTTY_RESOURCES_DIR
  if (resourcesDir === undefined || resourcesDir === '') return env
  // bash and fish use different bootstrap mechanisms; only zsh is supported.
  if (basename(command) !== 'zsh') return env

  const integrationDir = join(resourcesDir, 'shell-integration', 'zsh')
  if (env.ZDOTDIR === integrationDir) return env
  if (!integrationFileExists(join(integrationDir, '.zshenv'))) return env

  const next: PtyEnv = { ...env, ZDOTDIR: integrationDir }
  if (env.ZDOTDIR !== undefined && env.ZDOTDIR !== '') {
    next.GHOSTTY_ZSH_ZDOTDIR = env.ZDOTDIR
  }
  return next
}
