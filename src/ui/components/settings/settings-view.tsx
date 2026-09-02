import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { memo, useCallback, useMemo, useRef } from 'react'

import { filterSettingRows, type SettingSearchHit } from '../../../settings/search'
import { getSection } from '../../../settings/sections'
import { useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { clampBarWidth } from '../../../state/bars'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { useScrollActiveIntoView } from '../../hooks/use-scroll-active-into-view'
import { useSelectionInk } from '../../selection-ink'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { Muted, Rule, Section, TileRow } from '../stats/shared'
import { SettingsFooter } from './settings-footer'
import { CONFIG_FILE_MARK, SettingsRow, TOUCHED_MARK } from './settings-row'
import { SettingsSearchBar } from './settings-search-bar'

const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

const SETTINGS_GLYPH = '\u{2699}'

/** One padding column either side, the same inset the stats pages sit in. */
const PAGE_PAD = 1

/** A section and the rows it owns, each keeping the index the cursor holds. */
interface Group {
  sectionId: string
  label: string
  glyph: string
  note: string
  /** `[cursor index, hit]`, in screen order. */
  rows: [number, SettingSearchHit][]
}

function groupBySection(hits: SettingSearchHit[]): Group[] {
  const groups: Group[] = []
  for (const [index, hit] of hits.entries()) {
    const last = groups.at(-1)
    if (last?.sectionId === hit.sectionId) {
      last.rows.push([index, hit])
      continue
    }
    const section = getSection(hit.sectionId)
    groups.push({
      glyph: section?.glyph ?? ' ',
      label: hit.sectionLabel,
      note: section?.description ?? '',
      rows: [[index, hit]],
      sectionId: hit.sectionId,
    })
  }
  return groups
}

/**
 * The settings screen.
 *
 * Same shape as the stats screen — a nav column exactly where the left bar
 * stands, so opening it does not shift the column under the cursor, and a
 * bordered content pane where the terminal would be, showing one section at a
 * time.
 *
 * One section at a time, but still one cursor: the pane is a view of whatever
 * section the cursor is standing in, so `j` off the end of a section simply
 * lands in the next one and the pane follows. That is what lets a row afford
 * three lines — the setting, what it does, and a gap — where fifty rows in one
 * scroll could only afford one, and what keeps the nav column from being a
 * place you have to move into and back out of.
 */
export const SettingsView = memo(function SettingsView() {
  const t = useTheme()
  const ink = useSelectionInk()
  // The cursor is all this component needs from the app state. Rows read their
  // own values, so nothing here re-renders at the rate the terminals print.
  const rowIndex = useAppStore((s) => s.settings.rowIndex)
  // Which rows exist can depend on the projects — Setup has one per project — and
  // building a Setup row reads its script off disk. So the list is rebuilt when
  // the projects change and after any write; not on every render, which at the
  // rate this store changes would mean reading files at the rate the terminals
  // print.
  const projects = useAppStore((s) => s.projects)
  const revision = useSettingsStore((s) => s.revision)
  const touchedCount = useSettingsStore((s) => s.touched.size)
  const configCount = useSettingsStore((s) => s.fromConfigFile.size)
  // The section list stands exactly where the left bar stands. Its configured
  // width, not `getBarWidth`: a hidden bar still says how wide the sidebar is.
  const navWidth = useAppStore((s) => clampBarWidth(s.bars.left.width))
  const dimensions = useTerminalDimensions()
  const hits = useMemo(
    // No query: this is the whole list, and the same function the search filters
    // with — so the index a hit carries is the index this cursor holds.
    () => filterSettingRows(projects, null),
    // `revision` is an invalidation key, not an input: it says a value the builder
    // read from disk may have changed under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, revision]
  )
  const groups = useMemo(() => groupBySection(hits), [hits])
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const selected = hits[rowIndex]
  const current = groups.find((group) => group.sectionId === selected?.sectionId)

  useScrollActiveIntoView({
    activeId: selected?.row.id ?? null,
    idPrefix: 'setting-row-',
    scrollRef,
    visible: true,
  })

  // One click selects the row and changes it — a checkbox you have to select
  // first and then click again is not a checkbox.
  const handleRowClick = useCallback((index: number) => {
    dispatchGlobal({ rowIndex: index, type: 'settings-select-row' })
    runSideEffectGlobal({ type: 'activate-settings-row' })
  }, [])

  const handleSectionClick = useCallback(
    (index: number) => {
      const first = groups[index]?.rows[0]?.[0]
      if (first === undefined) return
      dispatchGlobal({ rowIndex: first, type: 'settings-select-row' })
    },
    [groups]
  )

  const handleClose = useCallback(() => {
    dispatchGlobal({ type: 'exit-settings' })
  }, [])

  // The headline row doubles as the legend for the two marks the rows wear —
  // the counts are the only reason anyone would need to know what they mean.
  const tiles = useMemo(
    () =>
      [
        { glyph: SETTINGS_GLYPH, label: 'settings', value: String(hits.length) },
        // A mark no row is wearing needs no legend, and a count of zero is not
        // news — so the tile only exists while the mark does.
        touchedCount === 0
          ? null
          : { glyph: TOUCHED_MARK, label: 'changed', value: String(touchedCount) },
        configCount === 0
          ? null
          : { glyph: CONFIG_FILE_MARK, label: 'from config', value: String(configCount) },
      ].filter((tile) => tile !== null),
    [hits.length, touchedCount, configCount]
  )

  // Same 1-cell seam the bar draws between itself and the terminal, so the two
  // views line up to the column.
  const navContentWidth = Math.max(1, navWidth - 1)
  const usable = Math.max(24, dimensions.width - navWidth - 2 - PAGE_PAD * 2)

  return (
    <box flexDirection="row" flexGrow={1} overflow="hidden">
      <box width={navWidth} flexDirection="row" overflow="hidden" backgroundColor={t.background}>
        <box width={navContentWidth} flexDirection="column" overflow="hidden">
          <box paddingLeft={1} paddingRight={1}>
            <text fg={t.textMuted}>Settings</text>
          </box>
          {/* A jump list, not a column you move into: it says which section the
              cursor is in and takes it somewhere. Nothing here holds focus,
              which is why the screen needs no notion of which pane has it. */}
          <box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
            {groups.map((group, index) => (
              <ListItem
                key={group.sectionId}
                active={group.sectionId === current?.sectionId}
                index={index}
                onClickIndex={handleSectionClick}
                title={
                  <text fg={group.sectionId === current?.sectionId ? ink : t.textMuted}>
                    {`${group.glyph} ${group.label}`}
                  </text>
                }
                trailing={
                  group.sectionId === current?.sectionId ? <text fg={ink}>›</text> : undefined
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
          keeps the inset it had instead of jumping to the edge of the screen. */}
      <box
        border
        borderColor={t.borderActive}
        title={`${SETTINGS_GLYPH} Settings`}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={t.background}
      >
        {/* Outside the scroll: the way to find a setting should not be a thing
            you have to scroll back up to. */}
        <box flexShrink={0} paddingLeft={PAGE_PAD} paddingRight={PAGE_PAD} paddingTop={1}>
          <SettingsSearchBar width={usable} />
        </box>
        <scrollbox
          ref={scrollRef}
          scrollY
          flexGrow={1}
          flexShrink={1}
          contentOptions={COLUMN_CONTENT_OPTIONS}
        >
          <box flexDirection="column" paddingLeft={PAGE_PAD} paddingRight={PAGE_PAD}>
            <TileRow tiles={tiles} usable={usable} />
            <box paddingTop={1} paddingBottom={1} flexShrink={0}>
              <Rule width={usable} />
            </box>
            {current === undefined ? (
              <Muted>Nothing to configure here yet.</Muted>
            ) : (
              <Section
                glyph={current.glyph}
                title={current.label}
                // Pinned to the same right edge every note on the screen lands on.
                note={String(current.rows.length)}
                width={usable}
              >
                {current.note === '' ? null : (
                  <box width={usable} paddingBottom={1}>
                    <text fg={t.textMuted} selectable={false}>
                      {current.note}
                    </text>
                  </box>
                )}
                <box flexDirection="column" gap={1}>
                  {current.rows.map(([index, hit]) => (
                    <SettingsRow
                      key={hit.row.id}
                      row={hit.row}
                      index={index}
                      active={index === rowIndex}
                      onSelect={handleRowClick}
                      width={usable}
                    />
                  ))}
                </box>
              </Section>
            )}
          </box>
        </scrollbox>
        <SettingsFooter row={selected?.row ?? null} width={usable} pad={PAGE_PAD} />
      </box>
    </box>
  )
})
