import type { KeyResult, ModeContext } from '../modes/types'
import type { KeyChord } from './key-chord'

export type ActionFn = (ctx: ModeContext) => KeyResult | null

export interface TrieBinding {
  result: KeyResult | ActionFn
  group?: string
  repeatable?: boolean
}

export interface TrieNode {
  binding: TrieBinding | null
  children: Map<string, TrieNode>
}

export type TrieMatch =
  | { type: 'exact'; binding: TrieBinding }
  | { type: 'prefix'; node: TrieNode }
  | { type: 'exact+prefix'; binding: TrieBinding; node: TrieNode }
  | { type: 'none' }

function createNode(): TrieNode {
  return { binding: null, children: new Map() }
}

export class KeyTrie {
  readonly root: TrieNode = createNode()

  /**
   * Insert a key sequence with a binding.
   * Later inserts for the same sequence overwrite earlier ones.
   */
  insert(sequence: KeyChord[], binding: TrieBinding): void {
    if (sequence.length === 0) return

    let node = this.root
    for (const chord of sequence) {
      let child = node.children.get(chord)
      if (!child) {
        child = createNode()
        node.children.set(chord, child)
      }
      node = child
    }
    node.binding = binding
  }

  /**
   * Remove a key sequence. Returns true if it was found and removed.
   */
  remove(sequence: KeyChord[]): boolean {
    if (sequence.length === 0) return false

    const path: { node: TrieNode; chord: KeyChord }[] = []
    let node = this.root

    for (const chord of sequence) {
      const child = node.children.get(chord)
      if (!child) return false
      path.push({ chord, node })
      node = child
    }

    if (!node.binding) return false
    node.binding = null

    // Prune empty branches from leaf upward
    for (let i = path.length - 1; i >= 0; i--) {
      const entry = path[i]
      if (!entry) break
      const { chord, node: parent } = entry
      const child = parent.children.get(chord)
      if (child && child.binding === null && child.children.size === 0) {
        parent.children.delete(chord)
      } else {
        break
      }
    }

    return true
  }

  /**
   * Look up a single KeyChord from a given node (defaults to root).
   */
  lookup(chord: KeyChord, from?: TrieNode): TrieMatch {
    const node = from ?? this.root
    const child = node.children.get(chord)

    if (!child) return { type: 'none' }

    const hasChildren = child.children.size > 0

    if (child.binding && hasChildren) {
      return { binding: child.binding, node: child, type: 'exact+prefix' }
    }
    if (child.binding) {
      return { binding: child.binding, type: 'exact' }
    }
    // hasChildren must be true (otherwise the node wouldn't exist after pruning)
    return { node: child, type: 'prefix' }
  }
}
