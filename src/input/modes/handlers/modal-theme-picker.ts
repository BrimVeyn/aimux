import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalThemePickerMode: ModeHandler = {
  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ action: 'restore', type: 'apply-theme' }],
        transition: 'navigation',
      }
    }

    if (key.name === 'j' || key.name === 'down') {
      return {
        actions: [{ delta: 1, type: 'move-modal-selection' }],
        effects: [{ action: 'preview', delta: 1, type: 'apply-theme' }],
      }
    }

    if (key.name === 'k' || key.name === 'up') {
      return {
        actions: [{ delta: -1, type: 'move-modal-selection' }],
        effects: [{ action: 'preview', delta: -1, type: 'apply-theme' }],
      }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ action: 'confirm', type: 'apply-theme' }],
        transition: 'navigation',
      }
    }

    return null
  },

  id: 'modal.theme-picker',
}
