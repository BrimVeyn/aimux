import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'
import type { BoxProps } from '@opentui/react'

import { type ContextMenuItem, openContextMenu } from '../context-menu/controller'

interface ContextMenuBoxProps extends BoxProps {
  rightClickMenu?: ContextMenuItem[]
}

export function ContextMenuBox({ onMouseDown, rightClickMenu, ...boxProps }: ContextMenuBoxProps) {
  function handleMouseDown(this: BoxRenderable, event: OtuiMouseEvent): void {
    if (event.button === 2 && rightClickMenu && rightClickMenu.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      openContextMenu(event.x, event.y, rightClickMenu)
      return
    }
    onMouseDown?.call(this, event)
  }
  return <box {...boxProps} onMouseDown={handleMouseDown} />
}
