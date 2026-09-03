import type {
  Disposer,
  PluginActionsApi,
  PluginCommandsApi,
  PluginContext,
  PluginGitFile,
  PluginKit,
  PluginLayoutNode,
  PluginStoreApi,
  PluginTabInfo,
  PluginThemeSnapshot,
  PluginUiApi,
  PluginUiState,
} from '@brimveyn/aimux-plugin'
import type { ReactNode } from 'react'

import {
  registerPluginAction,
  registerTuiTheme,
  type ResolvedTuiTheme,
  type SettingSection,
  type ThemeMode,
  type TuiThemeJson,
} from '@brimveyn/aimux-config'

import type { AppAction } from '../state/actions'
import type { AppState, GitFileEntry } from '../state/types'

import { registerPluginEffect } from '../app-runtime/plugin-effects'
import { registerCommitMessageProvider } from '../git/commit-message-provider'
import {
  gitCommitStaged,
  gitDiffOf,
  gitDiscard,
  gitStage,
  gitUnstage,
} from '../git/plugin-git-writes'
import { registerKeymapLayer } from '../input/keymap/plugin-layer'
import { registerSettingSection } from '../settings/sections'
import { settingsStore } from '../settings/settings-store'
import { appStore, useAppStore } from '../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../state/dispatch-ref'
import {
  allPaneIds as allPaneIdsOf,
  getTreeForTab,
  isTabLeaf,
  type LayoutNode,
} from '../state/layout-tree'
import { getCurrentProject } from '../state/project-workspaces'
import { registerPluginSlice } from '../state/reducers/plugin-slices'
import { registerStatsPage, registerStatsPageRenderer } from '../state/stats-pages'
import { toast } from '../state/toast-store'
import { notify as deliverNotification, registerNotificationSink } from './notifications'
import {
  closeCommandPane,
  findCommandPaneTab,
  getCommandPane,
  openCommandPane,
  openCommandPaneIds,
  registerCommandPane,
} from './plugin-command-panes'
import { listPluginCommands, runPluginCommand } from './plugin-commands'
import { KeyHint, List, Panel, Row, usePluginTheme } from './plugin-kit'
import { registerPluginModal } from './plugin-modals'
import { registerPluginPane } from './plugin-panes'
import { registerPluginView } from './plugin-views'
import { registerStatusBarSegment } from './status-bar-segments'
import { getCurrentMode, getCurrentTheme, subscribeThemeChanges } from './theme-store'
import { registerBarWidget } from './widgets/registry'

/**
 * Builds the `ctx.ui`, `ctx.actions` and `ctx.store` a UI-half plugin gets.
 *
 * Every registration goes on the fiber through `ctx.effect`, which is what
 * makes an unload total: the plugin does not have to remember to keep the
 * disposers, and it could not leak one if it tried.
 *
 * Ids are namespaced here rather than by the plugin. A plugin registering
 * `board` gets `acme.thing.board` whether it wanted to or not — two plugins
 * can each have a "board", and the owner of any id stays readable from the id.
 */

/**
 * The projection a plugin sees, cached on the three slices it is built from.
 *
 * Stability is the whole point: a plugin's selector runs on every store change,
 * and rebuilding the snapshot each time would re-render every widget on every
 * keystroke. Recomputing only when `tabs`, `activeTabId` or `currentProjectId`
 * changes identity gives `use(s => s.activeTab?.title)` the behaviour a caller
 * expects for free.
 */
let cachedFrom: [AppState['tabs'], string | null, string | null] | null = null
let cachedState: PluginUiState = { activeTab: null, activeTabId: null, projectId: null, tabs: [] }

function projectUiState(state: AppState): PluginUiState {
  if (
    cachedFrom !== null &&
    cachedFrom[0] === state.tabs &&
    cachedFrom[1] === state.activeTabId &&
    cachedFrom[2] === state.currentProjectId
  ) {
    return cachedState
  }
  const tabs: PluginTabInfo[] = state.tabs.map((tab) => ({
    activity: tab.activity ?? null,
    assistant: tab.assistant,
    id: tab.id,
    status: tab.status,
    title: tab.title,
    ...(tab.workspaceId === undefined ? {} : { workspaceId: tab.workspaceId }),
  }))
  cachedFrom = [state.tabs, state.activeTabId, state.currentProjectId]
  cachedState = {
    activeTab: tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    activeTabId: state.activeTabId,
    projectId: state.currentProjectId,
    tabs,
  }
  return cachedState
}

/**
 * The theme as a plugin sees it: flat colour tokens plus the mode. Same values
 * `kit.useTheme()` hands a component, in the shape a non-React caller wants.
 */
function themeSnapshot(resolved: ResolvedTuiTheme, mode: ThemeMode): PluginThemeSnapshot {
  return { colors: resolved as unknown as Record<string, string>, mode }
}

/** `<pluginId>.<id>`. The one place the prefix is applied. */
function qualify(pluginId: string, id: string): string {
  return `${pluginId}.${id}`
}

/**
 * Registers on the fiber and hands the disposer back too. The plugin may keep
 * it to withdraw something early; ignoring it is the normal case, because the
 * unload already has it.
 */
function own(ctx: PluginContext, dispose: Disposer): Disposer {
  ctx.effect(() => dispose)
  return dispose
}

/**
 * One frozen object, shared by every plugin: the components are stateless and
 * a per-plugin copy would only give React new identities to re-mount on.
 */
const KIT: PluginKit = {
  KeyHint,
  List: List as PluginKit['List'],
  Panel,
  Row,
  useTheme: () => usePluginTheme() as unknown as Record<string, string>,
}

/** `GitFileEntry` narrowed to what a plugin has any business seeing. */
function describeFiles(files: readonly GitFileEntry[]): PluginGitFile[] {
  return files.map((file) => ({
    added: file.added,
    path: file.path,
    removed: file.removed,
    section: file.section,
    status: file.status,
  }))
}

/** The directory git writes run in: the project's, which is what the panel polls. */
function requireRepoPath(): string {
  const path = getCurrentProject(appStore.getState())?.projectPath
  if (path === undefined || path === '') throw new Error('no project with a path is open')
  return path
}

/** The layout tree as a plugin reads it: `id` says what it is, `kind` what it holds. */
function describeTree(node: LayoutNode): PluginLayoutNode {
  if (node.type === 'leaf') {
    return { id: node.tabId, kind: isTabLeaf(node) ? 'tab' : 'plugin', type: 'leaf' }
  }
  return {
    direction: node.direction,
    first: describeTree(node.first),
    ratio: node.ratio,
    second: describeTree(node.second),
    type: 'split',
  }
}

function activeGroupTree(): LayoutNode | null {
  const state = appStore.getState()
  const from = state.activePluginPaneId ?? state.activeTabId
  if (from == null || from === '') return null
  return getTreeForTab(state.layoutTrees, state.tabGroupMap, from)
}

/** Leaving whichever screen the user is on, before opening another. */
const EXIT_BY_FOCUS: Partial<Record<string, AppAction>> = {
  git: { type: 'exit-git-mode' },
  settings: { type: 'exit-settings' },
  stats: { type: 'exit-stats' },
}

const ENTER_BY_SCREEN = {
  git: { type: 'enter-git-mode' },
  settings: { type: 'enter-settings' },
  stats: { type: 'enter-stats' },
} as const satisfies Record<string, AppAction>

function buildUi(ctx: PluginContext): PluginUiApi {
  const { id } = ctx
  return {
    git: {
      commit: async (input) => gitCommitStaged(requireRepoPath(), input),
      diff: async (path, options) => gitDiffOf(requireRepoPath(), path, options),
      discard: async (paths) => gitDiscard(requireRepoPath(), paths),
      provideCommitMessage: (provider) => {
        // aimux's own provider yields to any plugin the user installs; see
        // `commit-message-provider.ts` for why the ranks exist.
        const registration = registerCommitMessageProvider(id, provider, {
          builtin: id.startsWith('aimux.'),
        })
        if (!registration.accepted) {
          // Silence here would mean a plugin whose whole purpose never runs,
          // with nothing anywhere saying why.
          ctx.log.warn('commit messages are already provided by another plugin', {
            reason: registration.reason,
          })
          return () => {
            /* the slot was never taken; there is nothing to give back */
          }
        }
        return own(ctx, registration.dispose)
      },
      stage: async (paths) => gitStage(requireRepoPath(), paths),
      status: () => {
        const { gitPanel } = appStore.getState()
        return {
          ahead: gitPanel.ahead,
          behind: gitPanel.behind,
          branch: gitPanel.branch,
          files: describeFiles(gitPanel.files),
        }
      },
      unstage: async (paths) => gitUnstage(requireRepoPath(), paths),
    },
    kit: KIT,
    layout: {
      close: (tabId) => {
        const target = tabId ?? appStore.getState().activeTabId
        if (target == null || target === '') return
        dispatchGlobal({ tabId: target, type: 'close-pane' })
        runSideEffectGlobal({ tabId: target, type: 'close-tab' })
      },
      focus: (direction) => {
        dispatchGlobal({ direction, type: 'focus-pane-direction' })
      },
      panes: () => {
        const tree = activeGroupTree()
        if (tree !== null) return allPaneIdsOf(tree)
        const { activeTabId } = appStore.getState()
        return activeTabId == null || activeTabId === '' ? [] : [activeTabId]
      },
      resize: (delta, axis) => {
        const { activeTabId } = appStore.getState()
        if (activeTabId == null || activeTabId === '') return
        dispatchGlobal({ axis, delta, tabId: activeTabId, type: 'resize-pane' })
      },
      split: (direction) => {
        const { activeTabId } = appStore.getState()
        if (activeTabId == null || activeTabId === '') return
        runSideEffectGlobal({ direction, sourceTabId: activeTabId, type: 'split-pane' })
      },
      swap: (direction) => {
        dispatchGlobal({ direction, type: 'swap-pane' })
      },
      tree: () => {
        const tree = activeGroupTree()
        return tree === null ? null : describeTree(tree)
      },
    },
    modals: {
      close: () => {
        dispatchGlobal({ type: 'close-modal' })
      },
      open: (modalId, props) => {
        dispatchGlobal({ modalId, pluginId: id, props, type: 'open-plugin-modal' })
      },
      register: (modal) =>
        own(
          ctx,
          registerPluginModal({
            id: qualify(id, modal.id),
            pluginId: id,
            render: (props) => modal.render(props) as ReactNode,
            title: modal.title,
          })
        ),
    },
    navigate: (screen) => {
      const exit = EXIT_BY_FOCUS[appStore.getState().focusMode]
      // Leave first, the way a key press would: entering a second screen from
      // inside the first leaves the one behind it holding state nobody closed.
      if (exit !== undefined) dispatchGlobal(exit)
      if (screen === 'terminal') return
      dispatchGlobal(ENTER_BY_SCREEN[screen])
    },
    notifications: {
      notify: (notification) => {
        deliverNotification({ ...notification, kind: 'custom', pluginId: id })
      },
      provide: (sink) => {
        const registration = registerNotificationSink(id, sink)
        if (!registration.accepted) {
          ctx.log.warn('notifications are already provided by another plugin', {
            reason: registration.reason,
          })
          return () => {
            /* the slot was never taken; there is nothing to give back */
          }
        }
        return own(ctx, registration.dispose)
      },
    },
    panes: {
      close: (paneId) => {
        const qualified = qualify(id, paneId)
        if (getCommandPane(qualified) !== undefined || findCommandPaneTab(qualified)) {
          closeCommandPane(qualified)
          return
        }
        dispatchGlobal({ paneId: qualified, type: 'close-plugin-pane' })
      },
      open: (paneId, direction) => {
        const qualified = qualify(id, paneId)
        if (getCommandPane(qualified) !== undefined) {
          openCommandPane(qualified, direction ?? 'vertical')
          return
        }
        dispatchGlobal({
          direction: direction ?? 'vertical',
          paneId: qualified,
          type: 'open-plugin-pane',
        })
      },
      openCommandPanes: () => {
        const prefix = `${id}.`
        return openCommandPaneIds()
          .filter((paneId) => paneId.startsWith(prefix))
          .map((paneId) => paneId.slice(prefix.length))
      },
      register: (pane) =>
        own(
          ctx,
          registerPluginPane({
            id: qualify(id, pane.id),
            pluginId: id,
            render: () => pane.render() as ReactNode,
            title: pane.title,
          })
        ),
      registerCommand: (pane) =>
        own(
          ctx,
          registerCommandPane({
            command: pane.command,
            id: qualify(id, pane.id),
            pluginId: id,
            pluginRoot: ctx.paths.root,
            title: pane.title,
            ...(pane.cwd === undefined ? {} : { cwd: pane.cwd }),
          })
        ),
    },
    settings: {
      get: (settingId) => settingsStore.getState().values[settingId],
      registerSection: (section) => own(ctx, registerSettingSection(section as SettingSection)),
      // Fires immediately as well as on change: a plugin gating itself on a
      // toggle wants one call, not a read followed by a subscription it has to
      // remember to keep in step.
      watch: (settingId, listener) => {
        let last = settingsStore.getState().values[settingId]
        listener(last)
        return own(
          ctx,
          settingsStore.subscribe((state) => {
            const next = state.values[settingId]
            if (next === last) return
            last = next
            listener(next)
          })
        )
      },
    },
    state: {
      get: () => projectUiState(appStore.getState()),
      subscribe: (listener) => {
        listener(projectUiState(appStore.getState()))
        return own(
          ctx,
          appStore.subscribe((next) => {
            listener(projectUiState(next))
          })
        )
      },
      use: (select) => useAppStore((next) => select(projectUiState(next))),
    },
    stats: {
      registerPage: (page) => {
        const pageId = qualify(id, page.id)
        const disposers = [
          registerStatsPage({ glyph: page.glyph, id: pageId, label: page.label }),
          registerStatsPageRenderer(pageId, page.render),
        ]
        return own(ctx, () => {
          for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
        })
      },
    },
    statusBar: {
      register: (segment) =>
        own(
          ctx,
          registerStatusBarSegment({
            id: qualify(id, segment.id),
            render: () => segment.render() as ReactNode,
          })
        ),
    },
    themes: {
      current: () => themeSnapshot(getCurrentTheme(), getCurrentMode()),
      onChange: (listener) =>
        own(
          ctx,
          subscribeThemeChanges((resolved, mode) => {
            listener(themeSnapshot(resolved, mode))
          })
        ),
      register: (themeId, theme) => own(ctx, registerTuiTheme(themeId, theme as TuiThemeJson)),
    },
    toast: {
      error: (message) => {
        toast.error(message)
      },
      info: (message) => {
        toast.info(message)
      },
      success: (message) => {
        toast.success(message)
      },
    },
    views: {
      close: () => {
        dispatchGlobal({ type: 'close-plugin-view' })
      },
      open: (viewId) => {
        dispatchGlobal({ type: 'open-plugin-view', viewId: qualify(id, viewId) })
      },
      register: (view) =>
        own(
          ctx,
          registerPluginView({
            id: qualify(id, view.id),
            pluginId: id,
            render: () => view.render() as ReactNode,
            title: view.title,
          })
        ),
    },
    widgets: {
      register: (widget) =>
        own(
          ctx,
          registerBarWidget({
            id: qualify(id, widget.id),
            label: widget.label,
            render: (contentWidth, size) => widget.render(contentWidth, size) as ReactNode,
          })
        ),
    },
  }
}

function buildActions(ctx: PluginContext): PluginActionsApi {
  const { id } = ctx
  return {
    effect: (effectId, handler) =>
      own(
        ctx,
        registerPluginEffect(id, effectId, async (payload) => {
          await handler(payload)
        })
      ),
    // The keymap binds `<pluginId>.<verb>`; `k.plugin('acme.thing.open')` is
    // the same string a user writes in their config.
    register: (verb, handler, meta) =>
      own(
        ctx,
        registerPluginAction(
          qualify(id, verb),
          (modeCtx) => {
            const result = handler(modeCtx)
            return (result ?? null) as ReturnType<Parameters<typeof registerPluginAction>[1]>
          },
          meta ?? {}
        )
      ),
  }
}

function buildCommands(): PluginCommandsApi {
  return {
    list: () => listPluginCommands(),
    run: (commandId) => runPluginCommand(commandId),
  }
}

function buildStore(ctx: PluginContext): PluginStoreApi {
  const { id } = ctx
  return {
    dispatch: (actionId, payload) => {
      dispatchGlobal({ actionId, payload, pluginId: id, type: 'plugin-action' })
    },
    get: () => appStore.getState().plugins[id],
    reducer: (reduce) => own(ctx, registerPluginSlice(id, reduce)),
    set: (slice) => {
      dispatchGlobal({ pluginId: id, slice, type: 'set-plugin-slice' })
    },
    use: () => useAppStore((state) => state.plugins[id]),
  }
}

/**
 * The `extendContext` the UI kernel is built with. Attaches the three service
 * objects to every UI-half context.
 */
/**
 * What the manifest's `contributes` block asks the interface for: a place for
 * a widget, a key for an action.
 *
 * Applied before the plugin's own `apply` runs, which is deliberate and
 * harmless in both directions — a placed widget whose renderer is not
 * registered yet is an orphan, which bars already skip, and a bound key
 * resolves its action at press time. Both come back off through the fiber, so
 * an unload leaves neither a widget nobody can draw nor a key nobody answers.
 */
function applyContributions(ctx: PluginContext): void {
  const contributes = ctx.manifest.contributes
  if (contributes === undefined) return

  for (const placement of contributes.bars ?? []) {
    const widgetId = qualify(ctx.id, placement.widget)
    dispatchGlobal({
      ...(placement.grow === undefined ? {} : { grow: placement.grow }),
      ...(placement.position === 'start' ? { index: 0 } : {}),
      placedBy: 'plugin',
      side: placement.side ?? 'left',
      type: 'add-widget',
      widgetId,
    })
    ctx.effect(() => () => {
      dispatchGlobal({ type: 'remove-plugin-widget', widgetId })
    })
  }

  const bindings = contributes.keymaps ?? []
  if (bindings.length === 0) return
  const layer = registerKeymapLayer(
    ctx.id,
    bindings.map((binding) => ({
      action: qualify(ctx.id, binding.action),
      keys: binding.key,
      mode: binding.mode,
    }))
  )
  for (const { binding, reason } of layer.refused) {
    // A key that silently does nothing is the worst outcome here, so the
    // reason goes in the plugin's own log where `plugin log` will find it.
    ctx.log.warn(`keybinding not applied: ${binding.keys} in ${binding.mode}`, {
      reason: reason === 'taken' ? 'already bound — aimux.config.ts wins' : 'unparseable',
    })
  }
  ctx.effect(() => () => {
    layer.dispose()
  })
}

export function extendUiPluginContext(ctx: PluginContext): void {
  const extended = ctx as PluginContext & {
    ui: PluginUiApi
    actions: PluginActionsApi
    store: PluginStoreApi
    commands: PluginCommandsApi
  }
  extended.ui = buildUi(ctx)
  extended.actions = buildActions(ctx)
  extended.store = buildStore(ctx)
  extended.commands = buildCommands()
  applyContributions(ctx)
}
