import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useRenderer } from '@opentui/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import type { DiffData } from '../../../../state/types'

import { getScrollViewportDelta } from '../../../../app-runtime/terminal-mouse-adapter'
import { overrideGitDiffScroller } from '../../../git-view-controls'
import { detectGraphicsProtocol } from '../../../terminal-graphics/capabilities'
import { formatBytes } from '../../../terminal-graphics/dimensions'
import {
  changedPages,
  pdfPageCount,
  pdfPageFingerprints,
  renderPdfPage,
} from '../../../terminal-graphics/pdf-render'
import { useTheme } from '../../../theme'
import { graphicsBanner, TerminalImagePane } from '../image-diff'

// Sharp on a high-density display at half a screen wide; an A4 page is ~1240×1754.
const RENDER_DPI = 150
const WHEEL_THROTTLE_MS = 150
const MAX_LISTED_PAGES = 8

interface PdfDiffViewProps {
  diff: DiffData
}

interface Counts {
  after: number
  before: number
}

type Render =
  | { kind: 'error'; reason: string }
  | { kind: 'loading' }
  | { kind: 'ok'; png: Uint8Array }

/** `[2, 3, 4, 7]` → `2–4, 7`. */
function formatPages(pages: readonly number[]): string {
  const runs: string[] = []
  let start = pages[0]
  let prev = start
  for (const page of [...pages.slice(1), Number.NaN]) {
    if (start === undefined || prev === undefined) break
    if (page === prev + 1) {
      prev = page
      continue
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = page
    prev = page
  }
  return runs.join(', ')
}

function changeSummary(changed: readonly number[] | null, page: number): string {
  if (changed === null) return 'comparing pages…'
  if (changed.length === 0) return 'no visual changes'
  const here = changed.includes(page) ? 'changed' : 'unchanged'
  const list =
    changed.length > MAX_LISTED_PAGES
      ? `${changed.length} pages changed`
      : `changed: ${formatPages(changed)}`
  return `${here} · ${list}`
}

// Every scroll key turns exactly one page, changed or not: the whole document stays
// reachable, and the changed pages are listed in the header to aim for.
function nextPage(page: number, delta: number, total: number): number {
  return Math.max(1, Math.min(total, page + Math.sign(delta)))
}

interface PageProps {
  bytes: Uint8Array | undefined
  count: number | null
  label: string
  page: number
  preview: boolean
}

const PdfPage = memo(function PdfPage({ bytes, count, label, page, preview }: PageProps) {
  const t = useTheme()
  const [render, setRender] = useState<Render>({ kind: 'loading' })
  const exists = bytes !== undefined && count !== null && page <= count

  useEffect(() => {
    if (!preview || !exists) return
    let cancelled = false
    setRender({ kind: 'loading' })
    void (async () => {
      const result = await renderPdfPage(bytes, page, RENDER_DPI)
      if (!cancelled) setRender(result)
    })()
    return () => {
      cancelled = true
    }
  }, [bytes, exists, page, preview])

  const meta = bytes
    ? ['pdf', formatBytes(bytes.byteLength), count === null ? null : `${count} pages`]
        .filter((s) => s !== null)
        .join(' · ')
    : null

  let notice: React.ReactNode = null
  if (!bytes) notice = <text fg={t.textMuted}>(absent)</text>
  else if (count !== null && !exists) notice = <text fg={t.textMuted}>(no page {page})</text>
  else if (count !== null && !preview) notice = <text fg={t.textMuted}>(no preview)</text>
  else if (render.kind === 'error') notice = <text fg={t.warning}>({render.reason})</text>

  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} padding={1}>
      <text fg={t.text}>{label}</text>
      {notice === null && exists && preview && render.kind === 'ok' ? (
        <TerminalImagePane bytes={render.png} fit mime="image/png" />
      ) : (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          {notice}
        </box>
      )}
      {meta !== null ? <text fg={t.textMuted}>{meta}</text> : null}
    </box>
  )
})

export const PdfDiffView = memo(function PdfDiffView({ diff }: PdfDiffViewProps) {
  const t = useTheme()
  const renderer = useRenderer()
  const protocol = detectGraphicsProtocol(renderer)
  const before = diff.pdfBytesBefore
  const after = diff.pdfBytesAfter

  const [counts, setCounts] = useState<Counts | null>(null)
  const [changed, setChanged] = useState<number[] | null>(null)
  const [page, setPage] = useState(1)
  const navigatedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setCounts(null)
    setChanged(null)
    setPage(1)
    navigatedRef.current = false
    void (async () => {
      const [b, a] = await Promise.all([
        before ? pdfPageCount(before) : 0,
        after ? pdfPageCount(after) : 0,
      ])
      if (cancelled) return
      setCounts({ after: a, before: b })
      // A side that is absent has no pages to compare: every page on the other is new.
      const [fb, fa] = await Promise.all([
        before ? pdfPageFingerprints(before) : [],
        after ? pdfPageFingerprints(after) : [],
      ])
      if (cancelled || fb === null || fa === null) return
      const pages = changedPages(fb, fa)
      setChanged(pages)
      // Open on the first page that changed, unless the user has already moved.
      const first = pages[0]
      if (!navigatedRef.current && first !== undefined) setPage(first)
    })()
    return () => {
      cancelled = true
    }
  }, [before, after])

  const total = Math.max(1, counts?.before ?? 0, counts?.after ?? 0)

  const step = useCallback(
    (delta: number) => {
      navigatedRef.current = true
      setPage((current) => nextPage(current, delta, total))
    },
    [total]
  )

  useEffect(() => overrideGitDiffScroller(step), [step])

  const lastWheelRef = useRef(0)
  const handleScroll = useCallback(
    (event: OtuiMouseEvent) => {
      const delta = getScrollViewportDelta(event)
      if (delta === null) return
      event.preventDefault()
      event.stopPropagation()
      const now = Date.now()
      if (now - lastWheelRef.current < WHEEL_THROTTLE_MS) return
      lastWheelRef.current = now
      step(Math.sign(delta))
    },
    [step]
  )

  const banner = graphicsBanner(protocol, 'PDF')
  const preview = protocol === 'kitty'
  const showBoth = before && after

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      backgroundColor={t.background}
      onMouseScroll={handleScroll}
    >
      {diff.oldPath != null && diff.oldPath !== '' ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      {banner !== null ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={preview ? t.textMuted : t.warning}>{banner}</text>
        </box>
      ) : null}
      <box paddingLeft={1} paddingRight={1}>
        <text fg={t.text}>
          page {page} / {total}
          <span fg={t.textMuted}> · {changeSummary(changed, page)}</span>
        </text>
      </box>
      <box flexDirection="row" flexGrow={1}>
        {showBoth || before ? (
          <PdfPage
            bytes={before}
            count={counts?.before ?? null}
            label="old (HEAD)"
            page={page}
            preview={preview}
          />
        ) : null}
        {showBoth || after ? (
          <PdfPage
            bytes={after}
            count={counts?.after ?? null}
            label="new (working)"
            page={page}
            preview={preview}
          />
        ) : null}
      </box>
    </box>
  )
})
