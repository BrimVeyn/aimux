import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalSessionPickerMode: ModeHandler = {
  id: 'modal.session-picker',

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      if (!ctx.state.currentSessionId) return null
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
        effects: [{ type: 'confirm-selected-session' }],
      }
    }

    if (key.name === 'n') {
      return {
        actions: [{ type: 'open-create-session-modal' }],
        effects: [],
        transition: 'modal.create-session',
      }
    }

    if (key.name === 'r') {
      return {
        actions: [],
        effects: [{ type: 'open-rename-selected-session' }],
      }
    }

    if (key.name === 'd') {
      return {
        actions: [],
        effects: [{ type: 'delete-selected-session' }],
      }
    }

    if (key.sequence === '/') {
      return {
        actions: [{ type: 'begin-session-filter' }],
        effects: [],
        transition: 'modal.session-picker.filtering',
      }
    }

    return null
  },
}
