import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalSnippetEditorMode: ModeHandler = {
  id: 'modal.snippet-editor',

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'open-snippet-picker' }],
        effects: [],
        transition: 'modal.snippet-picker',
      }
    }

    if (key.name === 'tab') {
      return { actions: [{ type: 'switch-create-session-field' }], effects: [] }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'save-snippet-editor' }],
        transition: 'navigation',
      }
    }

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },
}
