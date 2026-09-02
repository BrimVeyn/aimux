import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useKeyboard } from '@opentui/react'
import { memo, useCallback, useEffect, useState } from 'react'

import { useAppStore } from '../../../../state/app-store'
import {
  closeContextMenu,
  type ContextMenuState,
  subscribeContextMenu,
} from '../../../context-menu/controller'
import { useSelectionInk } from '../../../selection-ink'
import { useTheme, useTransparent } from '../../../theme'
import { fillBorderedBoxInterior } from '../../../transparent-fill'

const MenuItem = memo(function MenuItem({
  active,
  index,
  label,
  onHover,
  onSelect,
  width,
}: {
  active: boolean
  index: number
  label: string
  onHover: (index: number) => void
  onSelect: () => void
  width: number
}) {
  const t = useTheme()
  const ink = useSelectionInk()
  const handleMouseOver = useCallback(() => onHover(index), [index, onHover])
  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.button !== 0) return
      closeContextMenu()
      onSelect()
    },
    [onSelect]
  )
  return (
    <box
      width={width - 2}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={active ? t.primary : undefined}
      onMouseOver={handleMouseOver}
      onMouseDown={handleMouseDown}
    >
      <text fg={active ? ink : t.textMuted} selectable={false}>
        {label}
      </text>
    </box>
  )
})

export function ContextMenuOverlay() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selected, setSelected] = useState(0)
  const t = useTheme()
  const transparent = useTransparent()
  const terminalCols = useAppStore((s) => s.layout.terminalCols)
  const terminalRows = useAppStore((s) => s.layout.terminalRows)

  useEffect(() => {
    return subscribeContextMenu((state) => {
      setMenu(state)
      setSelected(0)
    })
  }, [])

  useKeyboard((key) => {
    if (!menu) return
    if (key.name === 'escape') {
      key.preventDefault()
      closeContextMenu()
      return
    }
    if (key.name === 'up') {
      key.preventDefault()
      setSelected((i) => (i - 1 + menu.items.length) % menu.items.length)
      return
    }
    if (key.name === 'down') {
      key.preventDefault()
      setSelected((i) => (i + 1) % menu.items.length)
      return
    }
    if (key.name === 'return') {
      key.preventDefault()
      const item = menu.items[selected]
      closeContextMenu()
      item?.[1]()
    }
  })

  const handleBackdropMouseDown = useCallback((e: OtuiMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    closeContextMenu()
  }, [])
  const handleMenuMouseDown = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
  }, [])

  if (!menu) return null

  const maxLabel = Math.max(...menu.items.map(([label]) => label.length))
  const width = maxLabel + 4
  const height = menu.items.length + 2
  const left =
    menu.anchorX + width <= terminalCols ? menu.anchorX : Math.max(0, menu.anchorX - width)
  const top =
    menu.anchorY + height <= terminalRows ? menu.anchorY : Math.max(0, menu.anchorY - height)

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%">
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        onMouseDown={handleBackdropMouseDown}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={width}
        flexDirection="column"
        // backgroundElement, not backgroundPanel: this pops up over the bars as
        // often as over the terminal, and the bars are panel — a panel menu on a
        // panel bar has no edge. Transparent mode keeps the border for the same
        // reason the modal does: there is no background there to stand on.
        border={transparent}
        borderColor={t.border}
        backgroundColor={transparent ? 'transparent' : t.backgroundElement}
        renderAfter={transparent ? fillBorderedBoxInterior : undefined}
        onMouseDown={handleMenuMouseDown}
      >
        {menu.items.map(([label, onSelect], index) => (
          <MenuItem
            key={label}
            index={index}
            label={label}
            onHover={setSelected}
            onSelect={onSelect}
            active={index === selected}
            width={width}
          />
        ))}
      </box>
    </box>
  )
}
