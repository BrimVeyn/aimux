import type { KeyInput, KeyResult, ModeContext, ModeHandler } from './types'

import { chordsToNotation, keyInputToChord, parseKeyNotation } from '../keymap/key-chord'
import { getActiveKeymap } from '../keymap/keymap-ref'

const none: KeyResult = { actions: [], effects: [] }

export class SettingKeybindHandler implements ModeHandler {
  readonly id = 'modal.setting-keybind' as const

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    const modal = ctx.state.modal
    if (modal.type !== 'setting-keybind') return null
    const chord = keyInputToChord(key)
    if (chord === 'escape')
      return { actions: [{ type: 'close-modal' }], effects: [], transition: 'settings' }
    if (chord === 'return') {
      if (modal.captured.length === 0 || modal.conflict !== null) return none
      const leaderNotation = getActiveKeymap()?.leader
      const leader = leaderNotation === undefined ? undefined : parseKeyNotation(leaderNotation)[0]
      return {
        actions: [{ type: 'close-modal' }],
        effects: [
          {
            settingId: modal.settingId,
            type: 'commit-setting-keybind',
            value: chordsToNotation(modal.captured, leader),
          },
        ],
        transition: 'settings',
      }
    }
    if (chord === 'backspace') {
      if (modal.captured.length > 0)
        return { actions: [{ type: 'keybind-capture-pop' }], effects: [] }
      return {
        actions: [{ type: 'close-modal' }],
        effects: [{ settingId: modal.settingId, type: 'commit-setting-keybind', value: '' }],
        transition: 'settings',
      }
    }
    return { actions: [{ chord, type: 'keybind-capture-push' }], effects: [] }
  }
}
