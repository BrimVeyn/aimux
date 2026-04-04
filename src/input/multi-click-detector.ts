import { logInputDebug } from '../debug/input-log'

const MULTI_CLICK_TIMEOUT_MS = 400
const MULTI_CLICK_MAX_DISTANCE = 1

export class MultiClickDetector {
  private lastClickTime = 0
  private lastX = -1
  private lastY = -1
  private clickCount = 0

  track(x: number, y: number): number {
    const now = Date.now()
    const prevX = this.lastX
    const prevY = this.lastY
    const prevTime = this.lastClickTime
    // X tolerance allows slight horizontal drift during rapid clicks.
    // Y must match exactly because 1 pixel = 1 terminal row — a 1-pixel
    // vertical shift means a completely different line.
    const samePosition = Math.abs(x - this.lastX) <= MULTI_CLICK_MAX_DISTANCE && y === this.lastY
    const withinTimeout = now - this.lastClickTime < MULTI_CLICK_TIMEOUT_MS

    if (samePosition && withinTimeout && this.clickCount < 3) {
      this.clickCount += 1
    } else {
      this.clickCount = 1
    }

    this.lastClickTime = now
    this.lastX = x
    this.lastY = y

    logInputDebug('multiclick.track', {
      count: this.clickCount,
      dt: now - prevTime,
      dX: Math.abs(x - prevX),
      dY: Math.abs(y - prevY),
      inTime: withinTimeout,
      prevX,
      prevY,
      samePos: samePosition,
      x,
      y,
    })

    return this.clickCount
  }

  reset(): void {
    this.clickCount = 0
    this.lastClickTime = 0
    this.lastX = -1
    this.lastY = -1
  }
}
