import type { SettingRow, SettingSection } from '../types'

import { ABOUT_SECTION } from './about'

/**
 * Every section, in the order the screen lists them. Adding a setting is one
 * entry in one of these files — no component, no reducer branch, no keybind.
 */
export const SETTING_SECTIONS: readonly SettingSection[] = [ABOUT_SECTION]

export const ALL_SETTING_ROWS: readonly SettingRow[] = SETTING_SECTIONS.flatMap(
  (section) => section.rows
)

export const DEFAULT_SECTION_ID = SETTING_SECTIONS[0]?.id ?? 'about'

export function getSection(sectionId: string): SettingSection | undefined {
  return SETTING_SECTIONS.find((section) => section.id === sectionId)
}

/** Rows of the given section, or an empty list when the id is unknown. */
export function getSectionRows(sectionId: string): readonly SettingRow[] {
  return getSection(sectionId)?.rows ?? []
}
