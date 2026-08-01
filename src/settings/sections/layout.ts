import type { SettingSection } from '../types'

import { dispatchGlobal } from '../../state/dispatch-ref'

/**
 * Bars and their widths. Every row here is a view over something `AppState`
 * already owns, so each one dispatches the action its keybinding dispatches —
 * which is also what gets the value persisted on the next autosave. The toggles
 * flip rather than set, which is safe because `writeRow` never hands a row the
 * value it already has.
 */
export const LAYOUT_SECTION: SettingSection = {
  id: 'layout',
  label: 'Layout',
  rows: [
    {
      description: 'The tab strip above the terminal.',
      id: 'layout.projectBar',
      kind: 'toggle',
      label: 'Tab bar',
      read: (ctx) => ctx.state.projectBar.visible,
      storage: 'app',
      write: () => dispatchGlobal({ type: 'toggle-project-bar' }),
    },
    {
      id: 'layout.leftBar',
      kind: 'toggle',
      label: 'Left bar',
      read: (ctx) => ctx.state.bars.left.visible,
      storage: 'app',
      write: () => dispatchGlobal({ side: 'left', type: 'toggle-bar' }),
    },
    {
      description: 'Columns. Clamped to what the terminal can spare.',
      id: 'layout.leftBarWidth',
      kind: 'number',
      label: 'Left bar width',
      max: 80,
      min: 10,
      read: (ctx) => ctx.state.bars.left.width,
      step: 2,
      storage: 'app',
      write: (value) => {
        if (typeof value !== 'number') return
        dispatchGlobal({ side: 'left', type: 'set-bar-width', width: value })
      },
    },
    {
      id: 'layout.rightBar',
      kind: 'toggle',
      label: 'Right bar',
      read: (ctx) => ctx.state.bars.right.visible,
      storage: 'app',
      write: () => dispatchGlobal({ side: 'right', type: 'toggle-bar' }),
    },
    {
      description: 'Columns. Clamped to what the terminal can spare.',
      id: 'layout.rightBarWidth',
      kind: 'number',
      label: 'Right bar width',
      max: 80,
      min: 10,
      read: (ctx) => ctx.state.bars.right.width,
      step: 2,
      storage: 'app',
      write: (value) => {
        if (typeof value !== 'number') return
        dispatchGlobal({ side: 'right', type: 'set-bar-width', width: value })
      },
    },
  ],
}
