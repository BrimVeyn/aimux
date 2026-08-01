import { setStatusBarSeparator, type StatusBarSeparator } from '@brimveyn/aimux-config'

import type { SettingSection } from '../types'

export const AI_USAGE_ENABLED = 'statusBar.aiUsage.enabled'
export const AI_USAGE_POLL_SECONDS = 'statusBar.aiUsage.pollSeconds'

const SEPARATORS: { value: StatusBarSeparator; label: string }[] = [
  { label: 'arrow', value: 'arrow' },
  { label: 'round', value: 'round' },
  { label: 'slant', value: 'slant' },
  { label: 'flame', value: 'flame' },
  { label: 'none', value: 'none' },
]

/**
 * `statusBar.aiUsage.tools` is not here: it is a list, and this screen has no row
 * kind for one. `claudePlan` and `codexWeeklyLimit` are not here either — they are
 * declared in the config type but read nowhere, and a row that does nothing is
 * worse than no row.
 */
export const STATUS_BAR_SECTION: SettingSection = {
  id: 'statusBar',
  label: 'Status bar',
  rows: [
    {
      apply: (value) => setStatusBarSeparator(value as StatusBarSeparator),
      description: 'Glyph between sections. All but "none" need a nerd font.',
      fallback: 'arrow',
      fromConfig: (config) => config.statusBar?.separator,
      id: 'statusBar.separator',
      kind: 'select',
      label: 'Separator',
      options: SEPARATORS,
      storage: 'settings',
    },
    {
      description: 'Show how much of your Claude or Codex quota is left.',
      fallback: false,
      fromConfig: (config) => config.statusBar?.aiUsage?.enabled,
      id: AI_USAGE_ENABLED,
      kind: 'toggle',
      label: 'AI usage indicator',
      storage: 'settings',
    },
    {
      description: "Seconds between checks. Under 180, Claude's endpoint starts rate-limiting.",
      fallback: 60,
      fromConfig: (config) => config.statusBar?.aiUsage?.pollSeconds,
      id: AI_USAGE_POLL_SECONDS,
      kind: 'number',
      label: 'Refresh interval',
      max: 3_600,
      min: 60,
      step: 60,
      storage: 'settings',
    },
  ],
}
