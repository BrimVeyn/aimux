import type { ModeId } from './types'

const TRANSITIONS: Record<ModeId, readonly ModeId[]> = {
  'git-mode': ['navigation', 'modal.git-commit', 'modal.workspace-move'],
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
  'modal.settings-search.filtering': ['settings'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker.filtering'],
  // Both pickers are reachable from the settings screen as well as from the
  // panes, and `returnTo` sends each one back where it came from.
  'modal.snippet-picker.filtering': ['navigation', 'settings', 'modal.snippet-editor'],
  'modal.split-picker': ['navigation', 'terminal-input'],
  'modal.theme-picker.filtering': ['navigation', 'settings'],
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
    'modal.workspace-delete-confirm',
    'modal.workspace-move-confirm',
    'modal.flash-jump',
    'git-mode',
    'settings',
    'stats',
  ],
  // The help overlay opens over settings without a transition (it leaves
  // focusMode alone). The two pickers an action row hands over to are dispatched
  // directly rather than through a KeyResult, but they are listed because that is
  // what this table is for: saying where a mode can go.
  'settings': [
    'navigation',
    'modal.setting-text',
    'modal.settings-search.filtering',
    'modal.theme-picker.filtering',
    'modal.snippet-picker.filtering',
  ],
  // Read-only screen: the only way out is back to the panes. The help overlay
  // opens on top of it without a transition, the same way it does over settings.
  'stats': ['navigation'],
  'terminal-input': ['navigation', 'modal.split-picker', 'settings', 'stats'],
}

export function isValidTransition(from: ModeId, to: ModeId): boolean {
  return TRANSITIONS[from].includes(to)
}
