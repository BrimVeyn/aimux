import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

import { result } from './shared'

function findActiveTab(ctx: ModeContext) {
  return ctx.state.tabs.find((tab) => tab.id === ctx.state.activeTabId)
}

function isPlainD(key: KeyInput): boolean {
  return key.name === 'd' && !key.ctrl && !key.shift && !key.meta
}

let awaitingSecondD = false

export const navigationMode: ModeHandler = {
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (awaitingSecondD) {
      awaitingSecondD = false
      if (isPlainD(key)) {
        const tabId = ctx.state.activeTabId
        if (tabId) {
          return result([{ type: 'close-active-tab' }], [{ tabId, type: 'close-tab' }])
        }
        return null
      }
      // fall through so the second key gets its normal handling
    }

    if (key.ctrl && key.name === 'c') {
      return result([], [{ state: ctx.state, type: 'quit' }])
    }

    if (key.ctrl && key.name === 'n') {
      return result([{ type: 'open-new-tab-modal' }], [], 'modal.new-tab')
    }

    if (key.ctrl && key.name === 'g') {
      return result([{ type: 'open-session-picker' }], [], 'modal.session-picker')
    }

    if (key.ctrl && key.name === 'z') {
      if (!ctx.state.sidebar.visible) {
        return result([{ type: 'toggle-sidebar' }])
      }
      return result([])
    }

    if (isPlainD(key)) {
      awaitingSecondD = true
      return result([])
    }

    if (key.ctrl && key.name === 'b') {
      return result([{ type: 'toggle-sidebar' }])
    }

    if (key.ctrl && key.name === 'r') {
      const activeTab = findActiveTab(ctx)
      if (activeTab) {
        return result([], [{ tab: activeTab, type: 'restart-tab' }])
      }

      return null
    }

    if (key.ctrl && key.name === 's') {
      return result([{ type: 'open-snippet-picker' }], [], 'modal.snippet-picker')
    }

    if (key.ctrl && key.name === 't') {
      return result(
        [{ type: 'open-theme-picker' }],
        [{ action: 'open', type: 'apply-theme' }],
        'modal.theme-picker'
      )
    }

    if (key.ctrl && key.name === 'h') {
      return result([{ delta: -2, type: 'resize-sidebar' }])
    }

    if (key.ctrl && key.name === 'l') {
      return result([{ delta: 2, type: 'resize-sidebar' }])
    }

    if (key.shift && key.name === 'g') {
      return result([{ type: 'toggle-git-panel' }])
    }

    if (key.ctrl && key.name === 'd') {
      return result([{ type: 'enter-git-mode' }], [], 'git-mode')
    }

    if (key.ctrl && key.name === 'j') {
      return result([{ delta: -0.05, type: 'resize-git-panel' }])
    }

    if (key.ctrl && key.name === 'k') {
      return result([{ delta: 0.05, type: 'resize-git-panel' }])
    }

    if (key.shift && key.name === 'j') {
      return result([{ delta: 1, type: 'reorder-active-tab' }])
    }

    if (key.name === 'j') {
      return result([{ delta: 1, type: 'move-active-tab' }])
    }

    if (key.shift && key.name === 'k') {
      return result([{ delta: -1, type: 'reorder-active-tab' }])
    }

    if (key.name === 'k') {
      return result([{ delta: -1, type: 'move-active-tab' }])
    }

    if (key.name === 'r') {
      return result([{ type: 'open-rename-tab-modal' }], [], 'modal.rename-tab')
    }

    if (key.name === 'i') {
      if (ctx.state.activeTabId) {
        return result(
          [{ focusMode: 'terminal-input', type: 'set-focus-mode' }],
          [],
          'terminal-input'
        )
      }

      return null
    }

    if (key.sequence === '?') {
      return result([{ type: 'open-help-modal' }], [], 'modal.help')
    }

    return null
  },

  id: 'navigation',
}
