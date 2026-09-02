import { memo, useCallback } from 'react'

import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'

const SEARCH_GLYPH = '\u{2315}'

/**
 * The way into the search, drawn rather than remembered.
 *
 * `/` opened the picker long before this existed, and the footer said so — but a
 * key you have to read a hint to know about is a key nobody presses. A field you
 * can see and click is the only version of this that gets used, so the screen
 * spends three rows on it and keeps it out of the scroll.
 *
 * It never holds text. Clicking it opens the picker, which is where the typing
 * and the filtering actually happen; this is its handle.
 */
export const SettingsSearchBar = memo(function SettingsSearchBar({ width }: { width: number }) {
  const t = useTheme()
  const handleOpen = useCallback(() => {
    dispatchGlobal({ type: 'open-settings-search' })
  }, [])

  // Filled, and the prompt at full strength: it is the one control on a
  // read-mostly screen, and a control drawn like the text around it is a control
  // nobody sees. The fill is enough to say so — the frame it used to wear cost
  // two rows to repeat what the fill already said.
  return (
    <box
      backgroundColor={t.backgroundElement}
      width={width}
      flexShrink={0}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={handleOpen}
    >
      <text fg={t.primary} selectable={false} wrapMode="none">
        {`${SEARCH_GLYPH} `}
      </text>
      <box flexGrow={1} flexShrink={1}>
        <text fg={t.text} selectable={false} wrapMode="none">
          Search every setting…
        </text>
      </box>
      {/* The key drawn as the cap you press, not as a letter in a sentence. */}
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {'[ '}
      </text>
      <text fg={t.primary} selectable={false} wrapMode="none">
        /
      </text>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {' ]'}
      </text>
    </box>
  )
})
