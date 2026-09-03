import type { ActionFn, KeyResult, ModeContext } from './types'

/**
 * Named actions a plugin contributes, so a user's keymap can bind one by name
 * before the plugin that answers it has loaded — or at all.
 *
 * A keymap is resolved at startup from `aimux.config.ts`, and plugins load
 * after that. Binding a function directly would mean the config file could
 * only reference plugins it imported, which is exactly the coupling a plugin
 * system is supposed to remove. Binding a *name* defers the lookup to the
 * moment the key is pressed.
 *
 * Lives in this package, alongside the other runtime singletons
 * (`auto-commit-runtime`, `multi-repo-runtime`), because that is where the
 * action factories a config file calls already are.
 */

/** Qualified `<pluginId>.<verb>` — the id a keymap writes. */
const handlers = new Map<string, ActionFn>()

export function registerPluginAction(name: string, handler: ActionFn): () => void {
  handlers.set(name, handler)
  return () => {
    if (handlers.get(name) === handler) handlers.delete(name)
  }
}

/** Test seam. Never called by the app. */
export function clearPluginActions(): void {
  handlers.clear()
}

export function pluginActionNames(): string[] {
  return [...handlers.keys()]
}

export function hasPluginAction(name: string): boolean {
  return handlers.has(name)
}

/**
 * The `Action` a keymap binds. Resolved on every keypress rather than at
 * registration: a plugin that is not loaded yet, is disabled, or failed simply
 * yields `null`, which is the same "this key does nothing here" a mode with no
 * binding produces. Anything louder would turn one broken plugin into a broken
 * keyboard.
 */
export function pluginAction(name: string): ActionFn {
  return (ctx: ModeContext): KeyResult | null => handlers.get(name)?.(ctx) ?? null
}
