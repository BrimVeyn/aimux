import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useRef } from 'react'

import type { SessionRecord } from '../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterSessions } from '../../state/selectors'
import { abbreviatePath } from '../path-format'
import { orderSessionsForDisplay } from '../session-ordering'
import { useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

interface SessionPickerModalProps {
  sessions: SessionRecord[]
  selectedIndex: number
  currentSessionId: string | null
  currentTabCount: number
  filter: string | null
}

const VIEWPORT_HEIGHT_RATIO = 0.6
const MODAL_CHROME_ROWS = 6

function formatSessionLine(
  session: SessionRecord,
  currentSessionId: string | null,
  currentTabCount: number,
  displayIndex: number
): string {
  const tabCount =
    session.id === currentSessionId
      ? currentTabCount
      : (session.workspaceSnapshot?.tabs.length ?? 0)
  return `[${displayIndex}] ${session.name} (${tabCount} tab${tabCount === 1 ? '' : 's'})`
}

function getEmptyStateMessage(hasFilter: boolean): string {
  if (hasFilter) {
    return 'No matching sessions.'
  }

  return 'No sessions yet. Press Enter or n to create your first session.'
}

export function SessionPickerModal({
  currentSessionId,
  currentTabCount,
  filter,
  selectedIndex,
  sessions,
}: SessionPickerModalProps) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const ordered = orderSessionsForDisplay(sessions)
  const baselineOrder = ordered.map((s) => s.id)
  const filtered = filterSessions(ordered, filter)
  const hasFilter = !!filter
  const showFilteredEmptyState = filtered.length === 0 && sessions.length > 0
  const showInitialEmptyState = filtered.length === 0 && sessions.length === 0

  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const isScrollingRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!scrollboxRef.current) return
    isScrollingRef.current = true
    scrollboxRef.current.scrollChildIntoView(`session-item-${selectedIndex}`)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false
      scrollTimerRef.current = null
    }, 10)
  }, [selectedIndex])

  return (
    <ModalShell
      title="Sessions"
      keybindsModeId="modal.session-picker"
      width={uiTokens.modalWidth.lg}
      footer={<ModalFilterBar filter={filter} />}
    >
      {showFilteredEmptyState ? (
        <text fg={theme.colors['descriptionForeground']}>{getEmptyStateMessage(hasFilter)}</text>
      ) : null}
      {showInitialEmptyState ? (
        <text fg={theme.colors['descriptionForeground']}>{getEmptyStateMessage(false)}</text>
      ) : null}
      <scrollbox
        ref={scrollboxRef}
        scrollY
        height={listHeight}
        contentOptions={{ flexDirection: 'column', gap: 1 }}
        onMouseScroll={() => {
          isScrollingRef.current = true
          if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
          scrollTimerRef.current = setTimeout(() => {
            isScrollingRef.current = false
            scrollTimerRef.current = null
          }, 100)
        }}
      >
        {filtered.map((session, index) => {
          const active = index === selectedIndex
          const displayIndex = baselineOrder.indexOf(session.id) + 1
          return (
            <ListItem
              key={session.id}
              id={`session-item-${index}`}
              active={active}
              title={
                <text
                  fg={
                    active
                      ? theme.colors['editor.foreground']
                      : theme.colors['descriptionForeground']
                  }
                >
                  {formatSessionLine(session, currentSessionId, currentTabCount, displayIndex)}
                </text>
              }
              subtitle={
                session.projectPath ? (
                  <text fg={theme.colors['descriptionForeground']}>
                    {abbreviatePath(session.projectPath)}
                  </text>
                ) : undefined
              }
              onHover={() => {
                if (isScrollingRef.current) return
                dispatchGlobal({ index, type: 'set-modal-selection-index' })
              }}
              onClick={() => runSideEffectGlobal({ type: 'confirm-selected-session' })}
            />
          )
        })}
        <ListItem
          id={`session-item-${filtered.length}`}
          active={selectedIndex === filtered.length}
          title={
            <text
              fg={
                selectedIndex === filtered.length
                  ? theme.colors['editor.foreground']
                  : theme.colors['descriptionForeground']
              }
            >
              Create new session
            </text>
          }
          onHover={() => {
            if (isScrollingRef.current) return
            dispatchGlobal({ index: filtered.length, type: 'set-modal-selection-index' })
          }}
          onClick={() => runSideEffectGlobal({ type: 'confirm-selected-session' })}
        />
      </scrollbox>
    </ModalShell>
  )
}
