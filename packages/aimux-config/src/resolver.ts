import type {
  AimuxUserConfig,
  AutoCommitConfig,
  ModeId,
  ModeKeymapDef,
  ResolvedConfig,
  ResolvedKeymapConfig,
} from './types'

import { DEFAULT_AUTO_COMMIT_CONFIG, getDefaultKeymapConfig } from './defaults'
import { KeymapBuilder } from './keymap-builder'

/**
 * Resolve a user config by merging it with defaults.
 * User bindings override defaults; user unmaps remove defaults.
 */
export function resolveConfig(userConfig: AimuxUserConfig): ResolvedConfig {
  const keymaps = resolveKeymaps(userConfig)

  const autoCommit: AutoCommitConfig = {
    enabled: userConfig.autoCommit?.enabled ?? DEFAULT_AUTO_COMMIT_CONFIG.enabled,
    models: { ...DEFAULT_AUTO_COMMIT_CONFIG.models, ...userConfig.autoCommit?.models },
    timeoutMs: userConfig.autoCommit?.timeoutMs ?? DEFAULT_AUTO_COMMIT_CONFIG.timeoutMs,
  }

  return {
    autoCommit,
    backends: userConfig.backends ?? {},
    gitPane: userConfig.gitPane ?? {},
    hooks: userConfig.hooks ?? {},
    keymaps,
    sessionBar: userConfig.sessionBar ?? {},
    sidebar: userConfig.sidebar ?? {},
    snippets: userConfig.snippets ?? [],
    theme: userConfig.theme,
    themes: userConfig.themes ?? {},
  }
}

function resolveKeymaps(userConfig: AimuxUserConfig): ResolvedKeymapConfig {
  const defaults = getDefaultKeymapConfig()

  if (!userConfig.keymaps) {
    return defaults
  }

  // Run the user's keymaps callback on a fresh builder
  const userBuilder = new KeymapBuilder()
  userConfig.keymaps(userBuilder)
  const userKeymaps = userBuilder._build()

  // Merge: user leader/timeout override defaults
  const leader = userKeymaps.leader !== '<Space>' ? userKeymaps.leader : defaults.leader
  const timeout = userKeymaps.timeout !== 300 ? userKeymaps.timeout : defaults.timeout

  // Merge modes: for each mode, user bindings overlay on top of defaults
  const mergedModes = new Map<ModeId, ModeKeymapDef>(defaults.modes)

  for (const [modeId, userModeDef] of userKeymaps.modes) {
    const defaultModeDef = defaults.modes.get(modeId)

    if (!defaultModeDef) {
      // User defines a mode that has no defaults — use as-is
      mergedModes.set(modeId, userModeDef)
      continue
    }

    // Start with default bindings, remove unmaps, then overlay user bindings
    const removedKeys = new Set(userModeDef.removals)
    const filteredDefaults = defaultModeDef.bindings.filter((b) => !removedKeys.has(b.keys))

    // Build a map for deduplication: user bindings override same-key defaults
    const userKeySet = new Set(userModeDef.bindings.map((b) => b.keys))
    const mergedBindings = [
      ...filteredDefaults.filter((b) => !userKeySet.has(b.keys)),
      ...userModeDef.bindings,
    ]

    mergedModes.set(modeId, {
      bindings: mergedBindings,
      isPassthrough: userModeDef.isPassthrough || defaultModeDef.isPassthrough,
      removals: [],
    })
  }

  return { leader, modes: mergedModes, timeout }
}
