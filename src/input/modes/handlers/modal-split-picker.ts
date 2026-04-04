import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalSplitPickerMode: ModeHandler = {
  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [],
        transition: 'navigation',
      }
    }

    if (key.name === 'j' || key.name === 'down') {
      return { actions: [{ delta: 1, type: 'move-modal-selection' }], effects: [] }
    }

    if (key.name === 'k' || key.name === 'up') {
      return { actions: [{ delta: -1, type: 'move-modal-selection' }], effects: [] }
    }

    if (key.name === 'return') {
      return {
        actions: [],
        effects: [{ type: 'confirm-split' }],
      }
    }

    return null
  },

  id: 'modal.split-picker',
}
