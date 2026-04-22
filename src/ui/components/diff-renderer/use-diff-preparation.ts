import type { ThemedToken } from 'shiki'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DiffSegment } from './build-rows'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { getHighlightsTokens, getParsedPayload } from '../../../state/types'
import { type HighlightPatch, tokenizeSegment } from './highlight'
import { prepareDiff, type PreparedParsedDiff } from './prepare-diff'

export interface DiffPreparation {
  file: PreparedParsedDiff['file']
  filetype: string | null
  firstChangeOffset: number
  highlights: { add: ThemedToken[][]; del: ThemedToken[][] }
  preparing: boolean
  ready: boolean
  requestSegmentHighlights: (segments: readonly DiffSegment[]) => void
  segments: DiffSegment[]
}

const EMPTY_HIGHLIGHTS = { add: [] as ThemedToken[][], del: [] as ThemedToken[][] }
const EMPTY_PARSED: PreparedParsedDiff = {
  file: null,
  filetype: null,
  firstChangeOffset: -1,
  segments: [],
}

function applyHighlightPatches(
  source: { add: ThemedToken[][]; del: ThemedToken[][] },
  add: readonly HighlightPatch[],
  del: readonly HighlightPatch[]
): { add: ThemedToken[][]; del: ThemedToken[][] } {
  const nextAdd = [...source.add]
  const nextDel = [...source.del]
  for (const patch of add) {
    for (let i = 0; i < patch.tokens.length; i++) nextAdd[patch.start + i] = patch.tokens[i] ?? []
  }
  for (const patch of del) {
    for (let i = 0; i < patch.tokens.length; i++) nextDel[patch.start + i] = patch.tokens[i] ?? []
  }
  return { add: nextAdd, del: nextDel }
}

function segmentHasHighlights(
  segment: DiffSegment,
  highlights: { add: ThemedToken[][]; del: ThemedToken[][] }
): boolean {
  if (segment.kind === 'context') {
    for (let i = 0; i < segment.count; i++) {
      if (!highlights.add[segment.addStart + i] || !highlights.del[segment.delStart + i])
        return false
    }
    return true
  }
  if (segment.kind === 'change') {
    for (let i = 0; i < segment.additions; i++) {
      if (!highlights.add[segment.addStart + i]) return false
    }
    for (let i = 0; i < segment.deletions; i++) {
      if (!highlights.del[segment.delStart + i]) return false
    }
    return true
  }
  return true
}

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
  const [localParsed, setLocalParsed] = useState<PreparedParsedDiff | null>(null)
  const [localHighlights, setLocalHighlights] = useState(EMPTY_HIGHLIGHTS)
  const [localHash, setLocalHash] = useState<string | null>(null)
  const completedSegmentsRef = useRef(new Set<string>())
  const pendingSegmentsRef = useRef(new Set<string>())
  const requestVersionRef = useRef(0)

  const parsed = useMemo(() => {
    return getParsedPayload<PreparedParsedDiff>(cachedParsed) ?? localParsed ?? EMPTY_PARSED
  }, [cachedParsed, localParsed])

  const highlights = useMemo(() => {
    const cached = getHighlightsTokens(cachedHighlights)
    if (cached && cachedHighlights?.hash === cachedParsed?.hash) return cached
    return localHighlights
  }, [cachedHighlights, cachedParsed, localHighlights])

  const ready = !!parsed.file

  useEffect(() => {
    requestVersionRef.current += 1
    completedSegmentsRef.current.clear()
    pendingSegmentsRef.current.clear()
    setLocalParsed(null)
    setLocalHighlights(EMPTY_HIGHLIGHTS)
    setLocalHash(null)
  }, [cacheKey, diff, themeId])

  useEffect(() => {
    const parsedOk = !!cachedParsed
    if (parsedOk) return

    const controller = new AbortController()
    setPreparing(true)
    void prepareDiff(diff, path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setLocalParsed(result.parsed)
        setLocalHighlights(result.highlights)
        setLocalHash(result.hash)
        dispatchGlobal({
          file: result.parsed,
          hash: result.hash,
          key: cacheKey,
          type: 'git-mode-set-parsed',
        })
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreparing(false)
      })

    return () => {
      controller.abort()
    }
  }, [cacheKey, diff, path, cachedParsed])

  const requestSegmentHighlights = useCallback(
    (segments: readonly DiffSegment[]) => {
      const file = parsed.file
      const filetype = parsed.filetype
      if (!file || !filetype) return
      const version = requestVersionRef.current
      const activeHash = cachedParsed?.hash ?? localHash
      if (!activeHash) return
      const next = segments.filter(
        (segment) =>
          (segment.kind === 'context' || segment.kind === 'change') &&
          !completedSegmentsRef.current.has(segment.id) &&
          !pendingSegmentsRef.current.has(segment.id) &&
          !segmentHasHighlights(segment, highlights)
      )
      if (next.length === 0) return
      for (const segment of next) pendingSegmentsRef.current.add(segment.id)
      void (async () => {
        const add: HighlightPatch[] = []
        const del: HighlightPatch[] = []
        try {
          for (const segment of next) {
            if (requestVersionRef.current !== version) return
            const patch = await tokenizeSegment(file, segment, filetype)
            add.push(...patch.add)
            del.push(...patch.del)
          }
        } finally {
          for (const segment of next) {
            pendingSegmentsRef.current.delete(segment.id)
            completedSegmentsRef.current.add(segment.id)
          }
        }
        if (requestVersionRef.current !== version || (add.length === 0 && del.length === 0)) return
        setLocalHighlights((current) => applyHighlightPatches(current, add, del))
        dispatchGlobal({
          add,
          del,
          hash: activeHash,
          key: cacheKey,
          themeId,
          type: 'git-mode-merge-highlights',
        })
      })()
    },
    [cacheKey, cachedParsed?.hash, highlights, localHash, parsed.file, parsed.filetype, themeId]
  )

  return {
    file: parsed.file,
    filetype: parsed.filetype,
    firstChangeOffset: parsed.firstChangeOffset,
    highlights,
    preparing,
    ready,
    requestSegmentHighlights,
    segments: parsed.segments,
  }
}
