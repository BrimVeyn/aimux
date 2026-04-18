import type { ScrollBoxRenderable } from '@opentui/core'

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

import { parsePatchFiles } from '../../../diff-parser'
import { theme } from '../../theme'
import { SplitView, type SplitViewHandle } from './split-view'
import { StackedView, type StackedViewHandle } from './stacked-view'

export type DiffView = 'split' | 'stacked'

export interface PierreDiffHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

interface Props {
  diff: string
  view: DiffView
}

export const PierreDiff = forwardRef<PierreDiffHandle, Props>(function PierreDiff(
  { diff, view },
  ref
) {
  const file = useMemo(() => {
    const patches = parsePatchFiles(diff)
    return patches[0]?.files[0]
  }, [diff])

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
    return <StackedView ref={stackedRef} file={file} />
  }
  return <SplitView ref={splitRef} file={file} />
})
