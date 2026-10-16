import type { BoxRenderable, OptimizedBuffer } from '@opentui/core'

import { useRenderer } from '@opentui/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { mixColor } from '../../services/usage-history/stats'

const STEP_MS = 50
// One pulse: a quick swell, a short hold at the peak so it is seen, then a fade
// down to the resting tint. ~0.7s end to end.
export const PULSE_FRAMES = [0.5, 0.85, 1, 1, 1, 1, 1, 0.9, 0.78, 0.66, 0.55, 0.45, 0.37, 0.3]
// How far toward the accent the strongest cell goes. Short of a full fill, so
// the row's own text stays readable through the peak.
const PEAK = 0.4
// The tint a row keeps, as a fraction of the peak, for as long as its state lasts.
const RESTING = 0.3
// The fraction of the row's width the ramp covers before it reaches the surface.
const REACH = 0.6

/**
 * A single background pulse when `state` changes to something worth looking
 * at — the row's version of a notification — settling into a faint tint that
 * stays while the state does. Returns a `renderAfter` for the row's box: it
 * paints over the box's own background and under its children, a horizontal
 * ramp from `accent` at the left edge fading into `rest` partway across.
 * `state` null paints nothing; the first value seen tints without pulsing.
 */
export function useStatusPulse(
  state: string | null,
  accent: string,
  rest: string
): (this: BoxRenderable, buffer: OptimizedBuffer) => void {
  const renderer = useRenderer()
  const [frame, setFrame] = useState(-1)
  const prevRef = useRef(state)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = state
    if (state === null || state === prev) return
    let index = 0
    setFrame(0)
    const timer = setInterval(() => {
      index += 1
      setFrame(index < PULSE_FRAMES.length ? index : -1)
      renderer.requestRender()
      if (index >= PULSE_FRAMES.length) clearInterval(timer)
    }, STEP_MS)
    return () => {
      clearInterval(timer)
      setFrame(-1)
    }
  }, [renderer, state])

  const strength = state === null ? 0 : Math.max(PULSE_FRAMES[frame] ?? 0, RESTING)
  const paint = useCallback(
    function (this: BoxRenderable, buffer: OptimizedBuffer): void {
      if (strength === 0) return
      const reach = this.width * REACH
      for (let x = 0; x < reach; x++) {
        const ratio = PEAK * strength * (1 - x / reach)
        buffer.fillRect(
          this.screenX + x,
          this.screenY,
          1,
          this.height,
          mixColor(rest, accent, ratio)
        )
      }
    },
    [accent, rest, strength]
  )
  return paint
}
