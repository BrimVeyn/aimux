// The mode contract. `ModeId`, `KeyInput`, `KeyResult`, `ModeContext` and
// `SideEffect` are defined in `@brimveyn/aimux-config` — a keymap in a user's
// config and a plugin's mode both need them — and re-exported here so every
// import site in `src/` is unchanged.
//
// `ModeHandler` stays: it is the internal contract between the registry and a
// mode implementation, and nothing outside `src/input` implements one.

import type { KeyInput, KeyResult, ModeContext, ModeId } from '@brimveyn/aimux-config'
import type { KeyEvent } from '@opentui/core'

export type { KeyInput, KeyResult, ModeContext, ModeId, SideEffect } from '@brimveyn/aimux-config'

/**
 * The package declares `KeyInput` structurally so it can stay free of an
 * `@opentui/core` dependency. These two assertions are what keep that honest:
 * if opentui ever renames a field or changes a type, the build fails here
 * rather than at some call site months later.
 */
type _KeyInputMatchesOpentui =
  Pick<KeyEvent, 'name' | 'ctrl' | 'meta' | 'shift' | 'sequence'> extends KeyInput ? true : never
type _OpentuiMatchesKeyInput =
  KeyInput extends Pick<KeyEvent, 'name' | 'ctrl' | 'meta' | 'shift' | 'sequence'> ? true : never
const _keyInputAgrees: [_KeyInputMatchesOpentui, _OpentuiMatchesKeyInput] = [true, true]
void _keyInputAgrees

export interface ModeHandler {
  readonly id: ModeId
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null
  onEnter?(ctx: ModeContext, from: ModeId): KeyResult
  onExit?(ctx: ModeContext, to: ModeId): KeyResult
}
