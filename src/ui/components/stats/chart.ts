/**
 * The vertical bar chart as pure string building, like `table.ts`: an off-by-one
 * in the row thresholds draws bars that do not sit on the baseline, and only a
 * string-level test catches that.
 */

/**
 * Two columns of bar, one of gap.
 *
 * A one-column bar packs twice the days in, but a bar you cannot point at is
 * not worth the days: at that width there is no room to label which day is
 * which, and every column looks like every other. Two columns is wide enough
 * to carry a date ruler underneath and to read a single day off the chart.
 *
 * The cap is LOWER HALF BLOCK — the body's width, half its height — so a column
 * can end part-way up a row. Twenty levels over a ten-row chart.
 */
const BAR_WIDTH = 2
const GAP = 1
const BODY = '\u{2588}'.repeat(BAR_WIDTH)
const CAP = '\u{2584}'.repeat(BAR_WIDTH)
const BLANK = ' '.repeat(BAR_WIDTH)
const SPACER = ' '.repeat(GAP)
/** Bar plus gap: the columns one day occupies. */
export const CHART_STRIDE = BAR_WIDTH + GAP

export interface ChartLines {
  /** One label per row, top first, all the same width; blank on unlabelled rows. */
  axis: string[]
  /** One string per row, top first — bar columns separated by gaps. */
  bars: string[]
  /** The value the top of the chart stands for. */
  niceMax: number
}

/** How many bars fit in `width` columns, capped at `max` days. */
export function chartColumns(width: number, max = 45): number {
  return Math.max(4, Math.min(max, Math.floor(width / CHART_STRIDE)))
}

/**
 * A ruler under the columns: each label sits under the bar it belongs to.
 *
 * Labels come in one per bar, blank where a bar goes unlabelled — the caller
 * decides the interval, because how often a date is worth repeating depends on
 * what the dates are. A label that would run into the one before it is dropped
 * rather than overlapping.
 */
export function buildRuler(labels: string[]): string {
  const chars: string[] = Array.from({ length: labels.length * CHART_STRIDE }, () => ' ')
  let usedUpTo = 0
  for (const [index, label] of labels.entries()) {
    if (label === '') continue
    // Pulled back from the right edge rather than dropped: the last bar is
    // today, and today is the one date on the ruler worth reading.
    const offset = Math.min(index * CHART_STRIDE, chars.length - label.length)
    if (offset < usedUpTo) continue
    for (let position = 0; position < label.length; position++) {
      chars[offset + position] = label[position] ?? ' '
    }
    usedUpTo = offset + label.length + 1
  }
  return chars.join('')
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
  height = 10,
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
          // How much of *this* row the column fills, 0 to 1, rounded to the
          // nearest half — the two levels the body and the cap can express.
          const fill = Math.min(1, Math.max(0, (value / niceMax) * height - (row - 1)))
          if (fill >= 0.75) return BODY
          if (fill >= 0.25) return CAP
          // The bottom row keeps any non-zero day visible: a recorded day that
          // renders as nothing reads as a gap in the data rather than as a
          // quiet day.
          return row === 1 && value > 0 ? CAP : BLANK
        })
        .join(SPACER)
    )
  }
  return { axis, bars, niceMax }
}
