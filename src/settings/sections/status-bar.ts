import { setStatusBarSeparator, type StatusBarSeparator } from '@brimveyn/aimux-config'

import type { SettingSection } from '../types'

export const HINTS_ENABLED = 'statusBar.hints'
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
 *
 * Nor is `statusBar.aiUsage.enabled`, which used to sit here as a second switch
 * beside the `aimux.ai-usage` plugin's own. Turning the plugin on and watching
 * nothing appear is the failure that costs an hour; the plugin is the indicator,
 * so its switch is the switch (Plugins → AI usage), and the row below only says
 * how often it asks.
 */
export const STATUS_BAR_SECTION: SettingSection = {
  glyph: '\u{25AC}',
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
      description: 'The keybinding row under the bar. Off frees a line.',
      fallback: true,
      fromConfig: (config) => config.statusBar?.hints,
      id: HINTS_ENABLED,
      kind: 'toggle',
      label: 'Keybinding hints',
      storage: 'settings',
    },
    {
      // The floor is 180 rather than a warning at 180: Claude's endpoint answers
      // a faster caller with a rate limit, and the symptom is an indicator that
      // quietly stops updating. A setting whose own description tells you not to
      // use half its range should not have that half.
      description:
        "How often the AI usage indicator asks how much quota is left. Claude's endpoint rate-limits anything faster.",
      fallback: 180,
      fromConfig: (config) => config.statusBar?.aiUsage?.pollSeconds,
      id: AI_USAGE_POLL_SECONDS,
      kind: 'number',
      label: 'AI usage refresh',
      max: 3_600,
      min: 180,
      step: 60,
      storage: 'settings',
    },
  ],
}
