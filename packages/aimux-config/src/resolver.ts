import type {
  AimuxUserConfig,
  AutoCommitConfig,
  AutoRenameConfig,
  ModeId,
  ModeKeymapDef,
  MultiRepoConfig,
  ResolvedConfig,
  ResolvedKeymapConfig,
} from './types'

import {
  DEFAULT_AUTO_COMMIT_CONFIG,
  DEFAULT_AUTO_RENAME_CONFIG,
  DEFAULT_MULTI_REPO_CONFIG,
  getDefaultKeymapConfig,
} from './defaults'
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

  const autoRename: AutoRenameConfig = {
    enabled: userConfig.autoRename?.enabled ?? DEFAULT_AUTO_RENAME_CONFIG.enabled,
    maxAttempts: Math.max(
      1,
      userConfig.autoRename?.maxAttempts ?? DEFAULT_AUTO_RENAME_CONFIG.maxAttempts
    ),
    minPromptWords: Math.max(
      1,
      userConfig.autoRename?.minPromptWords ?? DEFAULT_AUTO_RENAME_CONFIG.minPromptWords
    ),
    models: { ...DEFAULT_AUTO_RENAME_CONFIG.models, ...userConfig.autoRename?.models },
    settleMs: Math.max(0, userConfig.autoRename?.settleMs ?? DEFAULT_AUTO_RENAME_CONFIG.settleMs),
    timeoutMs: userConfig.autoRename?.timeoutMs ?? DEFAULT_AUTO_RENAME_CONFIG.timeoutMs,
  }

  const multiRepo: MultiRepoConfig = {
    enabled: userConfig.multiRepo?.enabled ?? DEFAULT_MULTI_REPO_CONFIG.enabled,
    maxDepth: Math.max(1, userConfig.multiRepo?.maxDepth ?? DEFAULT_MULTI_REPO_CONFIG.maxDepth),
  }

  return {
    autoCommit,
    autoRename,
    backends: userConfig.backends ?? {},
    externalEditor: userConfig.externalEditor ?? {},
    gitPane: resolveGitPane(userConfig.gitPane),
    hooks: userConfig.hooks ?? {},
    integrations: resolveIntegrations(userConfig.integrations),
    keymaps,
    multiRepo,
    sessionBar: resolveSessionBar(userConfig.sessionBar),
    sidebar: userConfig.sidebar ?? {},
    snippets: userConfig.snippets ?? [],
    snippetTriggerChar: resolveSnippetTriggerChar(userConfig.snippetTriggerChar),
    statusBar: userConfig.statusBar ?? {},
    theme: resolveTheme(userConfig.theme),
    worktreeTemplates: userConfig.worktreeTemplates ?? [],
  }
}

function resolveIntegrations(
  userConfig: AimuxUserConfig['integrations']
): ResolvedConfig['integrations'] {
  return {
    claudeHooks: userConfig?.claudeHooks === true,
  }
}

function resolveSnippetTriggerChar(value: string | undefined): string {
  return typeof value === 'string' && value.length === 1 ? value : ':'
}

function resolveTheme(userConfig: AimuxUserConfig['theme']): ResolvedConfig['theme'] {
  if (!userConfig) return undefined
  return {
    beta: userConfig.beta
      ? {
          experimentalSyntaxHighlight: userConfig.beta.experimentalSyntaxHighlight === true,
          harmonizeClaudeTheme: userConfig.beta.harmonizeClaudeTheme === true,
        }
      : undefined,
    initialId: userConfig.initialId,
    initialMode: userConfig.initialMode ?? userConfig.mode,
  }
}

function resolveSessionBar(
  userConfig: AimuxUserConfig['sessionBar']
): ResolvedConfig['sessionBar'] {
  if (!userConfig) return {}
  return {
    initialVisible: userConfig.initialVisible ?? userConfig.visible,
  }
}

/** Placement fields are accepted for backwards compatibility but dropped here. */
function resolveGitPane(userConfig: AimuxUserConfig['gitPane']): ResolvedConfig['gitPane'] {
  if (!userConfig) return {}
  return {
    diffCount: userConfig.diffCount,
    initialDiffModeRatio: userConfig.initialDiffModeRatio ?? userConfig.diffModeRatio,
    initialFileListMode: userConfig.initialFileListMode ?? userConfig.fileListMode,
    initialTreeCompaction: userConfig.initialTreeCompaction ?? userConfig.treeCompaction,
    path: userConfig.path,
    prefetchRadius: userConfig.prefetchRadius,
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
