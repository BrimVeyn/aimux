import type { ModeId } from './types'

const TRANSITIONS: Record<ModeId, readonly ModeId[]> = {
  'git-mode': ['navigation', 'modal.git-commit'],
  'modal.create-session': ['navigation', 'modal.session-picker.filtering'],
  'modal.git-commit': ['git-mode'],
  'modal.help.filtering': ['navigation'],
  'modal.new-tab.command-edit': ['navigation'],
  'modal.rename-tab': ['navigation'],
  'modal.session-name': ['modal.session-picker.filtering', 'navigation'],
  'modal.session-picker.filtering': ['navigation', 'modal.session-name', 'modal.create-session'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker.filtering'],
  'modal.snippet-picker.filtering': ['navigation', 'modal.snippet-editor'],
  'modal.split-picker': ['navigation', 'terminal-input'],
  'modal.theme-picker.filtering': ['navigation'],
  'modal.update-available': ['navigation'],
  'navigation': [
    'terminal-input',
    'modal.new-tab.command-edit',
    'modal.session-picker.filtering',
    'modal.help.filtering',
    'modal.snippet-picker.filtering',
    'modal.theme-picker.filtering',
    'modal.rename-tab',
    'modal.update-available',
    'git-mode',
  ],
  'terminal-input': ['navigation', 'modal.split-picker'],
}

export function isValidTransition(from: ModeId, to: ModeId): boolean {
  return TRANSITIONS[from].includes(to)
}
