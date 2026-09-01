import { useEffect, useState } from 'react'

/**
 * `value`, but only once it has stopped changing for `ms`. The first value is
 * returned as-is, so mounting is never delayed.
 *
 * Everything keyed on the active workspace's path — git status, PR checks,
 * nested-repo discovery — restarts its poller and fires an immediate tick when
 * that path changes. Holding `j`/`k` through the sidebar changes it at
 * key-repeat rate, so without this every keypress spawned a `git status`
 * fan-out and a network-bound `gh pr view` that the next keypress discarded.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return settled
}
