import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'
import type { BoxProps } from '@opentui/react'

import { memo, useCallback } from 'react'

import { type ContextMenuItem, openContextMenu } from '../../../context-menu/controller'

interface ContextMenuBoxProps extends BoxProps {
  rightClickMenu?: ContextMenuItem[]
}

export const ContextMenuBox = memo(function ContextMenuBox({
  onMouseDown,
  rightClickMenu,
  ...boxProps
}: ContextMenuBoxProps) {
  const handleMouseDown = useCallback(
    function (this: BoxRenderable, event: OtuiMouseEvent): void {
      if (event.button === 2 && rightClickMenu && rightClickMenu.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        openContextMenu(event.x, event.y, rightClickMenu)
        return
      }
      onMouseDown?.call(this, event)
    },
    [onMouseDown, rightClickMenu]
  )
  return <box {...boxProps} onMouseDown={handleMouseDown} />
})
