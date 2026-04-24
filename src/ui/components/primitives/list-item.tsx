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
  return (
    <box id={id} onMouseOver={onHover} onMouseDown={onClick}>
      <Surface
        tone={active ? 'selected' : 'elevated'}
        paddingLeft={isRow ? 2 : 1}
        paddingRight={isRow ? 2 : 1}
      >
        <box flexDirection="column">
          <box flexDirection="row">
            {isRow ? null : (
              <>
                <text fg={active ? t['text-interactive-base'] : t['text-weaker']}>
                  {active ? '›' : '·'}
                </text>
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
    </box>
  )
}
