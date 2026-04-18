import type { ScrollBoxRenderable } from '@opentui/core'

import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { FileDiffMetadata } from '../../../diff-parser'

import { theme } from '../../theme'
import { buildUnifiedRows, gutterWidth, type UnifiedRowOrHeader } from './build-rows'

export interface StackedViewHandle {
  scroll: ScrollBoxRenderable | null
}

interface Props {
  file: FileDiffMetadata
}

export const StackedView = forwardRef<StackedViewHandle, Props>(function StackedView(
  { file },
  ref
) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      get scroll() {
        return scrollRef.current
      },
    }),
    []
  )

  const rows = buildUnifiedRows(file)
  const gw = gutterWidth(file)

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column', gap: 0 }}
    >
      {rows.map((row, i) => (
        <UnifiedRowRender key={i} gw={gw} row={row} />
      ))}
    </scrollbox>
  )
})

function UnifiedRowRender({ gw, row }: { gw: number; row: UnifiedRowOrHeader }) {
  if (row.type === 'hunk-header') {
    return (
      <box flexDirection="row" backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>{row.spec}</text>
        {row.context ? <text fg={theme.dim}> {row.context}</text> : null}
      </box>
    )
  }
  const pad = (n: number | undefined): string =>
    n === undefined ? ' '.repeat(gw) : String(n).padStart(gw, ' ')
  if (row.type === 'context') {
    return (
      <box flexDirection="row">
        <text fg={theme.textMuted}>{` ${pad(row.delLineNumber)} ${pad(row.addLineNumber)} `}</text>
        <text fg={theme.text}> {row.content}</text>
      </box>
    )
  }
  const bg = row.type === 'addition' ? theme.diffAddBg : theme.diffRemoveBg
  const sign = row.type === 'addition' ? '+' : '-'
  const signColor = row.type === 'addition' ? theme.success : theme.danger
  const delNum = row.type === 'deletion' ? row.lineNumber : undefined
  const addNum = row.type === 'addition' ? row.lineNumber : undefined
  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={theme.textMuted}>{` ${pad(delNum)} ${pad(addNum)} `}</text>
      <text fg={signColor}>{`${sign} `}</text>
      <text fg={theme.text}>{row.content}</text>
    </box>
  )
}
