import type { KeyInput, KeyResult, ModeContext, ModeHandler } from '../types'

export const terminalInputMode: ModeHandler = {
  handleKey(_key: KeyInput, _ctx: ModeContext): KeyResult | null {
    // All input is handled by the raw input handler (raw-input-handler.ts).
    // This mode handler is a no-op for useKeyboard events.
    return null
  },

  id: 'terminal-input',
}
