import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalNewTabCommandEditMode: ModeHandler = {
  id: 'modal.new-tab.command-edit',

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'cancel-command-edit' }],
        effects: [],
        transition: 'modal.new-tab',
      }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'commit-command-edit' }],
        effects: [{ type: 'save-custom-command' }],
        transition: 'modal.new-tab',
      }
    }

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },
}
