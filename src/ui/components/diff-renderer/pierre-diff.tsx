import type { ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import type { ThemeId } from '../../themes'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { type FoldState } from '../../../state/types'
import { useTheme } from '../../theme'
import { buildSplitRows, buildUnifiedRows, firstChangeRowOffset, gutterWidth } from './build-rows'
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

export const PierreDiff = forwardRef<PierreDiffHandle, Props>(function PierreDiff(
  { cacheKey, diff, path, themeId, view },
  ref
) {
  const theme = useTheme()
  const preparation = useDiffPreparation(cacheKey, diff, path, themeId)
  const file = preparation.file ?? undefined
  const highlights: DiffHighlights = preparation.highlights

  const terminalCols = useAppStore((s) => s.layout.terminalCols)
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const contentWidth = useMemo(() => {
    if (!file) return 0
    const gw = gutterWidth(file)
    const usable = Math.max(0, terminalCols - sidebarWidth - 1)
    const paneCols = view === 'split' ? Math.max(0, Math.floor(usable / 2) - 1) : usable
    const prefix = view === 'split' ? gw + 4 : gw * 2 + 5
    return Math.max(1, paneCols - prefix)
  }, [file, view, terminalCols, sidebarWidth])

  const folds = useAppStore((s) => s.gitMode.folds[cacheKey]) ?? EMPTY_FOLDS
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
    if (!file) return
    const rows =
      view === 'split'
        ? buildSplitRows(file, EMPTY_FOLDS, contentWidth)
        : buildUnifiedRows(file, EMPTY_FOLDS, contentWidth)
    const offset = firstChangeRowOffset(rows)
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
    const raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [cacheKey, file, view, contentWidth])

  if (!file) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.colors['descriptionForeground']}>
          {preparation.preparing ? 'Preparing diff…' : '(could not parse diff)'}
        </text>
      </box>
    )
  }

  if (view === 'stacked') {
    return (
      <StackedView
        ref={stackedRef}
        contentWidth={contentWidth}
        file={file}
        foldDispatch={foldDispatch}
        folds={folds}
        highlights={highlights}
      />
    )
  }
  return (
    <SplitView
      ref={splitRef}
      contentWidth={contentWidth}
      file={file}
      foldDispatch={foldDispatch}
      folds={folds}
      highlights={highlights}
    />
  )
})
