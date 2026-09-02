import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'
import type { ReactNode } from 'react'

import { PluginPaneContent, pluginPaneTitle } from '../../plugin-panes'
import { useTheme } from '../../theme'

/**
 * The chrome around a plugin's pane: the same border and background a terminal
 * pane draws, so a layout does not look like two different applications.
 *
 * It never draws the active border colour, because it can never be active —
 * see `src/ui/plugin-panes.tsx` for why keyboard focus stays with the
 * terminals. Mouse events reach the plugin's own elements through opentui, so
 * a list inside a pane still scrolls and clicks.
 */
export function PluginPane({
  onMouseDown,
  paneId,
}: {
  paneId: string
  onMouseDown?: (event: OtuiMouseEvent) => void
}): ReactNode {
  const t = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      <box
        border
        borderColor={t.border}
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
