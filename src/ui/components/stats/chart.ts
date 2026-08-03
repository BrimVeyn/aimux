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
const SOLID = '\u{2588}'
const HALF = '\u{2584}'

export interface BarShape {
  /** Blank columns between bars. Zero packs a distribution into one silhouette. */
  gap: number
  /** Columns of bar. */
  width: number
}

const DEFAULT_SHAPE: BarShape = { gap: 1, width: 2 }
/** Bar plus gap: the columns one day occupies. */
export const CHART_STRIDE = DEFAULT_SHAPE.width + DEFAULT_SHAPE.gap

export function strideOf(shape: BarShape = DEFAULT_SHAPE): number {
  return shape.width + shape.gap
}

/**
 * The widest shape whose `count` bars fit in `room` columns.
 *
 * A series with a fixed number of bars — the 24 hours of a day — cannot drop
 * columns to fit a narrow terminal the way a rolling window can, so it gives up
 * the gap first and the second column of bar only after that. The last rung
 * always fits something, even when it overflows: a squeezed chart beats none.
 */
const NARROWEST: BarShape = { gap: 0, width: 1 }

export function fitShape(count: number, room: number): BarShape {
  const ladder: BarShape[] = [DEFAULT_SHAPE, { gap: 0, width: 2 }, { gap: 1, width: 1 }, NARROWEST]
  return (
    ladder.find((shape) => count * shape.width + Math.max(0, count - 1) * shape.gap <= room) ??
    NARROWEST
  )
}

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
export function buildRuler(labels: string[], stride = CHART_STRIDE): string {
  const chars: string[] = Array.from({ length: labels.length * stride }, () => ' ')
  let usedUpTo = 0
  for (const [index, label] of labels.entries()) {
    if (label === '') continue
    // Pulled back from the right edge rather than dropped: the last bar is
    // today, and today is the one date on the ruler worth reading.
    const offset = Math.min(index * stride, chars.length - label.length)
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
  format: (value: number) => string = String,
  shape: BarShape = DEFAULT_SHAPE
): ChartLines {
  const body = SOLID.repeat(shape.width)
  const cap = HALF.repeat(shape.width)
  const blank = ' '.repeat(shape.width)
  const spacer = ' '.repeat(shape.gap)
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
          if (fill >= 0.75) return body
          if (fill >= 0.25) return cap
          // The bottom row keeps any non-zero day visible: a recorded day that
          // renders as nothing reads as a gap in the data rather than as a
          // quiet day.
          return row === 1 && value > 0 ? cap : blank
        })
        .join(spacer)
    )
  }
  return { axis, bars, niceMax }
}
