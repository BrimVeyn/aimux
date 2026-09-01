import { getExternalEditorConfig, setExternalEditorConfig } from '@brimveyn/aimux-config'

import type { SettingSection } from '../types'

/** `auto` is the absence of a value, which is not something a row can hold. */
const AUTO = 'auto'

/**
 * `args` and `terminal` are absent: both are argv lists, and a list is not a row.
 * They stay in `aimux.config.ts`, where they are the only two settings here that
 * really need to be.
 */
export const EDITOR_SECTION: SettingSection = {
  glyph: '\u{270E}',
  id: 'editor',
  label: 'Editor',
  rows: [
    {
      apply: (value) => {
        const command = String(value)
        setExternalEditorConfig({
          ...getExternalEditorConfig(),
          command: command === '' ? undefined : command,
        })
      },
      description: 'Overrides $VISUAL and $EDITOR. Empty falls back to them.',
      fallback: '',
      fromConfig: (config) => config.externalEditor?.command,
      id: 'externalEditor.command',
      kind: 'text',
      label: 'Command',
      placeholder: '$VISUAL / $EDITOR',
      storage: 'settings',
    },
    {
      apply: (value) => {
        setExternalEditorConfig({
          ...getExternalEditorConfig(),
          kind: value === 'gui' || value === 'tui' ? value : undefined,
        })
      },
      description:
        'gui spawns detached, tui hands over the terminal. auto decides from the command.',
      fallback: AUTO,
      fromConfig: (config) => config.externalEditor?.kind,
      id: 'externalEditor.kind',
      kind: 'select',
      label: 'Window',
      options: [
        { label: AUTO, value: AUTO },
        { label: 'gui', value: 'gui' },
        { label: 'tui', value: 'tui' },
      ],
      storage: 'settings',
    },
  ],
}
