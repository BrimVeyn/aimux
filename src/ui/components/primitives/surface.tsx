import type { ReactNode } from 'react'

import type { TuiColorToken } from '../../themes'

import { useTheme } from '../../theme'

type SurfaceTone = 'muted' | 'elevated' | 'selected' | 'input' | 'inputActive'

function toneToToken(tone: SurfaceTone): TuiColorToken {
  switch (tone) {
    case 'elevated':
      return 'backgroundElement'
    case 'selected':
      return 'backgroundElement'
    case 'input':
      return 'backgroundElement'
    case 'inputActive':
      return 'backgroundElement'
    case 'muted':
    default:
      return 'backgroundPanel'
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
  const t = useTheme()
  return (
    <box
      backgroundColor={t[toneToToken(tone)]}
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
