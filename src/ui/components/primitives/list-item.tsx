import { memo, type ReactNode, useMemo } from 'react'

import { useTheme } from '../../theme'
import { Surface } from './surface'

export type ListItemDirection = 'row' | 'column'

interface ListItemProps {
  active: boolean
  direction?: ListItemDirection
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
  const isRow = direction === 'row'
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
            <text fg={active ? t.primary : t.textMuted}>{active ? '›' : '·'}</text>
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
        <Surface tone="selected" paddingLeft={isRow ? 2 : 1} paddingRight={isRow ? 2 : 1}>
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
