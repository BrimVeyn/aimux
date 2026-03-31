import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleTextInput } from './shared'

export const modalSessionNameMode: ModeHandler = {
  id: 'modal.session-name',

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'open-session-picker' }],
        effects: [],
        transition: 'modal.session-picker',
      }
    }

    if (key.name === 'return') {
      const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
      const sessionId = ctx.state.modal.sessionTargetId
      if (trimmed && sessionId) {
        return {
          actions: [{ type: 'open-session-picker' }],
          effects: [{ type: 'rename-session', sessionId, name: trimmed }],
          transition: 'modal.session-picker',
        }
      }
      return {
        actions: [{ type: 'open-session-picker' }],
        effects: [],
        transition: 'modal.session-picker',
      }
    }

    return handleTextInput(key)
  },
}
