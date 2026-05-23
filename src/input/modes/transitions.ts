import type { ModeId } from './types'

const TRANSITIONS: Record<ModeId, readonly ModeId[]> = {
  'git-mode': ['navigation', 'modal.git-commit', 'modal.worktree-move'],
  'modal.ai-usage': ['navigation', 'terminal-input'],
  'modal.create-session': ['navigation', 'modal.session-picker.filtering'],
  'modal.git-commit': ['git-mode', 'modal.git-commit.confirm', 'modal.git-commit.generating'],
  'modal.git-commit.confirm': ['modal.git-commit', 'git-mode'],
  'modal.git-commit.generating': ['modal.git-commit', 'modal.git-commit.confirm', 'git-mode'],
  'modal.help.filtering': ['navigation'],
  'modal.new-tab.command-edit': ['navigation', 'modal.new-tab.editing-command'],
  'modal.new-tab.editing-command': ['navigation', 'modal.new-tab.command-edit'],
  'modal.rename-tab': ['navigation'],
  'modal.session-name': ['modal.session-picker.filtering', 'navigation'],
  'modal.session-picker.filtering': ['navigation', 'modal.session-name', 'modal.create-session'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker.filtering'],
  'modal.snippet-picker.filtering': ['navigation', 'modal.snippet-editor'],
  'modal.split-picker': ['navigation', 'terminal-input'],
  'modal.theme-picker.filtering': ['navigation'],
  'modal.update-available': ['navigation'],
  'modal.worktree-move': ['git-mode', 'navigation'],
  'navigation': [
    'terminal-input',
    'modal.new-tab.command-edit',
    'modal.new-tab.editing-command',
    'modal.session-picker.filtering',
    'modal.help.filtering',
    'modal.snippet-picker.filtering',
    'modal.theme-picker.filtering',
    'modal.rename-tab',
    'modal.update-available',
    'modal.ai-usage',
    'git-mode',
  ],
  'terminal-input': ['navigation', 'modal.split-picker', 'modal.ai-usage'],
}

export function isValidTransition(from: ModeId, to: ModeId): boolean {
  return TRANSITIONS[from].includes(to)
}
