import type { ModeId } from './types'

const TRANSITIONS: Record<ModeId, ModeId[]> = {
  'layout': ['terminal-input', 'navigation', 'modal.split-picker'],
  'modal.create-session': ['navigation', 'modal.session-picker'],
  'modal.help': ['navigation'],
  'modal.new-tab': ['navigation', 'modal.new-tab.command-edit'],
  'modal.new-tab.command-edit': ['modal.new-tab'],
  'modal.rename-tab': ['navigation'],
  'modal.session-name': ['modal.session-picker', 'navigation'],
  'modal.session-picker': [
    'navigation',
    'modal.session-picker.filtering',
    'modal.session-name',
    'modal.create-session',
  ],
  'modal.session-picker.filtering': ['modal.session-picker'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker'],
  'modal.snippet-picker': ['navigation', 'modal.snippet-picker.filtering', 'modal.snippet-editor'],
  'modal.snippet-picker.filtering': ['modal.snippet-picker'],
  'modal.split-picker': ['navigation'],
  'modal.theme-picker': ['navigation'],
  'navigation': [
    'terminal-input',
    'modal.new-tab',
    'modal.session-picker',
    'modal.help',
    'modal.snippet-picker',
    'modal.theme-picker',
    'modal.rename-tab',
  ],
  'terminal-input': ['navigation', 'layout'],
}

export function isValidTransition(from: ModeId, to: ModeId): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}
