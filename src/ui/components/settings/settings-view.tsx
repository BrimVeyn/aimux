import type { ScrollBoxRenderable } from '@opentui/core'

import { memo, useCallback, useMemo, useRef } from 'react'

import { getSectionRows, SETTING_SECTIONS } from '../../../settings/sections'
import { useSettingsStore } from '../../../settings/settings-store'
import { appStore, useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { useScrollActiveIntoView } from '../../hooks/use-scroll-active-into-view'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { SettingsRow } from './settings-row'

const NAV_WIDTH = 20
const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

export const SettingsView = memo(function SettingsView() {
  const t = useTheme()
  // The cursor is all this component needs from the app state. Rows read their
  // own values, so nothing here re-renders at the rate the terminals print.
  const settings = useAppStore((s) => s.settings)
  // Which rows exist can depend on state — Setup has one per project — and the
  // Setup rows read their value from a file when they are built. So the list is
  // rebuilt when the cursor moves, when the projects change, and after any write
  // (that is what `revision` is for), and not on every render: a rebuild reads
  // files, and this component would otherwise do it at the rate the store changes.
  const projectIds = useAppStore((s) => s.projects.map((project) => project.id).join(','))
  const revision = useSettingsStore((s) => s.revision)
  const rows = useMemo(
    () => getSectionRows(settings.sectionId, appStore.getState()),
    // Invalidation keys rather than inputs: the builder reads the store and, for
    // Setup, the file system. These are what say the answer may have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, projectIds, revision]
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

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden">
      <box flexDirection="row" flexGrow={1}>
        <box
          width={NAV_WIDTH}
          flexDirection="column"
          backgroundColor={t.backgroundPanel}
          overflow="hidden"
        >
          <box paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted}>Settings</text>
          </box>
          {SETTING_SECTIONS.map((section, index) => (
            <ListItem
              key={section.id}
              active={section.id === settings.sectionId}
              index={index}
              onClickIndex={handleSectionClick}
              title={
                <text fg={section.id === settings.sectionId ? t.text : t.textMuted}>
                  {section.label}
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
        <box flexDirection="column" flexGrow={1} overflow="hidden">
          <box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1}>
            <box flexGrow={1}>
              <text fg={t.text}>
                {SETTING_SECTIONS.find((s) => s.id === settings.sectionId)?.label ?? ''}
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={t.backgroundElement}
              onMouseDown={handleClose}
            >
              <text fg={t.text}>
                <strong>Close</strong>
              </text>
            </box>
          </box>
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
