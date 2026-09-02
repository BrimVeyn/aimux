import type { BuiltinPlugin } from '../plugins/builtin'

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
 */
export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = []
