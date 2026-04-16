import type { AppState } from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { getStatusBarModel } from '../status-bar-model'
import { theme } from '../theme'

function getModeColor(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return theme.accent
    case 'layout':
      return theme.warning
    case 'modal':
      return theme.warning
    case 'command-edit':
      return theme.warning
    case 'git':
      return theme.success
    case 'navigation':
    default:
      return theme.accentAlt
  }
}

function getModeLabel(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return 'input'
    case 'layout':
      return 'layout'
    case 'modal':
      return 'modal'
    case 'command-edit':
      return 'edit'
    case 'git':
      return 'git'
    case 'navigation':
    default:
      return 'nav'
  }
}

export function StatusBar() {
  const state = useAppStore((s) => s)
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  const model = getStatusBarModel(state, activeTab)

  return (
    <box
      minHeight={2}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      backgroundColor={theme.panelMuted}
    >
      <box width="100%" flexDirection="row">
        <text fg={getModeColor(state.focusMode)}>[{getModeLabel(state.focusMode)}]</text>
        <text> </text>
        <text fg={theme.text}>{model.left}</text>
      </box>
      <box width="100%">
        <text fg={theme.textMuted}>{model.right}</text>
      </box>
    </box>
  )
}
