import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const modalSnippetPickerMode: ModeHandler = {
  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === 'escape') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [],
        transition: 'navigation',
      }
    }

    if (key.name === 'j' || key.name === 'down') {
      return { actions: [{ delta: 1, type: 'move-modal-selection' }], effects: [] }
    }

    if (key.name === 'k' || key.name === 'up') {
      return { actions: [{ delta: -1, type: 'move-modal-selection' }], effects: [] }
    }

    if (key.name === 'return') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'paste-selected-snippet' }],
        transition: 'navigation',
      }
    }

    if (key.name === 'a') {
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ type: 'paste-snippet-to-group' }],
        transition: 'navigation',
      }
    }

    if (key.name === 'n') {
      return {
        actions: [{ type: 'open-snippet-editor' }],
        effects: [],
        transition: 'modal.snippet-editor',
      }
    }

    if (key.name === 'r' || key.name === 'e') {
      return {
        actions: [],
        effects: [{ type: 'edit-selected-snippet' }],
      }
    }

    if (key.name === 'd') {
      return {
        actions: [],
        effects: [{ type: 'delete-selected-snippet' }],
      }
    }

    if (key.sequence === '/') {
      return {
        actions: [{ type: 'begin-snippet-filter' }],
        effects: [],
        transition: 'modal.snippet-picker.filtering',
      }
    }

    return null
  },

  id: 'modal.snippet-picker',
}
