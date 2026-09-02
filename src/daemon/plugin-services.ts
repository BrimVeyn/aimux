import type { PluginContext } from '@brimveyn/aimux-plugin'

import type { HookServer } from '../integrations/hook-server'
import type { ProjectRecord, TerminalSnapshot } from '../state/types'
import type { DaemonTabEntry } from './daemon'

import { registerPluginCliCommand } from '../plugins/cli-commands'
import { type AssistantDefinition, registerAssistant } from '../pty/assistant-registry'
import { extractTailLines } from '../pty/assistant-status-detector'
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
      get: (projectId: string): ProjectRecord | undefined =>
        loadProjectCatalog().find((project) => project.id === projectId),
      /** Read from the catalog on every call: another process may have written it. */
      list: (): ProjectRecord[] => loadProjectCatalog(),
    }

    const workspaces = {
      list: (projectId: string) =>
        loadProjectCatalog().find((project) => project.id === projectId)?.workspaces ?? [],
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
    extended.assistants = assistants
    extended.hooks = hooks
    extended.cli = cli
  }
}
