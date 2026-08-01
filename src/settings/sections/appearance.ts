import { setStatusBarSeparator, type StatusBarSeparator } from '@brimveyn/aimux-config'

import type { SettingSection } from '../types'

import { runSideEffectGlobal } from '../../state/dispatch-ref'
import { getCurrentMode, getCurrentThemeId, getTransparent } from '../../ui/theme'

const SEPARATORS: { value: StatusBarSeparator; label: string }[] = [
  { label: 'arrow', value: 'arrow' },
  { label: 'round', value: 'round' },
  { label: 'slant', value: 'slant' },
  { label: 'flame', value: 'flame' },
  { label: 'none', value: 'none' },
]

/**
 * The theme lives in its own store, not in `AppState`. Rows over it read it
 * directly and write through the side effects that already apply it live and
 * persist it — every row on this screen calls `useTheme`, so a theme change
 * re-renders them all and these reads never go stale.
 */
export const APPEARANCE_SECTION: SettingSection = {
  id: 'appearance',
  label: 'Appearance',
  rows: [
    {
      // Not editable here on purpose: the theme picker filters 30-odd themes as
      // you type and previews each one, which no amount of stepping through a
      // list on this screen would improve on.
      description: 'Pick one with the theme picker (Ctrl+T).',
      id: 'appearance.theme',
      kind: 'info',
      label: 'Theme',
      value: () => getCurrentThemeId(),
    },
    {
      id: 'appearance.mode',
      kind: 'select',
      label: 'Mode',
      options: [
        { label: 'dark', value: 'dark' },
        { label: 'light', value: 'light' },
      ],
      read: () => getCurrentMode(),
      storage: 'app',
      // Flips rather than sets, which is safe because `writeRow` never hands a
      // row the value it already has.
      write: () => runSideEffectGlobal({ type: 'toggle-mode' }),
    },
    {
      description: "Let the host terminal's own background show through.",
      id: 'appearance.transparent',
      kind: 'toggle',
      label: 'Transparent background',
      read: () => getTransparent(),
      storage: 'app',
      write: () => runSideEffectGlobal({ type: 'toggle-transparent' }),
    },
    {
      apply: (value) => setStatusBarSeparator(value as StatusBarSeparator),
      description: 'Glyph between status bar sections. All but "none" need a nerd font.',
      fallback: 'arrow',
      fromConfig: (config) => config.statusBar?.separator,
      id: 'statusBar.separator',
      kind: 'select',
      label: 'Status bar separator',
      options: SEPARATORS,
      storage: 'settings',
    },
  ],
}
