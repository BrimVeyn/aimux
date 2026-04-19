import type { AppState } from '../../state/types'

import { version as APP_VERSION } from '../../../package.json'
import { useAppStore } from '../../state/app-store'
import { useKeymap } from '../keymap-context'
import { getStatusBarModel } from '../status-bar-model'
import { getCurrentTheme, useBg, useTheme } from '../theme'

function getModeColor(focusMode: AppState['focusMode']): string {
  const t = getCurrentTheme()
  switch (focusMode) {
    case 'terminal-input':
      return t.colors['textLink.foreground']
    case 'modal':
      return t.colors['editorWarning.foreground']
    case 'command-edit':
      return t.colors['editorWarning.foreground']
    case 'git':
      return t.colors['gitDecoration.addedResourceForeground']
    case 'navigation':
    default:
      return t.colors['terminal.ansiMagenta']
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
  const theme = useTheme()
  const headerBg = useBg('sideBarSectionHeader.background')
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
      backgroundColor={headerBg}
    >
      <box width="100%" flexDirection="row">
        <text fg={getModeColor(state.focusMode)}>[{getModeLabel(state.focusMode)}]</text>
        <text> </text>
        <text fg={theme.colors['editor.foreground']}>{model.left}</text>
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors['descriptionForeground']}>{model.right}</text>
        <box flexDirection="row" gap={2}>
          {model.help ? <text fg={theme.colors['descriptionForeground']}>{model.help}</text> : null}
          <text fg={theme.colors['editor.lineHighlightBackground']}>v{APP_VERSION}</text>
        </box>
      </box>
    </box>
  )
}
