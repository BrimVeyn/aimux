import type { CliContext } from './context'
import type { ArgSpec, FlagSpec } from './flags'

import { tabAwait } from './commands/tab/await'
import { tabClose } from './commands/tab/close'
import { tabCreate } from './commands/tab/create'
import { tabFocus } from './commands/tab/focus'
import { tabList } from './commands/tab/list'
import { tabRun } from './commands/tab/run'
import { tabSend } from './commands/tab/send'
import { tabSnapshot } from './commands/tab/snapshot'
import { tabTail } from './commands/tab/tail'
import { tabWait } from './commands/tab/wait'
import { workerAwait } from './commands/worker/await'
import { workerDoctor } from './commands/worker/doctor'
import { workerList } from './commands/worker/list'
import { workerPrompt } from './commands/worker/prompt'
import { workerRun } from './commands/worker/run'
import { workerStop } from './commands/worker/stop'
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
  tabRun,
  tabAwait,
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
  workerRun,
  workerPrompt,
  workerAwait,
  workerList,
  workerStop,
  workerDoctor,
]

export function resolveCommand(group: string, verb: string): CliCommand | null {
  for (const command of COMMANDS) {
    if (command.group === group && command.verb === verb) return command
  }
  return null
}
