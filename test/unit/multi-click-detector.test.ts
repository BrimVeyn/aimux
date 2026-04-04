import { beforeEach, expect, test } from 'bun:test'

import { MultiClickDetector } from '../../src/input/multi-click-detector'

let detector: MultiClickDetector

beforeEach(() => {
  detector = new MultiClickDetector()
})

test('first click returns 1', () => {
  expect(detector.track(5, 3)).toBe(1)
})

test('second click at same position within timeout returns 2', () => {
  detector.track(5, 3)
  expect(detector.track(5, 3)).toBe(2)
})

test('third click at same position within timeout returns 3', () => {
  detector.track(5, 3)
  detector.track(5, 3)
  expect(detector.track(5, 3)).toBe(3)
})

test('fourth click resets to 1', () => {
  detector.track(5, 3)
  detector.track(5, 3)
  detector.track(5, 3)
  expect(detector.track(5, 3)).toBe(1)
})

test('click at different position resets to 1', () => {
  detector.track(5, 3)
  expect(detector.track(10, 3)).toBe(1)
})

test('click within distance tolerance counts as same position', () => {
  detector.track(5, 3)
  expect(detector.track(6, 3)).toBe(2)
})

test('click beyond distance tolerance resets to 1', () => {
  detector.track(5, 3)
  expect(detector.track(7, 3)).toBe(1)
})

test('click after timeout resets to 1', async () => {
  detector.track(5, 3)
  await new Promise((resolve) => setTimeout(resolve, 450))
  expect(detector.track(5, 3)).toBe(1)
})

test('reset clears state', () => {
  detector.track(5, 3)
  detector.track(5, 3)
  detector.reset()
  expect(detector.track(5, 3)).toBe(1)
})
