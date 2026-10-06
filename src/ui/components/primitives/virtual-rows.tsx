import type { BoxRenderable, MouseEvent } from '@opentui/core'

import { type ReactNode, useCallback, useRef, useState } from 'react'

/** Rows kept between the cursor and the edge, as vim's `scrolloff`. */
const SCROLLOFF = 3

/** Rows one notch of the wheel moves. */
const WHEEL_STEP = 3

/**
 * The first row drawn, moved only as far as it takes to keep `cursor` at least
 * `scrolloff` rows from either edge. A `scrolloff` larger than half the room
 * keeps the cursor in the middle, as vim's `scrolloff=999` does.
 */
export function followCursor(
  top: number,
  cursor: number,
  height: number,
  count: number,
  scrolloff = SCROLLOFF
): number {
  const last = Math.max(0, count - height)
  let next = Math.min(Math.max(top, 0), last)
  if (cursor < 0 || height <= 0) return next
  const margin = Math.min(scrolloff, Math.floor((height - 1) / 2))
  if (cursor < next + margin) next = cursor - margin
  else if (cursor > next + height - 1 - margin) next = cursor - height + 1 + margin
  return Math.min(Math.max(next, 0), last)
}

interface VirtualRowsProps {
  count: number
  /** The cursor's row, kept in view. -1 for none. */
  cursor: number
  /** One line, drawn only while it is on screen. */
  renderRow: (index: number) => ReactNode
  keyOf: (index: number) => string
  scrolloff?: number
}

/**
 * A column of one-line rows of which only those on screen exist.
 *
 * A scrollbox mounts every child, and even with viewport culling every one of
 * them is laid out on every frame: a list of thousands costs hundreds of
 * milliseconds a keypress whatever is drawn. Here the room is measured and
 * that many rows are rendered, from a first row that follows the cursor and
 * that the wheel moves on its own.
 */
export function VirtualRows({
  count,
  cursor,
  keyOf,
  renderRow,
  scrolloff = SCROLLOFF,
}: VirtualRowsProps): ReactNode {
  const ref = useRef<BoxRenderable | null>(null)
  const [height, setHeight] = useState(0)
  const [top, setTop] = useState(0)
  // Follows the cursor when it moves, or the room changes — and only then, so
  // a wheel that scrolled the cursor out of sight is not undone by the next
  // unrelated render. Set during render, as React's derived state is.
  const [followed, setFollowed] = useState({ cursor: -1, height: 0 })
  if (followed.cursor !== cursor || followed.height !== height) {
    setFollowed({ cursor, height })
    setTop(followCursor(top, cursor, height, count, scrolloff))
  }
  const first = Math.min(Math.max(top, 0), Math.max(0, count - height))

  const measure = useCallback(() => setHeight(ref.current?.height ?? 0), [])
  const handleScroll = useCallback(
    (event: MouseEvent) => {
      const step = event.scroll?.direction === 'up' ? -WHEEL_STEP : WHEEL_STEP
      setTop((at) => Math.min(Math.max(at + step, 0), Math.max(0, count - height)))
    },
    [count, height]
  )

  const rows: ReactNode[] = []
  for (let index = first; index < Math.min(count, first + height); index++) {
    // One line each, whatever the row draws: a row that wrapped would push
    // the last one off the bottom, and the count is what the room was sized by.
    rows.push(
      <box key={keyOf(index)} height={1} flexShrink={0} flexDirection="column" overflow="hidden">
        {renderRow(index)}
      </box>
    )
  }
  return (
    <box
      ref={ref}
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      onSizeChange={measure}
      onMouseScroll={handleScroll}
    >
      {rows}
    </box>
  )
}
