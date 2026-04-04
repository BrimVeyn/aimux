import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleTextInput } from './shared'

export const modalRenameTabMode: ModeHandler = {
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [],
        transition: 'navigation',
      }
    }

    if (key.name === 'return') {
      const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
      const tabId = ctx.state.modal.sessionTargetId
      const actions: KeyResult['actions'] = []
      if (trimmed && tabId) {
        actions.push({ tabId, title: trimmed, type: 'rename-tab' })
      }
      actions.push({ type: 'close-modal' })
      return { actions, effects: [], transition: 'navigation' }
    }

    return handleTextInput(key)
  },

  id: 'modal.rename-tab',
}
