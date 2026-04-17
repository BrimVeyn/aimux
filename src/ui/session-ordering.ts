import type { SessionRecord } from '../state/types'

/**
 * Return sessions in user-facing display order: persisted `order` ascending,
 * with any missing `order` falling back to `createdAt` ascending.
 */
export function orderSessionsForDisplay(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice().sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER
    const bo = b.order ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.createdAt.localeCompare(b.createdAt)
  })
}
