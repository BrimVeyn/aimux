import { memo } from 'react'

import { useAppStore } from '../../../state/app-store'
import { useTheme } from '../../theme'
import { BareInput } from '../primitives/bare-input'

const SEARCH_GLYPH = '\u{2315}'

interface GitFileFilterBarProps {
  /** Files the filter keeps, against `total` — the one number worth reading. */
  matches: number
  total: number
}

/**
 * The diff sidebar's file filter. Only drawn while there is one — being typed,
 * or applied — so an unfiltered list spends no row on it; `/` is in the help.
 *
 * While typing it is a field with a cursor; once applied it holds the filter
 * as plain text, so a narrowed list never reads as the whole change set.
 */
export const GitFileFilterBar = memo(function GitFileFilterBar({
  matches,
  total,
}: GitFileFilterBarProps) {
  const t = useTheme()
  const modal = useAppStore((s) => s.modal)
  const applied = useAppStore((s) => s.gitMode.fileFilter)
  const editing = modal.type === 'git-file-filter'
  if (!editing && applied === '') return null

  return (
    <box
      backgroundColor={t.backgroundElement}
      flexShrink={0}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={t.primary} selectable={false} wrapMode="none">
        {`${SEARCH_GLYPH} `}
      </text>
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        {editing ? (
          <BareInput
            value={modal.editBuffer ?? ''}
            cursorPos={modal.cursorPos}
            placeholder="Filter files…"
          />
        ) : (
          <text fg={t.text} selectable={false} wrapMode="none">
            {applied}
          </text>
        )}
      </box>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {` ${matches}/${total}`}
      </text>
    </box>
  )
})
