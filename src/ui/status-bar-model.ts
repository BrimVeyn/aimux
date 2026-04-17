import type { ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import type { AppState, TabSession } from '../state/types'

import { buildHintText } from './keymap-context'
import { abbreviatePath } from './path-format'

export interface StatusBarModel {
  left: string
  right: string
}

const MAX_TAB_LABEL_LENGTH = 24
const HINT_LIMIT = 6

function truncateLabel(label: string): string {
  if (label.length <= MAX_TAB_LABEL_LENGTH) {
    return label
  }

  return `${label.slice(0, MAX_TAB_LABEL_LENGTH - 3)}...`
}

function getActiveTabLabel(tab?: TabSession): string {
  if (!tab) {
    return 'no tab'
  }

  return `${truncateLabel(tab.title)} (${tab.status})`
}

function hintForMode(config: ResolvedKeymapConfig, modeId: ModeId): string {
  return buildHintText(config, modeId, HINT_LIMIT)
}

export function getStatusBarModel(
  state: AppState,
  activeTab: TabSession | undefined,
  config: ResolvedKeymapConfig
): StatusBarModel {
  const currentSession = state.currentSessionId
    ? state.sessions.find((session) => session.id === state.currentSessionId)
    : undefined
  const sessionName = currentSession?.name ?? 'no session'
  const sessionLabel = currentSession?.projectPath
    ? `${sessionName} (${abbreviatePath(currentSession.projectPath)})`
    : sessionName

  // \u{f0b1} = nf-fa-briefcase (session icon)
  const sessionIcon = '\u{f0b1}'

  switch (state.focusMode) {
    case 'terminal-input':
      return {
        left: `${getActiveTabLabel(activeTab)}  ${sessionIcon}  ${sessionLabel}`,
        right: hintForMode(config, 'terminal-input'),
      }
    case 'modal': {
      const modalMode = deriveModalModeId(state.modal.type)
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: modalMode ? hintForMode(config, modalMode) : '',
      }
    }
    case 'layout':
      return {
        left: `${getActiveTabLabel(activeTab)}  ${sessionIcon}  ${sessionLabel}`,
        right: hintForMode(config, 'layout'),
      }
    case 'git':
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: hintForMode(config, 'git-mode'),
      }
    case 'command-edit': {
      const commandEditMode = deriveCommandEditModeId(state.modal.type)
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: commandEditMode ? hintForMode(config, commandEditMode) : '',
      }
    }
    case 'navigation':
    default:
      return {
        left: `${sessionIcon}  ${sessionLabel}  ${getActiveTabLabel(activeTab)}`,
        right: hintForMode(config, 'navigation'),
      }
  }
}

function deriveModalModeId(modalType: AppState['modal']['type']): ModeId | null {
  switch (modalType) {
    case 'help':
      return 'modal.help'
    case 'new-tab':
      return 'modal.new-tab'
    case 'session-picker':
      return 'modal.session-picker'
    case 'snippet-picker':
      return 'modal.snippet-picker'
    case 'split-picker':
      return 'modal.split-picker'
    case 'theme-picker':
      return 'modal.theme-picker'
    case 'update-available':
      return 'modal.update-available'
    default:
      return null
  }
}

function deriveCommandEditModeId(modalType: AppState['modal']['type']): ModeId | null {
  switch (modalType) {
    case 'create-session':
      return 'modal.create-session'
    case 'git-commit':
      return 'modal.git-commit'
    case 'new-tab':
      return 'modal.new-tab.command-edit'
    case 'rename-tab':
      return 'modal.rename-tab'
    case 'session-name':
      return 'modal.session-name'
    case 'session-picker':
      return 'modal.session-picker.filtering'
    case 'snippet-editor':
      return 'modal.snippet-editor'
    case 'snippet-picker':
      return 'modal.snippet-picker.filtering'
    default:
      return null
  }
}
