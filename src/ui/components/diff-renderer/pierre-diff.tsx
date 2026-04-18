import type { ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import type { FoldState } from '../../../state/types'
import type { ThemeId } from '../../themes'

import { parsePatchFiles } from '../../../diff-parser'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { theme } from '../../theme'
import { buildSplitRows, buildUnifiedRows, firstChangeRowIndex } from './build-rows'
import { filetypeFromPath } from './filetype'
import { tokenizeSide } from './highlight'
import { SplitView, type SplitViewHandle } from './split-view'
import { StackedView, type StackedViewHandle } from './stacked-view'

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
  diff: string
  path: string
  themeId: ThemeId
  view: DiffView
}

const EMPTY_HIGHLIGHTS: DiffHighlights = { add: [], del: [] }
const EMPTY_FOLDS: Record<string, FoldState> = {}

export const PierreDiff = forwardRef<PierreDiffHandle, Props>(function PierreDiff(
  { diff, path, themeId, view },
  ref
) {
  const file = useMemo(() => {
    const patches = parsePatchFiles(diff)
    return patches[0]?.files[0]
  }, [diff])

  const filetype = useMemo(() => filetypeFromPath(path), [path])

  const folds = useAppStore((s) => s.gitMode.folds[path]) ?? EMPTY_FOLDS
  const foldDispatch = useMemo<FoldDispatch>(
    () => ({
      adjust: (foldId, side, delta) =>
        dispatchGlobal({ delta, foldId, path, side, type: 'git-mode-fold-adjust' }),
      set: (foldId, top, bottom) =>
        dispatchGlobal({ bottom, foldId, path, top, type: 'git-mode-fold-set' }),
    }),
    [path]
  )

  const [highlights, setHighlights] = useState<DiffHighlights>(EMPTY_HIGHLIGHTS)

  useEffect(() => {
    setHighlights(EMPTY_HIGHLIGHTS)
    if (!file || !filetype) return
    let cancelled = false
    void Promise.all([
      tokenizeSide(file.additionLines, filetype, themeId),
      tokenizeSide(file.deletionLines, filetype, themeId),
    ]).then(([add, del]) => {
      if (cancelled) return
      setHighlights({ add, del })
    })
    return () => {
      cancelled = true
    }
  }, [file, filetype, themeId])

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
      view === 'split' ? buildSplitRows(file, EMPTY_FOLDS) : buildUnifiedRows(file, EMPTY_FOLDS)
    const idx = firstChangeRowIndex(rows)
    if (idx < 0) return
    const target = Math.max(0, idx - 2)
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
  }, [path, file, view])

  if (!file) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.textMuted}>(could not parse diff)</text>
      </box>
    )
  }

  if (view === 'stacked') {
    return (
      <StackedView
        ref={stackedRef}
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
      file={file}
      foldDispatch={foldDispatch}
      folds={folds}
      highlights={highlights}
    />
  )
})
