const MULTI_CLICK_TIMEOUT_MS = 400
const MULTI_CLICK_MAX_DISTANCE = 1

export class MultiClickDetector {
  private lastClickTime = 0
  private lastX = -1
  private lastY = -1
  private clickCount = 0

  track(x: number, y: number): number {
    const now = Date.now()
    const samePosition =
      Math.abs(x - this.lastX) <= MULTI_CLICK_MAX_DISTANCE &&
      Math.abs(y - this.lastY) <= MULTI_CLICK_MAX_DISTANCE
    const withinTimeout = now - this.lastClickTime < MULTI_CLICK_TIMEOUT_MS

    if (samePosition && withinTimeout && this.clickCount < 3) {
      this.clickCount += 1
    } else {
      this.clickCount = 1
    }

    this.lastClickTime = now
    this.lastX = x
    this.lastY = y
    return this.clickCount
  }

  reset(): void {
    this.clickCount = 0
    this.lastClickTime = 0
    this.lastX = -1
    this.lastY = -1
  }
}
