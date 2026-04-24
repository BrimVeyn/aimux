import type { AppState } from '../../../state/types'

import { version as APP_VERSION } from '../../../../package.json'
import { useAppStore } from '../../../state/app-store'
import { useKeymap } from '../../keymap-context'
import { getStatusBarModel } from '../../status-bar-model'
import { getCurrentResolved, useTheme } from '../../theme'
import { AIUsageIndicator } from '../overlays/ai-usage/ai-usage-indicator'

function getModeColor(focusMode: AppState['focusMode']): string {
  const t = getCurrentResolved()
  switch (focusMode) {
    case 'terminal-input':
      return t['text-interactive-base']
    case 'modal':
    case 'command-edit':
      return t['icon-warning-base']
    case 'git':
      return t['icon-success-base']
    case 'navigation':
    default:
      return t['text-strong']
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
  const t = useTheme()
  const headerBg = t['background-stronger']
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
        <text fg={t['text-base']}>{model.left}</text>
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={t['text-weak']}>{model.right}</text>
        <box flexDirection="row" gap={2}>
          {model.help ? <text fg={t['text-weak']}>{model.help}</text> : null}
          <AIUsageIndicator />
          <text fg={t['text-weaker']}>v{APP_VERSION}</text>
        </box>
      </box>
    </box>
  )
}
