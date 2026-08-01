import type { SettingRow, SettingSection } from '../types'

import { ASSISTANT_OPTIONS } from '../../pty/command-registry'
import { dispatchGlobal } from '../../state/dispatch-ref'

export const SNIPPET_TRIGGER_CHAR = 'snippets.triggerChar'
export const AUTO_COMMIT_MODEL_PREFIX = 'autoCommit.models.'

/**
 * What each assistant is actually launched with. The value lives in `AppState`
 * (and is persisted with the rest of it), so these rows delegate — and an empty
 * value removes the override rather than launching an empty command.
 */
function customCommandRow(option: (typeof ASSISTANT_OPTIONS)[number]): SettingRow {
  return {
    description: `Default: ${option.command}`,
    id: `customCommands.${option.id}`,
    kind: 'text',
    label: option.label,
    placeholder: option.command,
    read: (ctx) => ctx.state.customCommands[option.id] ?? '',
    storage: 'app',
    write: (value, ctx) => {
      const next = { ...ctx.state.customCommands }
      if (value === '') delete next[option.id]
      else next[option.id] = String(value)
      dispatchGlobal({ customCommands: next, type: 'set-custom-commands' })
    },
  }
}

/** The assistants whose auto-commit model the config ships a default for. */
const MODEL_ASSISTANTS = ['claude', 'codex'] as const

function autoCommitModelRow(assistant: (typeof MODEL_ASSISTANTS)[number]): SettingRow {
  return {
    description: `Model that writes the commit message when ${assistant} is the active tab.`,
    fallback: '',
    fromConfig: (config) => config.autoCommit?.models?.[assistant],
    id: `${AUTO_COMMIT_MODEL_PREFIX}${assistant}`,
    kind: 'text',
    label: `Auto-commit model (${assistant})`,
    placeholder: 'the built-in default',
    storage: 'settings',
  }
}

export const COMMANDS_SECTION: SettingSection = {
  id: 'commands',
  label: 'Commands',
  rows: [
    {
      description: 'Type this, then a trigger, to expand a snippet. One character.',
      fallback: ':',
      fromConfig: (config) => config.snippetTriggerChar,
      id: SNIPPET_TRIGGER_CHAR,
      kind: 'text',
      label: 'Snippet trigger',
      storage: 'settings',
    },
    {
      description: 'The picker owns them: create, edit, delete, and see the config-pinned ones.',
      id: 'snippets.manage',
      kind: 'action',
      label: 'Snippets',
      run: () => dispatchGlobal({ returnTo: 'settings', type: 'open-snippet-picker' }),
      value: (ctx) => `${String(ctx.state.snippets.length)} ›`,
    },
    ...MODEL_ASSISTANTS.map(autoCommitModelRow),
    ...ASSISTANT_OPTIONS.map(customCommandRow),
  ],
}
