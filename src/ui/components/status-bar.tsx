import type { AppState, TabSession } from '../../state/types'

import { getStatusBarModel } from '../status-bar-model'
import { theme } from '../theme'

interface StatusBarProps {
  state: AppState
  activeTab?: TabSession
}

function getModeBorderColor(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return theme.accent
    case 'modal':
      return theme.warning
    case 'navigation':
    default:
      return theme.accentAlt
  }
}

export function StatusBar({ state, activeTab }: StatusBarProps) {
  const model = getStatusBarModel(state, activeTab)

  return (
    <box
      minHeight={4}
      border
      borderColor={getModeBorderColor(state.focusMode)}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      backgroundColor={theme.panel}
    >
      <box width="100%">
        <text fg={theme.text}>{model.left}</text>
      </box>
      <box width="100%">
        <text fg={theme.textMuted}>{model.right}</text>
      </box>
    </box>
  )
}
