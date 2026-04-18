import type { ReactNode } from 'react'

import { getCurrentTheme } from '../theme'

type SurfaceTone = 'muted' | 'elevated' | 'selected' | 'input' | 'inputActive'

function getSurfaceColor(tone: SurfaceTone): string {
  switch (tone) {
    case 'elevated':
      return getCurrentTheme().colors['sideBar.background']
    case 'selected':
      return getCurrentTheme().colors['list.activeSelectionBackground']
    case 'input':
      return getCurrentTheme().colors['editor.background']
    case 'inputActive':
      return getCurrentTheme().colors['list.activeSelectionBackground']
    case 'muted':
    default:
      return getCurrentTheme().colors['sideBarSectionHeader.background']
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
  return (
    <box
      backgroundColor={getSurfaceColor(tone)}
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
