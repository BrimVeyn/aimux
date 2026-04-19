import type { ThemedToken } from 'shiki'

import { type FileDiffMetadata, parsePatchFiles } from '../../../diff-parser'
import { diffHash } from '../../../git/diff-hash'
import { filetypeFromPath } from './filetype'
import { tokenizeSide } from './highlight'

export interface PreparedDiff {
  hash: string
  file: FileDiffMetadata | null
  filetype: string | null
  highlights: { add: ThemedToken[][]; del: ThemedToken[][] }
}

interface PrepareOptions {
  signal?: AbortSignal
  /** Skip Shiki for big files to keep prepare under a few tens of ms. */
  skipHighlightThreshold?: number
}

const DEFAULT_SKIP_HIGHLIGHT = 2000

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

// Lifts the hot path (parse → tokenize) off the synchronous render tree. The
// parser still blocks briefly on very large diffs, but yielding between parse
// and each tokenize side keeps other UI updates responsive.
export async function prepareDiff(
  diff: string,
  path: string,
  opts: PrepareOptions
): Promise<PreparedDiff> {
  const hash = diffHash(diff)
  throwIfAborted(opts.signal)
  const patches = parsePatchFiles(diff)
  const file = patches[0]?.files[0] ?? null
  const filetype = file ? (filetypeFromPath(path) ?? null) : null

  const skipThreshold = opts.skipHighlightThreshold ?? DEFAULT_SKIP_HIGHLIGHT
  const totalLines = file ? file.additionLines.length + file.deletionLines.length : 0
  const shouldHighlight = !!file && !!filetype && totalLines <= skipThreshold

  if (!shouldHighlight) {
    return { file, filetype, hash, highlights: { add: [], del: [] } }
  }

  await yieldToEventLoop()
  throwIfAborted(opts.signal)
  const add = await tokenizeSide(file.additionLines, filetype)
  throwIfAborted(opts.signal)
  await yieldToEventLoop()
  throwIfAborted(opts.signal)
  const del = await tokenizeSide(file.deletionLines, filetype)
  throwIfAborted(opts.signal)

  return { file, filetype, hash, highlights: { add, del } }
}
