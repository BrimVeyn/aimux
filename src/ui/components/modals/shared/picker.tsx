import type { ModeId } from '@brimveyn/aimux-config'
import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { useTheme } from '../../../theme'
import { BareInput } from '../../primitives/bare-input'
import { ListItem } from '../../primitives/list-item'
import { ModalShell } from './modal-shell'

export interface PickerItem {
  key: string
  group?: string
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
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

function PickerItemCtas({ onDelete, onEdit }: { onEdit?: () => void; onDelete?: () => void }) {
  const t = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      {onEdit ? (
        <box
          onMouseDown={(event) => {
            event.stopPropagation()
            onEdit()
          }}
        >
          <text fg={t['text-interactive-base']}>[edit]</text>
        </box>
      ) : null}
      {onDelete ? (
        <box
          onMouseDown={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <text fg={t['icon-critical-base']}>[del]</text>
        </box>
      ) : null}
    </box>
  )
}

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
  const t = useTheme()
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
        {(() => {
          let prevGroup: string | undefined
          const nodes: ReactNode[] = []
          for (let index = 0; index < items.length; index++) {
            const item = items[index]
            if (!item) continue
            if (item.group && item.group !== prevGroup) {
              nodes.push(
                <box key={`group::${item.group}`} paddingLeft={1} paddingTop={index === 0 ? 0 : 1}>
                  <text fg={t['text-weak']} wrapMode="none">
                    {item.group}
                  </text>
                </box>
              )
              prevGroup = item.group
            }
            const active = index === selectedIndex
            const capturedIndex = index
            const trailing =
              item.trailing ??
              (active && (item.onEdit || item.onDelete) ? (
                <PickerItemCtas onEdit={item.onEdit} onDelete={item.onDelete} />
              ) : null)
            nodes.push(
              <ListItem
                key={item.key}
                id={item.key}
                active={active}
                title={item.title}
                subtitle={item.subtitle}
                trailing={trailing}
                onHover={() => {
                  if (isScrollingRef.current) return
                  skipNextScrollRef.current = true
                  onHover(capturedIndex)
                }}
                onClick={item.onClick}
              />
            )
          }
          return nodes
        })()}
      </scrollbox>
    </ModalShell>
  )
}
