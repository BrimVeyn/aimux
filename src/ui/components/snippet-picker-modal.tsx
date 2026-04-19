import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useRef } from 'react'

import type { SnippetRecord } from '../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterSnippets } from '../../state/selectors'
import { useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

interface SnippetPickerModalProps {
  snippets: SnippetRecord[]
  selectedIndex: number
  filter: string | null
}

const MAX_PREVIEW_LENGTH = 60
const VIEWPORT_HEIGHT_RATIO = 0.6
const MODAL_CHROME_ROWS = 6

function truncateContent(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
}

export function SnippetPickerModal({ filter, selectedIndex, snippets }: SnippetPickerModalProps) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const filtered = filterSnippets(snippets, filter)

  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const isScrollingRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!scrollboxRef.current) return
    isScrollingRef.current = true
    scrollboxRef.current.scrollChildIntoView(`snippet-item-${selectedIndex}`)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false
      scrollTimerRef.current = null
    }, 10)
  }, [selectedIndex])

  return (
    <ModalShell
      title="Snippets"
      keybindsModeId="modal.snippet-picker"
      width={uiTokens.modalWidth.xl}
      footer={<ModalFilterBar filter={filter} />}
    >
      {filtered.length === 0 ? (
        <text fg={theme.colors['descriptionForeground']}>
          {filter ? 'No matching snippets.' : 'No snippets yet. Press n to create one.'}
        </text>
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
        {filtered.map((snippet, index) => {
          const active = index === selectedIndex
          return (
            <ListItem
              key={snippet.id}
              id={`snippet-item-${index}`}
              active={active}
              title={
                <text
                  fg={
                    active
                      ? theme.colors['editor.foreground']
                      : theme.colors['descriptionForeground']
                  }
                >
                  <strong>{snippet.name}</strong>
                </text>
              }
              subtitle={
                <text fg={theme.colors['descriptionForeground']}>
                  {truncateContent(snippet.content)}
                </text>
              }
              onHover={() => {
                if (isScrollingRef.current) return
                dispatchGlobal({ index, type: 'set-modal-selection-index' })
              }}
              onClick={() => {
                dispatchGlobal({ type: 'close-modal' })
                runSideEffectGlobal({ type: 'paste-selected-snippet' })
              }}
            />
          )
        })}
      </scrollbox>
    </ModalShell>
  )
}
