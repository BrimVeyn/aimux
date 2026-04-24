import type { ReactNode } from 'react'

import type { ResolvedToken } from '../../themes'

import { useTheme } from '../../theme'

type SurfaceTone = 'muted' | 'elevated' | 'selected' | 'input' | 'inputActive'

function toneToToken(tone: SurfaceTone): ResolvedToken {
  switch (tone) {
    case 'elevated':
      return 'surface-raised-base'
    case 'selected':
      return 'surface-raised-base-hover'
    case 'input':
      return 'input-base'
    case 'inputActive':
      return 'input-base'
    case 'muted':
    default:
      return 'background-stronger'
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
