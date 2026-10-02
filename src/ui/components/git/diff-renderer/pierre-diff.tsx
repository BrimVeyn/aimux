import type { ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

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
import { useTheme } from '../../../theme'
import { buildDiffSegments, firstChangeSegmentOffset, type SplitWidths } from './build-rows'
import { SplitView, type SplitViewHandle } from './split-view'
import { StackedView, type StackedViewHandle } from './stacked-view'
import { useDiffPreparation } from './use-diff-preparation'

export type DiffView = 'split' | 'stacked'

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
  const segments = useMemo(
    () => (file ? buildDiffSegments(file, folds).segments : []),
    [file, folds]
  )
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

  useEffect(() => {
    // Wait for the first measurement: offsets taken before it count every line
    // as one row, and a wrapped prologue would land the view short of the change.
    if (!file || widths.left <= 0) return
    const autoScrollKey = `${cacheKey}:${view}`
    if (autoScrollKeyRef.current === autoScrollKey) return
    autoScrollKeyRef.current = autoScrollKey
    const offset = firstChangeSegmentOffset(file, EMPTY_FOLDS, widths, view)
    if (offset < 0) return
    const target = Math.max(0, offset - 2)
    const apply = (): void => {
      if (view === 'split') {
        const left = splitRef.current?.leftScroll
        const right = splitRef.current?.rightScroll
        if (left) left.scrollTop = target
        if (right && right !== left) right.scrollTop = target
      } else {
        const node = stackedRef.current?.scroll
        if (node) node.scrollTop = target
      }
    }
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(apply)
    })
    return () => cancelAnimationFrame(raf)
  }, [cacheKey, widths, file, view])

  if (!file) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.textMuted}>
          {preparation.preparing ? 'Preparing diff…' : '(could not parse diff)'}
        </text>
      </box>
    )
  }

  if (view === 'stacked') {
    return (
      <StackedView
        ref={stackedRef}
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
