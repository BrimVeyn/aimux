import type { ActivityTransitionArgs } from './auto-commit-driver'

type TriggerFn = (args: ActivityTransitionArgs) => Promise<void>

let activeTrigger: TriggerFn | null = null

export function setActiveAutoCommitDriver(trigger: TriggerFn | null): void {
  activeTrigger = trigger
}

// Identity-checked cleanup: only clears the slot if it still holds `trigger`.
// Prevents a re-mounted hook from nulling out a live registration.
export function clearActiveAutoCommitDriverIfMatches(trigger: TriggerFn): void {
  if (activeTrigger === trigger) activeTrigger = null
}

export function triggerAutoCommitNow(args: ActivityTransitionArgs): Promise<void> {
  if (!activeTrigger) return Promise.resolve()
  return activeTrigger(args)
}
