import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalThemePickerMode: ModeHandler = {
  id: 'modal.theme-picker',

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'apply-theme', action: 'restore' }],
        transition: 'navigation',
      }
    }

    if (key.name === 'j' || key.name === 'down') {
      return {
        actions: [{ type: 'move-modal-selection', delta: 1 }],
        effects: [{ type: 'apply-theme', action: 'preview', delta: 1 }],
      }
    }

    if (key.name === 'k' || key.name === 'up') {
      return {
        actions: [{ type: 'move-modal-selection', delta: -1 }],
        effects: [{ type: 'apply-theme', action: 'preview', delta: -1 }],
      }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'apply-theme', action: 'confirm' }],
        transition: 'navigation',
      }
    }

    return null
  },
}
