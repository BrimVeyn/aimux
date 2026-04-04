import { MouseButton, MouseEvent } from '@opentui/core'
import { describe, expect, test } from 'bun:test'

import { encodeMouseEventForPty } from '../../src/input/mouse-forwarding'

const ORIGIN = { cols: 80, rows: 24, x: 34, y: 3 }

function createMouseEvent(attributes: ConstructorParameters<typeof MouseEvent>[1]): MouseEvent {
  return new MouseEvent(null, attributes)
}

describe('encodeMouseEventForPty', () => {
  test('encodes click events', () => {
    const event = createMouseEvent({
      button: MouseButton.LEFT,
      modifiers: { alt: false, ctrl: false, shift: false },
      type: 'down',
      x: 40,
      y: 10,
    })

    expect(encodeMouseEventForPty(event, ORIGIN)).toBe('\x1b[<0;7;8M')
  })

  test('encodes mouse release with SGR release code', () => {
    const event = createMouseEvent({
      button: MouseButton.LEFT,
      modifiers: { alt: false, ctrl: false, shift: false },
      type: 'up',
      x: 40,
      y: 10,
    })

    expect(encodeMouseEventForPty(event, ORIGIN)).toBe('\x1b[<3;7;8m')
  })

  test('encodes scroll events from scroll direction', () => {
    const event = createMouseEvent({
      button: MouseButton.LEFT,
      modifiers: { alt: false, ctrl: false, shift: false },
      scroll: { delta: 1, direction: 'up' },
      type: 'scroll',
      x: 40,
      y: 10,
    })

    expect(encodeMouseEventForPty(event, ORIGIN)).toBe('\x1b[<64;7;8M')
  })
})
