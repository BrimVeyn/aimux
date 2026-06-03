import type { SessionStatus } from '../../state/types'

import { useAppStore } from '../../state/app-store'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_SESSION_STATUS } from '../../state/types'
import { useTheme } from '../theme'
import { useBusySpinner } from './use-busy-spinner'

const IDLE = IDLE_SESSION_STATUS

/**
 * Read the activity status of a single worktree from app state.
 *
 * `includeUnassigned` merges in the bucket the detection loop uses for tabs
 * that lack a `worktreeId` (legacy/pre-worktree tabs). Pass `true` for the
 * primary worktree row so it carries those tabs' status, rather than letting
 * them silently vanish from the sidebar.
 */
export function useWorktreeStatus(
  worktreeId: string | undefined,
  includeUnassigned = false
): SessionStatus {
  const direct = useAppStore((s) =>
    worktreeId != null && worktreeId !== '' ? s.worktreeStatuses[worktreeId] : undefined
  )
  const unassigned = useAppStore((s) => (includeUnassigned ? s.worktreeStatuses[''] : undefined))
  if (!direct && !unassigned) return IDLE
  return {
    waiting: (direct?.waiting ?? false) || (unassigned?.waiting ?? false),
    working: (direct?.working ?? false) || (unassigned?.working ?? false),
  }
}

/**
 * Compute the sidebar status glyph + color for a given status. Idle returns
 * a muted bullet, waiting an interrogation glyph, working an animated spinner.
 */
export function useStatusGlyph(status: SessionStatus): { glyph: string; color: string } {
  const t = useTheme()
  const spinner = useBusySpinner(status.working)
  if (status.waiting) return { color: t.warning, glyph: '?' }
  if (status.working) return { color: t.primary, glyph: spinner }
  return { color: t.textMuted, glyph: '•' }
}
