import { useEffect, useState } from 'react'

import { type CounterDays, readCounters } from '../../../services/aimux-counters/store'
import { localDay, readUsageHistory, type UsageDays } from '../../../services/usage-history/store'

export interface StatsData {
  claude: UsageDays
  codex: UsageDays
  counters: CounterDays
  /** Local day key for "today", captured once so every page agrees on it. */
  today: string
  todayDate: Date
}

/**
 * Reads both on-disk files once, when the screen opens.
 *
 * Synchronous and small: the history file is ~100 KB after a full year and the
 * counters file is a few KB. Re-reading on every page change would reparse them
 * for nothing, so the read is tied to the screen, not to the page.
 */
export function useStatsData(): StatsData | null {
  const [data, setData] = useState<StatsData | null>(null)

  useEffect(() => {
    const history = readUsageHistory()
    const todayDate = new Date()
    setData({
      claude: history.tools.claude ?? {},
      codex: history.tools.codex ?? {},
      counters: readCounters().days,
      today: localDay(todayDate),
      todayDate,
    })
  }, [])

  return data
}

/** True when nothing has been recorded yet, so a page can say so instead of rendering zeros. */
export function isEmpty(days: UsageDays): boolean {
  return Object.keys(days).length === 0
}
