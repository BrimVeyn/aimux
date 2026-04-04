import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalSnippetPickerFilterMode: ModeHandler = {
  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'cancel-command-edit' }],
        effects: [],
        transition: 'modal.snippet-picker',
      }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'paste-selected-snippet' }],
        transition: 'navigation',
      }
    }

    if (key.ctrl && key.name === 'a') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'paste-snippet-to-group' }],
        transition: 'navigation',
      }
    }

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },

  id: 'modal.snippet-picker.filtering',
}
