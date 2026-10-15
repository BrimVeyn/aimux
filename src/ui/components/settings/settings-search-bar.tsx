import { memo, useCallback } from 'react'

import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'

const SEARCH_GLYPH = '\u{2315}'

/**
 * The way into the search, drawn rather than remembered.
 *
 * `/` opened the picker long before this existed, and the footer said so — but a
 * key you have to read a hint to know about is a key nobody presses. A field you
 * can see and click is the only version of this that gets used, so it heads the
 * page and stays out of the scroll.
 *
 * It never holds text. Clicking it opens the picker, which is where the typing
 * and the filtering actually happen; this is its handle.
 */
export const SettingsSearchBar = memo(function SettingsSearchBar({ width }: { width: number }) {
  const t = useTheme()
  const handleOpen = useCallback(() => {
    dispatchGlobal({ type: 'open-settings-search' })
  }, [])

  // Drawn like every other input — the element fill with a row of padding round
  // the text — so it reads as a field, not as one more line of the page.
  return (
    <box
      backgroundColor={t.backgroundElement}
      width={width}
      flexShrink={0}
      flexDirection="row"
      padding={1}
      paddingLeft={2}
      paddingRight={2}
      onMouseDown={handleOpen}
    >
      <text fg={t.primary} selectable={false} wrapMode="none">
        {`${SEARCH_GLYPH}  `}
      </text>
      <box flexGrow={1} flexShrink={1}>
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          Search settings
        </text>
      </box>
      <text fg={t.primary} selectable={false} wrapMode="none">
        /
      </text>
    </box>
  )
})
