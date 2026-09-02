import type { ProjectRecord } from '../../state/types'
import type { SettingRow, SettingSection } from '../types'

import { ABOUT_SECTION } from './about'
import { APPEARANCE_SECTION } from './appearance'
import { AUTOMATION_SECTION } from './automation'
import { COMMANDS_SECTION } from './commands'
import { EDITOR_SECTION } from './editor'
import { EXPERIMENTAL_SECTION } from './experimental'
import { GIT_SECTION } from './git'
import { INTEGRATIONS_SECTION } from './integrations'
import { LAYOUT_SECTION } from './layout'
import { NOTIFICATIONS_SECTION } from './notifications'
import { SETUP_SECTION } from './setup'
import { STATUS_BAR_SECTION } from './status-bar'
import { WORKSPACE_SECTION } from './workspace'

/**
 * Every section aimux ships, in the order the screen lists them. Adding a
 * setting is one entry in one of these files — no component, no reducer
 * branch, no keybind.
 */
export const BUILTIN_SETTING_SECTIONS: readonly SettingSection[] = [
  APPEARANCE_SECTION,
  LAYOUT_SECTION,
  AUTOMATION_SECTION,
  NOTIFICATIONS_SECTION,
  SETUP_SECTION,
  WORKSPACE_SECTION,
  GIT_SECTION,
  COMMANDS_SECTION,
  EDITOR_SECTION,
  STATUS_BAR_SECTION,
  INTEGRATIONS_SECTION,
  EXPERIMENTAL_SECTION,
  ABOUT_SECTION,
]

const pluginSections = new Map<string, SettingSection>()
const listeners = new Set<() => void>()

function notify(): void {
  const current = [...listeners]
  for (const listener of current) listener()
}

export function onSettingSectionsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Registers a plugin's section. It lands after the built-ins and before
 * `About`, which is where a reader looks for "things this install added" —
 * and never between two built-ins, so the screen a user learned does not
 * reshuffle when they install something.
 *
 * Returns the disposer the plugin's fiber holds.
 */
export function registerSettingSection(section: SettingSection): () => void {
  pluginSections.set(section.id, section)
  notify()
  return () => {
    if (pluginSections.get(section.id) === section) pluginSections.delete(section.id)
    notify()
  }
}

/** Test seam. Never called by the app. */
export function clearSettingSections(): void {
  pluginSections.clear()
  notify()
}

/**
 * The sections the screen lists, built-ins plus whatever plugins registered.
 * Read fresh on every call: the cursor bounds, the search index and the screen
 * all derive from it, and a plugin loaded after boot has to move all three.
 */
export function settingSections(): readonly SettingSection[] {
  if (pluginSections.size === 0) return BUILTIN_SETTING_SECTIONS
  const about = BUILTIN_SETTING_SECTIONS.at(-1)
  const rest = BUILTIN_SETTING_SECTIONS.slice(0, -1)
  return about ? [...rest, ...pluginSections.values(), about] : [...pluginSections.values()]
}

/**
 * The rows that exist regardless of state, which is what hydration resolves. A
 * section that builds its rows from state is a view over something that has its
 * own home — a file, a project record — so it has nothing to hydrate.
 *
 * Built-ins only: hydration runs once at boot, before any plugin has loaded,
 * and a plugin's settings are hydrated by its own fiber from its own config.
 */
export const ALL_SETTING_ROWS: readonly SettingRow[] = BUILTIN_SETTING_SECTIONS.flatMap((section) =>
  Array.isArray(section.rows) ? section.rows : []
)

export function getSection(sectionId: string): SettingSection | undefined {
  return settingSections().find((section) => section.id === sectionId)
}

export function sectionRows(
  section: SettingSection,
  projects: readonly ProjectRecord[]
): readonly SettingRow[] {
  return Array.isArray(section.rows) ? section.rows : section.rows(projects)
}

/**
 * How many rows a section has, without building them. The reducer clamps the
 * cursor with this, which is why it exists: building a Setup row reads a script
 * off disk, and a reducer has no business doing that.
 */
export function sectionRowCount(
  section: SettingSection,
  projects: readonly ProjectRecord[]
): number {
  if (section.rowCount) return section.rowCount(projects)
  return Array.isArray(section.rows) ? section.rows.length : section.rows(projects).length
}

/**
 * How many rows the screen holds in total. The screen is one list, so this is
 * what clamps its cursor — and like `sectionRowCount`, it counts without
 * building, which is what keeps the reducer off the disk.
 */
export function totalRowCount(projects: readonly ProjectRecord[]): number {
  let total = 0
  for (const section of settingSections()) total += sectionRowCount(section, projects)
  return total
}

/**
 * The flat index of each section's first row, in screen order. What `}` and `{`
 * jump between, and the reason they can: an empty section contributes no index,
 * so the cursor never lands on a heading with nothing under it.
 */
export function sectionStartIndexes(projects: readonly ProjectRecord[]): number[] {
  const starts: number[] = []
  let index = 0
  for (const section of settingSections()) {
    const count = sectionRowCount(section, projects)
    if (count > 0) starts.push(index)
    index += count
  }
  return starts
}

/** The row with this id, dynamic ones included. */
export function findSettingRow(
  id: string,
  projects: readonly ProjectRecord[]
): SettingRow | undefined {
  for (const section of settingSections()) {
    const row = sectionRows(section, projects).find((entry) => entry.id === id)
    if (row) return row
  }
  return undefined
}
