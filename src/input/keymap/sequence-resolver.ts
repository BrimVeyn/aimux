import type { KeyChord } from './key-chord'
import type { KeyTrie, TrieBinding, TrieNode } from './trie'

export type ResolveResult =
  | { type: 'resolved'; binding: TrieBinding }
  | { type: 'pending' }
  | { type: 'passthrough' }

export interface SequenceResolverConfig {
  timeoutMs: number
}

export class SequenceResolver {
  private currentNode: TrieNode | null = null
  private pendingBinding: TrieBinding | null = null
  private pendingChords: KeyChord[] = []
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private onTimeout: ((binding: TrieBinding) => void) | null = null
  private onPendingChange: ((chords: KeyChord[] | null) => void) | null = null
  private repeatTerminal: KeyChord | null = null
  private repeatBinding: TrieBinding | null = null

  constructor(
    private readonly trie: KeyTrie,
    private readonly config: SequenceResolverConfig
  ) {}

  /**
   * Feed a key chord into the resolver.
   *
   * Algorithm:
   * 1. Lookup from current position (or root if no pending sequence).
   * 2. 'none' → reset, try from root. If still none → passthrough.
   * 3. 'exact' → fire immediately.
   * 4. 'prefix' → wait for more keys.
   * 5. 'exact+prefix' → start timeout. If next key arrives in time, advance.
   *    If timeout fires, resolve the exact match.
   */
  feed(chord: KeyChord): ResolveResult {
    this.clearTimeout()

    // Repeat: when not mid-sequence and the chord matches the last repeatable
    // sequence's terminal key, re-fire it.
    if (
      this.currentNode === null &&
      this.repeatTerminal !== null &&
      this.repeatBinding !== null &&
      chord === this.repeatTerminal
    ) {
      return { binding: this.repeatBinding, type: 'resolved' }
    }

    const fromNode = this.currentNode ?? this.trie.root
    const match = this.trie.lookup(chord, fromNode)

    switch (match.type) {
      case 'exact': {
        this.resetState()
        this.updateRepeatOnResolve(chord, match.binding)
        return { binding: match.binding, type: 'resolved' }
      }

      case 'prefix': {
        this.clearRepeat()
        this.currentNode = match.node
        this.pendingBinding = null
        this.pendingChords.push(chord)
        this.emitPendingChange()
        return { type: 'pending' }
      }

      case 'exact+prefix': {
        this.clearRepeat()
        this.currentNode = match.node
        this.pendingBinding = match.binding
        this.pendingChords.push(chord)
        this.emitPendingChange()
        this.startTimeout(chord, match.binding)
        return { type: 'pending' }
      }

      case 'none': {
        // If we were mid-sequence, try the chord from root
        if (this.currentNode !== null) {
          this.resetState()
          return this.feed(chord)
        }
        this.clearRepeat()
        return { type: 'passthrough' }
      }
    }
  }

  reset(): void {
    this.clearTimeout()
    this.resetState()
    this.clearRepeat()
  }

  setTimeoutCallback(cb: (binding: TrieBinding) => void): void {
    this.onTimeout = cb
  }

  setPendingChangeCallback(cb: (chords: KeyChord[] | null) => void): void {
    this.onPendingChange = cb
  }

  private resetState(): void {
    const hadPending = this.pendingChords.length > 0
    this.currentNode = null
    this.pendingBinding = null
    this.pendingChords = []
    if (hadPending) this.emitPendingChange()
  }

  private emitPendingChange(): void {
    if (!this.onPendingChange) return
    this.onPendingChange(this.pendingChords.length === 0 ? null : [...this.pendingChords])
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }

  private startTimeout(chord: KeyChord, binding: TrieBinding): void {
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null
      this.resetState()
      this.updateRepeatOnResolve(chord, binding)
      this.onTimeout?.(binding)
    }, this.config.timeoutMs)
  }

  private updateRepeatOnResolve(chord: KeyChord, binding: TrieBinding): void {
    if (binding.repeatable) {
      this.repeatTerminal = chord
      this.repeatBinding = binding
    } else {
      this.clearRepeat()
    }
  }

  private clearRepeat(): void {
    this.repeatTerminal = null
    this.repeatBinding = null
  }
}
