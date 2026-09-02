import type { CliContext } from './context'
import type { ArgSpec, FlagSpec } from './flags'

import { pluginDoctor } from './commands/plugin/doctor'
import { pluginDisable, pluginEnable } from './commands/plugin/enable'
import { pluginCommands, pluginExec } from './commands/plugin/exec'
import { pluginInstall } from './commands/plugin/install'
import { pluginLink } from './commands/plugin/link'
import { pluginList } from './commands/plugin/list'
import { pluginLog } from './commands/plugin/log'
import { pluginNew } from './commands/plugin/new'
import { pluginReload } from './commands/plugin/reload'
import { pluginUninstall } from './commands/plugin/uninstall'
import { pluginUnlink } from './commands/plugin/unlink'
import { projectClose } from './commands/project/close'
import { projectCreate } from './commands/project/create'
import { projectList } from './commands/project/list'
import { projectShow } from './commands/project/show'
import { projectSwitch } from './commands/project/switch'
import { skillList, skillPathCommand } from './commands/skill'
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
import { workerSubmit } from './commands/worker/submit'
import { workspaceCreate } from './commands/workspace/create'
import { workspaceList } from './commands/workspace/list'
import { workspaceRemove } from './commands/workspace/remove'

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
  projectList,
  projectShow,
  projectCreate,
  projectSwitch,
  projectClose,
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workerRun,
  workerPrompt,
  workerSubmit,
  workerAwait,
  workerList,
  workerStop,
  workerDoctor,
  pluginNew,
  pluginList,
  pluginLink,
  pluginUnlink,
  pluginInstall,
  pluginUninstall,
  pluginEnable,
  pluginDisable,
  pluginReload,
  pluginLog,
  pluginDoctor,
  skillList,
  skillPathCommand,
  pluginCommands,
  pluginExec,
]

export function resolveCommand(group: string, verb: string): CliCommand | null {
  for (const command of COMMANDS) {
    if (command.group === group && command.verb === verb) return command
  }
  return null
}
