import type { AppAction, AppState } from '../types'

export function reduceUIState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'toggle-sidebar':
      return { ...state, sidebar: { ...state.sidebar, visible: !state.sidebar.visible } }
    case 'resize-sidebar': {
      const width = Math.min(
        state.sidebar.maxWidth,
        Math.max(state.sidebar.minWidth, state.sidebar.width + action.delta)
      )
      return { ...state, sidebar: { ...state.sidebar, width } }
    }
    case 'set-focus-mode':
      return { ...state, focusMode: action.focusMode }
    case 'set-terminal-size':
      return { ...state, layout: { terminalCols: action.cols, terminalRows: action.rows } }
    default:
      return null
  }
}
