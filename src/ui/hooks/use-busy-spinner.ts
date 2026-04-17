import { useEffect, useState } from 'react'

export const BUSY_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const BUSY_FRAME_INTERVAL_MS = 80

export function useBusySpinner(enabled = true): string {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % BUSY_FRAMES.length)
    }, BUSY_FRAME_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [enabled])

  return BUSY_FRAMES[frame] ?? BUSY_FRAMES[0] ?? ''
}
