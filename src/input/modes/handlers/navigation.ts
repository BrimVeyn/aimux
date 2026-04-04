import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const navigationMode: ModeHandler = {
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.ctrl && key.name === 'c') {
      return {
        actions: [],
        effects: [{ state: ctx.state, type: 'quit' }],
      }
    }

    if (key.ctrl && key.name === 'n') {
      return {
        actions: [{ type: 'open-new-tab-modal' }],
        effects: [],
        transition: 'modal.new-tab',
      }
    }

    if (key.ctrl && key.name === 'g') {
      return {
        actions: [{ type: 'open-session-picker' }],
        effects: [],
        transition: 'modal.session-picker',
      }
    }

    if (key.ctrl && key.name === 'w') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ type: 'close-active-tab' }],
          effects: [{ tabId, type: 'close-tab' }],
        }
      }
      return null
    }

    if (key.ctrl && key.name === 'b') {
      return { actions: [{ type: 'toggle-sidebar' }], effects: [] }
    }

    if (key.ctrl && key.name === 'r') {
      const activeTab = ctx.state.tabs.find((t) => t.id === ctx.state.activeTabId)
      if (activeTab) {
        return {
          actions: [],
          effects: [{ tab: activeTab, type: 'restart-tab' }],
        }
      }
      return null
    }

    if (key.ctrl && key.name === 's') {
      return {
        actions: [{ type: 'open-snippet-picker' }],
        effects: [],
        transition: 'modal.snippet-picker',
      }
    }

    if (key.ctrl && key.name === 't') {
      return {
        actions: [{ type: 'open-theme-picker' }],
        effects: [{ action: 'open', type: 'apply-theme' }],
        transition: 'modal.theme-picker',
      }
    }

    if (key.ctrl && key.name === 'h') {
      return { actions: [{ delta: -2, type: 'resize-sidebar' }], effects: [] }
    }

    if (key.ctrl && key.name === 'l') {
      return { actions: [{ delta: 2, type: 'resize-sidebar' }], effects: [] }
    }

    if (key.shift && key.name === 'j') {
      return { actions: [{ delta: 1, type: 'reorder-active-tab' }], effects: [] }
    }

    if (key.name === 'j') {
      return { actions: [{ delta: 1, type: 'move-active-tab' }], effects: [] }
    }

    if (key.shift && key.name === 'k') {
      return { actions: [{ delta: -1, type: 'reorder-active-tab' }], effects: [] }
    }

    if (key.name === 'k') {
      return { actions: [{ delta: -1, type: 'move-active-tab' }], effects: [] }
    }

    if (key.name === 'r') {
      return {
        actions: [{ type: 'open-rename-tab-modal' }],
        effects: [],
        transition: 'modal.rename-tab',
      }
    }

    if (key.name === 'i') {
      if (ctx.state.activeTabId) {
        return {
          actions: [{ focusMode: 'terminal-input', type: 'set-focus-mode' }],
          effects: [],
          transition: 'terminal-input',
        }
      }
      return null
    }

    if (key.sequence === '?') {
      return {
        actions: [{ type: 'open-help-modal' }],
        effects: [],
        transition: 'modal.help',
      }
    }

    return null
  },

  id: 'navigation',
}
