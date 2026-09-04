import type { EffectStack } from './effects'
import type { Disposer } from './types'
import type {
  PluginActionsApi,
  PluginCommandsApi,
  PluginCommitMessage,
  PluginCommitMessageRequest,
  PluginGitStatus,
  PluginNotificationEvent,
  PluginSettingValue,
  PluginStoreApi,
  PluginThemeSnapshot,
  PluginUiApi,
  PluginUiState,
} from './ui'

/**
 * The UI half of a plugin, with no aimux drawing anything.
 *
 * `createTestContext` gives a daemon plugin everything it needs — the real bus,
 * the real effect stack, recorded RPC — but a UI plugin's first line is
 * `ctx.ui.widgets.register(...)`, and `ctx.ui` simply was not there. So the
 * test the scaffold generates, against the half the scaffold generates, threw
 * on the first statement: the author's first run of `bun test` was a red they
 * had not written. Inside this repo it was invisible, because aimux's own tests
 * pass `extend` with the real services.
 *
 * Everything here records rather than draws, and every registration goes on the
 * same effect stack the rest of the context uses — so `effectCount()` counts
 * them and `dispose()` unwinds them, which is the property a plugin test is
 * really there to check.
 */

/** What the plugin registered, by surface. Mirrors what `plugin doctor` reports. */
export interface TestUiRegistrations {
  widgets: string[]
  views: string[]
  modals: string[]
  panes: string[]
  /** Command panes — programs the plugin asked to host. */
  commandPanes: string[]
  statusBar: string[]
  statsPages: string[]
  themes: string[]
  settingsSections: number
  /** Whether the plugin claimed the commit-message slot. */
  commitMessageProvider: boolean
  /** Whether the plugin claimed the notification slot. */
  notificationSink: boolean
  actions: string[]
  effects: string[]
}

export interface TestUiSurface {
  ui: PluginUiApi
  actions: PluginActionsApi
  store: PluginStoreApi
  commands: PluginCommandsApi
  registrations: TestUiRegistrations
  /** Everything `ctx.ui.toast` was asked to show, newest last. */
  toasts: { level: 'info' | 'success' | 'error'; message: string }[]
  /** Everything `ctx.ui.notifications.notify` raised, newest last. */
  notifications: { title: string; message?: string; level?: string }[]
  /** Panes and views the plugin asked to open or close, in order. */
  opened: string[]
  /** Layout verbs the plugin called, in order — `split:vertical`, `focus:left`, … */
  layoutCalls: string[]
  /** Git writes the plugin asked for, in order — `stage:a.ts`, `commit:title`, … */
  gitWrites: string[]
  /** Drives `ctx.ui.state`: set it, and subscribers hear about it. */
  setState: (next: Partial<PluginUiState>) => void
  /** Drives `ctx.ui.settings.watch` and what `get` answers. */
  setSetting: (id: string, value: PluginSettingValue) => void
  /** Drives `ctx.ui.themes.onChange` and what `current()` answers. */
  setTheme: (snapshot: PluginThemeSnapshot) => void
  /** Drives `ctx.ui.git.status`. */
  setGitStatus: (status: PluginGitStatus) => void
  /**
   * Asks the provider the plugin registered, as the commit flow would. Throws
   * when it registered none, because a test that silently asserts nothing is
   * the failure this whole harness exists to avoid.
   */
  askForCommitMessage: (
    request?: Partial<PluginCommitMessageRequest>
  ) => Promise<PluginCommitMessage | null>
  /**
   * Delivers an event to the sink the plugin provided, as aimux would on an
   * agent finishing a turn. Throws when it provided none.
   */
  deliverNotification: (event: PluginNotificationEvent) => Promise<void>
  /** Drives `ctx.ui.git.diff`. */
  setGitDiff: (path: string, diff: string) => void
}

const EMPTY_STATE: PluginUiState = {
  activeTab: null,
  activeTabId: null,
  projectId: null,
  tabs: [],
}

const DEFAULT_THEME: PluginThemeSnapshot = { colors: {}, mode: 'dark' }

const EMPTY_GIT: PluginGitStatus = { ahead: 0, behind: 0, branch: null, files: [] }

const EMPTY_REQUEST: PluginCommitMessageRequest = {
  assistant: 'claude',
  branch: 'main',
  diff: '',
  files: [],
  projectId: 'p1',
  recentCommits: '',
  repoRoot: '/tmp/repo',
}

/** A component that renders nothing: a test asserts on registrations, not pixels. */
const nothing = (): null => null

export function createTestUiSurface(effects: EffectStack): TestUiSurface {
  const registrations: TestUiRegistrations = {
    actions: [],
    commandPanes: [],
    commitMessageProvider: false,
    effects: [],
    modals: [],
    notificationSink: false,
    panes: [],
    settingsSections: 0,
    statsPages: [],
    statusBar: [],
    themes: [],
    views: [],
    widgets: [],
  }
  const toasts: TestUiSurface['toasts'] = []
  const notifications: TestUiSurface['notifications'] = []
  const opened: string[] = []
  const layoutCalls: string[] = []
  const gitWrites: string[] = []
  const diffs = new Map<string, string>()
  let notificationSink: ((event: PluginNotificationEvent) => void | Promise<void>) | null = null

  let state: PluginUiState = EMPTY_STATE
  const stateListeners = new Set<(next: PluginUiState) => void>()
  const settings = new Map<string, PluginSettingValue>()
  const settingListeners = new Map<string, Set<(value: PluginSettingValue) => void>>()
  let theme: PluginThemeSnapshot = DEFAULT_THEME
  const themeListeners = new Set<(snapshot: PluginThemeSnapshot) => void>()
  let slice: unknown
  let git: PluginGitStatus = EMPTY_GIT
  let commitProvider:
    | ((
        request: PluginCommitMessageRequest,
        signal: AbortSignal
      ) => Promise<PluginCommitMessage | null> | PluginCommitMessage | null)
    | null = null

  /** Records a registration and hands back a disposer that unrecords it. */
  function record(into: string[], id: string): Disposer {
    into.push(id)
    const dispose = (): void => {
      const at = into.indexOf(id)
      if (at !== -1) into.splice(at, 1)
    }
    effects.add(dispose)
    return dispose
  }

  function own<T>(set: Set<T>, listener: T): Disposer {
    set.add(listener)
    const dispose = (): void => {
      set.delete(listener)
    }
    effects.add(dispose)
    return dispose
  }

  const ui: PluginUiApi = {
    git: {
      commit: async (input) => {
        gitWrites.push(`commit:${input.title}`)
      },
      diff: async (path) => diffs.get(path) ?? '',
      discard: async (paths) => {
        gitWrites.push(`discard:${paths.join(',')}`)
      },
      provideCommitMessage: (provider) => {
        commitProvider = provider
        registrations.commitMessageProvider = true
        const dispose = (): void => {
          if (commitProvider === provider) commitProvider = null
          registrations.commitMessageProvider = false
        }
        effects.add(dispose)
        return dispose
      },
      stage: async (paths) => {
        gitWrites.push(`stage:${paths.join(',')}`)
      },
      status: () => git,
      unstage: async (paths) => {
        gitWrites.push(`unstage:${paths.join(',')}`)
      },
    },
    kit: {
      KeyHint: nothing,
      List: nothing,
      Panel: nothing,
      Row: nothing,
      useTheme: () => theme.colors,
    },
    layout: {
      close: (tabId) => layoutCalls.push(`close:${tabId ?? 'active'}`),
      focus: (direction) => layoutCalls.push(`focus:${direction}`),
      panes: () => (state.activeTabId === null ? [] : [state.activeTabId]),
      resize: (delta, axis) => layoutCalls.push(`resize:${axis}:${delta}`),
      split: (direction) => layoutCalls.push(`split:${direction}`),
      swap: (direction) => layoutCalls.push(`swap:${direction}`),
      tree: () => null,
    },
    modals: {
      close: () => opened.push('modal:close'),
      open: (id) => opened.push(`modal:${id}`),
      register: (modal) => record(registrations.modals, modal.id),
    },
    navigate: (screen) => opened.push(`screen:${screen}`),
    notifications: {
      notify: (notification) => {
        notifications.push(notification)
      },
      provide: (sink) => {
        notificationSink = sink
        registrations.notificationSink = true
        const dispose = (): void => {
          if (notificationSink === sink) notificationSink = null
          registrations.notificationSink = false
        }
        effects.add(dispose)
        return dispose
      },
    },
    panes: {
      close: (id) => opened.push(`pane:close:${id}`),
      open: (id) => opened.push(`pane:${id}`),
      openCommandPanes: () => [],
      register: (pane) => record(registrations.panes, pane.id),
      registerCommand: (pane) => record(registrations.commandPanes, pane.id),
    },
    settings: {
      get: (id) => settings.get(id),
      registerSection: () => {
        registrations.settingsSections += 1
        const dispose = (): void => {
          registrations.settingsSections -= 1
        }
        effects.add(dispose)
        return dispose
      },
      watch: (id, listener) => {
        const set = settingListeners.get(id) ?? new Set()
        settingListeners.set(id, set)
        return own(set, listener)
      },
    },
    state: {
      get: () => state,
      subscribe: (listener) => {
        // Fires once immediately, exactly as the real one does.
        listener(state)
        return own(stateListeners, listener)
      },
      use: (select) => select(state),
    },
    stats: {
      registerPage: (page) => record(registrations.statsPages, page.id),
    },
    statusBar: {
      register: (segment) => record(registrations.statusBar, segment.id),
    },
    themes: {
      current: () => theme,
      onChange: (listener) => own(themeListeners, listener),
      register: (id) => record(registrations.themes, id),
    },
    toast: {
      error: (message) => toasts.push({ level: 'error', message }),
      info: (message) => toasts.push({ level: 'info', message }),
      success: (message) => toasts.push({ level: 'success', message }),
    },
    views: {
      close: () => opened.push('view:close'),
      open: (id) => opened.push(`view:${id}`),
      register: (view) => record(registrations.views, view.id),
    },
    widgets: {
      register: (widget) => record(registrations.widgets, widget.id),
    },
  }

  const actions: PluginActionsApi = {
    effect: (effectId) => record(registrations.effects, effectId),
    register: (verb) => record(registrations.actions, verb),
  }

  const commands: PluginCommandsApi = {
    list: () =>
      registrations.actions.map((verb) => ({
        id: verb,
        kind: 'action' as const,
        pluginId: 'test',
        title: verb,
      })),
    run: () => false,
  }

  const store: PluginStoreApi = {
    dispatch: () => {
      /* a slice reducer is the plugin's; a bare context has none to run */
    },
    get: () => slice,
    reducer: () => {
      const dispose = (): void => {
        /* nothing was installed, so nothing comes off */
      }
      effects.add(dispose)
      return dispose
    },
    set: (next) => {
      slice = next
    },
    use: () => slice,
  }

  return {
    actions,
    askForCommitMessage: async (request) => {
      if (commitProvider === null) throw new Error('the plugin registered no commit provider')
      return commitProvider({ ...EMPTY_REQUEST, ...request }, new AbortController().signal)
    },
    commands,
    deliverNotification: async (event) => {
      if (notificationSink === null) throw new Error('the plugin provided no notification sink')
      await notificationSink(event)
    },
    gitWrites,
    layoutCalls,
    notifications,
    opened,
    registrations,
    setGitDiff: (path, diff) => {
      diffs.set(path, diff)
    },
    setGitStatus: (status) => {
      git = status
    },
    setSetting: (id, value) => {
      settings.set(id, value)
      for (const listener of settingListeners.get(id) ?? []) listener(value)
    },
    setState: (next) => {
      state = { ...state, ...next }
      for (const listener of stateListeners) listener(state)
    },
    setTheme: (snapshot) => {
      theme = snapshot
      for (const listener of themeListeners) listener(snapshot)
    },
    store,
    toasts,
    ui,
  }
}
