import type { SettingSection } from '../types'

import { userSpriteDir } from '../../ui/terminal-graphics/sprites'

export const HARMONIZE_CLAUDE_THEME = 'theme.beta.harmonizeClaudeTheme'
export const ACTIVITY_SPRITES = 'theme.beta.experimentalActivitySprites'

/**
 * The `theme.beta.*` block of the config, under the label its own docstrings use.
 * Not grouped with the integrations even though both of these touch Claude Code:
 * what they have in common is that they are unfinished, which is the thing a user
 * needs to know before turning one on.
 */
export const EXPERIMENTAL_SECTION: SettingSection = {
  description: 'Unfinished. These can change behaviour, or go away, in any release.',
  glyph: '\u{2727}',
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
    {
      description: 'A little animation per agent state, instead of the spinner and the dots.',
      fallback: false,
      fromConfig: (config) => config.theme?.beta?.experimentalActivitySprites,
      id: ACTIVITY_SPRITES,
      kind: 'toggle',
      label: 'Activity sprites (Kitty or Ghostty, not tmux)',
      storage: 'settings',
    },
    // The row above is useless without knowing where to put anything, and a path
    // that has to be looked up in the docs is a path nobody uses.
    {
      description: 'Drop a `<state>.gif` here — states: idle, working, waiting, done.',
      id: 'experimental.spriteFolder',
      kind: 'info',
      label: 'Sprite folder',
      value: () => userSpriteDir(),
    },
  ],
}
