import type { AppState } from '../../state/types'

import { version as APP_VERSION } from '../../../package.json'
import { useAppStore } from '../../state/app-store'
import { useKeymap } from '../keymap-context'
import { getStatusBarModel } from '../status-bar-model'
import { theme } from '../theme'

function getModeColor(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return theme.accent
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
  const config = useKeymap()
  const model = getStatusBarModel(state, activeTab, config)

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
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{model.right}</text>
        <box flexDirection="row" gap={2}>
          {model.help ? <text fg={theme.textMuted}>{model.help}</text> : null}
          <text fg={theme.dim}>v{APP_VERSION}</text>
        </box>
      </box>
    </box>
  )
}
