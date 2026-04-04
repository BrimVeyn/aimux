import type { TerminalModeState } from './types'

export function createDefaultTerminalModes(): TerminalModeState {
  return {
    alternateScrollMode: false,
    bracketedPasteMode: false,
    isAlternateBuffer: false,
    mouseTrackingMode: 'none',
    sendFocusMode: false,
  }
}
