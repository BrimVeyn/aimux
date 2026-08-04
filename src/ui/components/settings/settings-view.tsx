import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { memo, useCallback, useMemo, useRef } from 'react'

import { getSectionRows, SETTING_SECTIONS } from '../../../settings/sections'
import { useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { clampBarWidth } from '../../../state/bars'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { useScrollActiveIntoView } from '../../hooks/use-scroll-active-into-view'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { SettingsRow } from './settings-row'

const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

/**
 * Share of the window the settings themselves are allowed. Without a cap the
 * value sits on the far edge of a wide terminal, a hundred columns from the label
 * it belongs to, and the pair stops reading as a pair.
 *
 * A share of the window rather than a fixed column count, so it holds whatever
 * the window is; the floor is there for the narrow ones, where the pane is
 * smaller than the cap anyway and this stops binding.
 */
const CONTENT_WIDTH_RATIO = 0.45
const CONTENT_MIN_WIDTH = 56

export const SettingsView = memo(function SettingsView() {
  const t = useTheme()
  // The cursor is all this component needs from the app state. Rows read their
  // own values, so nothing here re-renders at the rate the terminals print.
  const settings = useAppStore((s) => s.settings)
  // The section list stands exactly where the left bar stands, so opening the
  // screen does not shift the column under the cursor. Its configured width, not
  // `getBarWidth`: a hidden bar still says how wide the sidebar is.
  const navWidth = useAppStore((s) => clampBarWidth(s.bars.left.width))
  // Which rows exist can depend on the projects — Setup has one per project — and
  // building a Setup row reads its script off disk. So the list is rebuilt when
  // the section changes, when the projects change, and after any write; not on
  // every render, which at the rate this store changes would mean reading files
  // at the rate the terminals print.
  const projects = useAppStore((s) => s.projects)
  const revision = useSettingsStore((s) => s.revision)
  const rows = useMemo(
    () => getSectionRows(settings.sectionId, projects),
    // `revision` is an invalidation key, not an input: it says a value the builder
    // read from disk may have changed under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.sectionId, projects, revision]
  )
  const dimensions = useTerminalDimensions()
  const contentMaxWidth = Math.max(
    CONTENT_MIN_WIDTH,
    Math.round(dimensions.width * CONTENT_WIDTH_RATIO)
  )
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  useScrollActiveIntoView({
    activeId: settings.pane === 'rows' ? (rows[settings.rowIndex]?.id ?? null) : null,
    idPrefix: 'setting-row-',
    scrollRef,
    visible: true,
  })

  const handleSectionClick = useCallback((index: number) => {
    const sectionId = SETTING_SECTIONS[index]?.id
    if (sectionId == null) return
    dispatchGlobal({ sectionId, type: 'settings-select-section' })
  }, [])

  // One click selects the row and changes it — a checkbox you have to select
  // first and then click again is not a checkbox.
  const handleRowClick = useCallback((rowIndex: number) => {
    dispatchGlobal({ rowIndex, type: 'settings-select-row' })
    runSideEffectGlobal({ type: 'activate-settings-row' })
  }, [])

  const handleClose = useCallback(() => {
    dispatchGlobal({ type: 'exit-settings' })
  }, [])

  const section = SETTING_SECTIONS.find((s) => s.id === settings.sectionId)
  // The glyph rides with the label: a section that could not be found has
  // neither, and the fallback title stands on its own.
  const sectionTitle = section === undefined ? 'Settings' : `${section.glyph} ${section.label}`
  const sectionNote = section?.description
  // Same 1-cell seam the bar draws between itself and the terminal, so the two
  // views line up to the column.
  const navContentWidth = Math.max(1, navWidth - 1)

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden">
      <box width={navWidth} flexDirection="row" overflow="hidden" backgroundColor={t.background}>
        <box width={navContentWidth} flexDirection="column" overflow="hidden">
          <box paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted}>Settings</text>
          </box>
          <box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
            {SETTING_SECTIONS.map((section, index) => (
              <ListItem
                key={section.id}
                active={section.id === settings.sectionId}
                index={index}
                onClickIndex={handleSectionClick}
                title={
                  <text fg={section.id === settings.sectionId ? t.text : t.textMuted}>
                    {`${section.glyph} ${section.label}`}
                  </text>
                }
                trailing={
                  section.id === settings.sectionId && settings.pane === 'nav' ? (
                    <text fg={t.primary}>›</text>
                  ) : undefined
                }
              />
            ))}
          </box>
          <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted} onMouseDown={handleClose}>
              ‹ Close
            </text>
          </box>
        </box>
        <box width={1} flexShrink={0} backgroundColor={t.border} />
      </box>
      {/* The pane the terminal would be in, with the same border — the content
          keeps the inset it had, instead of jumping to the edge of the screen. */}
      <box
        border
        borderColor={settings.pane === 'rows' ? t.borderActive : t.border}
        title={sectionTitle}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={t.background}
      >
        <box flexDirection="column" flexGrow={1} flexShrink={1} maxWidth={contentMaxWidth}>
          {sectionNote != null && sectionNote !== '' ? (
            <box flexShrink={0} paddingLeft={1} paddingRight={1}>
              <text fg={t.textMuted}>{sectionNote}</text>
            </box>
          ) : null}
          <scrollbox
            ref={scrollRef}
            scrollY
            flexGrow={1}
            flexShrink={1}
            contentOptions={COLUMN_CONTENT_OPTIONS}
          >
            {rows.length === 0 ? (
              <box paddingLeft={1}>
                <text fg={t.textMuted}>Nothing to configure here yet.</text>
              </box>
            ) : (
              rows.map((row, index) => (
                <SettingsRow
                  key={row.id}
                  row={row}
                  index={index}
                  active={settings.pane === 'rows' && index === settings.rowIndex}
                  onSelect={handleRowClick}
                />
              ))
            )}
          </scrollbox>
        </box>
      </box>
    </box>
  )
})
