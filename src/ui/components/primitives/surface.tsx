import type { ReactNode } from 'react'

import { type SurfaceToken, useBg } from '../../theme'

type SurfaceTone = 'muted' | 'elevated' | 'selected' | 'input' | 'inputActive'

function toneToToken(tone: SurfaceTone): SurfaceToken {
  switch (tone) {
    case 'elevated':
      return 'elevated'
    case 'selected':
    case 'inputActive':
      return 'selected'
    case 'input':
      return 'base'
    case 'muted':
    default:
      return 'elevated'
  }
}

interface SurfaceProps {
  children: ReactNode
  flexDirection?: 'row' | 'column'
  gap?: number
  padding?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  tone?: SurfaceTone
  width?: number | `${number}%`
}

export function Surface({
  children,
  flexDirection = 'column',
  gap = 0,
  padding,
  paddingBottom,
  paddingLeft,
  paddingRight,
  paddingTop,
  tone = 'muted',
  width,
}: SurfaceProps) {
  const bg = useBg(toneToToken(tone))
  return (
    <box
      backgroundColor={bg}
      flexDirection={flexDirection}
      gap={gap}
      padding={padding}
      paddingBottom={paddingBottom}
      paddingLeft={paddingLeft}
      paddingRight={paddingRight}
      paddingTop={paddingTop}
      width={width}
    >
      {children}
    </box>
  )
}
