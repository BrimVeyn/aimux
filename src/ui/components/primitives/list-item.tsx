import type { ReactNode } from 'react'

import { useTheme } from '../../theme'
import { Surface } from './surface'

export type ListItemDirection = 'row' | 'column'

interface ListItemProps {
  active: boolean
  direction?: ListItemDirection
  id?: string
  leading?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
  trailing?: ReactNode
  onHover?: () => void
  onClick?: () => void
}

export function ListItem({
  active,
  direction = 'column',
  id,
  leading,
  onClick,
  onHover,
  subtitle,
  title,
  trailing,
}: ListItemProps) {
  const t = useTheme()
  const isRow = direction === 'row'
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
    <box id={id} onMouseOver={onHover} onMouseDown={onClick}>
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
}
