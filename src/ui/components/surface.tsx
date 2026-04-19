import type { ReactNode } from 'react'

import type { ThemeColorMap } from '../themes'

import { useBg } from '../theme'

type SurfaceTone = 'muted' | 'elevated' | 'selected' | 'input' | 'inputActive'

function toneToColorKey(tone: SurfaceTone): keyof ThemeColorMap {
  switch (tone) {
    case 'elevated':
      return 'sideBar.background'
    case 'selected':
      return 'list.activeSelectionBackground'
    case 'input':
      return 'editor.background'
    case 'inputActive':
      return 'list.activeSelectionBackground'
    case 'muted':
    default:
      return 'sideBarSectionHeader.background'
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
  const bg = useBg(toneToColorKey(tone))
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
