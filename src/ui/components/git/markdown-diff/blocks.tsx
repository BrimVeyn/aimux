import { TextAttributes } from '@opentui/core'
import { memo, useMemo } from 'react'

import type { ScreenRect } from '../image-diff/terminal-image-pane'

import {
  type BlockEntry,
  diffLines,
  diffSpans,
  type Piece,
  type PieceOp,
  plainText,
  sideOf,
  type Span,
  type Unit,
} from '../../../../markdown-diff'
import { lcsDiff } from '../../../../markdown-diff/lcs'
import { useTheme } from '../../../theme'
import { CodeBlock, type CodeLine } from './code-block'
import { Inline } from './inline'
import { MdImage } from './md-image'

/** Which version a column shows: both interleaved, or one side of a split. */
export type Side = 'both' | 'new' | 'old'

export interface RenderContext {
  mdPath: string
  repoRoot: string | null
  themeId: string
  visibleIn: () => ScreenRect | null
}

type Tone = 'add' | 'del' | 'mod' | 'same'

const MAX_COLUMN = 32
const RULE_WIDTH = 40

function same(spans: readonly Span[]): Piece[] {
  return spans.map((s) => ({ op: 'same', style: s.style, text: s.text }))
}

function piecesFor(pieces: readonly Piece[], side: Side): Piece[] {
  return side === 'both' ? [...pieces] : sideOf(pieces, side)
}

function opsFor<T extends { op: PieceOp }>(ops: readonly T[], side: Side): T[] {
  if (side === 'both') return [...ops]
  const drop: PieceOp = side === 'old' ? 'add' : 'del'
  return ops.filter((o) => o.op !== drop)
}

const PROSE = new Set(['heading', 'item', 'paragraph'])

interface MarkerPiece {
  op: PieceOp
  text: string
}

interface ProseProps {
  /** A list item's marker; two pieces when a checkbox was ticked or a number moved. */
  marker: readonly MarkerPiece[]
  pieces: readonly Piece[]
  unit: Extract<Unit, { kind: 'heading' | 'item' | 'paragraph' }>
}

function highlightOf(
  op: PieceOp,
  t: { diffHighlightAdded: string; diffHighlightRemoved: string }
): string | undefined {
  if (op === 'add') return t.diffHighlightAdded
  if (op === 'del') return t.diffHighlightRemoved
  return undefined
}

const Prose = memo(function Prose({ marker, pieces, unit }: ProseProps) {
  const t = useTheme()
  const fg = unit.quote ? t.markdownBlockQuote : t.markdownText
  if (unit.kind === 'heading') {
    return (
      <box flexDirection="row">
        <text fg={t.textMuted}>{`${'#'.repeat(unit.depth)} `}</text>
        <Inline attributes={TextAttributes.BOLD} fg={t.markdownHeading} pieces={pieces} />
      </box>
    )
  }
  const attributes = unit.quote ? TextAttributes.ITALIC : 0
  if (unit.kind === 'item') {
    const enumerated = /^\d/.test(unit.marker)
    return (
      <box flexDirection="row">
        <text fg={enumerated ? t.markdownListEnumeration : t.markdownListItem}>
          {marker.map((m) => (
            <span
              key={m.op}
              attributes={m.op === 'del' ? TextAttributes.STRIKETHROUGH : 0}
              bg={highlightOf(m.op, t)}
            >
              {m.text}
            </span>
          ))}{' '}
        </text>
        <box flexGrow={1} flexShrink={1}>
          <Inline attributes={attributes} fg={fg} pieces={pieces} />
        </box>
      </box>
    )
  }
  return <Inline attributes={attributes} fg={fg} pieces={pieces} />
})

interface TableRow {
  cells: Piece[][]
  op: PieceOp
}

const NO_PIECES: Piece[] = []

const Table = memo(function Table({
  header,
  rows,
}: {
  header: TableRow
  rows: readonly TableRow[]
}) {
  const t = useTheme()
  const widths = useMemo(() => {
    const columns = Math.max(header.cells.length, ...rows.map((r) => r.cells.length))
    return Array.from({ length: columns }, (_, c) =>
      Math.min(
        MAX_COLUMN,
        Math.max(
          3,
          ...[header, ...rows].map((r) =>
            Math.max(
              ...(r.cells[c] ?? [])
                .map((p) => p.text)
                .join('')
                .split('\n')
                .map((l) => l.length)
            )
          )
        )
      )
    )
  }, [header, rows])
  const rowView = (row: TableRow, key: string, isHeader: boolean): React.ReactNode => {
    let bg = isHeader ? t.backgroundPanel : undefined
    if (row.op === 'add') bg = t.diffAddedBg
    if (row.op === 'del') bg = t.diffRemovedBg
    const attributes =
      (isHeader ? TextAttributes.BOLD : 0) | (row.op === 'del' ? TextAttributes.STRIKETHROUGH : 0)
    return (
      <box
        key={key}
        flexDirection="row"
        gap={2}
        backgroundColor={bg}
        paddingLeft={1}
        paddingRight={1}
      >
        {widths.map((w, c) => (
          // Columns are positional.
          // eslint-disable-next-line react/no-array-index-key
          <box key={c} width={w}>
            <Inline
              attributes={attributes}
              fg={t.markdownText}
              pieces={row.cells[c] ?? NO_PIECES}
            />
          </box>
        ))}
      </box>
    )
  }
  return (
    <box flexDirection="column" alignSelf="flex-start">
      {rowView(header, 'h', true)}
      {/* Rows are positional within one table. */}
      {/* eslint-disable-next-line react/no-array-index-key */}
      {rows.map((row, i) => rowView(row, `r${i}`, false))}
    </box>
  )
})

function rowKey(cells: readonly Span[][]): string {
  return cells.map((c) => plainText(c)).join('\u0000')
}

function tableRows(
  old: Extract<Unit, { kind: 'table' }> | null,
  next: Extract<Unit, { kind: 'table' }> | null,
  side: Side
): { header: TableRow; rows: TableRow[] } {
  const shown = side === 'old' ? (old ?? next) : (next ?? old)
  const cells = (row: readonly Span[][]): Piece[][] => row.map(same)
  const header: TableRow = { cells: cells(shown?.header ?? []), op: 'same' }
  if (!old || !next) {
    return { header, rows: (shown?.rows ?? []).map((row) => ({ cells: cells(row), op: 'same' })) }
  }
  const rows = lcsDiff(old.rows, next.rows, rowKey).map((op): TableRow => {
    if (op.type === 'same') return { cells: cells(op.b), op: 'same' }
    if (op.type === 'del') return { cells: cells(op.a), op: 'del' }
    return { cells: cells(op.b), op: 'add' }
  })
  return { header, rows: opsFor(rows, side) }
}

interface UnitViewProps {
  ctx: RenderContext
  /** The other version of this unit, when the entry is a modification. */
  counterpart: Unit | null
  side: Side
  tone: Tone
  unit: Unit
}

type Content =
  | { kind: 'code'; lines: CodeLine[] }
  | { kind: 'prose'; marker: MarkerPiece[]; pieces: Piece[] }
  | { header: TableRow; kind: 'table'; rows: TableRow[] }
  | { kind: 'other' }

function markerOf(shown: Unit, older: Unit | null, newer: Unit | null, side: Side): MarkerPiece[] {
  const text = shown.kind === 'item' ? shown.marker : ''
  if (older?.kind !== 'item' || newer?.kind !== 'item' || older.marker === newer.marker) {
    return [{ op: 'same', text }]
  }
  const was: MarkerPiece = { op: 'del', text: older.marker }
  const now: MarkerPiece = { op: 'add', text: newer.marker }
  if (side === 'old') return [was]
  if (side === 'new') return [now]
  return [was, now]
}

// What a unit shows from one side: its own content, or for a modification the
// edit between its two versions, cut down to that side.
function contentOf(shown: Unit, older: Unit | null, newer: Unit | null, side: Side): Content {
  switch (shown.kind) {
    case 'heading':
    case 'item':
    case 'paragraph':
      return {
        kind: 'prose',
        marker: markerOf(shown, older, newer, side),
        pieces:
          older && newer && 'spans' in older && 'spans' in newer
            ? piecesFor(diffSpans(older.spans, newer.spans), side)
            : same(shown.spans),
      }
    case 'code':
      return {
        kind: 'code',
        lines:
          older?.kind === 'code' && newer?.kind === 'code'
            ? opsFor(diffLines(older.lines, newer.lines), side)
            : shown.lines.map((text) => ({ op: 'same', text })),
      }
    case 'table':
      return {
        kind: 'table',
        ...tableRows(
          older?.kind === 'table' ? older : null,
          newer?.kind === 'table' ? newer : null,
          side
        ),
      }
    default:
      return { kind: 'other' }
  }
}

function UnitView({ counterpart, ctx, side, tone, unit }: UnitViewProps): React.ReactNode {
  const t = useTheme()
  // For a modification, `unit` is the old version and `counterpart` the new one.
  const older = tone === 'mod' ? unit : null
  const newer = tone === 'mod' ? counterpart : null
  const shown = tone === 'mod' && side !== 'old' && counterpart ? counterpart : unit
  const content = useMemo(() => contentOf(shown, older, newer, side), [shown, older, newer, side])

  switch (shown.kind) {
    case 'heading':
    case 'item':
    case 'paragraph':
      return content.kind === 'prose' ? (
        <Prose marker={content.marker} pieces={content.pieces} unit={shown} />
      ) : null
    case 'code':
      return content.kind === 'code' ? (
        <CodeBlock lang={shown.lang} lines={content.lines} themeId={ctx.themeId} />
      ) : null
    case 'table':
      return content.kind === 'table' ? <Table header={content.header} rows={content.rows} /> : null
    case 'image':
      return (
        <MdImage
          alt={shown.alt}
          mdPath={ctx.mdPath}
          repoRoot={ctx.repoRoot}
          src={shown.src}
          visibleIn={ctx.visibleIn}
        />
      )
    case 'html':
      return (
        <text fg={t.textMuted} wrapMode="word">
          {shown.text}
        </text>
      )
    case 'rule':
      return <text fg={t.markdownHorizontalRule}>{'─'.repeat(RULE_WIDTH)}</text>
  }
}

const SIGN: Record<Tone, string> = { add: '+', del: '-', mod: '~', same: ' ' }

interface BlockProps {
  ctx: RenderContext
  counterpart: Unit | null
  side: Side
  tone: Tone
  unit: Unit
}

/** One unit, with its diff sign in the gutter and its indentation. */
const Block = memo(function Block({ counterpart, ctx, side, tone, unit }: BlockProps) {
  const t = useTheme()
  let bg: string | undefined
  if (tone === 'add') bg = t.diffAddedBg
  if (tone === 'del') bg = t.diffRemovedBg
  let signFg = t.textMuted
  if (tone === 'add') signFg = t.diffAdded
  if (tone === 'del') signFg = t.diffRemoved
  const indent = unit.indent * 2 + (unit.quote ? 2 : 0)
  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={signFg}>{`${SIGN[tone]} `}</text>
      <box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={indent}>
        <UnitView counterpart={counterpart} ctx={ctx} side={side} tone={tone} unit={unit} />
      </box>
    </box>
  )
})

/** Whether an entry is drawn as one modified block or as its two versions. */
export function editsInPlace(entry: BlockEntry): boolean {
  return (
    entry.type === 'modified' &&
    (PROSE.has(entry.old.kind) || entry.old.kind === 'code' || entry.old.kind === 'table')
  )
}

interface EntryProps {
  ctx: RenderContext
  entry: BlockEntry
  side: Side
}

/** An entry as seen from one side; nothing when that side does not have it. */
export const EntryView = memo(function EntryView({ ctx, entry, side }: EntryProps) {
  switch (entry.type) {
    case 'same':
      return (
        <Block
          counterpart={null}
          ctx={ctx}
          side={side}
          tone="same"
          unit={side === 'old' ? entry.old : entry.new}
        />
      )
    case 'added':
      return side === 'old' ? null : (
        <Block counterpart={null} ctx={ctx} side={side} tone="add" unit={entry.new} />
      )
    case 'removed':
      return side === 'new' ? null : (
        <Block counterpart={null} ctx={ctx} side={side} tone="del" unit={entry.old} />
      )
    case 'modified':
      if (editsInPlace(entry)) {
        return <Block counterpart={entry.new} ctx={ctx} side={side} tone="mod" unit={entry.old} />
      }
      return (
        <box flexDirection="column">
          {side !== 'new' ? (
            <Block counterpart={null} ctx={ctx} side={side} tone="del" unit={entry.old} />
          ) : null}
          {side !== 'old' ? (
            <Block counterpart={null} ctx={ctx} side={side} tone="add" unit={entry.new} />
          ) : null}
        </box>
      )
  }
})
