import type { ActivityTransitionArgs } from './auto-commit-driver'

type TriggerFn = (args: ActivityTransitionArgs) => Promise<void>

let activeTrigger: TriggerFn | null = null

export function setActiveAutoCommitDriver(trigger: TriggerFn | null): void {
  activeTrigger = trigger
}

export function triggerAutoCommitNow(args: ActivityTransitionArgs): Promise<void> {
  if (!activeTrigger) return Promise.resolve()
  return activeTrigger(args)
}
