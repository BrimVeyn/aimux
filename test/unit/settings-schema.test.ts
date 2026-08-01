import { expect, test } from 'bun:test'

import { ALL_SETTING_ROWS, sectionRows, SETTING_SECTIONS } from '../../src/settings/sections'
import { readRow } from '../../src/settings/settings-store'
import { createInitialState } from '../../src/state/store'

const STATE = createInitialState()

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
  for (const section of SETTING_SECTIONS) {
    expect(section.label.length).toBeGreaterThan(0)
    // `section.rows.length` would be a function's arity for the dynamic ones —
    // 1, always, which is how this assertion once passed without looking at a
    // single row.
    const rows = sectionRows(section, STATE)
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
