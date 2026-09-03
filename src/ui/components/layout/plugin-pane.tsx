import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'
import type { ReactNode } from 'react'

import { PluginPaneContent, pluginPaneTitle } from '../../plugin-panes'
import { useTheme } from '../../theme'

/**
 * The chrome around a plugin's pane: the same border and background a terminal
 * pane draws, so a layout does not look like two different applications.
 *
 * It draws the focused border when the pane holds the keyboard, using the
 * navigation colour rather than the terminal-input one: a pane is never in
 * terminal input, and borrowing that colour would say it was.
 */
export function PluginPane({
  isActive = false,
  onMouseDown,
  paneId,
}: {
  paneId: string
  /** True while this pane holds the keyboard. */
  isActive?: boolean
  onMouseDown?: (event: OtuiMouseEvent) => void
}): ReactNode {
  const t = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      <box
        border
        borderColor={isActive ? t.primary : t.border}
        title={pluginPaneTitle(paneId)}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={t.background}
        onMouseDown={onMouseDown}
      >
        <PluginPaneContent paneId={paneId} />
      </box>
    </box>
  )
}
