import type { ProjectRecord } from '../state/types'

/**
 * Return projects in user-facing display order: persisted `order` ascending,
 * with any missing `order` falling back to `createdAt` ascending.
 */
export function orderProjectsForDisplay(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER
    const bo = b.order ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/**
 * Move `moveId` into the gap `insertIndex` — 0 is before the first id,
 * `ids.length` is after the last, matching the drop bars drawn between rows.
 * Returns the input array itself when the move changes nothing, so callers can
 * skip the dispatch with a reference check.
 */
export function moveIdToInsertIndex(ids: string[], moveId: string, insertIndex: number): string[] {
  const from = ids.indexOf(moveId)
  if (from < 0) return ids
  // Removing the id first shifts every later gap down by one.
  const to = insertIndex > from ? insertIndex - 1 : insertIndex
  if (to === from) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, moveId)
  return next
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
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, moveId)
  return next
}
