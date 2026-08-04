import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { memo, useCallback, useEffect, useRef } from 'react'

import { useAppStore } from '../../../state/app-store'
import { clampBarWidth } from '../../../state/bars'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { STATS_PAGES, statsPageAt } from '../../../state/stats-pages'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { AimuxPage } from './aimux-page'
import { ProjectsPage } from './projects-page'
import { UsagePage } from './usage-page'
import { useStatsData } from './use-stats-data'

const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

/**
 * The stats screen.
 *
 * Same shape as the settings screen — a nav column exactly where the left bar
 * stands, so opening it does not shift the column under the cursor, and a
 * bordered content pane where the terminal would be. Read-only: nothing here
 * dispatches anything but page selection.
 */
export const StatsView = memo(function StatsView() {
  const t = useTheme()
  const stats = useAppStore((s) => s.stats)
  const navWidth = useAppStore((s) => clampBarWidth(s.bars.left.width))
  const dimensions = useTerminalDimensions()
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const data = useStatsData()

  const page = statsPageAt(stats.pageIndex)

  // The reducer owns the offset but cannot know how tall the page renders, so
  // the scrollbox is what actually bounds it: push the requested offset in, read
  // back what it accepted, and tell the reducer. Without the read-back the
  // offset keeps climbing past the bottom of the page and the way up is a dead
  // zone as long as the overshoot.
  useEffect(() => {
    const box = scrollRef.current
    if (box === null) return
    box.scrollTop = stats.scrollTop
    // A box that has not been laid out yet reports no height, and its clamp
    // would snap every offset to zero. Wait for the frame that measures it.
    if (box.scrollHeight <= 0) return
    if (box.scrollTop !== stats.scrollTop) {
      dispatchGlobal({ scrollTop: box.scrollTop, type: 'stats-scroll-settled' })
    }
  }, [stats.scrollTop, stats.pageIndex])

  const handlePageClick = useCallback((index: number) => {
    dispatchGlobal({ pageIndex: index, type: 'stats-select-page' })
  }, [])

  const handleClose = useCallback(() => {
    dispatchGlobal({ type: 'exit-stats' })
  }, [])

  // Same 1-cell seam the bar draws between itself and the terminal, so the two
  // views line up to the column.
  const navContentWidth = Math.max(1, navWidth - 1)
  const contentWidth = Math.max(24, dimensions.width - navWidth - 2)

  let body = null
  if (data === null) {
    body = (
      <box paddingLeft={2}>
        <text fg={t.textMuted} selectable={false}>
          reading history…
        </text>
      </box>
    )
  } else {
    switch (page.id) {
      case 'usage':
        body = <UsagePage data={data} width={contentWidth} />
        break
      case 'projects':
        body = <ProjectsPage data={data} width={contentWidth} />
        break
      case 'aimux':
        body = <AimuxPage data={data} width={contentWidth} />
        break
      default:
        page.id satisfies never
    }
  }

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden">
      <box width={navWidth} flexDirection="row" overflow="hidden" backgroundColor={t.background}>
        <box width={navContentWidth} flexDirection="column" overflow="hidden">
          <box paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted}>Stats</text>
          </box>
          <box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
            {STATS_PAGES.map((entry, index) => (
              <ListItem
                key={entry.id}
                active={index === stats.pageIndex}
                index={index}
                onClickIndex={handlePageClick}
                title={
                  <text fg={index === stats.pageIndex ? t.text : t.textMuted}>
                    {`${entry.glyph} ${entry.label}`}
                  </text>
                }
                trailing={index === stats.pageIndex ? <text fg={t.primary}>›</text> : undefined}
              />
            ))}
          </box>
          <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted} onMouseDown={handleClose}>
              ‹ Close
            </text>
          </box>
        </box>
        <box width={1} flexShrink={0} backgroundColor={t.border} />
      </box>
      {/* The pane the terminal would be in, with the same border — the content
          keeps the inset it had instead of jumping to the edge of the screen. */}
      <box
        border
        borderColor={t.borderActive}
        title={`${page.glyph} ${page.label}`}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={t.background}
      >
        <scrollbox
          ref={scrollRef}
          scrollY
          flexGrow={1}
          flexShrink={1}
          contentOptions={COLUMN_CONTENT_OPTIONS}
        >
          {body}
        </scrollbox>
      </box>
    </box>
  )
})
