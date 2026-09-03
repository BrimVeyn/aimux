/**
 * The calendar both halves talk about, and the grid maths.
 *
 * Pure: no dates from `now`, no I/O. That is what makes the grid testable and
 * what keeps the drawing half from having an opinion about time zones.
 */

export interface Calendar {
  /** `gh` when GitHub answered, `git` when it fell back to the local repo. */
  source: 'gh' | 'git' | 'none'
  label: string
  total: number
  /** `YYYY-MM-DD` → commits that day. Sparse: only days with commits.  */
  counts: Record<string, number>
}

export const EMPTY_CALENDAR: Calendar = { counts: {}, label: '', source: 'none', total: 0 }

/** Local calendar day, the same shape GitHub and `git log --date=short` use. */
export function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Weeks of seven days, oldest week first, each week running Sunday → Saturday
 * and ending on `today`. The trailing week is padded with `null` so the last
 * column is the current week rather than a whole one shifted.
 */
export interface GridCell {
  /** `YYYY-MM-DD`. A cell knowing its own date is what gives it a React key. */
  day: string
  count: number
  /** Days after today: drawn as a gap, so the grid ends where the year does. */
  future: boolean
}

export function buildGrid(
  counts: Record<string, number>,
  today: Date,
  weeks: number
): GridCell[][] {
  const grid: GridCell[][] = []
  const cursor = new Date(today)
  // Walk back to the Sunday of the oldest week we will draw.
  cursor.setDate(cursor.getDate() - today.getDay() - (weeks - 1) * 7)

  for (let week = 0; week < weeks; week++) {
    const column: GridCell[] = []
    for (let day = 0; day < 7; day++) {
      const key = dayKey(cursor)
      column.push({ count: counts[key] ?? 0, day: key, future: cursor > today })
      cursor.setDate(cursor.getDate() + 1)
    }
    grid.push(column)
  }
  return grid
}

/**
 * 0-3, the four shades a contribution grid has always had. Relative to the
 * busiest day rather than to fixed thresholds: someone who commits twice a day
 * and someone who commits forty times should both see a grid, not a flat wall.
 */
export function level(count: number, busiest: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0
  if (busiest <= 1) return 3
  const ratio = count / busiest
  if (ratio > 0.66) return 3
  if (ratio > 0.33) return 2
  return 1
}

export function busiestDay(counts: Record<string, number>): number {
  let busiest = 0
  for (const value of Object.values(counts)) busiest = Math.max(busiest, value)
  return busiest
}
