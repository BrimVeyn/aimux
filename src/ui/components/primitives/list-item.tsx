import { memo, type ReactNode, useMemo } from 'react'

import { useSelectionInk } from '../../selection-ink'
import { useTheme } from '../../theme'
import { Surface } from './surface'

export type ListItemDirection = 'row' | 'column'

/**
 * How the selected row is filled. `primary` by default — the accent fill every
 * picker and nav list wants. `elevated` is for a row that carries a colour scale
 * of its own (the settings rows and their gauges): an accent behind those would
 * swallow the very thing the row is there to show.
 */
export type ListItemFill = 'primary' | 'elevated'

interface ListItemProps {
  active: boolean
  direction?: ListItemDirection
  fill?: ListItemFill
  id?: string
  index?: number
  leading?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
  trailing?: ReactNode
  onHover?: () => void
  onClick?: () => void
  onHoverIndex?: (index: number) => void
  onClickIndex?: (index: number) => void
}

export const ListItem = memo(function ListItem({
  active,
  direction = 'column',
  fill = 'primary',
  id,
  index,
  leading,
  onClick,
  onClickIndex,
  onHover,
  onHoverIndex,
  subtitle,
  title,
  trailing,
}: ListItemProps) {
  const t = useTheme()
  const ink = useSelectionInk()
  const isRow = direction === 'row'
  const filled = active && fill === 'primary'
  // The cursor glyph: the selection ink on a filled row, the accent on a row
  // that only lifts, muted on the rest.
  let markerFg = t.textMuted
  if (filled) markerFg = ink
  else if (active) markerFg = t.primary
  // Build per-item handlers from the stable index-based callbacks so callers can
  // avoid creating fresh closures inside their list `.map()`.
  const handleHover = useMemo<(() => void) | undefined>(() => {
    if (onHoverIndex && index !== undefined) return () => onHoverIndex(index)
    return onHover
  }, [index, onHover, onHoverIndex])
  const handleClick = useMemo<(() => void) | undefined>(() => {
    if (onClickIndex && index !== undefined) return () => onClickIndex(index)
    return onClick
  }, [index, onClick, onClickIndex])
  const inner = (
    <box flexDirection="column">
      <box flexDirection="row">
        {isRow ? null : (
          <>
            <text fg={markerFg}>{active ? '›' : '·'}</text>
            <text> </text>
          </>
        )}
        {leading}
        {leading != null ? <text> </text> : null}
        <box flexGrow={isRow ? 0 : 1}>{title}</box>
        {trailing != null ? <box>{trailing}</box> : null}
      </box>
      {subtitle != null ? <box paddingLeft={2}>{subtitle}</box> : null}
    </box>
  )
  return (
    <box id={id} onMouseOver={handleHover} onMouseDown={handleClick}>
      {active ? (
        <Surface
          tone={fill === 'primary' ? 'selected' : 'elevated'}
          paddingLeft={isRow ? 2 : 1}
          paddingRight={isRow ? 2 : 1}
        >
          {inner}
        </Surface>
      ) : (
        <box paddingLeft={isRow ? 2 : 1} paddingRight={isRow ? 2 : 1}>
          {inner}
        </box>
      )}
    </box>
  )
})
