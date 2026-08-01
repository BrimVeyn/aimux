import type { SettingSection } from '../types'

export const HARMONIZE_CLAUDE_THEME = 'theme.beta.harmonizeClaudeTheme'

/**
 * Everything here reaches outside aimux — into `~/.claude` or into the
 * environment of the PTYs it spawns.
 *
 * Only the theme bridge applies live. Installing Claude's hooks is a one-way
 * write at startup with no uninstall, and the syntax-highlight flag is an
 * environment variable the child processes inherit when they spawn, so neither
 * can honestly claim to take effect before the next launch.
 */
export const INTEGRATIONS_SECTION: SettingSection = {
  id: 'integrations',
  label: 'Integrations',
  rows: [
    {
      description: 'Write the active theme into ~/.claude and select it there.',
      fallback: false,
      fromConfig: (config) => config.theme?.beta?.harmonizeClaudeTheme,
      id: HARMONIZE_CLAUDE_THEME,
      kind: 'toggle',
      label: 'Harmonize the Claude Code theme',
      storage: 'settings',
    },
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
    {
      description: "Turn off Claude's own highlighting and re-colour diffs from the aimux theme.",
      fallback: false,
      fromConfig: (config) => config.theme?.beta?.experimentalSyntaxHighlight,
      id: 'theme.beta.experimentalSyntaxHighlight',
      kind: 'toggle',
      label: 'Experimental syntax highlight',
      restart: true,
      storage: 'settings',
    },
  ],
}
