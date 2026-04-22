import type { ThemedToken } from 'shiki'

import { type FileDiffMetadata, parsePatchFiles } from '../../../../diff-parser'
import { diffHash } from '../../../../git/diff-hash'
import { buildDiffSegments, type DiffSegment } from './build-rows'
import { filetypeFromPath } from './filetype'

export interface PreparedParsedDiff {
  file: FileDiffMetadata | null
  filetype: string | null
  firstChangeOffset: number
  segments: DiffSegment[]
}

export interface PreparedDiff {
  hash: string
  parsed: PreparedParsedDiff
  highlights: { add: ThemedToken[][]; del: ThemedToken[][] }
}

interface PrepareOptions {
  signal?: AbortSignal
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

// Lifts diff parsing off the synchronous render tree and returns a segmented
// model immediately. Syntax highlighting is requested later for visible
// segments so first paint is not blocked on full-file tokenization.
export async function prepareDiff(
  diff: string,
  path: string,
  opts: PrepareOptions
): Promise<PreparedDiff> {
  const hash = diffHash(diff)
  throwIfAborted(opts.signal)
  await yieldToEventLoop()
  throwIfAborted(opts.signal)
  const patches = parsePatchFiles(diff)
  const files = patches.flatMap((patch) => patch.files)
  const file = files.length === 1 ? (files[0] ?? null) : null
  const filetype = file ? (filetypeFromPath(path) ?? null) : null
  const segmented = file ? buildDiffSegments(file) : { firstChangeOffset: -1, segments: [] }
  return {
    hash,
    highlights: { add: [], del: [] },
    parsed: {
      file,
      filetype,
      firstChangeOffset: segmented.firstChangeOffset,
      segments: segmented.segments,
    },
  }
}
