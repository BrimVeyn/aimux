import type { ReactNode } from 'react'

import type { Disposer } from './types'

/**
 * The UI half's services — what a plugin reaches through `ctx.ui`, `ctx.actions`
 * and `ctx.store`.
 *
 * Declared here, implemented by `src/ui/plugin-host.tsx`. The split matters:
 * this package must stay free of React and of aimux's internals, so a plugin
 * can be typechecked with nothing but `bun install`.
 *
 * Ids are namespaced by the host. A plugin registers `board` and the widget
 * becomes `acme.thing.board`, so two plugins can each have a "board" and the
 * owner of any id is readable from the id alone.
 */

/**
 * What a plugin renders. `react` is an optional peer of this package, typed
 * only — no runtime dependency, and any plugin drawing UI already needs
 * `@types/react` to write JSX at all.
 *
 * The node must come from *aimux's* React at runtime. The module loader forces
 * that resolution, so a plugin that simply imports `react` gets the right one
 * and its hooks work.
 */
export type PluginNode = ReactNode

/** A component the kit hands back, usable directly in a plugin's JSX. */
export type PluginComponent<Props> = (props: Props) => PluginNode

/** Aimux's own types, re-declared structurally where the shape is small. */
export interface PluginToastApi {
  info: (message: string) => void
  success: (message: string) => void
  error: (message: string) => void
}

/** The room a bar widget has been given, in cells. */
export interface PluginWidgetSize {
  cols: number
  rows: number
}

export interface PluginBarWidget {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  label: string
  /**
   * `size` is the second argument rather than a replacement for the first: the
   * width already shipped as a number under `apiVersion: 1`, and swapping it
   * would break every published plugin to save one parameter. `size.cols` is
   * the same value.
   */
  render: (contentWidth: number, size: PluginWidgetSize) => PluginNode
}

export interface PluginView {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  title: string
  render: () => PluginNode
}

export interface PluginModal {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  title: string
  render: (props: unknown) => PluginNode
}

export interface PluginWidgetsApi {
  register: (widget: PluginBarWidget) => Disposer
}

export interface PluginViewsApi {
  register: (view: PluginView) => Disposer
  /** Replaces the panes with this view. Takes the unqualified id. */
  open: (id: string) => void
  /** Returns to the panes. */
  close: () => void
}

export interface PluginModalsApi {
  register: (modal: PluginModal) => Disposer
  open: (id: string, props?: unknown) => void
  close: () => void
}

/** What a settings row holds. Absent when nothing has ever set it. */
export type PluginSettingValue = boolean | number | string | undefined

export interface PluginSettingsApi {
  /**
   * Registers a section beyond the one generated from the manifest's `config`
   * schema. Most plugins need neither — declaring `config` is enough.
   */
  registerSection: (section: unknown) => Disposer
  /**
   * Reads one of *aimux's own* settings by row id — the same dotted id that
   * appears in `aimux.config.ts` and on the settings screen.
   *
   * A plugin's own configuration is `ctx.config`; this is for the cases where
   * a plugin has to agree with aimux about something the user already set,
   * rather than ask them a second time.
   */
  get: (id: string) => PluginSettingValue
  /**
   * Calls back on every change to that row, and once immediately with the
   * current value — so a plugin gating itself on a toggle is one call, with no
   * separate "read it first" step to forget.
   */
  watch: (id: string, listener: (value: PluginSettingValue) => void) => Disposer
}

/**
 * One tab, as a UI plugin sees it. A narrow projection on purpose: the app's
 * own `TabSession` carries a viewport, terminal modes and a scrollback buffer,
 * none of which a plugin has any business holding a reference to.
 */
export interface PluginTabInfo {
  id: string
  title: string
  assistant: string
  status: string
  /** `idle` / `working` / `waiting-input`, or null when nothing has said yet. */
  activity: string | null
  workspaceId?: string
}

/** What aimux is currently showing, as much of it as a plugin can act on. */
export interface PluginUiState {
  tabs: readonly PluginTabInfo[]
  activeTabId: string | null
  /** The same tab `activeTabId` names, or null. Saved lookups add up. */
  activeTab: PluginTabInfo | null
  projectId: string | null
}

export interface PluginStateApi {
  /** A snapshot, outside React. */
  get: () => PluginUiState
  /** Fires on every change, and once immediately with the current value. */
  subscribe: (listener: (state: PluginUiState) => void) => Disposer
  /**
   * The hook a renderer wants: re-renders only when the selected value
   * changes. The snapshot object is stable between changes, so selecting a
   * field is cheap — selecting a *new object* re-renders every time, which is
   * the same rule every store hook has.
   */
  use: <T>(select: (state: PluginUiState) => T) => T
}

export interface PluginPane {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  /** Drawn in the pane's border. */
  title: string
  render: () => PluginNode
}

/**
 * A pane that hosts a *program* rather than React: lazygit, yazi, a Rust TUI
 * the plugin ships. Same story the daemon's `commands[]` tells — a plugin in
 * any language — applied to the interface.
 *
 * Opening one spawns the argv in a terminal pane aimux owns on the plugin's
 * behalf: it is a real PTY tab, so it takes the keyboard like any terminal
 * does. The pane outlives a reload of the plugin (a re-registration under the
 * same id adopts it) and dies with the plugin (unlink, uninstall, disable). A
 * program that exits leaves a pane that says so, and `Ctrl+r` restarts it.
 */
export interface PluginCommandPane {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  /** Drawn in the pane's border and in the tab strip. */
  title: string
  /** argv, not a shell string — no quoting rules to get wrong. */
  command: string[]
  /**
   * Where to run it. `workspace` (the default) is the active workspace's
   * directory, `project` the project's, `plugin` the plugin's own root; any
   * other value is taken as an absolute path.
   */
  cwd?: 'workspace' | 'project' | 'plugin' | (string & {})
}

export interface PluginPanesApi {
  /**
   * Declares a pane: a leaf in the layout tree that draws something other than
   * a terminal. A widget is a narrow strip and a view takes the whole screen;
   * a pane is the one that sits *beside* an agent — a board, a diff, a log
   * browser.
   *
   * Registering does not put it on screen; `open` does.
   */
  register: (pane: PluginPane) => Disposer
  /**
   * Declares a pane that runs a program. The manifest's `panes[]` block is the
   * same declaration without a line of TypeScript. `open` and `close` take the
   * same unqualified id either way.
   */
  registerCommand: (pane: PluginCommandPane) => Disposer
  /**
   * Splits the pane the user is in and puts this one beside it. Takes the
   * unqualified id. Opening one that is already open does nothing: the id is
   * the plugin's name for it, and two panes claiming it would make `close`
   * ambiguous.
   *
   * Opening does not move the keyboard: `direction` decides where the pane
   * goes, and focus stays on the terminal it was split from. The user walks
   * into it with the ordinary pane-navigation keys, and its own keys are bound
   * in its own mode — `plugin.pane.<pluginId>.<id>`.
   */
  open: (id: string, direction?: 'horizontal' | 'vertical') => void
  /**
   * Takes it off screen. The layout collapses as it would for a closed tab.
   * For a command pane this also kills the program.
   */
  close: (id: string) => void
  /**
   * Which command panes are on screen right now, by unqualified id. A React
   * pane is either registered or not; a command pane also has a process, and
   * a plugin that wants to toggle one needs to know.
   */
  openCommandPanes: () => string[]
}

/** The layout of one group, as a plugin reads it. Same shape aimux persists. */
export type PluginLayoutNode =
  | { type: 'leaf'; id: string; kind: 'tab' | 'plugin' }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number
      first: PluginLayoutNode
      second: PluginLayoutNode
    }

export type PluginPaneDirection = 'left' | 'right' | 'up' | 'down'

/**
 * The layout as an API rather than as keys. Every verb here is one the
 * keyboard already has, dispatched through the same reducer, so a plugin
 * cannot reach a layout the user could not have made by hand.
 *
 * Everything acts on the pane holding the keyboard unless a `tabId` says
 * otherwise; nothing here throws for a pane that cannot move, because a
 * key press does not either.
 */
export interface PluginLayoutApi {
  /** Splits the active pane and puts a new terminal beside it, same assistant. */
  split: (direction: 'horizontal' | 'vertical') => void
  /** Moves the keyboard to the neighbouring pane. */
  focus: (direction: PluginPaneDirection) => void
  /** Exchanges the active pane with its neighbour in that direction. */
  swap: (direction: PluginPaneDirection) => void
  /** Nudges the split the active pane sits in. `delta` is in steps, ±1 typically. */
  resize: (delta: number, axis: 'horizontal' | 'vertical') => void
  /** Closes a pane — the active one when no id is given. Kills its process. */
  close: (tabId?: string) => void
  /** The active group's tree, or null when the active tab is not split. */
  tree: () => PluginLayoutNode | null
  /** Every pane id in the active group, in draw order. One id when unsplit. */
  panes: () => string[]
}

/** What a notification says. */
export interface PluginNotification {
  title: string
  message?: string
  level?: 'info' | 'success' | 'warning' | 'error'
}

/**
 * A notification aimux is about to make — its own (`waiting-input`,
 * `turn-complete`) or one a plugin raised (`custom`). What a sink receives.
 */
export interface PluginNotificationEvent extends PluginNotification {
  kind: 'waiting-input' | 'turn-complete' | 'custom'
  tabId?: string
  workspaceId?: string
  /** The plugin that raised it; absent on aimux's own. */
  pluginId?: string
}

export interface PluginNotificationsApi {
  /** Shows a toast — or hands it to the sink, when a plugin provides one. */
  notify: (notification: PluginNotification) => void
  /**
   * Replaces aimux's own notifications: the sound on an agent asking a
   * question or finishing a turn stops playing, and every event — aimux's
   * and other plugins' — lands here instead. A ntfy or Telegram plugin
   * *replaces* the native toast rather than doubling it.
   *
   * One plugin at a time, on the `provideCommitMessage` model: the second to
   * ask is refused and told so in its log.
   */
  provide: (sink: (event: PluginNotificationEvent) => void | Promise<void>) => Disposer
}

/** One entry of what `ctx.commands.list()` enumerates. */
export interface PluginCommandEntry {
  /** `action` runs in the UI, `exec` is a manifest `commands[]` subprocess, `cli` an `aimux <group> <verb>`. */
  kind: 'action' | 'exec' | 'cli'
  /** The name to run it by: the qualified action, `<pluginId> <commandId>`, or `<group> <verb>`. */
  id: string
  pluginId: string
  title: string
  description?: string
}

/**
 * Everything runnable that plugins have contributed, in one list. Without it
 * a command palette written by a third party has nothing to show; with it,
 * `run` fires an action the way its key would.
 */
export interface PluginCommandsApi {
  list: () => PluginCommandEntry[]
  /** Runs an `action` entry by its qualified id. Returns false when nothing answered. */
  run: (id: string) => boolean
}

export interface PluginStatusBarSegment {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  render: () => PluginNode
}

export interface PluginStatusBarApi {
  /**
   * Adds a tile to the right of the status bar, before the version.
   *
   * The bar draws its own separators and tile colours around it, so a segment
   * renders content and nothing else — there are no powerline glyphs to get
   * wrong. Order is registration order.
   */
  register: (segment: PluginStatusBarSegment) => Disposer
}

export interface PluginStatsPage {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  label: string
  /** One cell, text presentation — the rule every nav glyph follows. */
  glyph: string
  render: () => PluginNode
}

export interface PluginStatsApi {
  /** Adds a page to the stats screen's nav, after the built-in three. */
  registerPage: (page: PluginStatsPage) => Disposer
}

/** Light or dark. The user picks it, or the terminal does. */
export type PluginThemeMode = 'dark' | 'light'

export interface PluginThemeSnapshot {
  /** Resolved colour tokens — the same values `kit.useTheme()` returns. */
  colors: Record<string, string>
  mode: PluginThemeMode
}

export interface PluginThemesApi {
  /** The shipped theme JSON shape. A shipped id may not be replaced. */
  register: (id: string, theme: unknown) => Disposer
  /**
   * The active theme outside React. `kit.useTheme()` is the hook for anything
   * being rendered; this is for the rest — a plugin writing the palette to a
   * file, or telling another program about it.
   */
  current: () => PluginThemeSnapshot
  /** Fires on every theme or mode change. Does not fire for the initial value. */
  onChange: (listener: (snapshot: PluginThemeSnapshot) => void) => Disposer
}

/**
 * The primitives a plugin renders with, already styled like the rest of aimux.
 *
 * Handed over on the context rather than imported: they are implemented in the
 * app, against the same theme store and the same `Surface`/`ListItem` the
 * built-in screens use, and re-implementing them in this package would be the
 * duplication the type de-duplication just removed.
 *
 * Not a component library. A plugin that needs something else drops to `<box>`
 * and `<text>` and styles it from `kit.useTheme()`, which is what every
 * built-in view does.
 */
export interface PluginKit {
  /**
   * The resolved theme. The one thing a plugin must not hard-code: aimux ships
   * 34 themes and loads more from disk, and a plugin with its own colours is
   * the part of the screen that stops matching when the user switches.
   */
  useTheme: () => Record<string, string>
  /** A titled container — what a bar widget and a full-screen view both are. */
  Panel: PluginComponent<{
    children?: PluginNode
    title?: string
    tone?: 'muted' | 'elevated'
    padding?: number
    flexGrow?: number
  }>
  /** A label/value line — what every settings and stats row already is. */
  Row: PluginComponent<{ label: PluginNode; value?: PluginNode; dim?: boolean }>
  /** A selectable list, with the built-in cursor glyph and mouse wiring. */
  List: PluginComponent<{
    items: readonly unknown[]
    selectedIndex?: number
    keyOf?: (item: unknown, index: number) => string
    renderItem: (item: unknown, index: number) => PluginNode
    empty?: PluginNode
    onSelect?: (index: number) => void
    onHover?: (index: number) => void
  }>
  /** The footer line every modal and screen ends with. */
  KeyHint: PluginComponent<{ hints: readonly { keys: string; label: string }[] }>
}

/** One changed file, as the git panel sees it. */
export interface PluginGitFile {
  path: string
  /** Porcelain-ish status: `modified`, `new`, `deleted`, `renamed`, … */
  status: string
  /** Which half of the panel it sits in — staged or not. */
  section: string
  added: number | null
  removed: number | null
}

/**
 * The working tree as the panel last saw it. A snapshot of aimux's poll, not a
 * fresh `git status`: it is what the user is looking at, which is the point,
 * and it is empty until a project with a path is open.
 */
export interface PluginGitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: PluginGitFile[]
}

/** Everything aimux gathered before asking for a commit message. */
export interface PluginCommitMessageRequest {
  projectId: string
  repoRoot: string
  branch: string
  /**
   * The assistant in the tab the commit is being written for — `claude`,
   * `codex`, … A provider that calls a model headlessly needs to know which
   * one the user is already working with.
   */
  assistant: string
  /** Staged diff when anything is staged, the working-tree diff otherwise. */
  diff: string
  /** `git log --oneline`, for house style rather than for content. */
  recentCommits: string
  files: PluginGitFile[]
  /** The tail of what the agent in the tab was doing, when there is one. */
  sessionTail?: string
}

export interface PluginCommitMessage {
  title: string
  body?: string
}

export interface PluginGitCommitInput {
  title: string
  body?: string
}

export interface PluginGitApi {
  /** The panel's last refresh. */
  status: () => PluginGitStatus
  /**
   * The diff of one file, unified. `staged` reads the index against HEAD; the
   * default reads the working tree against the index, which is what the
   * panel shows for an unstaged file. Empty for an untracked file — git has
   * nothing to compare it with — so read the file itself in that case.
   */
  diff: (path: string, options?: { staged?: boolean }) => Promise<string>
  /** `git add -- <paths>`. Rejects with git's own message on failure. */
  stage: (paths: readonly string[]) => Promise<void>
  /** `git restore --staged -- <paths>`. */
  unstage: (paths: readonly string[]) => Promise<void>
  /**
   * Throws away working-tree changes: `git checkout --` for a tracked file,
   * deletion for an untracked one. There is no undo, which is why it takes
   * paths rather than "everything".
   */
  discard: (paths: readonly string[]) => Promise<void>
  /** Commits what is staged. Rejects when nothing is, with git's own words. */
  commit: (input: PluginGitCommitInput) => Promise<void>
  /**
   * Answers "what should this commit say", replacing the headless model call
   * aimux would otherwise make. Return `null` to decline this one — aimux falls
   * back to its own suggestion rather than leaving the user with nothing.
   *
   * One plugin at a time: the second to ask is refused, and told so in its log,
   * because a message that depends on load order is worse than no message.
   */
  provideCommitMessage: (
    provider: (
      request: PluginCommitMessageRequest,
      signal: AbortSignal
    ) => Promise<PluginCommitMessage | null> | PluginCommitMessage | null
  ) => Disposer
}

/** The screens a plugin may send the user to. */
export type PluginScreen = 'git' | 'stats' | 'settings' | 'terminal'

export interface PluginUiApi {
  /**
   * Opens one of aimux's own screens, or `terminal` to leave the one you are
   * on. Deliberately four names and not an id space: exposing modal or view ids
   * would make them API, and they are not.
   */
  navigate: (screen: PluginScreen) => void
  git: PluginGitApi
  widgets: PluginWidgetsApi
  views: PluginViewsApi
  modals: PluginModalsApi
  settings: PluginSettingsApi
  themes: PluginThemesApi
  toast: PluginToastApi
  panes: PluginPanesApi
  layout: PluginLayoutApi
  notifications: PluginNotificationsApi
  state: PluginStateApi
  stats: PluginStatsApi
  statusBar: PluginStatusBarApi
  kit: PluginKit
}

/**
 * Keyboard actions and their effects. Registered by unqualified verb; a user's
 * keymap binds the qualified name with `k.plugin('acme.thing.open')`.
 */
/** What a palette shows for an action. Optional: an action without one lists under its verb. */
export interface PluginActionMeta {
  title?: string
  description?: string
}

export interface PluginActionsApi {
  /**
   * The action a key produces. Receives the mode context and returns a
   * `KeyResult` — the same value a built-in binding produces — or null for
   * "not handled here".
   *
   * `meta` gives it a title. An action with one is something a palette can
   * list and a user can find; without it the verb is all anyone sees.
   */
  register: (verb: string, handler: (ctx: unknown) => unknown, meta?: PluginActionMeta) => Disposer
  /**
   * The side of a binding that is allowed to do things: spawn a tab, write a
   * file, call out. Reached from an action's `KeyResult` as a `plugin-effect`.
   */
  effect: (effectId: string, handler: (payload: unknown) => void | Promise<void>) => Disposer
}

/**
 * This plugin's slice of `AppState`, at `state.plugins[<pluginId>]`. Opaque to
 * the core reducer — the shape is the plugin's, and knowing it would make the
 * app depend on plugins rather than the other way round.
 */
export interface PluginStoreApi<Slice = unknown> {
  /** Installs the slice reducer. One per plugin; registering again replaces it. */
  reducer: (
    reduce: (slice: Slice | undefined, action: { actionId: string; payload?: unknown }) => Slice
  ) => Disposer
  /** Reads the current slice. A snapshot: it does not subscribe. */
  get: () => Slice | undefined
  /**
   * The slice, as a hook. What a renderer wants: `get()` inside a component
   * reads the right value once and then never hears about the next one, which
   * is a widget that quietly stops updating.
   */
  use: () => Slice | undefined
  /** Replaces the slice outright. */
  set: (slice: Slice) => void
  /** Dispatches into this plugin's reducer. */
  dispatch: (actionId: string, payload?: unknown) => void
}
