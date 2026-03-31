import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalSnippetPickerFilterMode: ModeHandler = {
  id: 'modal.snippet-picker.filtering',

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

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },
}
