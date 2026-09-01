import type { ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import type { AppState } from '../state/types'

import { describeBindings } from '../input/keymap/describe-bindings'
import { getActiveWorkspacePath } from '../state/workspace-view'
import { buildHintText } from './keymap-context'
import { abbreviatePath } from './path-format'

export interface IdentitySegment {
  id: string
  text: string
  tone: 'primary' | 'muted'
}

export interface StatusBarModel {
  help: string
  right: string
  projectSegments: IdentitySegment[]
}

const HINT_LIMIT = 6
const HELP_DESCRIPTION = 'Help'
const SEP = '  ·  '

function projectSegments(
  projectName: string,
  projectPath: string | null | undefined
): IdentitySegment[] {
  const segs: IdentitySegment[] = [{ id: 'project', text: projectName, tone: 'primary' }]
  if (projectPath != null && projectPath !== '') {
    segs.push({ id: 'sep-project-path', text: SEP, tone: 'muted' })
    segs.push({ id: 'path', text: abbreviatePath(projectPath), tone: 'muted' })
  }
  return segs
}

const STAGING_DESCRIPTIONS = ['Stage', 'Unstage/delete', 'Commit', 'Push']
const HINT_JOINER = '  ·  '
/**
 * Moving around a two-column screen is the one thing you can see from the screen,
 * so the bar spends its six slots on what you cannot: searching, resetting, and
 * how to change the thing under the cursor.
 */
const SETTINGS_OBVIOUS_DESCRIPTIONS = ['Sections', 'Settings of the section', 'Next', 'Prev']

function hintForMode(config: ResolvedKeymapConfig, modeId: ModeId): string {
  return buildHintText(config, modeId, HINT_LIMIT, { excludeDescriptions: [HELP_DESCRIPTION] })
}

function hintForGitMode(config: ResolvedKeymapConfig, headOffset: number): string {
  if (headOffset === 0) {
    return buildHintText(config, 'git-mode', HINT_LIMIT, {
      excludeDescriptions: [HELP_DESCRIPTION],
    })
  }
  const base = buildHintText(config, 'git-mode', HINT_LIMIT, {
    excludeDescriptions: [HELP_DESCRIPTION, ...STAGING_DESCRIPTIONS],
  })
  const bindings = describeBindings(config, 'git-mode', {
    dedupeByDescription: true,
    withDescriptionOnly: true,
  })
  const stagingKeys = STAGING_DESCRIPTIONS.map(
    (desc) => bindings.find((b) => b.description === desc)?.keysDisplay
  ).filter((k): k is string => k != null && k !== '')
  if (stagingKeys.length === 0) return base
  const suffix = `${stagingKeys.join('/')} disabled — press 0 or ] to return`
  return base !== '' ? `${base}${HINT_JOINER}${suffix}` : suffix
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

export function getStatusBarModel(state: AppState, config: ResolvedKeymapConfig): StatusBarModel {
  const currentProject =
    state.currentProjectId != null && state.currentProjectId !== ''
      ? state.projects.find((project) => project.id === state.currentProjectId)
      : undefined
  const projectName = currentProject?.name ?? 'no project'
  const projectPath = getActiveWorkspacePath(currentProject)
  const projectSegs = projectSegments(projectName, projectPath)

  switch (state.focusMode) {
    case 'terminal-input':
      return {
        help: '',
        projectSegments: projectSegs,
        right: hintForMode(config, 'terminal-input'),
      }
    case 'modal': {
      const modalMode = deriveModalModeId(state.modal.type)
      return {
        help: '',
        projectSegments: projectSegs,
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
        projectSegments: [...projectSegs, ...extras],
        right: hintForGitMode(config, headOffset),
      }
    }
    case 'settings':
      return {
        help: helpHintForMode(config, 'settings'),
        projectSegments: projectSegs,
        right: buildHintText(config, 'settings', HINT_LIMIT, {
          excludeDescriptions: [HELP_DESCRIPTION, ...SETTINGS_OBVIOUS_DESCRIPTIONS],
        }),
      }
    case 'command-edit': {
      const commandEditMode = deriveCommandEditModeId(state.modal.type)
      return {
        help: '',
        projectSegments: projectSegs,
        right: commandEditMode ? hintForMode(config, commandEditMode) : '',
      }
    }
    case 'navigation':
    default:
      return {
        help: helpHintForMode(config, 'navigation'),
        projectSegments: projectSegs,
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
    case 'project-picker':
      return 'modal.project-picker.filtering'
    case 'snippet-picker':
      return 'modal.snippet-picker.filtering'
    case 'split-picker':
      return 'modal.split-picker'
    case 'theme-picker':
      return 'modal.theme-picker.filtering'
    case 'update-available':
      return 'modal.update-available'
    case 'workspace-move':
      return 'modal.workspace-move'
    case 'workspace-move-confirm':
      return 'modal.workspace-move-confirm'
    default:
      return null
  }
}

function deriveCommandEditModeId(modalType: AppState['modal']['type']): ModeId | null {
  switch (modalType) {
    case 'create-project':
      return 'modal.create-project'
    case 'git-commit':
      return 'modal.git-commit'
    case 'new-tab':
      return 'modal.new-tab.command-edit'
    case 'rename-tab':
      return 'modal.rename-tab'
    case 'rename-workspace':
      return 'modal.rename-workspace'
    case 'project-name':
      return 'modal.project-name'
    case 'project-picker':
      return 'modal.project-picker.filtering'
    case 'snippet-editor':
      return 'modal.snippet-editor'
    case 'snippet-picker':
      return 'modal.snippet-picker.filtering'
    default:
      return null
  }
}
