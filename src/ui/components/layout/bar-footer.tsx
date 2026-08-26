import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback } from 'react'

import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'

/**
 * U+2699, not the nerd-font gear: its Emoji_Presentation is No, so a conforming
 * terminal draws it text-style in one cell and no font has to be installed for
 * the one button that opens the settings.
 */
const SETTINGS_GLYPH = '⚙'
/**
 * U+25A4, chosen on the same rule as the gear above: one cell, text presentation,
 * present in the base fonts. A ▁▄█ mini bar chart reads better but is three cells
 * wide, which pushes this row past a narrow sidebar.
 */
const STATS_GLYPH = '▤'
const SETTINGS_LABEL = `${SETTINGS_GLYPH} Settings`
const STATS_LABEL = `${STATS_GLYPH} Stats`
/** The two entries and the gap between them, so a renamed label re-measures itself. */
const FOOTER_GAP = 2
const FOOTER_FULL_WIDTH = SETTINGS_LABEL.length + FOOTER_GAP + STATS_LABEL.length
/** The row's own left and right padding. */
const FOOTER_PAD = 2

/**
 * The bar's bottom bar: settings and stats, pinned under every widget in the
 * column rather than living inside whichever widget happens to be last. These
 * are the only full-screen views the panes step aside for that a mouse can
 * reach at all, so they need a slot that is on screen whenever the bar is.
 */
export function BarFooter({ contentWidth }: { contentWidth: number }) {
  const t = useTheme()

  const handleOpenSettings = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatchGlobal({ type: 'enter-settings' })
  }, [])

  const handleOpenStats = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatchGlobal({ type: 'enter-stats' })
  }, [])

  // The bar clamps down to 18 columns, narrower than both labels together, so
  // below that the second entry drops to its glyph rather than being sliced
  // mid-word by the overflow.
  const statsLabel = contentWidth - FOOTER_PAD >= FOOTER_FULL_WIDTH ? STATS_LABEL : STATS_GLYPH

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexShrink={0}>
        <text fg={t.border} selectable={false} wrapMode="none">
          {'─'.repeat(Math.max(1, contentWidth))}
        </text>
      </box>
      {/* Each entry is its own <text>, with a spacer box between them: one string
          holding both would make the whole footer a single click target. */}
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={t.textMuted} selectable={false} wrapMode="none" onMouseDown={handleOpenSettings}>
          {SETTINGS_LABEL}
        </text>
        <box width={FOOTER_GAP} flexShrink={1} />
        <text fg={t.textMuted} selectable={false} wrapMode="none" onMouseDown={handleOpenStats}>
          {statsLabel}
        </text>
      </box>
    </box>
  )
}
