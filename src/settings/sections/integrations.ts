import type { SettingSection } from '../types'

/**
 * What aimux writes into other tools' configuration. Installing Claude's hooks is
 * a one-way write at startup with no uninstall, so it cannot honestly claim to
 * take effect before the next launch.
 */
export const INTEGRATIONS_SECTION: SettingSection = {
  glyph: '\u{21C4}',
  id: 'integrations',
  label: 'Integrations',
  rows: [
    {
      description: 'Drive per-tab activity from Claude Code events instead of reading the screen.',
      fallback: false,
      fromConfig: (config) => config.integrations?.claudeHooks,
      id: 'integrations.claudeHooks',
      kind: 'toggle',
      label: 'Claude Code hooks',
      restart: true,
      storage: 'settings',
    },
  ],
}
