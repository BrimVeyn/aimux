import { MouseButton, type MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from './raw-input-handler'

function clampPtyCoordinates(
  event: MouseEvent,
  origin: TerminalContentOrigin
): { x: number; y: number } | null {
  const x = event.x + 1 - origin.x
  const y = event.y + 1 - origin.y

  if (x < 1 || y < 1 || x > origin.cols || y > origin.rows) {
    return null
  }

  return { x, y }
}

function getModifierBits(event: MouseEvent): number {
  return (
    (event.modifiers.shift ? 4 : 0) |
    (event.modifiers.alt ? 8 : 0) |
    (event.modifiers.ctrl ? 16 : 0)
  )
}

function getBaseButtonCode(event: MouseEvent): number | null {
  if (event.type === 'scroll') {
    switch (event.scroll?.direction) {
      case 'up':
        return 64
      case 'down':
        return 65
      case 'left':
        return 66
      case 'right':
        return 67
      default:
        return null
    }
  }

  switch (event.button) {
    case MouseButton.LEFT:
      return 0
    case MouseButton.MIDDLE:
      return 1
    case MouseButton.RIGHT:
      return 2
    case MouseButton.WHEEL_UP:
      return 64
    case MouseButton.WHEEL_DOWN:
      return 65
    default:
      return null
  }
}

export function encodeMouseEventForPty(
  event: MouseEvent,
  origin: TerminalContentOrigin
): string | null {
  const coordinates = clampPtyCoordinates(event, origin)
  if (!coordinates) {
    return null
  }

  const modifierBits = getModifierBits(event)

  switch (event.type) {
    case 'down': {
      const buttonCode = getBaseButtonCode(event)
      if (buttonCode === null) {
        return null
      }
      return `\x1b[<${buttonCode | modifierBits};${coordinates.x};${coordinates.y}M`
    }
    case 'up': {
      return `\x1b[<${3 | modifierBits};${coordinates.x};${coordinates.y}m`
    }
    case 'drag': {
      const buttonCode = getBaseButtonCode(event)
      if (buttonCode === null) {
        return null
      }
      return `\x1b[<${buttonCode | 32 | modifierBits};${coordinates.x};${coordinates.y}M`
    }
    case 'scroll': {
      const buttonCode = getBaseButtonCode(event)
      if (buttonCode === null) {
        return null
      }
      return `\x1b[<${buttonCode | modifierBits};${coordinates.x};${coordinates.y}M`
    }
    default:
      return null
  }
}
