import type { ModeId } from '@brimveyn/aimux-config'
import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { BareInput } from './bare-input'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

export interface PickerItem {
  key: string
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
}

interface PickerProps {
  title: string
  width: number | `${number}%`
  keybindsModeId?: ModeId
  listGap?: number
  gap?: number
  footer?: ReactNode
  items: PickerItem[]
  selectedIndex: number
  emptyState?: ReactNode
  onHover: (index: number) => void
  filter: string | null
  cursorPos?: number
}

const VIEWPORT_HEIGHT_RATIO = 0.6
const MODAL_CHROME_ROWS = 6

export function Picker({
  cursorPos,
  emptyState,
  filter,
  footer,
  gap = 0,
  items,
  keybindsModeId,
  listGap,
  onHover,
  selectedIndex,
  title,
  width,
}: PickerProps) {
  const dimensions = useTerminalDimensions()
  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const isScrollingRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextScrollRef = useRef(false)

  const resetScrollTimer = () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false
      scrollTimerRef.current = null
    }, 10)
  }

  useLayoutEffect(() => {
    if (!scrollboxRef.current) return
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false
      return
    }
    const target = items[selectedIndex]?.key
    if (!target) return
    isScrollingRef.current = true
    scrollboxRef.current.scrollChildIntoView(target)
    resetScrollTimer()
  }, [selectedIndex, items])

  return (
    <ModalShell
      title={title}
      width={width}
      keybindsModeId={keybindsModeId}
      listGap={listGap}
      footer={footer}
    >
      <BareInput value={filter ?? ''} cursorPos={cursorPos} placeholder="Type to filter..." />
      {items.length === 0 ? (emptyState ?? null) : null}
      <scrollbox
        ref={scrollboxRef}
        scrollY
        height={items.length === 0 ? 0 : listHeight}
        contentOptions={{ flexDirection: 'column', gap }}
        onMouseScroll={() => {
          isScrollingRef.current = true
          resetScrollTimer()
        }}
      >
        {items.map((item, index) => {
          const active = index === selectedIndex
          return (
            <ListItem
              key={item.key}
              id={item.key}
              active={active}
              title={item.title}
              subtitle={item.subtitle}
              trailing={item.trailing}
              onHover={() => {
                if (isScrollingRef.current) return
                skipNextScrollRef.current = true
                onHover(index)
              }}
              onClick={item.onClick}
            />
          )
        })}
      </scrollbox>
    </ModalShell>
  )
}
