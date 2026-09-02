import type {
  PluginContext,
  PluginCounterDay,
  PluginProjectView,
  PluginWorkspaceView,
} from '@brimveyn/aimux-plugin'

import type { HookServer } from '../integrations/hook-server'
import type { ProjectRecord, TerminalSnapshot, WorkspaceRecord } from '../state/types'
import type { DaemonTabEntry } from './daemon'

import { registerPluginCliCommand } from '../plugins/cli-commands'
import { type AssistantDefinition, registerAssistant } from '../pty/assistant-registry'
import { extractTailLines } from '../pty/assistant-status-detector'
import { readCounters } from '../services/aimux-counters/store'
import { loadProjectCatalog } from '../state/project-catalog'

/**
 * Builds the services a daemon-half plugin gets: `ctx.assistants`, `ctx.hooks`,
 * `ctx.cli`, `ctx.tabs`, `ctx.projects`, `ctx.workspaces`.
 *
 * Mirrors `src/ui/plugin-ui-services.tsx` — same `extendContext` hook, same two
 * invariants. Everything goes on the fiber through `ctx.effect`, and every id a
 * plugin supplies is namespaced by the host.
 *
 * The reads go through the daemon's own registry rather than the terminal
 * manager. That is not a shortcut: the registry is what the daemon already
 * answers `listTabs` from, and routing a plugin's read through the TM would put
 * plugin traffic on the socket that every PTY's output shares.
 */

/**
 * Narrow projections of the catalog records.
 *
 * A `ProjectRecord` carries a whole persisted UI snapshot — layout trees,
 * scrollback buffers — and handing that to a plugin would make every field of
 * it something aimux can no longer change.
 */
function toWorkspaceView(workspace: WorkspaceRecord): PluginWorkspaceView {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    repoRoot: workspace.repoRoot,
    ...(workspace.baseRef === undefined ? {} : { baseRef: workspace.baseRef }),
    ...(workspace.branch === undefined ? {} : { branch: workspace.branch }),
  }
}

function toProjectView(project: ProjectRecord): PluginProjectView {
  return {
    id: project.id,
    name: project.name,
    workspaces: (project.workspaces ?? []).map(toWorkspaceView),
    ...(project.activeWorkspaceId === undefined
      ? {}
      : { activeWorkspaceId: project.activeWorkspaceId }),
    ...(project.projectPath === undefined ? {} : { path: project.projectPath }),
  }
}

/** What the daemon hands over so these services can reach its state. */
export interface DaemonPluginBackings {
  tabs: () => ReadonlyMap<string, DaemonTabEntry>
  activeTabId: (projectId: string) => string | null
  spawnTab: (input: {
    projectId: string
    assistant: string
    title: string
    command: string
    args?: string[]
    cwd?: string
    workspaceId?: string
  }) => Promise<string>
  write: (tabId: string, data: string) => Promise<void>
  /** Title change that reaches the manager, the session and every UI. */
  renameTab: (tabId: string, title: string) => void
  focus: (projectId: string, tabId: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  hookServer: () => HookServer | null
}

export interface PluginTabView {
  id: string
  projectId: string
  assistant: string
  title: string
  command: string
  workspaceId?: string
  workerName?: string
}

function toView(id: string, entry: DaemonTabEntry): PluginTabView {
  return {
    assistant: entry.assistant,
    command: entry.command,
    id,
    projectId: entry.projectId,
    title: entry.title ?? '',
    workerName: entry.workerName,
    workspaceId: entry.workspaceId,
  }
}

function ownDisposer(ctx: PluginContext, dispose: () => void): () => void {
  ctx.effect(() => dispose)
  return dispose
}

function qualify(pluginId: string, id: string): string {
  return `${pluginId}.${id}`
}

/**
 * `extendContext` for the daemon kernel. Attaches the service objects onto a
 * freshly-built context, the way the UI host does.
 */
export function createDaemonContextExtender(
  backings: DaemonPluginBackings
): (ctx: PluginContext) => void {
  return (ctx: PluginContext): void => {
    const { id } = ctx

    const tabs = {
      activeId: (projectId: string): string | null => backings.activeTabId(projectId),
      close: async (tabId: string) => backings.closeTab(tabId),
      focus: async (projectId: string, tabId: string) => backings.focus(projectId, tabId),
      get: (tabId: string): PluginTabView | undefined => {
        const entry = backings.tabs().get(tabId)
        return entry ? toView(tabId, entry) : undefined
      },
      list: (projectId?: string): PluginTabView[] => {
        const views: PluginTabView[] = []
        for (const [tabId, entry] of backings.tabs()) {
          if (projectId !== undefined && entry.projectId !== projectId) continue
          views.push(toView(tabId, entry))
        }
        return views
      },
      /**
       * A title change, not a suggestion: it reaches the manager, the
       * persisted session and every attached UI, so it outlives the plugin
       * that made it.
       */
      rename: async (tabId: string, title: string): Promise<void> => {
        backings.renameTab(tabId, title)
        return Promise.resolve()
      },
      /** Writes to the PTY. Bytes, not a line: a newline is the caller's to add. */
      send: async (tabId: string, data: string) => backings.write(tabId, data),
      /** The tab's rendered tail, or `null` when it has produced no viewport. */
      snapshot: (tabId: string, lines = 40): string | null => {
        const viewport: TerminalSnapshot | undefined = backings.tabs().get(tabId)?.viewport
        return viewport ? extractTailLines(viewport, lines).join('\n') : null
      },
      spawn: async (input: Parameters<DaemonPluginBackings['spawnTab']>[0]) =>
        backings.spawnTab(input),
    }

    const projects = {
      get: (projectId: string): PluginProjectView | undefined => {
        const found = loadProjectCatalog().find((project) => project.id === projectId)
        return found ? toProjectView(found) : undefined
      },
      /** Read from the catalog on every call: another process may have written it. */
      list: (): PluginProjectView[] => loadProjectCatalog().map(toProjectView),
    }

    const workspaces = {
      list: (projectId: string): PluginWorkspaceView[] =>
        (loadProjectCatalog().find((project) => project.id === projectId)?.workspaces ?? []).map(
          toWorkspaceView
        ),
    }

    const metrics = {
      counters: (days = 30): PluginCounterDay[] =>
        Object.entries(readCounters().days)
          .sort(([a], [b]) => (a < b ? 1 : -1))
          .slice(0, Math.max(0, days))
          .map(([day, values]) => ({ day, values: { ...values } as Record<string, number> })),
    }

    const assistants = {
      register: (definition: AssistantDefinition) =>
        ownDisposer(ctx, registerAssistant(definition)),
    }

    const hooks = {
      /**
       * Adds a hook route. The id is namespaced, so the URL a plugin's bridge
       * script POSTs to is `/hook/<pluginId>.<id>` and cannot collide with
       * another plugin's — or with `claude`.
       */
      route: (routeId: string, onEvent: (event: unknown) => void) => {
        const server = backings.hookServer()
        if (!server) {
          throw new Error('the hook server is not running; hook routes are unavailable')
        }
        return ownDisposer(ctx, server.route(qualify(id, routeId), onEvent))
      },
      /** The URL to hand a bridge script, or null when the route is not registered. */
      url: (routeId: string): string | null =>
        backings.hookServer()?.urlFor(qualify(id, routeId)) ?? null,
    }

    const cli = {
      register: (command: {
        group: string
        verb: string
        summary: string
        flags?: never[]
        args?: never[]
        run: (args: {
          flags: Record<string, string | number | boolean>
          positionals: string[]
        }) => Promise<unknown>
      }) =>
        ownDisposer(
          ctx,
          registerPluginCliCommand({
            args: command.args,
            flags: command.flags,
            group: command.group,
            pluginId: id,
            run: command.run,
            summary: command.summary,
            verb: command.verb,
          })
        ),
    }

    const extended = ctx as PluginContext & Record<string, unknown>
    extended.tabs = tabs
    extended.projects = projects
    extended.workspaces = workspaces
    extended.metrics = metrics
    extended.assistants = assistants
    extended.hooks = hooks
    extended.cli = cli
  }
}
