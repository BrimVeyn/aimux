import type { ResolvedTuiTheme } from '@brimveyn/aimux-config'

import type { AppState } from '../../../state/types'

import { version as APP_VERSION } from '../../../../package.json'
import { useAppStore } from '../../../state/app-store'
import { useKeymap } from '../../keymap-context'
import { getStatusBarModel } from '../../status-bar-model'
import { useTheme } from '../../theme'
import { AIUsageIndicator } from '../overlays/ai-usage/ai-usage-indicator'

// Width of the mode badge block (` XXX `) — 3 letters + 1 space padding each side.
const BADGE_WIDTH = 5
// Breathing space between the badge and the identity segments.
const BADGE_GAP = 2
// Row 2 indents to align past the badge + gap.
const ROW2_INDENT = BADGE_WIDTH + BADGE_GAP

function getModeBadge(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return 'INP'
    case 'modal':
      return 'MOD'
    case 'command-edit':
      return 'EDT'
    case 'git':
      return 'GIT'
    case 'navigation':
    default:
      return 'NAV'
  }
}

function getModeColor(focusMode: AppState['focusMode'], t: ResolvedTuiTheme): string {
  switch (focusMode) {
    case 'terminal-input':
      return t.primary
    case 'modal':
    case 'command-edit':
      return t.warning
    case 'git':
      return t.success
    case 'navigation':
    default:
      return t.text
  }
}

function composeAmbient(right: string, help: string): string {
  if (right === '' && help === '') return ''
  if (right === '') return help
  if (help === '') return right
  return `${right}  ·  ${help}`
}

export function StatusBar() {
  const t = useTheme()
  const state = useAppStore((s) => s)
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  const config = useKeymap()
  const model = getStatusBarModel(state, activeTab, config)
  const modeColor = getModeColor(state.focusMode, t)
  const ambient = composeAmbient(model.right, model.help)

  return (
    <box
      height={2}
      flexShrink={0}
      overflow="hidden"
      flexDirection="column"
      backgroundColor={t.backgroundPanel}
    >
      {/* Row 1 — identity */}
      <box height={1} flexShrink={0} flexDirection="row" paddingRight={1} overflow="hidden">
        <box backgroundColor={modeColor} paddingLeft={1} paddingRight={1}>
          <text fg={t.background} selectable={false}>
            {getModeBadge(state.focusMode)}
          </text>
        </box>

        <text>{' '.repeat(BADGE_GAP)}</text>

        <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          {model.identity.map((seg) => (
            <text
              key={seg.id}
              fg={seg.tone === 'primary' ? t.text : t.textMuted}
              wrapMode="none"
              selectable={false}
            >
              {seg.text}
            </text>
          ))}
        </box>

        <box flexDirection="row" flexShrink={0} gap={2}>
          <AIUsageIndicator />
          <text fg={t.textMuted}>v{APP_VERSION}</text>
        </box>
      </box>

      {/* Row 2 — ambient hints */}
      <box
        height={1}
        flexShrink={0}
        flexDirection="row"
        paddingLeft={ROW2_INDENT}
        paddingRight={1}
        overflow="hidden"
      >
        {ambient !== '' ? (
          <text fg={t.textMuted} wrapMode="none" selectable={false}>
            {ambient}
          </text>
        ) : null}
      </box>
    </box>
  )
}
