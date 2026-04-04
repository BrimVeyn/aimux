import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

function exitToInput(): Pick<KeyResult, 'transition'> & { exitActions: KeyResult['actions'] } {
  return {
    exitActions: [{ focusMode: 'terminal-input', type: 'set-focus-mode' }],
    transition: 'terminal-input',
  }
}

export const layoutMode: ModeHandler = {
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    // Escape or Ctrl+W again → back to terminal-input
    if (key.name === 'escape' || (key.ctrl && key.name === 'w')) {
      const exit = exitToInput()
      return { actions: exit.exitActions, effects: [], transition: exit.transition }
    }

    // Resize: Shift+H/J/K/L — stays in layout mode for repeated adjustments
    if (key.shift && key.name === 'h') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ axis: 'vertical', delta: -1, tabId, type: 'resize-pane' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'l') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ axis: 'vertical', delta: 1, tabId, type: 'resize-pane' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'k') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ axis: 'horizontal', delta: -1, tabId, type: 'resize-pane' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'j') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ axis: 'horizontal', delta: 1, tabId, type: 'resize-pane' }],
          effects: [],
        }
      }
    }

    // Pane navigation: h/j/k/l (must be after shift checks)
    if (key.name === 'h') {
      const exit = exitToInput()
      return {
        actions: [{ direction: 'left', type: 'focus-pane-direction' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'j') {
      const exit = exitToInput()
      return {
        actions: [{ direction: 'down', type: 'focus-pane-direction' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'k') {
      const exit = exitToInput()
      return {
        actions: [{ direction: 'up', type: 'focus-pane-direction' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'l') {
      const exit = exitToInput()
      return {
        actions: [{ direction: 'right', type: 'focus-pane-direction' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }

    // Split: | vertical, - horizontal → open picker modal
    if (key.sequence === '|') {
      return {
        actions: [{ direction: 'vertical', type: 'open-split-picker' }],
        effects: [],
        transition: 'modal.split-picker',
      }
    }
    if (key.sequence === '-') {
      return {
        actions: [{ direction: 'horizontal', type: 'open-split-picker' }],
        effects: [],
        transition: 'modal.split-picker',
      }
    }

    // Close pane: q
    if (key.name === 'q') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        const exit = exitToInput()
        return {
          actions: [{ tabId, type: 'close-pane' }, ...exit.exitActions],
          effects: [{ tabId, type: 'close-tab' }],
          transition: exit.transition,
        }
      }
    }

    return null
  },

  id: 'layout',
}
