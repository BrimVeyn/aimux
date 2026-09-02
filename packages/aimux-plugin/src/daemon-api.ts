import type { Disposer } from './types'

/**
 * The daemon half's services — what a plugin reaches through `ctx.tabs`,
 * `ctx.projects`, `ctx.workspaces`, `ctx.assistants`, `ctx.hooks` and
 * `ctx.cli`.
 *
 * Declared here, implemented by `src/daemon/plugin-services.ts`. Same split as
 * the UI half: this package stays free of aimux's internals so a plugin can be
 * typechecked with nothing but `bun install`.
 *
 * The shapes that cross over — a tab view, a project record — are the aimux
 * ones, structurally re-declared where they are small and left `unknown` where
 * re-declaring them would be a second copy to keep in sync.
 */

export interface PluginTabView {
  id: string
  projectId: string
  assistant: string
  title: string
  command: string
  workspaceId?: string
  workerName?: string
}

export interface PluginSpawnTabInput {
  projectId: string
  /** A registered assistant id, or a bare command's id. */
  assistant: string
  title: string
  command: string
  args?: string[]
  cwd?: string
  workspaceId?: string
}

export interface PluginTabsApi {
  list: (projectId?: string) => PluginTabView[]
  get: (tabId: string) => PluginTabView | undefined
  /** The tab the UI is focused on for this project, or null. */
  activeId: (projectId: string) => string | null
  /**
   * Spawns a tab and resolves with its id. Sized from the project's last
   * attached dimensions — a plugin has no viewport of its own — so it fails
   * with a clear error if no UI has ever attached to that project.
   */
  spawn: (input: PluginSpawnTabInput) => Promise<string>
  /** Writes to the PTY. Bytes, not a line: the newline is the caller's to add. */
  send: (tabId: string, data: string) => Promise<void>
  focus: (projectId: string, tabId: string) => Promise<void>
  close: (tabId: string) => Promise<void>
  /** The tab's last rendered lines, or null when it has produced no viewport. */
  snapshot: (tabId: string, lines?: number) => string | null
}

/**
 * A workspace, as a plugin sees it. `path` is the directory to run a command
 * in and `repoRoot` the repository it belongs to — for a git worktree those
 * differ, which is exactly why both are here.
 */
export interface PluginWorkspaceView {
  id: string
  name: string
  path: string
  repoRoot: string
  branch?: string
  baseRef?: string
}

export interface PluginProjectView {
  id: string
  name: string
  /** Where the project lives, when it has a directory of its own. */
  path?: string
  workspaces: PluginWorkspaceView[]
  activeWorkspaceId?: string
}

/**
 * Project and workspace records, read from the catalog on every call because
 * another process may have written it.
 *
 * Narrow projections rather than the raw records: the catalog entry carries a
 * whole persisted UI snapshot — layout trees, scrollback buffers — and handing
 * that to a plugin would make every field of it something aimux can no longer
 * change.
 */
export interface PluginProjectsApi {
  list: () => PluginProjectView[]
  get: (projectId: string) => PluginProjectView | undefined
}

export interface PluginWorkspacesApi {
  list: (projectId: string) => PluginWorkspaceView[]
}

/**
 * What aimux knows about its own use, per local calendar day — counts and
 * nothing else. No key identity, no content, nothing that leaves the machine.
 */
export interface PluginCounterDay {
  /** `YYYY-MM-DD`, local calendar. */
  day: string
  values: Record<string, number>
}

export interface PluginMetricsApi {
  /** Newest day first. `days` caps how far back it looks; default 30. */
  counters: (days?: number) => PluginCounterDay[]
}

export interface PluginAssistantsApi {
  /**
   * Registers a complete assistant: spawn command, status classifier, question
   * parser, usage adapter, hook mapping. See `AssistantDefinition` in
   * `src/pty/assistant-registry.ts` for the shape.
   */
  register: (definition: unknown) => Disposer
}

export interface PluginHooksApi {
  /**
   * Adds an HTTP hook route. The id is namespaced, so the path a bridge script
   * POSTs to is `/hook/<pluginId>.<id>` and cannot collide with another
   * plugin's — or with `claude`.
   */
  route: (routeId: string, onEvent: (event: unknown) => void) => Disposer
  /** The URL to hand a bridge script, or null when the route is not registered. */
  url: (routeId: string) => string | null
}

export interface PluginCliApi {
  /**
   * Adds an `aimux <group> <verb>`. The command runs here, in the daemon; the
   * CLI process learns its shape from a sidecar and never loads plugin code.
   * Whatever `run` returns becomes the command's JSON body on stdout.
   */
  register: (command: {
    group: string
    verb: string
    summary: string
    run: (args: {
      flags: Record<string, string | number | boolean>
      positionals: string[]
    }) => Promise<unknown>
  }) => Disposer
}
