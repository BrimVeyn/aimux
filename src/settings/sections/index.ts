import type { AppState } from '../../state/types'
import type { SettingRow, SettingSection } from '../types'

import { ABOUT_SECTION } from './about'
import { APPEARANCE_SECTION } from './appearance'
import { AUTOMATION_SECTION } from './automation'
import { COMMANDS_SECTION } from './commands'
import { EDITOR_SECTION } from './editor'
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

export function sectionRows(section: SettingSection, state: AppState): readonly SettingRow[] {
  return Array.isArray(section.rows) ? section.rows : section.rows(state)
}

/** Rows of the given section, or an empty list when the id is unknown. */
export function getSectionRows(sectionId: string, state: AppState): readonly SettingRow[] {
  const section = getSection(sectionId)
  return section ? sectionRows(section, state) : []
}

/** The row with this id, dynamic ones included. */
export function findSettingRow(id: string, state: AppState): SettingRow | undefined {
  for (const section of SETTING_SECTIONS) {
    const row = sectionRows(section, state).find((entry) => entry.id === id)
    if (row) return row
  }
  return undefined
}
