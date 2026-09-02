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

export interface PluginBarWidget {
  /** Unqualified; the host prefixes the plugin id. */
  id: string
  label: string
  render: (contentWidth: number) => PluginNode
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

export interface PluginSettingsApi {
  /**
   * Registers a section beyond the one generated from the manifest's `config`
   * schema. Most plugins need neither — declaring `config` is enough.
   */
  registerSection: (section: unknown) => Disposer
}

export interface PluginThemesApi {
  /** The shipped theme JSON shape. A shipped id may not be replaced. */
  register: (id: string, theme: unknown) => Disposer
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

export interface PluginUiApi {
  widgets: PluginWidgetsApi
  views: PluginViewsApi
  modals: PluginModalsApi
  settings: PluginSettingsApi
  themes: PluginThemesApi
  toast: PluginToastApi
  kit: PluginKit
}

/**
 * Keyboard actions and their effects. Registered by unqualified verb; a user's
 * keymap binds the qualified name with `k.plugin('acme.thing.open')`.
 */
export interface PluginActionsApi {
  /**
   * The action a key produces. Receives the mode context and returns a
   * `KeyResult` — the same value a built-in binding produces — or null for
   * "not handled here".
   */
  register: (verb: string, handler: (ctx: unknown) => unknown) => Disposer
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
  /** Reads the current slice. */
  get: () => Slice | undefined
  /** Replaces the slice outright. */
  set: (slice: Slice) => void
  /** Dispatches into this plugin's reducer. */
  dispatch: (actionId: string, payload?: unknown) => void
}
