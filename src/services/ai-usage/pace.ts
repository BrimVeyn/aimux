import type { UsagePace, UsagePaceStage } from './types'

function stageFor(delta: number): UsagePaceStage {
  const abs = Math.abs(delta)
  if (abs <= 2) return 'onTrack'
  if (abs <= 6) return delta >= 0 ? 'slightlyBehind' : 'slightlyAhead'
  if (abs <= 12) return delta >= 0 ? 'behind' : 'ahead'
  return delta >= 0 ? 'farBehind' : 'farAhead'
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    const hh = h % 24
    return hh > 0 ? `${d}d ${hh}h` : `${d}d`
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

export function computePace(opts: {
  percent: number | null
  resetAtMs: number | null
  windowSeconds: number | null
  now?: number
}): UsagePace | null {
  const { percent, resetAtMs, windowSeconds } = opts
  const now = opts.now ?? Date.now()
  if (percent === null || resetAtMs === null || !windowSeconds || windowSeconds <= 0) {
    return null
  }

  const timeUntilReset = (resetAtMs - now) / 1000
  if (timeUntilReset <= 0 || timeUntilReset > windowSeconds) return null

  const elapsed = Math.max(0, Math.min(windowSeconds, windowSeconds - timeUntilReset))
  const expected = Math.max(0, Math.min(100, (elapsed / windowSeconds) * 100))
  const actual = Math.max(0, Math.min(100, percent))
  const delta = actual - expected
  const stage = stageFor(delta)

  let rightText: string | null = null
  if (elapsed > 0 && actual > 0) {
    const rate = actual / elapsed
    if (rate > 0) {
      const remaining = Math.max(0, 100 - actual)
      const candidate = remaining / rate
      if (candidate >= timeUntilReset) {
        rightText = 'Lasts to reset'
      } else {
        rightText = `Runs out in ${formatDuration(candidate)}`
      }
    }
  } else if (elapsed > 0 && actual === 0) {
    rightText = 'Lasts to reset'
  }

  const rounded = Math.round(delta)
  let label: string
  if (stage === 'onTrack') {
    label = 'On pace'
  } else if (delta > 0) {
    label = `Behind (+${rounded}%)`
  } else {
    label = `Ahead (${rounded}%)`
  }

  return { delta, label, rightText, stage }
}

export function formatTimeRemaining(resetAtMs: number | null, now?: number): string | null {
  if (resetAtMs === null) return null
  const diff = resetAtMs - (now ?? Date.now())
  if (diff <= 0) return null
  return formatDuration(diff / 1000)
}
