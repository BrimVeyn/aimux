import type {
  Disposer,
  PluginActionsApi,
  PluginContext,
  PluginKit,
  PluginStoreApi,
  PluginUiApi,
} from '@brimveyn/aimux-plugin'
import type { ReactNode } from 'react'

import {
  registerPluginAction,
  registerTuiTheme,
  type SettingSection,
  type TuiThemeJson,
} from '@brimveyn/aimux-config'

import { registerPluginEffect } from '../app-runtime/plugin-effects'
import { registerSettingSection } from '../settings/sections'
import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { registerPluginSlice } from '../state/reducers/plugin-slices'
import { registerStatsPage, registerStatsPageRenderer } from '../state/stats-pages'
import { toast } from '../state/toast-store'
import { KeyHint, List, Panel, Row, usePluginTheme } from './plugin-kit'
import { registerPluginModal } from './plugin-modals'
import { registerPluginView } from './plugin-views'
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

function buildUi(ctx: PluginContext): PluginUiApi {
  const { id } = ctx
  return {
    kit: KIT,
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
    settings: {
      registerSection: (section) => own(ctx, registerSettingSection(section as SettingSection)),
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
    themes: {
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
            render: (contentWidth) => widget.render(contentWidth) as ReactNode,
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
    register: (verb, handler) =>
      own(
        ctx,
        registerPluginAction(qualify(id, verb), (modeCtx) => {
          const result = handler(modeCtx)
          return (result ?? null) as ReturnType<Parameters<typeof registerPluginAction>[1]>
        })
      ),
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
  }
}

/**
 * The `extendContext` the UI kernel is built with. Attaches the three service
 * objects to every UI-half context.
 */
export function extendUiPluginContext(ctx: PluginContext): void {
  const extended = ctx as PluginContext & {
    ui: PluginUiApi
    actions: PluginActionsApi
    store: PluginStoreApi
  }
  extended.ui = buildUi(ctx)
  extended.actions = buildActions(ctx)
  extended.store = buildStore(ctx)
}
