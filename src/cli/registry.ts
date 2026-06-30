import type { CliContext } from './context'
import type { ArgSpec, FlagSpec } from './flags'

import { tabClose } from './commands/tab/close'
import { tabCreate } from './commands/tab/create'
import { tabFocus } from './commands/tab/focus'
import { tabList } from './commands/tab/list'
import { tabSend } from './commands/tab/send'
import { tabSnapshot } from './commands/tab/snapshot'
import { tabWait } from './commands/tab/wait'
import { workspaceList } from './commands/workspace/list'
import { workspaceShow } from './commands/workspace/show'

export interface CliCommand {
  group: string
  verb: string
  summary: string
  flags: readonly FlagSpec[]
  args: readonly ArgSpec[]
  run: (ctx: CliContext) => Promise<number>
}

export const COMMANDS: readonly CliCommand[] = [
  tabList,
  tabCreate,
  tabSend,
  tabFocus,
  tabClose,
  tabSnapshot,
  tabWait,
  workspaceList,
  workspaceShow,
]

export function resolveCommand(group: string, verb: string): CliCommand | null {
  for (const command of COMMANDS) {
    if (command.group === group && command.verb === verb) return command
  }
  return null
}
