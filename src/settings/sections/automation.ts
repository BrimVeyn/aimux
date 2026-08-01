import { setAutoCommitEnabled } from '@brimveyn/aimux-config'

import type { SettingSection } from '../types'

/** Ids `src/settings/live.ts` reads back — spelled once, here, next to the rows. */
export const AUTO_COMMIT_ENABLED = 'autoCommit.enabled'
export const AUTO_COMMIT_TIMEOUT = 'autoCommit.timeoutMs'

/**
 * Auto-commit applies live: the driver reads its config through a ref that this
 * store feeds, and the keymap action reads the module flag `apply` sets.
 *
 * Auto-rename does not. Its config is handed to the session backend at bootstrap,
 * before this screen exists, so a change reaches it on the next launch — which is
 * what `restart` puts on the row.
 */
export const AUTOMATION_SECTION: SettingSection = {
  id: 'automation',
  label: 'Automation',
  rows: [
    {
      apply: (value) => setAutoCommitEnabled(value === true),
      description: 'Offer a generated commit message when you commit from git mode.',
      fallback: false,
      fromConfig: (config) => config.autoCommit?.enabled,
      id: AUTO_COMMIT_ENABLED,
      kind: 'toggle',
      label: 'Auto-commit',
      storage: 'settings',
    },
    {
      description: 'How long the assistant gets to produce one, in milliseconds.',
      fallback: 60_000,
      fromConfig: (config) => config.autoCommit?.timeoutMs,
      id: AUTO_COMMIT_TIMEOUT,
      kind: 'number',
      label: 'Auto-commit timeout',
      max: 300_000,
      min: 10_000,
      step: 10_000,
      storage: 'settings',
    },
    {
      description: 'Name a tab from the first real prompt you send it.',
      fallback: true,
      fromConfig: (config) => config.autoRename?.enabled,
      id: 'autoRename.enabled',
      kind: 'toggle',
      label: 'Auto-rename tabs',
      restart: true,
      storage: 'settings',
    },
    {
      description: 'Quiet period after a prompt before a title is generated, in milliseconds.',
      fallback: 2_500,
      fromConfig: (config) => config.autoRename?.settleMs,
      id: 'autoRename.settleMs',
      kind: 'number',
      label: 'Auto-rename settle',
      max: 10_000,
      min: 0,
      restart: true,
      step: 500,
      storage: 'settings',
    },
    {
      description: 'Tries before falling back to a title derived from the prompt itself.',
      fallback: 3,
      fromConfig: (config) => config.autoRename?.maxAttempts,
      id: 'autoRename.maxAttempts',
      kind: 'number',
      label: 'Auto-rename attempts',
      max: 10,
      min: 1,
      restart: true,
      step: 1,
      storage: 'settings',
    },
    {
      description: 'Shorter prompts are menu answers, not something to name a tab after.',
      fallback: 3,
      fromConfig: (config) => config.autoRename?.minPromptWords,
      id: 'autoRename.minPromptWords',
      kind: 'number',
      label: 'Auto-rename minimum words',
      max: 20,
      min: 1,
      restart: true,
      step: 1,
      storage: 'settings',
    },
    {
      fallback: 15_000,
      fromConfig: (config) => config.autoRename?.timeoutMs,
      id: 'autoRename.timeoutMs',
      kind: 'number',
      label: 'Auto-rename timeout',
      max: 60_000,
      min: 5_000,
      restart: true,
      step: 5_000,
      storage: 'settings',
    },
  ],
}
