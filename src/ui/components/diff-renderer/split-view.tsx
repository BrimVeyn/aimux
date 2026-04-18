import type { ScrollBoxRenderable } from '@opentui/core'

import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'

import { theme } from '../../theme'
import { buildSplitRows, gutterWidth, type SplitCell, type SplitRowOrHeader } from './build-rows'

export interface SplitViewHandle {
  leftScroll: ScrollBoxRenderable | null
  rightScroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
}

export const SplitView = forwardRef<SplitViewHandle, Props>(function SplitView({ file }, ref) {
  const leftRef = useRef<ScrollBoxRenderable | null>(null)
  const rightRef = useRef<ScrollBoxRenderable | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      get leftScroll() {
        return leftRef.current
      },
      get rightScroll() {
        return rightRef.current
      },
    }),
    []
  )

  const rows = buildSplitRows(file)
  const gw = gutterWidth(file)

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden">
      <scrollbox
        ref={leftRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
      >
        {rows.map((row, i) =>
          row.type === 'hunk-header' ? (
            <HunkHeaderRow key={i} row={row} />
          ) : (
            <HalfRow key={i} cell={row.left} gw={gw} />
          )
        )}
      </scrollbox>
      <box width={1} backgroundColor={theme.dim} />
      <scrollbox
        ref={rightRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
      >
        {rows.map((row, i) =>
          row.type === 'hunk-header' ? (
            <HunkHeaderRow key={i} row={row} />
          ) : (
            <HalfRow key={i} cell={row.right} gw={gw} />
          )
        )}
      </scrollbox>
    </box>
  )
})

function HunkHeaderRow({ row }: { row: Extract<SplitRowOrHeader, { type: 'hunk-header' }> }) {
  return (
    <box flexDirection="row" backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
      <text fg={theme.textMuted}>{row.spec}</text>
      {row.context ? <text fg={theme.dim}> {row.context}</text> : null}
    </box>
  )
}

function HalfRow({ cell, gw }: { cell: SplitCell; gw: number }) {
  if (cell.type === 'filler') {
    return <box backgroundColor={theme.panelMuted} height={1} />
  }
  let bg: string | undefined
  let sign = ' '
  let signColor = theme.textMuted
  if (cell.type === 'addition') {
    bg = theme.diffAddBg
    sign = '+'
    signColor = theme.success
  } else if (cell.type === 'deletion') {
    bg = theme.diffRemoveBg
    sign = '-'
    signColor = theme.danger
  }
  const num = String(cell.lineNumber).padStart(gw, ' ')
  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={theme.textMuted}>{` ${num} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <text fg={theme.text}>{cell.content}</text>
    </box>
  )
}
