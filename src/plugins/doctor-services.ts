import type { PluginContext, PluginHost } from '@brimveyn/aimux-plugin'

/**
 * Stand-in host services for `aimux plugin doctor`.
 *
 * Doctor applies each half against a throwaway context so it can report what
 * the plugin registers without touching the running aimux. That only works if
 * the context has the services the plugin reaches for — a plugin calling
 * `ctx.ui.views.register` or `ctx.assistants.register` would otherwise fail on
 * a missing property, and doctor would report a broken plugin that is fine.
 *
 * These record instead of registering, which is also exactly the report the
 * author wants: the list of what an `apply` contributes.
 */

export interface DoctorRegistrations {
  widgets: string[]
  views: string[]
  modals: string[]
  themes: string[]
  statsPages: string[]
  statusBarSegments: string[]
  settingsSections: number
  actions: string[]
  effects: string[]
  /** aimux settings the plugin gates itself on — `ctx.ui.settings.watch`. */
  settingsWatched: string[]
  assistants: string[]
  hookRoutes: string[]
  cliCommands: string[]
  /** True when the plugin installed a state reducer. */
  storeReducer: boolean
}

export function emptyRegistrations(): DoctorRegistrations {
  return {
    actions: [],
    assistants: [],
    cliCommands: [],
    effects: [],
    hookRoutes: [],
    modals: [],
    settingsSections: 0,
    settingsWatched: [],
    statsPages: [],
    statusBarSegments: [],
    storeReducer: false,
    themes: [],
    views: [],
    widgets: [],
  }
}

const noop = (): void => {}

/**
 * Builds the `extend` a doctor run passes to `createTestContext`. The returned
 * disposers are real, so a plugin that unregisters something during `apply`
 * still reads correctly.
 */
export function createDoctorExtender(
  host: PluginHost,
  into: DoctorRegistrations
): (ctx: PluginContext) => void {
  const record = (list: string[], id: string): (() => void) => {
    list.push(id)
    return () => {
      const index = list.indexOf(id)
      if (index !== -1) list.splice(index, 1)
    }
  }

  return (ctx: PluginContext): void => {
    const extended = ctx as PluginContext & Record<string, unknown>

    if (host === 'ui') {
      extended.ui = {
        kit: {
          KeyHint: () => null,
          List: () => null,
          Panel: () => null,
          Row: () => null,
          // A plugin may call this during `apply` to pick a colour; a plain
          // object is enough for a dry run and avoids pulling the theme store
          // into a process that has no screen.
          useTheme: () => ({}),
        },
        modals: {
          close: noop,
          open: noop,
          register: (modal: { id: string }) => record(into.modals, modal.id),
        },
        settings: {
          // `undefined` is the honest dry-run answer — nothing is set in a
          // process with no settings store. A plugin that registers only
          // inside the callback therefore reports nothing, which is why the
          // watched ids are reported: the author can see the gate.
          get: (): undefined => {
            /* nothing is set in a process with no settings store */
          },
          registerSection: () => {
            into.settingsSections += 1
            return noop
          },
          watch: (settingId: string, listener: (value: undefined) => void) => {
            const undo = record(into.settingsWatched, settingId)
            listener(undefined)
            return undo
          },
        },
        stats: {
          registerPage: (page: { id: string }) => record(into.statsPages, page.id),
        },
        statusBar: {
          register: (segment: { id: string }) => record(into.statusBarSegments, segment.id),
        },
        themes: {
          current: () => ({ colors: {}, mode: 'dark' }),
          onChange: () => noop,
          register: (id: string) => record(into.themes, id),
        },
        toast: { error: noop, info: noop, success: noop },
        views: {
          close: noop,
          open: noop,
          register: (view: { id: string }) => record(into.views, view.id),
        },
        widgets: {
          register: (widget: { id: string }) => record(into.widgets, widget.id),
        },
      }
      extended.actions = {
        effect: (effectId: string) => record(into.effects, effectId),
        register: (verb: string) => record(into.actions, verb),
      }
      extended.store = {
        dispatch: noop,
        get: () => {
          /* no slice in a dry run */
        },
        reducer: () => {
          into.storeReducer = true
          return noop
        },
        set: noop,
      }
      return
    }

    extended.tabs = {
      activeId: () => null,
      close: async () => {},
      focus: async () => {},
      get: () => {
        /* nothing to find in a dry run */
      },
      list: () => [],
      send: async () => {},
      snapshot: () => null,
      // A dry run must not spawn anything. Rejecting is honest: an `apply` that
      // spawns a tab is doing work, not registering, and doctor should say so
      // rather than quietly hand back a fake id the plugin then uses.
      spawn: async () => {
        throw new Error('plugin doctor does not spawn tabs')
      },
    }
    extended.projects = {
      get: () => {
        /* nothing to find in a dry run */
      },
      list: () => [],
    }
    extended.workspaces = { list: () => [] }
    extended.assistants = {
      register: (definition: { option: { id: string } }) =>
        record(into.assistants, definition.option.id),
    }
    extended.hooks = {
      route: (routeId: string) => record(into.hookRoutes, routeId),
      url: () => null,
    }
    extended.cli = {
      register: (command: { group: string; verb: string }) =>
        record(into.cliCommands, `${command.group} ${command.verb}`),
    }
  }
}
