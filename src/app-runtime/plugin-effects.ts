import type { SideEffectContext } from './side-effect-context'

import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'

/**
 * The other half of the plugin-action envelope: where a `plugin-effect` goes
 * when the executor reaches it.
 *
 * Actions change state and must stay pure; effects are where a plugin does the
 * things a reducer may not — spawn a tab, write a file, call out. Splitting
 * them the same way the core does means a plugin's keybinding is built from
 * the same two halves as a built-in one, and `KeyResult` needs no new shape.
 */

export type PluginEffectHandler = (payload: unknown, ctx: SideEffectContext) => void | Promise<void>

const handlers = new Map<string, Map<string, PluginEffectHandler>>()

/**
 * Registers one effect. Returns the disposer the plugin's fiber holds; a
 * reload therefore replaces the handler rather than stacking a second one
 * behind the same id.
 */
export function registerPluginEffect(
  pluginId: string,
  effectId: string,
  handler: PluginEffectHandler
): () => void {
  let byEffect = handlers.get(pluginId)
  if (!byEffect) {
    byEffect = new Map()
    handlers.set(pluginId, byEffect)
  }
  byEffect.set(effectId, handler)
  return () => {
    const current = handlers.get(pluginId)
    if (current?.get(effectId) !== handler) return
    current.delete(effectId)
    if (current.size === 0) handlers.delete(pluginId)
  }
}

/** Test seam. Never called by the app. */
export function clearPluginEffects(): void {
  handlers.clear()
}

/** Effect ids a plugin currently handles — read by `plugin doctor` and tests. */
export function pluginEffectIds(pluginId: string): string[] {
  return [...(handlers.get(pluginId)?.keys() ?? [])]
}

/**
 * Runs a plugin effect. Every failure is contained: a plugin throwing here
 * must not take down the effect executor, which is also draining core effects
 * for the same keystroke.
 */
export function runPluginEffect(
  pluginId: string,
  effectId: string,
  payload: unknown,
  ctx: SideEffectContext
): void {
  const handler = handlers.get(pluginId)?.get(effectId)
  if (!handler) {
    // Reaching an unregistered effect means a keybinding outlived the plugin
    // that answered it — worth saying out loud rather than swallowing, since
    // the key will otherwise just seem dead.
    logDebug('plugin.effect.unhandled', { effectId, pluginId })
    toast.error(`plugin ${pluginId}: no handler for effect "${effectId}"`)
    return
  }
  void invoke(pluginId, effectId, handler, payload, ctx)
}

async function invoke(
  pluginId: string,
  effectId: string,
  handler: PluginEffectHandler,
  payload: unknown,
  ctx: SideEffectContext
): Promise<void> {
  try {
    await handler(payload, ctx)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('plugin.effect.failed', { effectId, error: message, pluginId })
    toast.error(`plugin ${pluginId}.${effectId}: ${message}`)
  }
}
