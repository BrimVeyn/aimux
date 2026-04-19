import type { ThemedToken } from 'shiki'

import { useEffect, useMemo, useState } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { getHighlightsTokens, getParsedFile } from '../../../state/types'
import { prepareDiff } from './prepare-diff'

export interface DiffPreparation {
  file: FileDiffMetadata | null
  highlights: { add: ThemedToken[][]; del: ThemedToken[][] }
  /** True while prepare is running for this cache key + hash. */
  preparing: boolean
  /** Available once either cache or prepare has produced a valid hash. */
  ready: boolean
}

const EMPTY_HIGHLIGHTS = { add: [] as ThemedToken[][], del: [] as ThemedToken[][] }

// Consults the parsed + highlight caches first, then falls back to an off-thread
// prepareDiff that dispatches results into the store. Deduplicates in-flight
// preparation per cacheKey+hash by hashing the diff string once.
export function useDiffPreparation(
  cacheKey: string,
  diff: string,
  path: string,
  themeId: string
): DiffPreparation {
  const cachedParsed = useAppStore((s) => s.gitMode.parsedFiles[cacheKey])
  const highlightKey = `${cacheKey}|${themeId}`
  const cachedHighlights = useAppStore((s) => s.gitMode.highlights[highlightKey])

  const [preparing, setPreparing] = useState(false)
  const [localFile, setLocalFile] = useState<FileDiffMetadata | null>(null)
  const [localHighlights, setLocalHighlights] = useState(EMPTY_HIGHLIGHTS)
  const [localHash, setLocalHash] = useState<string | null>(null)

  const { file, highlights, ready } = useMemo(() => {
    const parsedFile = cachedParsed ? getParsedFile(cachedParsed) : null
    const parsedMatches = !!cachedParsed
    const tokens = cachedHighlights ? getHighlightsTokens(cachedHighlights) : null
    const hlMatches = !!cachedHighlights && cachedHighlights.hash === cachedParsed?.hash

    if (parsedMatches && hlMatches && tokens) {
      return { file: parsedFile, highlights: tokens, ready: true }
    }
    if (parsedMatches && !hlMatches) {
      return {
        file: parsedFile,
        highlights: tokens ?? EMPTY_HIGHLIGHTS,
        ready: true,
      }
    }
    if (localHash && localFile) {
      return { file: localFile, highlights: localHighlights, ready: true }
    }
    return { file: null, highlights: EMPTY_HIGHLIGHTS, ready: false }
  }, [cachedParsed, cachedHighlights, localFile, localHighlights, localHash])

  useEffect(() => {
    // If caches already cover both parsed and highlights for this theme, bail.
    const parsedOk = !!cachedParsed
    const hlOk = !!cachedHighlights && cachedParsed && cachedHighlights.hash === cachedParsed.hash
    if (parsedOk && hlOk) return

    const controller = new AbortController()
    setPreparing(true)
    void prepareDiff(diff, path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setLocalFile(result.file)
        setLocalHighlights(result.highlights)
        setLocalHash(result.hash)
        dispatchGlobal({
          file: result.file,
          hash: result.hash,
          key: cacheKey,
          type: 'git-mode-set-parsed',
        })
        dispatchGlobal({
          add: result.highlights.add,
          del: result.highlights.del,
          hash: result.hash,
          key: cacheKey,
          themeId,
          type: 'git-mode-set-highlights',
        })
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        // Swallow — the UI falls back to "(could not parse diff)" when file stays null.
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreparing(false)
      })

    return () => {
      controller.abort()
    }
  }, [cacheKey, diff, path, themeId, cachedParsed, cachedHighlights])

  return { file, highlights, preparing, ready }
}
