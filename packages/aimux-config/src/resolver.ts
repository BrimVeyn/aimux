import type {
  AimuxUserConfig,
  ModeId,
  ModeKeymapDef,
  ResolvedConfig,
  ResolvedKeymapConfig,
} from './types'

import { getDefaultKeymapConfig } from './defaults'
import { KeymapBuilder } from './keymap-builder'

/**
 * Resolve a user config by merging it with defaults.
 * User bindings override defaults; user unmaps remove defaults.
 */
export function resolveConfig(userConfig: AimuxUserConfig): ResolvedConfig {
  const keymaps = resolveKeymaps(userConfig)

  return {
    backends: userConfig.backends ?? {},
    gitPane: resolveGitPane(userConfig.gitPane),
    hooks: userConfig.hooks ?? {},
    keymaps,
    sessionBar: resolveSessionBar(userConfig.sessionBar),
    sidebar: userConfig.sidebar ?? {},
    snippets: userConfig.snippets ?? [],
    theme: resolveTheme(userConfig.theme),
  }
}

function resolveTheme(userConfig: AimuxUserConfig['theme']): ResolvedConfig['theme'] {
  if (!userConfig) return undefined
  return {
    initialMode: userConfig.initialMode ?? userConfig.mode,
    paletteOverrides: userConfig.paletteOverrides,
  }
}

function resolveSessionBar(
  userConfig: AimuxUserConfig['sessionBar']
): ResolvedConfig['sessionBar'] {
  if (!userConfig) return {}
  return {
    initialPosition: userConfig.initialPosition ?? userConfig.position,
    initialVisible: userConfig.initialVisible ?? userConfig.visible,
  }
}

function resolvePaneInitialPosition(
  userConfig: NonNullable<AimuxUserConfig['gitPane']>
): 'left' | 'right' | undefined {
  if (userConfig.initialPosition === 'left' || userConfig.initialPosition === 'right') {
    return userConfig.initialPosition
  }
  if (userConfig.position === 'left' || userConfig.position === 'right') {
    return userConfig.position
  }
  return undefined
}

function resolveEmbeddedInitialPosition(
  userConfig: NonNullable<AimuxUserConfig['gitPane']>
): 'top' | 'bottom' | undefined {
  if (userConfig.initialPosition === 'top' || userConfig.initialPosition === 'bottom') {
    return userConfig.initialPosition
  }
  if (userConfig.position === 'top' || userConfig.position === 'bottom') {
    return userConfig.position
  }
  return undefined
}

function resolveGitPane(userConfig: AimuxUserConfig['gitPane']): ResolvedConfig['gitPane'] {
  if (!userConfig) return {}

  const initialMode = userConfig.initialMode ?? userConfig.mode
  const paneInitialPosition = resolvePaneInitialPosition(userConfig)
  const embeddedInitialPosition = resolveEmbeddedInitialPosition(userConfig)
  const shared = {
    diffCount: userConfig.diffCount,
    initialDiffModeRatio: userConfig.initialDiffModeRatio ?? userConfig.diffModeRatio,
    initialFileListMode: userConfig.initialFileListMode ?? userConfig.fileListMode,
    initialRatio: userConfig.initialRatio ?? userConfig.ratio,
    initialTreeCompaction: userConfig.initialTreeCompaction ?? userConfig.treeCompaction,
    initialVisible: userConfig.initialVisible ?? userConfig.visible,
    path: userConfig.path,
    prefetchRadius: userConfig.prefetchRadius,
  }

  if (initialMode === 'pane') {
    return {
      ...shared,
      initialMode: 'pane',
      initialPosition: paneInitialPosition,
    }
  }

  return {
    ...shared,
    ...(initialMode === 'embedded' ? { initialMode: 'embedded' as const } : {}),
    initialPosition: embeddedInitialPosition,
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
