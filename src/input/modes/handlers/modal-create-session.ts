import type { ModalCreateSession } from '../../../state/types'
import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { handleCtrlNavigation, handleTextInput } from './shared'

export const modalCreateSessionMode: ModeHandler = {
  id: 'modal.create-session',

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    const modal = ctx.state.modal as ModalCreateSession

    if (key.name === 'escape') {
      return {
        actions: [{ type: 'open-session-picker' }],
        effects: [],
        transition: 'modal.session-picker',
      }
    }

    if (key.name === 'tab') {
      return { actions: [{ type: 'switch-create-session-field' }], effects: [] }
    }

    if (key.name === 'return') {
      if (modal.activeField === 'directory') {
        return { actions: [{ type: 'select-directory' }], effects: [] }
      }
      const trimmed = (modal.editBuffer ?? '').trim()
      const projectPath = modal.pendingProjectPath ?? undefined
      const sessionName = trimmed || (projectPath ? projectPath.split('/').pop()! : '')
      if (sessionName) {
        return {
          actions: [{ type: 'close-modal' }],
          effects: [{ type: 'create-session', name: sessionName, projectPath }],
          transition: 'navigation',
        }
      }
      return {
        actions: [{ type: 'close-modal' }],
        effects: [],
        transition: 'navigation',
      }
    }

    return handleCtrlNavigation(key) ?? handleTextInput(key)
  },
}
