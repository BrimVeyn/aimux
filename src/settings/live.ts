import type { AIUsageToolConfig, AutoCommitConfig } from '@brimveyn/aimux-config'

import { useMemo } from 'react'

import { AUTO_COMMIT_ENABLED, AUTO_COMMIT_TIMEOUT } from './sections/automation'
import { AUTO_COMMIT_MODEL_PREFIX, SNIPPET_TRIGGER_CHAR } from './sections/commands'
import { ACTIVITY_SPRITES } from './sections/experimental'
import { AI_USAGE_ENABLED, AI_USAGE_POLL_SECONDS, HINTS_ENABLED } from './sections/status-bar'
import { useSettingsStore } from './settings-store'

/**
 * The read side of the settings screen: where a consumer used to take a value
 * straight off the resolved config, it takes it from here instead, and the change
 * lands without a restart.
 *
 * One hook per consumer, all in this file, so the row ids are read in exactly one
 * place — and the ids themselves come from the section that defines them.
 */
export function useAutoCommitConfig(fromConfigFile: AutoCommitConfig): AutoCommitConfig {
  const values = useSettingsStore((s) => s.values)
  const timeoutMs = values[AUTO_COMMIT_TIMEOUT]
  const models = { ...fromConfigFile.models }
  for (const [id, value] of Object.entries(values)) {
    if (!id.startsWith(AUTO_COMMIT_MODEL_PREFIX)) continue
    // An empty row means "leave the default alone", not "use no model".
    if (typeof value === 'string' && value !== '') {
      models[id.slice(AUTO_COMMIT_MODEL_PREFIX.length)] = value
    }
  }
  return {
    enabled: values[AUTO_COMMIT_ENABLED] === true,
    models,
    timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : fromConfigFile.timeoutMs,
  }
}

/**
 * The character that opens an inline snippet trigger. Clamped to one character,
 * the same rule the config resolver applies — a two-character value would simply
 * never match.
 */
export function useSnippetTriggerChar(fromConfigFile: string): string {
  const stored = useSettingsStore((s) => s.values[SNIPPET_TRIGGER_CHAR])
  if (typeof stored === 'string' && stored.length === 1) return stored
  return fromConfigFile
}

/**
 * Memoized on purpose: its consumer restarts the polling service whenever this
 * object changes, so a fresh identity per render would restart it per render.
 */
export function useAIUsageConfig(fromConfigFile: AIUsageToolConfig | undefined): AIUsageToolConfig {
  const values = useSettingsStore((s) => s.values)
  const enabled = values[AI_USAGE_ENABLED] === true
  const poll = values[AI_USAGE_POLL_SECONDS]
  const pollSeconds = typeof poll === 'number' ? poll : fromConfigFile?.pollSeconds
  return useMemo(
    () => ({ ...fromConfigFile, enabled, pollSeconds }),
    [enabled, fromConfigFile, pollSeconds]
  )
}

/**
 * The model that would write the commit message for this assistant, or undefined
 * when nothing overrides the built-in default. The generating overlay names it, so
 * an override set on the settings screen is visible where it applies.
 */
export function useAutoCommitModel(assistant: string | undefined): string | undefined {
  const stored = useSettingsStore((s) =>
    assistant == null || assistant === ''
      ? undefined
      : s.values[`${AUTO_COMMIT_MODEL_PREFIX}${assistant}`]
  )
  return typeof stored === 'string' && stored !== '' ? stored : undefined
}

/**
 * Whether agent state is drawn as a sprite. Read straight off the store rather
 * than through the resolved config: hydration already folds in whatever
 * `aimux.config.ts` declares, and this way the toggle lands without a restart.
 */
export function useActivitySprites(): boolean {
  return useSettingsStore((s) => s.values[ACTIVITY_SPRITES] === true)
}

/** Whether the status bar draws its second row of keybinding hints. */
export function useStatusBarHints(): boolean {
  return useSettingsStore((s) => s.values[HINTS_ENABLED] !== false)
}
