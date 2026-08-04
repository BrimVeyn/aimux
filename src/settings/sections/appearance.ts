import type { SettingSection } from '../types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { getCurrentMode, getCurrentThemeId, getTransparent } from '../../ui/theme'

/**
 * The theme lives in its own store, not in `AppState`. Rows over it read it
 * directly and write through the side effects that already apply it live and
 * persist it — every row on this screen calls `useTheme`, so a theme change
 * re-renders them all and these reads never go stale.
 */
export const APPEARANCE_SECTION: SettingSection = {
  glyph: '\u{25D1}',
  id: 'appearance',
  label: 'Appearance',
  rows: [
    {
      // Hands over to the picker rather than being a list of 30-odd options on
      // this screen: it filters as you type and previews each theme as you move.
      // It comes back here when it closes, which is what `returnTo` is for.
      description: 'Filters as you type, and previews as you move.',
      id: 'appearance.theme',
      kind: 'action',
      label: 'Theme',
      run: () => {
        dispatchGlobal({ returnTo: 'settings', type: 'open-theme-picker' })
        runSideEffectGlobal({ action: 'open', type: 'apply-theme' })
      },
      value: () => `${getCurrentThemeId()} ›`,
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
  ],
}
