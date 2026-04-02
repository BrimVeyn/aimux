import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

function exitToInput(): Pick<KeyResult, 'transition'> & { exitActions: KeyResult['actions'] } {
  return {
    exitActions: [{ type: 'set-focus-mode', focusMode: 'terminal-input' }],
    transition: 'terminal-input',
  }
}

export const layoutMode: ModeHandler = {
  id: 'layout',

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
          actions: [{ type: 'resize-pane', tabId, delta: -1, axis: 'vertical' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'l') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ type: 'resize-pane', tabId, delta: 1, axis: 'vertical' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'k') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ type: 'resize-pane', tabId, delta: -1, axis: 'horizontal' }],
          effects: [],
        }
      }
    }
    if (key.shift && key.name === 'j') {
      const tabId = ctx.state.activeTabId
      if (tabId) {
        return {
          actions: [{ type: 'resize-pane', tabId, delta: 1, axis: 'horizontal' }],
          effects: [],
        }
      }
    }

    // Pane navigation: h/j/k/l (must be after shift checks)
    if (key.name === 'h') {
      const exit = exitToInput()
      return {
        actions: [{ type: 'focus-pane-direction', direction: 'left' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'j') {
      const exit = exitToInput()
      return {
        actions: [{ type: 'focus-pane-direction', direction: 'down' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'k') {
      const exit = exitToInput()
      return {
        actions: [{ type: 'focus-pane-direction', direction: 'up' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }
    if (key.name === 'l') {
      const exit = exitToInput()
      return {
        actions: [{ type: 'focus-pane-direction', direction: 'right' }, ...exit.exitActions],
        effects: [],
        transition: exit.transition,
      }
    }

    // Split: | vertical, - horizontal → open picker modal
    if (key.sequence === '|') {
      return {
        actions: [{ type: 'open-split-picker', direction: 'vertical' }],
        effects: [],
        transition: 'modal.split-picker',
      }
    }
    if (key.sequence === '-') {
      return {
        actions: [{ type: 'open-split-picker', direction: 'horizontal' }],
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
          actions: [{ type: 'close-pane', tabId }, ...exit.exitActions],
          effects: [{ type: 'close-tab', tabId }],
          transition: exit.transition,
        }
      }
    }

    return null
  },
}
