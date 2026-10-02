import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DiffData, GitDiffView } from '../../../../state/types'
import type { ScreenRect } from '../image-diff/terminal-image-pane'

import { type BlockEntry, diffUnits, parseUnits, splitUnifiedDiff } from '../../../../markdown-diff'
import { overrideGitDiffScroller } from '../../../git-view-controls'
import { useTheme } from '../../../theme'
import { EntryView, type RenderContext } from './blocks'

// Unchanged blocks kept on each side of a change, and the shortest run worth
// folding: hiding two blocks behind a line that says "2 blocks" saves nothing.
const CONTEXT = 2
const MIN_FOLD = 4
const CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

type Item =
  | { entry: BlockEntry; index: number; type: 'entry' }
  | { hidden: number; id: string; type: 'fold' }

/** Entries with long unchanged runs folded, unless they are expanded. */
export function foldEntries(
  entries: readonly BlockEntry[],
  expanded: ReadonlySet<string>,
  expandAll: boolean
): Item[] {
  const changed = entries.some((e) => e.type !== 'same')
  const out: Item[] = []
  let i = 0
  while (i < entries.length) {
    if (entries[i]?.type !== 'same') {
      out.push({ entry: entries[i] as BlockEntry, index: i, type: 'entry' })
      i++
      continue
    }
    let end = i
    while (end < entries.length && entries[end]?.type === 'same') end++
    const keepTop = i === 0 ? 0 : CONTEXT
    const keepBottom = end === entries.length ? 0 : CONTEXT
    const hidden = end - i - keepTop - keepBottom
    const id = `fold:${i}`
    if (!changed || expandAll || expanded.has(id) || hidden < MIN_FOLD) {
      for (let k = i; k < end; k++)
        out.push({ entry: entries[k] as BlockEntry, index: k, type: 'entry' })
    } else {
      for (let k = i; k < i + keepTop; k++) {
        out.push({ entry: entries[k] as BlockEntry, index: k, type: 'entry' })
      }
      out.push({ hidden, id, type: 'fold' })
      for (let k = end - keepBottom; k < end; k++) {
        out.push({ entry: entries[k] as BlockEntry, index: k, type: 'entry' })
      }
    }
    i = end
  }
  return out
}

function kindOf(item: Item): string | null {
  if (item.type !== 'entry') return null
  return item.entry.type === 'removed' ? item.entry.old.kind : item.entry.new.kind
}

// List items sit on consecutive lines, as they do in the source; everything else
// is a paragraph of its own, a blank row apart.
function tightWith(prev: Item | undefined, item: Item): boolean {
  if (!prev) return true
  return kindOf(prev) === 'item' && kindOf(item) === 'item'
}

const FoldRow = memo(function FoldRow({
  hidden,
  id,
  onExpand,
}: {
  hidden: number
  id: string
  onExpand: (id: string) => void
}) {
  const t = useTheme()
  const handle = useCallback(() => onExpand(id), [id, onExpand])
  return (
    <box flexDirection="row" backgroundColor={t.diffContextBg} paddingLeft={2} onMouseDown={handle}>
      <text fg={t.textMuted}>
        ··· {hidden} unchanged blocks <span fg={t.primary}>expand</span>
      </text>
    </box>
  )
})

interface MarkdownDiffViewProps {
  diff: DiffData
  /** Every fold open, from `e`. */
  expandAll: boolean
  repoRoot: string | null
  themeId: string
  view: GitDiffView
}

export const MarkdownDiffView = memo(function MarkdownDiffView({
  diff,
  expandAll,
  repoRoot,
  themeId,
  view,
}: MarkdownDiffViewProps) {
  const t = useTheme()
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const entries = useMemo(() => {
    const { after, before } = splitUnifiedDiff(diff.rawDiff)
    return diffUnits(parseUnits(before), parseUnits(after))
  }, [diff.rawDiff])
  const items = useMemo(
    () => foldEntries(entries, expanded, expandAll),
    [entries, expanded, expandAll]
  )
  const changes = entries.filter((e) => e.type !== 'same').length

  const onExpand = useCallback((id: string) => {
    setExpanded((prev) => new Set(prev).add(id))
  }, [])

  const visibleIn = useCallback((): ScreenRect | null => {
    const viewport = scrollRef.current?.viewport
    if (!viewport) return null
    return {
      height: viewport.height,
      width: viewport.width,
      x: viewport.screenX,
      y: viewport.screenY,
    }
  }, [])

  const ctx = useMemo<RenderContext>(
    () => ({ mdPath: diff.path, repoRoot, themeId, visibleIn }),
    [diff.path, repoRoot, themeId, visibleIn]
  )

  useEffect(
    () =>
      overrideGitDiffScroller((delta) => {
        const scroll = scrollRef.current
        if (!scroll) return
        const cap = Math.max(scroll.scrollHeight - scroll.viewport.height, 0)
        scroll.scrollTop = Math.max(0, Math.min(cap, scroll.scrollTop + delta))
      }),
    []
  )

  // Open on the first change: once its row has been laid out, bring it to the top
  // with a couple of rows of what precedes it.
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [diff.rawDiff])
  const firstChange = items.findIndex((i) => i.type === 'entry' && i.entry.type !== 'same')
  const scrollToFirstChange = useCallback(function (this: BoxRenderable): void {
    if (scrolledRef.current) return
    const scroll = scrollRef.current
    if (!scroll) return
    scrolledRef.current = true
    const offset = this.screenY - scroll.viewport.screenY + scroll.scrollTop - 2
    if (offset > 0) process.nextTick(() => (scroll.scrollTop = offset))
  }, [])

  const column = (side: 'both' | 'new' | 'old', item: Item): React.ReactNode =>
    item.type === 'fold' ? (
      <FoldRow hidden={item.hidden} id={item.id} onExpand={onExpand} />
    ) : (
      <EntryView ctx={ctx} entry={item.entry} side={side} />
    )

  let summary = 'no changes in the rendered document'
  if (changes === 1) summary = '1 block changed'
  else if (changes > 1) summary = `${changes} blocks changed`

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden" backgroundColor={t.background}>
      {diff.oldPath != null && diff.oldPath !== '' ? (
        <box flexShrink={0} paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      {/* Fixed height: the document under it is taller than the screen, and flex
          would otherwise shrink this row away to make room for it. */}
      <box flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={t.textMuted}>
          rendered · {summary} · <span fg={t.primary}>r</span> source
        </text>
      </box>
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        scrollY
        // Off so every block's renderAfter runs: an image scrolled out of view
        // has to be taken down, and a culled block would never get the chance.
        viewportCulling={false}
        contentOptions={CONTENT_OPTIONS}
      >
        {items.map((item, i) => {
          const key = item.type === 'fold' ? item.id : `e${item.index}`
          const marginTop = tightWith(items[i - 1], item) ? 0 : 1
          const renderAfter = i === firstChange ? scrollToFirstChange : undefined
          if (view === 'split') {
            return (
              <box
                key={key}
                flexDirection="row"
                gap={1}
                marginTop={marginTop}
                renderAfter={renderAfter}
              >
                {item.type === 'fold' ? (
                  column('both', item)
                ) : (
                  <>
                    <box flexBasis={0} flexDirection="column" flexGrow={1} flexShrink={1}>
                      {column('old', item)}
                    </box>
                    <box flexBasis={0} flexDirection="column" flexGrow={1} flexShrink={1}>
                      {column('new', item)}
                    </box>
                  </>
                )}
              </box>
            )
          }
          return (
            <box key={key} flexDirection="column" marginTop={marginTop} renderAfter={renderAfter}>
              {column('both', item)}
            </box>
          )
        })}
      </scrollbox>
    </box>
  )
})
