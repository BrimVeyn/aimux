import type { ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import { describeBindings, type DescribedBinding } from './describe-bindings'

export interface HelpEntry extends DescribedBinding {
  mode: ModeId
  modeLabel: string
}

export const HELP_MODE_LABELS: { modeId: ModeId; label: string }[] = [
  { label: 'Navigation', modeId: 'navigation' },
  { label: 'Terminal input', modeId: 'terminal-input' },
  { label: 'Git mode', modeId: 'git-mode' },
  { label: 'Git commit', modeId: 'modal.git-commit' },
  { label: 'New tab', modeId: 'modal.new-tab.command-edit' },
  { label: 'New tab — command', modeId: 'modal.new-tab.command-edit' },
  { label: 'Project picker', modeId: 'modal.project-picker.filtering' },
  { label: 'Project picker — filter', modeId: 'modal.project-picker.filtering' },
  { label: 'Project name', modeId: 'modal.project-name' },
  { label: 'Create project', modeId: 'modal.create-project' },
  { label: 'Create workspace', modeId: 'modal.create-workspace' },
  { label: 'Rename tab', modeId: 'modal.rename-tab' },
  { label: 'Rename workspace', modeId: 'modal.rename-workspace' },
  { label: 'Snippet picker', modeId: 'modal.snippet-picker.filtering' },
  { label: 'Snippet picker — filter', modeId: 'modal.snippet-picker.filtering' },
  { label: 'Snippet editor', modeId: 'modal.snippet-editor' },
  { label: 'Theme picker', modeId: 'modal.theme-picker.filtering' },
  { label: 'Split picker', modeId: 'modal.split-picker' },
  { label: 'Help', modeId: 'modal.help.filtering' },
  { label: 'Help — filter', modeId: 'modal.help.filtering' },
  { label: 'Update available', modeId: 'modal.update-available' },
]

export function collectHelpEntries(config: ResolvedKeymapConfig): HelpEntry[] {
  const entries: HelpEntry[] = []
  for (const { label, modeId } of HELP_MODE_LABELS) {
    const bindings = describeBindings(config, modeId, {
      dedupeByDescription: true,
      withDescriptionOnly: true,
    })
    for (const binding of bindings) {
      entries.push({ ...binding, mode: modeId, modeLabel: label })
    }
  }
  return entries
}
