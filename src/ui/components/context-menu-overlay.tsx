import { useKeyboard } from '@opentui/react'
import { useEffect, useState } from 'react'

import { useAppStore } from '../../state/app-store'
import {
  closeContextMenu,
  type ContextMenuState,
  subscribeContextMenu,
} from '../context-menu/controller'
import { useTheme } from '../theme'

export function ContextMenuOverlay() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selected, setSelected] = useState(0)
  const theme = useTheme()
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
  // +2 horizontal padding, +2 border
  const width = maxLabel + 4
  const height = menu.items.length + 2
  const left = Math.max(0, Math.min(menu.anchorX, terminalCols - width))
  const top = Math.max(0, Math.min(menu.anchorY, terminalRows - height))

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
        borderColor={theme.colors['focusBorder']}
        backgroundColor={theme.colors['sideBar.background']}
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
              backgroundColor={active ? theme.colors['list.activeSelectionBackground'] : undefined}
              onMouseOver={() => setSelected(index)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.button !== 0) return
                closeContextMenu()
                onSelect()
              }}
            >
              <text
                fg={
                  active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']
                }
                selectable={false}
              >
                {label}
              </text>
            </box>
          )
        })}
      </box>
    </box>
  )
}
