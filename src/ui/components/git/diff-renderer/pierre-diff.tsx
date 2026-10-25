import type { ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

import { useRenderer } from '@opentui/react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { FoldState } from '../../../../state/types'
import type { ThemeId } from '../../../themes'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useDiffScroll } from '../../../git-view-controls'
import { useTheme } from '../../../theme'
import {
  buildDiffSegments,
  buildFileSegments,
  type DiffSegment,
  firstChangeSegmentOffset,
  type SplitWidths,
} from './build-rows'
import { changeBlockOffsets, changeBlocks, formatChangeBlock } from './hunks'
import { SplitView, type SplitViewHandle } from './split-view'
import { StackedView, type StackedViewHandle } from './stacked-view'
import { useDiffPreparation } from './use-diff-preparation'

/** `single` is a file read as it is: the diff's rows with nothing to compare. */
export type DiffView = 'single' | 'split' | 'stacked'

export interface PierreDiffHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

export interface DiffHighlights {
  add: ThemedToken[][]
  del: ThemedToken[][]
}

export interface FoldDispatch {
  adjust: (foldId: string, side: 'top' | 'bottom', delta: number) => void
  set: (foldId: string, top: number, bottom: number) => void
}

interface Props {
  cacheKey: string
  diff: string
  path: string
  themeId: ThemeId
  view: DiffView
}

const EMPTY_FOLDS: Record<string, FoldState> = {}
const NO_WIDTHS: SplitWidths = { left: 0, right: 0 }

export const PierreDiff = forwardRef<PierreDiffHandle, Props>(function PierreDiff(
  { cacheKey, diff, path, themeId, view },
  ref
) {
  const renderer = useRenderer()
  const t = useTheme()
  const preparation = useDiffPreparation(cacheKey, diff, path, themeId)
  const file = preparation.file ?? undefined
  const highlights: DiffHighlights = preparation.highlights

  // Text columns per side, as the views measure them once laid out. Until then
  // every line counts as one row; the first frame corrects it.
  const [widths, setWidths] = useState<SplitWidths>(NO_WIDTHS)
  const onSplitMeasure = useCallback((next: SplitWidths) => {
    setWidths((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
  }, [])
  const onStackedMeasure = useCallback(
    (width: number) => onSplitMeasure({ left: width, right: width }),
    [onSplitMeasure]
  )

  const folds = useAppStore((s) => s.gitMode.folds[cacheKey]) ?? EMPTY_FOLDS
  const segments = useMemo(() => {
    if (!file) return []
    return view === 'single' ? buildFileSegments(file) : buildDiffSegments(file, folds).segments
  }, [file, folds, view])
  const foldDispatch = useMemo<FoldDispatch>(
    () => ({
      adjust: (foldId, side, delta) =>
        dispatchGlobal({ delta, foldId, key: cacheKey, side, type: 'git-mode-fold-adjust' }),
      set: (foldId, top, bottom) =>
        dispatchGlobal({ bottom, foldId, key: cacheKey, top, type: 'git-mode-fold-set' }),
    }),
    [cacheKey]
  )

  const splitRef = useRef<SplitViewHandle | null>(null)
  const stackedRef = useRef<StackedViewHandle | null>(null)
  const autoScrollKeyRef = useRef<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      get leftScroll() {
        if (view === 'split') return splitRef.current?.leftScroll ?? null
        return stackedRef.current?.scroll ?? null
      },
      get rightScroll() {
        if (view === 'split') return splitRef.current?.rightScroll ?? null
        return stackedRef.current?.scroll ?? null
      },
    }),
    [view]
  )

  const scrollTo = useCallback(
    (target: number) => {
      if (view === 'split') {
        const left = splitRef.current?.leftScroll
        const right = splitRef.current?.rightScroll
        if (left) left.scrollTop = target
        if (right && right !== left) right.scrollTop = target
      } else {
        const node = stackedRef.current?.scroll
        if (node) node.scrollTop = target
      }
    },
    [view]
  )

  // Where each change block starts, worked out on the first hunk key rather than
  // on every resize: it walks every row of the file.
  const blocksRef = useRef<{
    offsets: number[]
    segments: DiffSegment[]
    widths: SplitWidths
  } | null>(null)
  // The block the last jump landed on, while the view has not moved since: a
  // block near the end cannot reach the top, so the top alone would name another.
  const landedRef = useRef<{ index: number; top: number } | null>(null)
  const slot = useDiffScroll()
  useEffect(() => {
    if (!file || view === 'single') return
    const blocks = changeBlocks(file)
    const offsets = (): number[] => {
      const hit = blocksRef.current
      if (hit && hit.segments === segments && hit.widths === widths) return hit.offsets
      // Two rows of what came before, as the view opens on the first change.
      const next = changeBlockOffsets(file, segments, widths, view).map((o) => Math.max(0, o - 2))
      blocksRef.current = { offsets: next, segments, widths }
      return next
    }
    const top = (): number =>
      (view === 'split' ? splitRef.current?.leftScroll : stackedRef.current?.scroll)?.scrollTop ?? 0
    const currentIndex = (): number => {
      const at = top()
      const landed = landedRef.current
      if (landed && landed.top === at) return landed.index
      return Math.max(
        0,
        offsets().findLastIndex((o) => o <= at)
      )
    }
    return slot.provideHunks({
      current: () => {
        const block = blocks[currentIndex()]
        return block ? formatChangeBlock(file, block, path) : null
      },
      jump: (delta) => {
        const all = offsets()
        if (all.length === 0) return
        const at = top()
        const index = delta > 0 ? all.findIndex((o) => o > at) : all.findLastIndex((o) => o < at)
        if (index < 0) return
        scrollTo(all[index] ?? 0)
        landedRef.current = { index, top: top() }
      },
    })
  }, [file, path, scrollTo, segments, slot, view, widths])

  useEffect(() => {
    // Wait for the first measurement: offsets taken before it count every line
    // as one row, and a wrapped prologue would land the view short of the change.
    if (!file || widths.left <= 0 || view === 'single') return
    const autoScrollKey = `${cacheKey}:${view}`
    if (autoScrollKeyRef.current === autoScrollKey) return
    autoScrollKeyRef.current = autoScrollKey
    const offset = firstChangeSegmentOffset(file, EMPTY_FOLDS, widths, view)
    if (offset < 0) return
    const target = Math.max(0, offset - 2)
    const apply = (): void => scrollTo(target)
    let raf = renderer.requestAnimationFrame(() => {
      raf = renderer.requestAnimationFrame(apply)
    })
    return () => renderer.cancelAnimationFrame(raf)
  }, [cacheKey, file, renderer, scrollTo, view, widths])

  if (!file) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.textMuted}>
          {preparation.preparing ? 'Preparing diff…' : '(could not parse diff)'}
        </text>
      </box>
    )
  }

  if (view !== 'split') {
    return (
      <StackedView
        ref={stackedRef}
        single={view === 'single'}
        onMeasure={onStackedMeasure}
        width={widths.left}
        file={file}
        foldDispatch={foldDispatch}
        highlights={highlights}
        requestSegmentHighlights={preparation.requestSegmentHighlights}
        segments={segments}
      />
    )
  }
  return (
    <SplitView
      ref={splitRef}
      onMeasure={onSplitMeasure}
      widths={widths}
      file={file}
      foldDispatch={foldDispatch}
      highlights={highlights}
      requestSegmentHighlights={preparation.requestSegmentHighlights}
      segments={segments}
    />
  )
})
