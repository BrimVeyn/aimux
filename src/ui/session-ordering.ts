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

/**
 * Move `moveId` to the slot currently held by `intoPositionOfId`, shifting the
 * displaced id in the opposite direction. Pure; returns a new array. Returns
 * the input unchanged if either id is missing or both refer to the same slot.
 */
export function moveIdToIdPosition(
  ids: string[],
  moveId: string,
  intoPositionOfId: string
): string[] {
  if (moveId === intoPositionOfId) return ids
  const from = ids.indexOf(moveId)
  const to = ids.indexOf(intoPositionOfId)
  if (from < 0 || to < 0) return ids
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(to, 0, moveId)
  return next
}
