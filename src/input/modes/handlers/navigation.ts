import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const navigationMode: ModeHandler = {
  id: 'navigation',

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.ctrl && key.name === 'c') {
      return {
        actions: [],
        effects: [{ type: 'quit', state: ctx.state }],
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
          effects: [{ type: 'close-tab', tabId }],
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
          effects: [{ type: 'restart-tab', tab: activeTab }],
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
        effects: [{ type: 'apply-theme', action: 'open' }],
        transition: 'modal.theme-picker',
      }
    }

    if (key.ctrl && key.name === 'h') {
      return { actions: [{ type: 'resize-sidebar', delta: -2 }], effects: [] }
    }

    if (key.ctrl && key.name === 'l') {
      return { actions: [{ type: 'resize-sidebar', delta: 2 }], effects: [] }
    }

    if (key.shift && key.name === 'j') {
      return { actions: [{ type: 'reorder-active-tab', delta: 1 }], effects: [] }
    }

    if (key.name === 'j') {
      return { actions: [{ type: 'move-active-tab', delta: 1 }], effects: [] }
    }

    if (key.shift && key.name === 'k') {
      return { actions: [{ type: 'reorder-active-tab', delta: -1 }], effects: [] }
    }

    if (key.name === 'k') {
      return { actions: [{ type: 'move-active-tab', delta: -1 }], effects: [] }
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
          actions: [{ type: 'set-focus-mode', focusMode: 'terminal-input' }],
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
}
