import { useCallback, useEffect, useRef, useState } from 'react'

const STEP_MS = 28
// Normalized distance off-screen: 1 = fully hidden, 0 = resting. Eased so the
// toast decelerates in and accelerates out.
const ENTER_FRAMES = [1, 0.55, 0.3, 0.15, 0.05, 0]
const EXIT_FRAMES = [0.2, 0.45, 0.72, 1]

interface ToastAnimationOptions {
  reduceMotion: boolean
  onExited: () => void
}

/**
 * Drives a toast's slide via a frame loop (terminals have no opacity/transform,
 * so motion is a stepped integer offset). Returns `away` in [0,1] — multiply by a
 * pixel distance to get the cell offset — and `requestExit` to slide back out.
 */
export function useToastAnimation({ onExited, reduceMotion }: ToastAnimationOptions): {
  away: number
  requestExit: () => void
} {
  const [away, setAway] = useState(reduceMotion ? 0 : 1)
  const exitingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited

  const runFrames = useCallback((frames: number[], done?: () => void) => {
    if (timerRef.current != null) clearInterval(timerRef.current)
    let index = 0
    setAway(frames[0] ?? 0)
    timerRef.current = setInterval(() => {
      index += 1
      if (index >= frames.length) {
        if (timerRef.current != null) clearInterval(timerRef.current)
        timerRef.current = null
        done?.()
        return
      }
      setAway(frames[index] ?? 0)
    }, STEP_MS)
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    runFrames(ENTER_FRAMES)
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current)
    }
  }, [reduceMotion, runFrames])

  const requestExit = useCallback(() => {
    if (exitingRef.current) return
    exitingRef.current = true
    if (reduceMotion) {
      onExitedRef.current()
      return
    }
    runFrames(EXIT_FRAMES, () => onExitedRef.current())
  }, [reduceMotion, runFrames])

  return { away, requestExit }
}
