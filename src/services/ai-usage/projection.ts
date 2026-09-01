import type { UsageWindow } from './types'

/**
 * Where a quota window lands if the current rate holds.
 *
 * Pure, and derived only from what the provider already reports: `percent`,
 * `windowSeconds` and `resetAt` give the elapsed fraction, which is all a linear
 * projection needs. Nothing here parses `timeRemaining` — that is a display
 * string, and a projection built on parsing one breaks the day its wording does.
 */

export type ProjectionVerdict =
  /** The window resets before the quota runs out at this rate. */
  | { kind: 'lasts' }
  /** Not enough of the window has elapsed to say anything honest. */
  | { kind: 'unknown' }
  | { kind: 'exhausted'; at: Date }

/** Below this, one burst early in a window projects to nonsense. */
const MIN_ELAPSED_FRACTION = 0.05

export function projectWindow(window: UsageWindow, now: Date): ProjectionVerdict {
  const { percent, resetAt, windowSeconds } = window
  if (percent === null || resetAt === null || windowSeconds === null || windowSeconds <= 0) {
    return { kind: 'unknown' }
  }

  const resetMs = Date.parse(resetAt)
  if (!Number.isFinite(resetMs)) return { kind: 'unknown' }

  const remainingSeconds = (resetMs - now.getTime()) / 1000
  const elapsedSeconds = windowSeconds - remainingSeconds
  if (remainingSeconds <= 0) return { kind: 'unknown' }
  if (elapsedSeconds / windowSeconds < MIN_ELAPSED_FRACTION) return { kind: 'unknown' }

  if (percent >= 100) return { at: now, kind: 'exhausted' }
  const perSecond = percent / elapsedSeconds
  if (perSecond <= 0) return { kind: 'lasts' }

  const secondsToFull = (100 - percent) / perSecond
  if (secondsToFull >= remainingSeconds) return { kind: 'lasts' }

  return { at: new Date(now.getTime() + secondsToFull * 1000), kind: 'exhausted' }
}
