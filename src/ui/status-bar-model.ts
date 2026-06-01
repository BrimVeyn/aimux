import type { ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import type { AppState, TabSession } from '../state/types'

import { describeBindings } from '../input/keymap/describe-bindings'
import { getSessionProjectPath } from '../state/session-worktrees'
import { buildHintText } from './keymap-context'
import { abbreviatePath } from './path-format'

export interface IdentitySegment {
  id: string
  text: string
  tone: 'primary' | 'muted'
}

export interface StatusBarModel {
  identity: IdentitySegment[]
  right: string
  help: string
}

const MAX_TAB_LABEL_LENGTH = 24
const HINT_LIMIT = 6
const HELP_DESCRIPTION = 'Help'
const SEP = '  ·  '

function truncateLabel(label: string): string {
  if (label.length <= MAX_TAB_LABEL_LENGTH) {
    return label
  }

  return `${label.slice(0, MAX_TAB_LABEL_LENGTH - 3)}...`
}

function sessionSegments(
  sessionName: string,
  sessionPath: string | null | undefined
): IdentitySegment[] {
  const segs: IdentitySegment[] = [{ id: 'session', text: sessionName, tone: 'primary' }]
  if (sessionPath != null && sessionPath !== '') {
    segs.push({ id: 'sep-session-path', text: SEP, tone: 'muted' })
    segs.push({ id: 'path', text: abbreviatePath(sessionPath), tone: 'muted' })
  }
  return segs
}

function tabSegments(tab?: TabSession): IdentitySegment[] {
  if (!tab) {
    return [{ id: 'tab-empty', text: 'no tab', tone: 'muted' }]
  }
  return [{ id: 'tab-title', text: truncateLabel(tab.title), tone: 'primary' }]
}

const STAGING_DESCRIPTIONS = ['Stage', 'Unstage/delete', 'Commit', 'Push']

function hintForMode(config: ResolvedKeymapConfig, modeId: ModeId): string {
  return buildHintText(config, modeId, HINT_LIMIT, { excludeDescriptions: [HELP_DESCRIPTION] })
}

function hintForGitMode(config: ResolvedKeymapConfig, headOffset: number): string {
  const exclude = headOffset > 0 ? [HELP_DESCRIPTION, ...STAGING_DESCRIPTIONS] : [HELP_DESCRIPTION]
  return buildHintText(config, 'git-mode', HINT_LIMIT, { excludeDescriptions: exclude })
}

function helpHintForMode(config: ResolvedKeymapConfig, modeId: ModeId): string {
  const bindings = describeBindings(config, modeId, {
    dedupeByDescription: true,
    withDescriptionOnly: true,
  })
  const helpBinding = bindings.find((b) => b.description === HELP_DESCRIPTION)
  if (!helpBinding) return ''
  return `${helpBinding.keysDisplay} ${helpBinding.description ?? ''}`.trim()
}

export function getStatusBarModel(
  state: AppState,
  activeTab: TabSession | undefined,
  config: ResolvedKeymapConfig
): StatusBarModel {
  const currentSession =
    state.currentSessionId != null && state.currentSessionId !== ''
      ? state.sessions.find((session) => session.id === state.currentSessionId)
      : undefined
  const sessionName = currentSession?.name ?? 'no workspace'
  const sessionPath = getSessionProjectPath(currentSession)
  const sessionSegs = sessionSegments(sessionName, sessionPath)

  const withTab: IdentitySegment[] = [
    ...sessionSegs,
    { id: 'sep-session-tab', text: SEP, tone: 'muted' },
    ...tabSegments(activeTab),
  ]

  switch (state.focusMode) {
    case 'terminal-input':
      return {
        help: '',
        identity: withTab,
        right: hintForMode(config, 'terminal-input'),
      }
    case 'modal': {
      const modalMode = deriveModalModeId(state.modal.type)
      return {
        help: '',
        identity: sessionSegs,
        right: modalMode ? hintForMode(config, modalMode) : '',
      }
    }
    case 'git': {
      const headOffset = state.gitMode.headOffset
      const extras: IdentitySegment[] = []
      if (headOffset > 0) {
        extras.push({ id: 'sep-head-offset', text: SEP, tone: 'muted' })
        extras.push({ id: 'head-offset', text: `HEAD~${headOffset}`, tone: 'muted' })
      }
      if (state.gitMode.reviewBase) {
        extras.push({ id: 'sep-review-base', text: SEP, tone: 'muted' })
        extras.push({ id: 'review-base', text: 'vs base', tone: 'muted' })
      }
      return {
        help: helpHintForMode(config, 'git-mode'),
        identity: [...sessionSegs, ...extras],
        right: hintForGitMode(config, headOffset),
      }
    }
    case 'command-edit': {
      const commandEditMode = deriveCommandEditModeId(state.modal.type)
      return {
        help: '',
        identity: sessionSegs,
        right: commandEditMode ? hintForMode(config, commandEditMode) : '',
      }
    }
    case 'navigation':
    default:
      return {
        help: helpHintForMode(config, 'navigation'),
        identity: withTab,
        right: hintForMode(config, 'navigation'),
      }
  }
}

function deriveModalModeId(modalType: AppState['modal']['type']): ModeId | null {
  switch (modalType) {
    case 'help':
      return 'modal.help.filtering'
    case 'new-tab':
      return 'modal.new-tab.command-edit'
    case 'session-picker':
      return 'modal.session-picker.filtering'
    case 'snippet-picker':
      return 'modal.snippet-picker.filtering'
    case 'split-picker':
      return 'modal.split-picker'
    case 'theme-picker':
      return 'modal.theme-picker.filtering'
    case 'update-available':
      return 'modal.update-available'
    case 'worktree-move':
      return 'modal.worktree-move'
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
