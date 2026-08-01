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
import { SETUP_SECTION } from './setup'
import { STATUS_BAR_SECTION } from './status-bar'

/**
 * Every section, in the order the screen lists them. Adding a setting is one
 * entry in one of these files — no component, no reducer branch, no keybind.
 */
export const SETTING_SECTIONS: readonly SettingSection[] = [
  APPEARANCE_SECTION,
  LAYOUT_SECTION,
  AUTOMATION_SECTION,
  SETUP_SECTION,
  GIT_SECTION,
  COMMANDS_SECTION,
  EDITOR_SECTION,
  STATUS_BAR_SECTION,
  INTEGRATIONS_SECTION,
  EXPERIMENTAL_SECTION,
  ABOUT_SECTION,
]

/**
 * The rows that exist regardless of state, which is what hydration resolves. A
 * section that builds its rows from state is a view over something that has its
 * own home — a file, a project record — so it has nothing to hydrate.
 */
export const ALL_SETTING_ROWS: readonly SettingRow[] = SETTING_SECTIONS.flatMap((section) =>
  Array.isArray(section.rows) ? section.rows : []
)

export const DEFAULT_SECTION_ID = SETTING_SECTIONS[0]?.id ?? 'about'

export function getSection(sectionId: string): SettingSection | undefined {
  return SETTING_SECTIONS.find((section) => section.id === sectionId)
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

/** Rows of the given section, or an empty list when the id is unknown. */
export function getSectionRows(
  sectionId: string,
  projects: readonly ProjectRecord[]
): readonly SettingRow[] {
  const section = getSection(sectionId)
  return section ? sectionRows(section, projects) : []
}

export function getSectionRowCount(sectionId: string, projects: readonly ProjectRecord[]): number {
  const section = getSection(sectionId)
  return section ? sectionRowCount(section, projects) : 0
}

/** The row with this id, dynamic ones included. */
export function findSettingRow(
  id: string,
  projects: readonly ProjectRecord[]
): SettingRow | undefined {
  for (const section of SETTING_SECTIONS) {
    const row = sectionRows(section, projects).find((entry) => entry.id === id)
    if (row) return row
  }
  return undefined
}
