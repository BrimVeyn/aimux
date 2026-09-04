import type { PluginCommandEntry } from '@brimveyn/aimux-plugin'

import { listPluginActions } from '@brimveyn/aimux-config'

import { readPluginCliSidecar } from '../plugins/cli-commands'
import { listExecCommands } from '../plugins/exec-adapter'
import { pluginStore } from '../plugins/plugin-store'
import { runPluginActionByName } from './introspection'

/**
 * Everything runnable that plugins have contributed, as one list.
 *
 * Three sources, three shapes: actions live in the UI and are registered at
 * apply time; `commands[]` come from the manifest and spawn in the daemon;
 * CLI verbs are read from the sidecar the daemon writes. None of them knew
 * about the others, which is why a palette written by a third party had
 * nothing to list — and the palette is the family that comes up most often
 * after panes.
 */
export function listPluginCommands(): PluginCommandEntry[] {
  const entries: PluginCommandEntry[] = []

  for (const action of listPluginActions()) {
    const dot = action.name.lastIndexOf('.')
    entries.push({
      id: action.name,
      kind: 'action',
      pluginId: dot === -1 ? action.name : action.name.slice(0, dot),
      title: action.title ?? (dot === -1 ? action.name : action.name.slice(dot + 1)),
      ...(action.description === undefined ? {} : { description: action.description }),
    })
  }

  for (const command of listExecCommands(pluginStore.getState().records)) {
    entries.push({
      id: `${command.pluginId} ${command.id}`,
      kind: 'exec',
      pluginId: command.pluginId,
      title: command.title,
    })
  }

  for (const command of readPluginCliSidecar()) {
    entries.push({
      description: command.summary,
      id: `${command.group} ${command.verb}`,
      kind: 'cli',
      pluginId: command.pluginId,
      title: `aimux ${command.group} ${command.verb}`,
    })
  }

  return entries
}

/** Runs an action entry the way its key would. False when nothing answered. */
export function runPluginCommand(id: string): boolean {
  return runPluginActionByName(id).ran
}
