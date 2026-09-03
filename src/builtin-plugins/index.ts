import type { ResolvedConfig } from '@brimveyn/aimux-config'

import type { BuiltinPlugin } from '../plugins/builtin'

import { aiUsagePlugin } from './ai-usage'
import { CLAUDE_PLUGIN } from './claude'

/**
 * The plugins aimux ships with.
 *
 * Phase 4 of the plugin plan: features aimux already had, re-expressed through
 * the public plugin API. The point is not tidiness — it is that the API is
 * only trustworthy once it carries real weight. Anything a migration could not
 * do cleanly was an API hole, and the hole was filled before the migration
 * landed.
 *
 * A built-in is switched off like anything else, from `aimux.config.ts`:
 *
 *   plugins: [{ id: 'aimux.claude', enabled: false }]
 *
 * Takes the resolved config because a migrated feature keeps the keys it was
 * always configured under: the mapping from `statusBar.aiUsage.*` and friends
 * to a plugin's `ctx.config` lives in the built-in's own declaration, so the
 * plugin body reads nothing aimux-specific. Callable with nothing when only
 * the ids are wanted.
 */
export function builtinPlugins(config?: ResolvedConfig): readonly BuiltinPlugin[] {
  return [CLAUDE_PLUGIN, aiUsagePlugin(config)]
}
