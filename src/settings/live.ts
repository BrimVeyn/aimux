import type { AIUsageToolConfig, AutoCommitConfig } from '@brimveyn/aimux-config'

import { useMemo } from 'react'

import { AUTO_COMMIT_ENABLED, AUTO_COMMIT_TIMEOUT } from './sections/automation'
import { AI_USAGE_ENABLED, AI_USAGE_POLL_SECONDS } from './sections/status-bar'
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
  return {
    enabled: values[AUTO_COMMIT_ENABLED] === true,
    // `models` stays config-file only: it is a model name per assistant, and the
    // screen has no text field yet.
    models: fromConfigFile.models,
    timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : fromConfigFile.timeoutMs,
  }
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
