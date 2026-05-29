import type { ToastPosition } from '../../../../state/toast-store'

export interface ToastAnchor {
  vertical: 'top' | 'bottom'
  horizontal: 'left' | 'center' | 'right'
}

export function parseToastPosition(position: ToastPosition): ToastAnchor {
  const [vertical, horizontal] = position.split('-') as [
    ToastAnchor['vertical'],
    ToastAnchor['horizontal'],
  ]
  return { horizontal, vertical }
}

// Absolute box props that pin a stack to its corner. Center spans the width and
// centers its children; left/right hug their edge. Margin keeps it off the edge.
export function stackContainerProps(anchor: ToastAnchor, margin: number) {
  const vertical = anchor.vertical === 'top' ? { top: margin } : { bottom: margin }
  if (anchor.horizontal === 'left') {
    return { ...vertical, alignItems: 'flex-start' as const, left: margin }
  }
  if (anchor.horizontal === 'right') {
    return { ...vertical, alignItems: 'flex-end' as const, right: margin }
  }
  return { ...vertical, alignItems: 'center' as const, left: margin, right: margin }
}

interface SlideMargins {
  marginLeft?: number
  marginRight?: number
  marginTop?: number
  marginBottom?: number
}

// A negative margin on the entering edge pushes the toast that many cells off the
// nearest screen edge (the overflow is clipped by the screen buffer); animating it
// back to 0 slides the toast in. `offset` is cells off-screen (0 = resting). Used
// instead of opacity/transform, which terminals don't have.
export function slideOffsetStyle(anchor: ToastAnchor, offset: number): SlideMargins {
  const off = -offset
  if (anchor.horizontal === 'right') return { marginRight: off }
  if (anchor.horizontal === 'left') return { marginLeft: off }
  return anchor.vertical === 'top' ? { marginTop: off } : { marginBottom: off }
}
