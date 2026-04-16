import type { ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import type { KeymapModeHandler } from '../../keymap/keymap-mode-handler'

import { buildKeymapHandlers } from '../../keymap/build-handlers'
import { registerMode } from '../registry'
import { gitMode } from './git-mode'
import { modalGitCommitMode } from './modal-git-commit'

/**
 * Build and register all mode handlers from a resolved keymap config.
 * Returns the handlers array so app.tsx can wire timeout callbacks.
 */
export function registerAllModes(config: ResolvedKeymapConfig): KeymapModeHandler[] {
  const handlers = buildKeymapHandlers(config)
  for (const handler of handlers) {
    registerMode(handler)
  }
  registerMode(gitMode)
  registerMode(modalGitCommitMode)
  return handlers
}
