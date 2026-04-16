import type { AppState, TabSession } from '../state/types'

import { abbreviatePath } from './path-format'

export interface StatusBarModel {
  left: string
  right: string
}

const MAX_TAB_LABEL_LENGTH = 24

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

function getNavigationHint(activeTab?: TabSession): string {
  if (!activeTab) {
    return 'Ctrl+g sessions  Ctrl+n new  Ctrl+b toggle  Ctrl+h/l resize  ? help'
  }

  if (activeTab.status === 'disconnected') {
    return 'Ctrl+r restart restored tab  Ctrl+w close  i focus'
  }

  return 'Ctrl+g sessions  j/k move  Shift+J/K reorder  Ctrl+r restart  Ctrl+w close  i focus  ? help'
}

function getInputHint(activeTab?: TabSession): string {
  if (!activeTab) {
    return 'Ctrl+n new  no active tab to focus'
  }

  if (activeTab.status === 'disconnected') {
    return 'Ctrl+z unfocus  Ctrl+w layout  Ctrl+r restart'
  }

  return 'Ctrl+z unfocus  Ctrl+w layout  typing goes to active tab'
}

function getGitHint(modalType: AppState['modal']['type']): string {
  if (modalType === 'git-commit') {
    return 'Tab switch field  Enter newline  Ctrl+Enter commit  Esc cancel'
  }

  return 'j/k file  Ctrl+d/u page  a stage  d unstage/delete  c commit  p push  Esc exit'
}

export function getStatusBarModel(state: AppState, activeTab?: TabSession): StatusBarModel {
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
        right: getInputHint(activeTab),
      }
    case 'modal':
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: 'j/k move  Enter confirm  n/r/d actions  Esc cancel',
      }
    case 'layout':
      return {
        left: `${getActiveTabLabel(activeTab)}  ${sessionIcon}  ${sessionLabel}`,
        right: 'h/j/k/l focus  |/- split  H/L resize  q close  Esc cancel',
      }
    case 'git':
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: getGitHint(state.modal.type),
      }
    case 'command-edit':
      return {
        left: `${sessionIcon}  ${sessionLabel}`,
        right: state.modal.type === 'git-commit' ? getGitHint('git-commit') : 'Esc cancel',
      }
    case 'navigation':
    default:
      return {
        left: `${sessionIcon}  ${sessionLabel}  ${getActiveTabLabel(activeTab)}`,
        right: getNavigationHint(activeTab),
      }
  }
}
