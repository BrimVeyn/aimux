import type { ScrollBoxRenderable } from '@opentui/core'
import type { ThemedToken } from 'shiki'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import type { ThemeId } from '../../themes'

import { parsePatchFiles } from '../../../diff-parser'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { theme } from '../../theme'
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

interface Props {
  diff: string
  path: string
  themeId: ThemeId
  view: DiffView
}

const EMPTY_HIGHLIGHTS: DiffHighlights = { add: [], del: [] }

export const PierreDiff = forwardRef<PierreDiffHandle, Props>(function PierreDiff(
  { diff, path, themeId, view },
  ref
) {
  const file = useMemo(() => {
    const patches = parsePatchFiles(diff)
    return patches[0]?.files[0]
  }, [diff])

  const filetype = useMemo(() => filetypeFromPath(path), [path])

  const collapsedList = useAppStore((s) => s.gitMode.collapsedHunks[path])
  const collapsed = useMemo(() => new Set(collapsedList ?? []), [collapsedList])
  const toggleHunk = useMemo(
    () => (hunkIndex: number) =>
      dispatchGlobal({ hunkIndex, path, type: 'git-mode-toggle-hunk-collapsed' }),
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
        collapsed={collapsed}
        file={file}
        highlights={highlights}
        onToggleHunk={toggleHunk}
      />
    )
  }
  return (
    <SplitView
      ref={splitRef}
      collapsed={collapsed}
      file={file}
      highlights={highlights}
      onToggleHunk={toggleHunk}
    />
  )
})
