import type { ActionFn } from '@brimveyn/aimux-config'

import type { KeyInput, KeyResult, ModeContext, ModeHandler, ModeId } from '../modes/types'
import type { KeyTrie, TrieBinding } from './trie'

import { handleTextInput } from '../modes/handlers/shared'
import { type KeyChord, keyInputToChord } from './key-chord'
import { SequenceResolver } from './sequence-resolver'

const EMPTY_RESULT: KeyResult = { actions: [], effects: [] }

function evalBinding(binding: TrieBinding, ctx: ModeContext): KeyResult | null {
  if (typeof binding.result === 'function') {
    return (binding.result as ActionFn)(ctx)
  }
  return binding.result
}

export class KeymapModeHandler implements ModeHandler {
  readonly id: ModeId
  private readonly resolver: SequenceResolver
  private readonly isPassthrough: boolean

  constructor(id: ModeId, trie: KeyTrie, opts: { timeoutMs: number; passthrough?: boolean }) {
    this.id = id
    this.isPassthrough = opts.passthrough ?? false
    this.resolver = new SequenceResolver(trie, { timeoutMs: opts.timeoutMs })
  }

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    const chord = keyInputToChord(key)
    const match = this.resolver.feed(chord)

    switch (match.type) {
      case 'resolved':
        return evalBinding(match.binding, ctx)
      case 'pending':
        return EMPTY_RESULT
      case 'passthrough':
        if (this.isPassthrough) return handleTextInput(key)
        return null
    }
  }

  /**
   * Feed a KeyChord directly (bypassing KeyInput conversion).
   * Used by raw-input-handler for terminal-input shortcuts.
   * Returns the resolved KeyResult if matched, otherwise null.
   */
  handleChord(chord: KeyChord, ctx: ModeContext): KeyResult | null {
    const match = this.resolver.feed(chord)

    switch (match.type) {
      case 'resolved':
        return evalBinding(match.binding, ctx)
      case 'pending':
        return EMPTY_RESULT
      case 'passthrough':
        return null
    }
  }

  onEnter(_ctx: ModeContext, _from: ModeId): KeyResult {
    this.resolver.reset()
    return EMPTY_RESULT
  }

  onExit(_ctx: ModeContext, _to: ModeId): KeyResult {
    this.resolver.reset()
    return EMPTY_RESULT
  }

  /**
   * Set the callback for when an ambiguous sequence times out.
   * Must be wired from app.tsx to call processKeyResult.
   */
  setTimeoutCallback(cb: (binding: TrieBinding) => void): void {
    this.resolver.setTimeoutCallback(cb)
  }

  /**
   * Set the callback for pending chord state changes.
   * Fires with the current pending chord sequence (or null when cleared).
   */
  setPendingChangeCallback(cb: (chords: KeyChord[] | null) => void): void {
    this.resolver.setPendingChangeCallback(cb)
  }
}
