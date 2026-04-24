import { useKeyboard } from '@opentui/react'
import { useEffect, useState } from 'react'

import { useAppStore } from '../../../../state/app-store'
import {
  closeContextMenu,
  type ContextMenuState,
  subscribeContextMenu,
} from '../../../context-menu/controller'
import { useTheme } from '../../../theme'

export function ContextMenuOverlay() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selected, setSelected] = useState(0)
  const t = useTheme()
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
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          closeContextMenu()
        }}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={width}
        flexDirection="column"
        border
        borderColor={t['border-weak-base']}
        backgroundColor={t['surface-raised-stronger-non-alpha']}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
      >
        {menu.items.map(([label, onSelect], index) => {
          const active = index === selected
          return (
            <box
              key={`${label}-${index}`}
              width={width - 2}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={active ? t['surface-raised-base-hover'] : undefined}
              onMouseOver={() => setSelected(index)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.button !== 0) return
                closeContextMenu()
                onSelect()
              }}
            >
              <text fg={active ? t['text-base'] : t['text-weak']} selectable={false}>
                {label}
              </text>
            </box>
          )
        })}
      </box>
    </box>
  )
}
