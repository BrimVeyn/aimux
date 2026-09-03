import type { PluginContext, PluginDefinition } from './types'

/**
 * Identity function that pins the context type, so `apply(ctx)` is inferred
 * rather than annotated:
 *
 * ```ts
 * export default definePlugin<UiPluginContext>({
 *   inject: ['ui'],
 *   apply(ctx) { ctx.log.info('hello') },
 * })
 * ```
 *
 * Plain `definePlugin({ … })` gives the base context, which is all a plugin
 * that only uses `log` / `config` / `effect` / `on` / `rpc` needs.
 */
export function definePlugin<Ctx extends PluginContext = PluginContext>(
  definition: PluginDefinition<Ctx>
): PluginDefinition<Ctx> {
  return definition
}
