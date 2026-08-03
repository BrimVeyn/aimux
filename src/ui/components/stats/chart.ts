/**
 * The vertical bar chart as pure string building, like `table.ts`: an off-by-one
 * in the row thresholds draws bars that do not sit on the baseline, and only a
 * string-level test catches that.
 */

const BAR_WIDTH = 2
const GAP = 1
const FULL = '\u{2588}'.repeat(BAR_WIDTH)
const HALF = '\u{2584}'.repeat(BAR_WIDTH)
const BLANK = ' '.repeat(BAR_WIDTH)
const SPACER = ' '.repeat(GAP)

export interface ChartLines {
  /** One label per row, top first, all the same width; blank on unlabelled rows. */
  axis: string[]
  /** One string per row, top first — bar columns separated by gaps. */
  bars: string[]
  /** The value the top of the chart stands for. */
  niceMax: number
}

/** How many bars fit in `width` columns, capped at `max` days. */
export function chartColumns(width: number, max = 32): number {
  return Math.max(4, Math.min(max, Math.floor(width / (BAR_WIDTH + GAP))))
}

/**
 * The smallest 1, 2 or 5 times a power of ten that covers `raw`.
 *
 * Without this the step is whatever `max / height` happens to be, and the axis
 * reads 798K, 399K — numbers that look like measurements when they are only
 * arithmetic. A reader should be able to tell a bar's value from the axis, which
 * needs gridlines on numbers worth counting in.
 */
function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const multiple of [1, 2, 5]) {
    if (multiple * magnitude >= raw) return multiple * magnitude
  }
  return 10 * magnitude
}

/**
 * Scale the chart so every axis label is a round number: the max rounds up to a
 * multiple of the height, and each row is worth exactly `niceMax / height`.
 *
 * `format` is for series whose raw numbers are unreadable on an axis — millions
 * of tokens want `2.4M`, not `2400000`, which would be wider than the chart.
 */
export function buildChart(
  values: number[],
  height = 8,
  format: (value: number) => string = String
): ChartLines {
  const max = Math.max(...values, 0)
  // A floor of one: these are counts, so half a prompt is not a gridline.
  const step = Math.max(1, niceStep(max / height))
  const niceMax = step * height
  const axisWidth = Math.max(
    ...Array.from({ length: height }, (_, row) => format(step * (row + 1)).length)
  )

  const axis: string[] = []
  const bars: string[] = []
  for (let row = height; row >= 1; row--) {
    const labelled = row === height || row % 2 === 0
    axis.push(labelled ? format(step * row).padStart(axisWidth) : ' '.repeat(axisWidth))
    bars.push(
      values
        .map((value) => {
          const scaled = (value / niceMax) * height
          if (scaled >= row - 0.25) return FULL
          // The bottom row keeps any non-zero day visible: a recorded day that
          // renders as nothing reads as a gap in the data.
          if (scaled >= row - 0.75 || (row === 1 && value > 0)) return HALF
          return BLANK
        })
        .join(SPACER)
    )
  }
  return { axis, bars, niceMax }
}
