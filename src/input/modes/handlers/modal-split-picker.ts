import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalSplitPickerMode: ModeHandler = {
  id: 'modal.split-picker',

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [],
        transition: 'navigation',
      }
    }

    if (key.name === 'j' || key.name === 'down') {
      return { actions: [{ type: 'move-modal-selection', delta: 1 }], effects: [] }
    }

    if (key.name === 'k' || key.name === 'up') {
      return { actions: [{ type: 'move-modal-selection', delta: -1 }], effects: [] }
    }

    if (key.name === 'return') {
      return {
        actions: [],
        effects: [{ type: 'confirm-split' }],
      }
    }

    return null
  },
}
