import type { SettingSection } from '../types'

export const HARMONIZE_CLAUDE_THEME = 'theme.beta.harmonizeClaudeTheme'

/**
 * The `theme.beta.*` block of the config, under the label its own docstrings use.
 * Not grouped with the integrations even though both of these touch Claude Code:
 * what they have in common is that they are unfinished, which is the thing a user
 * needs to know before turning one on.
 */
export const EXPERIMENTAL_SECTION: SettingSection = {
  description: 'Unfinished. These can change behaviour, or go away, in any release.',
  id: 'experimental',
  label: 'Experimental',
  rows: [
    {
      description: 'Write the active aimux theme into ~/.claude and select it there.',
      fallback: false,
      fromConfig: (config) => config.theme?.beta?.harmonizeClaudeTheme,
      id: HARMONIZE_CLAUDE_THEME,
      kind: 'toggle',
      label: 'Harmonize the Claude Code theme',
      storage: 'settings',
    },
    {
      description: "Turn off Claude's own highlighting and re-colour diffs from the aimux theme.",
      fallback: false,
      fromConfig: (config) => config.theme?.beta?.experimentalSyntaxHighlight,
      id: 'theme.beta.experimentalSyntaxHighlight',
      kind: 'toggle',
      label: 'Syntax highlight from the theme',
      restart: true,
      storage: 'settings',
    },
  ],
}
