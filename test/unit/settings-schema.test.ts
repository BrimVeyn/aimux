import { expect, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import {
  ALL_SETTING_ROWS,
  BUILTIN_SETTING_SECTIONS,
  sectionRowCount,
  sectionRows,
} from '../../src/settings/sections'
import { readRow } from '../../src/settings/settings-store'
import { createInitialState } from '../../src/state/store'

const STATE = createInitialState()
const NOW = '2026-08-01T00:00:00.000Z'
/** Two projects, so the sections that build a row per project build some. */
const PROJECTS: ProjectRecord[] = [
  { createdAt: NOW, id: 'p1', lastOpenedAt: NOW, name: 'one', updatedAt: NOW },
  { createdAt: NOW, id: 'p2', lastOpenedAt: NOW, name: 'two', updatedAt: NOW },
]

/**
 * Adding a setting is one entry in one data file, which is the point — and it
 * means nothing type-checks the entry against the rest of the screen. These are
 * the checks that would otherwise be a manual pass through every row.
 */

test('every row id is unique', () => {
  const ids = ALL_SETTING_ROWS.map((row) => row.id)

  // Ids key the stored values, so a duplicate means two rows fighting over one
  // slot in aimux.json — and the second one silently winning.
  expect(new Set(ids).size).toBe(ids.length)
})

test('every section has a label, and static ones have rows', () => {
  for (const section of BUILTIN_SETTING_SECTIONS) {
    expect(section.label.length).toBeGreaterThan(0)
    // `section.rows.length` would be a function's arity for the dynamic ones —
    // 1, always, which is how this assertion once passed without looking at a
    // single row.
    const rows = sectionRows(section, STATE.projects)
    expect(Array.isArray(rows), `${section.id} rows`).toBe(true)
    if (Array.isArray(section.rows)) {
      expect(rows.length, `${section.id} has no rows`).toBeGreaterThan(0)
    }
  }
})

test('every row reads a value from a fresh state without throwing', () => {
  const ctx = { state: STATE, values: {} }

  for (const row of ALL_SETTING_ROWS) {
    // No try/catch: a row that throws here throws on the first paint of its
    // section, and the assertion below never runs.
    const value = readRow(row, ctx)
    expect(typeof value, `${row.id} read a ${typeof value}`).not.toBe('undefined')
  }
})

test('a select row defaults to one of its own options', () => {
  for (const row of ALL_SETTING_ROWS) {
    if (row.kind !== 'select' || row.storage !== 'settings') continue
    const values = row.options.map((option) => option.value)

    // A fallback outside the list renders as a raw value and takes two presses
    // to leave, because stepping from "not found" restarts at the first option.
    expect(values, `${row.id} defaults outside its options`).toContain(row.fallback)
  }
})

test('a select row whose value lives elsewhere has exactly two options', () => {
  for (const row of ALL_SETTING_ROWS) {
    if (row.kind !== 'select' || row.storage !== 'app') continue

    // These delegate to the action behind the keybinding, and those actions flip
    // rather than set — flipping is what also reconciles whatever depended on the
    // old value (the git view's selected entry, for one). Flipping and setting
    // agree on two options and part company on three, silently: the row would
    // move to a value nobody asked for. A third option means teaching the action
    // to take a target first.
    expect(row.options.length, `${row.id} delegates to a flip`).toBe(2)
  }
})

test('a number row has a usable range and a default inside it', () => {
  for (const row of ALL_SETTING_ROWS) {
    if (row.kind !== 'number') continue
    expect(row.min, `${row.id} min/max`).toBeLessThan(row.max)
    expect(row.step, `${row.id} step`).toBeGreaterThan(0)
    if (row.storage !== 'settings') continue
    expect(typeof row.fallback).toBe('number')
    expect(row.fallback as number).toBeGreaterThanOrEqual(row.min)
    expect(row.fallback as number).toBeLessThanOrEqual(row.max)
  }
})

test('a toggle defaults to a boolean, not a truthy string', () => {
  for (const row of ALL_SETTING_ROWS) {
    if (row.kind !== 'toggle' || row.storage !== 'settings') continue
    expect(typeof row.fallback, `${row.id} default`).toBe('boolean')
  }
})

/**
 * Every row id, frozen. A row id is also its key in the `settings` block of
 * `aimux.json`, so renaming one orphans whatever the user had set — silently, and
 * with no migration to fall back on. There is deliberately no rename mechanism;
 * this list is the substitute. Changing it is fine, but it has to be on purpose.
 */
const FROZEN_ROW_IDS = [
  'about.configDir',
  'about.configFile',
  'about.fromConfigFile',
  'about.profile',
  'about.version',
  'appearance.mode',
  'appearance.theme',
  'appearance.transparent',
  'autoCommit.enabled',
  'autoCommit.models.claude',
  'autoCommit.models.codex',
  'autoCommit.timeoutMs',
  'autoRename.enabled',
  'autoRename.maxAttempts',
  'autoRename.minPromptWords',
  'autoRename.settleMs',
  'autoRename.timeoutMs',
  'customCommands.antigravity',
  'customCommands.claude',
  'customCommands.codex',
  'customCommands.grok',
  'customCommands.kimi',
  'customCommands.opencode',
  'customCommands.terminal',
  'externalEditor.command',
  'externalEditor.kind',
  'git.diffCount',
  'git.fetchBase',
  'git.fileListMode',
  'git.prefetchRadius',
  'git.treeCompaction',
  'git.worktreeCopyFiles',
  'integrations.claudeHooks',
  'layout.leftBar',
  'layout.leftBarWidth',
  'layout.projectBar',
  'layout.rightBar',
  'layout.rightBarWidth',
  'multiRepo.enabled',
  'multiRepo.maxDepth',
  'notifications.sound',
  'notifications.test',
  'notifications.volume',
  'snippets.manage',
  'snippets.triggerChar',
  'statusBar.aiUsage.pollSeconds',
  'statusBar.hints',
  'statusBar.separator',
  'experimental.spriteFolder',
  'theme.beta.experimentalActivitySprites',
  'theme.beta.experimentalSyntaxHighlight',
  'theme.beta.harmonizeClaudeTheme',
]

test('no row id changes by accident', () => {
  expect(ALL_SETTING_ROWS.map((row) => row.id).sort()).toEqual([...FROZEN_ROW_IDS].sort())
})

test('a section that builds its rows counts them without building them', () => {
  for (const section of BUILTIN_SETTING_SECTIONS) {
    // The reducer clamps the cursor with `rowCount` precisely so it never builds
    // rows — building a Setup row reads a file. A count that disagrees with the
    // list is a cursor that stops one row short of the end, or one past it.
    expect(sectionRowCount(section, PROJECTS), `${section.id} miscounts its rows`).toBe(
      sectionRows(section, PROJECTS).length
    )
    if (!Array.isArray(section.rows)) {
      expect(section.rowCount, `${section.id} builds rows to count them`).toBeDefined()
    }
  }
})

test('a row built from state never claims the settings file owns its value', () => {
  for (const section of BUILTIN_SETTING_SECTIONS) {
    if (Array.isArray(section.rows)) continue
    for (const row of sectionRows(section, PROJECTS)) {
      // Hydration only walks the static rows, so a dynamic `storage: 'settings'`
      // row would never resolve its config-file value nor report that the file
      // owns it — while writes to it persisted quite happily.
      if (row.kind === 'info' || row.kind === 'action') continue
      expect(row.storage, `${row.id} is dynamic and stored`).toBe('app')
    }
  }
})
