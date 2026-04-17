import type { ReactNode } from 'react'

import { theme } from '../theme'
import { Surface } from './surface'

export type ListItemDirection = 'row' | 'column'

interface ListItemProps {
  active: boolean
  direction?: ListItemDirection
  leading?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
  trailing?: ReactNode
}

export function ListItem({
  active,
  direction = 'column',
  leading,
  subtitle,
  title,
  trailing,
}: ListItemProps) {
  const isRow = direction === 'row'
  return (
    <Surface
      tone={active ? 'selected' : 'elevated'}
      paddingLeft={isRow ? 2 : 1}
      paddingRight={isRow ? 2 : 1}
    >
      <box flexDirection="column">
        <box flexDirection="row">
          {isRow ? null : (
            <>
              <text fg={active ? theme.accent : theme.dim}>{active ? '›' : '·'}</text>
              <text> </text>
            </>
          )}
          {leading}
          {leading ? <text> </text> : null}
          <box flexGrow={isRow ? 0 : 1}>{title}</box>
          {trailing ? <box>{trailing}</box> : null}
        </box>
        {subtitle ? <box paddingLeft={2}>{subtitle}</box> : null}
      </box>
    </Surface>
  )
}
