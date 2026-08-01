import type { ModeId } from './types'

const TRANSITIONS: Record<ModeId, readonly ModeId[]> = {
  'git-mode': ['navigation', 'modal.git-commit', 'modal.workspace-move'],
  'modal.ai-usage': ['navigation', 'terminal-input'],
  'modal.create-project': ['navigation', 'modal.project-picker.filtering'],
  'modal.create-workspace': ['navigation', 'terminal-input'],
  'modal.flash-jump': ['navigation'],
  'modal.git-commit': ['git-mode', 'modal.git-commit.confirm', 'modal.git-commit.generating'],
  'modal.git-commit.confirm': ['modal.git-commit', 'git-mode'],
  'modal.git-commit.generating': ['modal.git-commit', 'modal.git-commit.confirm', 'git-mode'],
  'modal.help.filtering': ['navigation'],
  'modal.new-tab.command-edit': ['navigation', 'modal.new-tab.editing-command'],
  'modal.new-tab.editing-command': ['navigation', 'modal.new-tab.command-edit'],
  'modal.project-name': ['modal.project-picker.filtering', 'navigation'],
  'modal.project-picker.filtering': ['navigation', 'modal.project-name', 'modal.create-project'],
  'modal.rename-tab': ['navigation'],
  'modal.rename-workspace': ['navigation'],
  'modal.setting-text': ['settings'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker.filtering'],
  'modal.snippet-picker.filtering': ['navigation', 'modal.snippet-editor'],
  'modal.split-picker': ['navigation', 'terminal-input'],
  'modal.theme-picker.filtering': ['navigation'],
  'modal.update-available': ['navigation'],
  'modal.workspace-delete-confirm': ['navigation'],
  'modal.workspace-move': ['git-mode', 'navigation'],
  'modal.workspace-move-confirm': ['navigation'],
  'navigation': [
    'terminal-input',
    'modal.create-workspace',
    'modal.new-tab.command-edit',
    'modal.new-tab.editing-command',
    'modal.project-picker.filtering',
    'modal.help.filtering',
    'modal.snippet-picker.filtering',
    'modal.theme-picker.filtering',
    'modal.rename-tab',
    'modal.rename-workspace',
    'modal.update-available',
    'modal.ai-usage',
    'modal.workspace-delete-confirm',
    'modal.workspace-move-confirm',
    'modal.flash-jump',
    'git-mode',
    'settings',
  ],
  // The help overlay opens over settings without a transition (it leaves
  // focusMode alone), so leaving is the only move this mode makes.
  'settings': ['navigation', 'modal.setting-text'],
  'terminal-input': ['navigation', 'modal.split-picker', 'modal.ai-usage', 'settings'],
}

export function isValidTransition(from: ModeId, to: ModeId): boolean {
  return TRANSITIONS[from].includes(to)
}
