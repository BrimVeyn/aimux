import type { CliContext } from './context'
import type { ArgSpec, FlagSpec } from './flags'

import { tabClose } from './commands/tab/close'
import { tabCreate } from './commands/tab/create'
import { tabFocus } from './commands/tab/focus'
import { tabList } from './commands/tab/list'
import { tabSend } from './commands/tab/send'
import { tabSnapshot } from './commands/tab/snapshot'
import { tabTail } from './commands/tab/tail'
import { tabWait } from './commands/tab/wait'
import { workspaceClose } from './commands/workspace/close'
import { workspaceCreate } from './commands/workspace/create'
import { workspaceList } from './commands/workspace/list'
import { workspaceShow } from './commands/workspace/show'
import { workspaceSwitch } from './commands/workspace/switch'
import { worktreeCreate } from './commands/worktree/create'
import { worktreeList } from './commands/worktree/list'
import { worktreeRemove } from './commands/worktree/remove'

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
  tabTail,
  tabWait,
  workspaceList,
  workspaceShow,
  workspaceCreate,
  workspaceSwitch,
  workspaceClose,
  worktreeList,
  worktreeCreate,
  worktreeRemove,
]

export function resolveCommand(group: string, verb: string): CliCommand | null {
  for (const command of COMMANDS) {
    if (command.group === group && command.verb === verb) return command
  }
  return null
}
