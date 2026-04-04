import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalSessionPickerFilterMode: ModeHandler = {
  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'cancel-command-edit' }],
        effects: [],
        transition: 'modal.session-picker',
      }
    }

    if (key.name === 'return') {
      return {
        actions: [],
        effects: [{ type: 'confirm-selected-session' }],
      }
    }

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },

  id: 'modal.session-picker.filtering',
}
