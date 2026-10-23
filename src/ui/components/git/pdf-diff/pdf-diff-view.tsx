import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useRenderer } from '@opentui/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import type { DiffData } from '../../../../state/types'

import { getScrollViewportDelta } from '../../../../app-runtime/terminal-mouse-adapter'
import { useDiffScroll } from '../../../git-view-controls'
import { detectGraphicsProtocol } from '../../../terminal-graphics/capabilities'
import { formatBytes } from '../../../terminal-graphics/dimensions'
import {
  changedPages,
  changedPagesSoFar,
  type FingerprintProgress,
  pdfDocumentKey,
  pdfPageCount,
  pdfTextFingerprints,
  renderPdfPage,
  watchPdfPageFingerprints,
} from '../../../terminal-graphics/pdf-render'
import { useTheme } from '../../../theme'
import { graphicsBanner, TerminalImagePane } from '../image-diff'

// Sharp on a high-density display at half a screen wide; an A4 page is ~1240×1754.
const RENDER_DPI = 150
const WHEEL_THROTTLE_MS = 150
const MAX_LISTED_PAGES = 8

interface PdfDiffViewProps {
  diff: DiffData
  /** One document read as it is: no second side, nothing compared. */
  single?: boolean
}

interface Counts {
  after: number
  before: number
}

/** The pages known to differ, and whether every pass looking for more is over. */
interface Changes {
  done: boolean
  pages: readonly number[]
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

function changeSummary(changes: Changes | null, page: number): string {
  if (changes === null || (changes.pages.length === 0 && !changes.done)) return 'comparing pages…'
  const changed = changes.pages
  if (changed.length === 0) return 'no visual changes'
  const list =
    changed.length > MAX_LISTED_PAGES
      ? `${changed.length} pages changed`
      : `changed: ${formatPages(changed)}`
  // Still comparing, a page not on the list yet may be on it in a moment, so it
  // is not called unchanged until the end.
  if (!changes.done) return `${changed.includes(page) ? 'changed · ' : ''}${list} · comparing…`
  return `${changed.includes(page) ? 'changed' : 'unchanged'} · ${list}`
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
  // Rendered before the page count is in: page 1 is on screen sooner, and a page
  // past the end only fails a render the count then explains.
  const exists = bytes !== undefined && (count === null || page <= count)

  useEffect(() => {
    if (!preview || !exists) return
    const controller = new AbortController()
    setRender({ kind: 'loading' })
    void (async () => {
      const result = await renderPdfPage(bytes, page, RENDER_DPI, controller.signal)
      if (!controller.signal.aborted) setRender(result)
    })()
    // Turned past before it rendered: the render is killed unless another view
    // is waiting on the same page.
    return () => controller.abort()
  }, [bytes, exists, page, preview])

  const meta = bytes
    ? ['pdf', formatBytes(bytes.byteLength), count === null ? null : `${count} pages`]
        .filter((s) => s !== null)
        .join(' · ')
    : null

  let notice: React.ReactNode = null
  if (!bytes) notice = <text fg={t.textMuted}>(absent)</text>
  else if (count !== null && !exists) notice = <text fg={t.textMuted}>(no page {page})</text>
  else if (!preview) notice = <text fg={t.textMuted}>(no preview)</text>
  else if (render.kind === 'error') notice = <text fg={t.warning}>({render.reason})</text>

  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} padding={1}>
      {label === '' ? null : <text fg={t.text}>{label}</text>}
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

type Side = 'after' | 'before'

/**
 * Looks for the pages that changed and reports them as it goes, with two passes
 * side by side: the text of every page, which takes a moment even on a long
 * book, and the pixels, which catch what text cannot — an image, a colour, a
 * moved line — and stream in page by page. A page is changed when either pass
 * says so. Everything still running is killed when the view goes away.
 */
function compareDocuments(
  before: Uint8Array | undefined,
  after: Uint8Array | undefined,
  // The page already on screen. Its render is what the user is waiting for, so
  // nothing competes with it.
  visible: Promise<unknown>,
  signal: AbortSignal,
  report: (changes: Changes) => void
): void {
  let text: number[] = []
  let textDone = false
  let raster: number[] = []
  let rasterDone = false
  const publish = (): void => {
    const pages = [...new Set([...text, ...raster])].toSorted((a, b) => a - b)
    report({ done: textDone && rasterDone, pages })
  }

  void (async () => {
    await visible
    if (signal.aborted) return

    // A side that is absent has no pages to compare: every page on the other is new.
    const sides: Record<Side, FingerprintProgress> = {
      after: { done: !after, hashes: [] },
      before: { done: !before, hashes: [] },
    }
    const update = (side: Side, progress: FingerprintProgress): void => {
      sides[side] = progress
      const b = sides.before
      const a = sides.after
      rasterDone = b.done && a.done
      if (b.hashes !== null && a.hashes !== null) {
        raster = changedPagesSoFar(
          { done: b.done, hashes: b.hashes },
          { done: a.done, hashes: a.hashes }
        )
      }
      publish()
    }
    const stops = [
      before ? watchPdfPageFingerprints(before, (p) => update('before', p)) : null,
      after ? watchPdfPageFingerprints(after, (p) => update('after', p)) : null,
    ]
    signal.addEventListener('abort', () => {
      for (const stop of stops) stop?.()
    })

    const [tb, ta] = await Promise.all([
      before ? pdfTextFingerprints(before, signal) : [],
      after ? pdfTextFingerprints(after, signal) : [],
    ])
    if (signal.aborted) return
    // Unreadable text leaves the pixels to decide alone.
    if (tb !== null && ta !== null) text = changedPages(tb, ta)
    textDone = true
    publish()
  })()
}

/**
 * Keyed on the documents' content: the same PDFs fetched again keep the page the
 * user is on, and different ones start from nothing instead of inheriting the
 * last document's page count, page and changes for a frame.
 */
export const PdfDiffView = memo(function PdfDiffView({ diff, single = false }: PdfDiffViewProps) {
  const before = diff.pdfBytesBefore
  const after = diff.pdfBytesAfter
  const key = `${before ? pdfDocumentKey(before) : '-'}:${after ? pdfDocumentKey(after) : '-'}`
  return <PdfDiff key={key} diff={diff} single={single} />
})

const PdfDiff = memo(function PdfDiff({ diff, single = false }: PdfDiffViewProps) {
  const t = useTheme()
  const renderer = useRenderer()
  const protocol = detectGraphicsProtocol(renderer)
  const preview = protocol === 'kitty'
  const before = diff.pdfBytesBefore
  const after = diff.pdfBytesAfter

  const [counts, setCounts] = useState<Counts | null>(null)
  const [changes, setChanges] = useState<Changes | null>(null)
  const [page, setPage] = useState(1)
  const navigatedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [b, a] = await Promise.all([
        before ? pdfPageCount(before) : 0,
        after ? pdfPageCount(after) : 0,
      ])
      if (!cancelled) setCounts({ after: a, before: b })
    })()
    return () => {
      cancelled = true
    }
  }, [before, after])

  useEffect(() => {
    if (single) return
    const controller = new AbortController()
    const visible = preview
      ? Promise.all([
          before ? renderPdfPage(before, 1, RENDER_DPI, controller.signal) : null,
          after ? renderPdfPage(after, 1, RENDER_DPI, controller.signal) : null,
        ])
      : Promise.resolve()
    compareDocuments(before, after, visible, controller.signal, (next) => {
      if (controller.signal.aborted) return
      setChanges(next)
      // Open on the first page known to have changed, unless the user has moved.
      const first = next.pages[0]
      if (!navigatedRef.current && first !== undefined) setPage(first)
    })
    return () => controller.abort()
  }, [before, after, preview, single])

  const total = Math.max(1, counts?.before ?? 0, counts?.after ?? 0)

  const step = useCallback(
    (delta: number) => {
      navigatedRef.current = true
      setPage((current) => nextPage(current, delta, total))
    },
    [total]
  )

  const slot = useDiffScroll()
  useEffect(() => slot.override(step), [slot, step])

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
          {single ? null : <span fg={t.textMuted}> · {changeSummary(changes, page)}</span>}
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
            label={single ? '' : 'new (working)'}
            page={page}
            preview={preview}
          />
        ) : null}
      </box>
    </box>
  )
})
