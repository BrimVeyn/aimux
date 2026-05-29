import { expect, test } from 'bun:test'

import { loadUserConfig } from '../config/loader'
import { computeGuiHelpEntries } from './gui-help-entries'

test('computeGuiHelpEntries returns serializable entries with keys + descriptions', async () => {
  const config = await loadUserConfig()
  const entries = computeGuiHelpEntries(config.keymaps)
  expect(entries.length).toBeGreaterThan(0)
  for (const entry of entries) {
    expect(typeof entry.keys).toBe('string')
    expect(typeof entry.keysDisplay).toBe('string')
    expect(typeof entry.modeLabel).toBe('string')
  }
  // must be JSON round-trippable (goes over the WS wire)
  expect(JSON.parse(JSON.stringify(entries))).toEqual(entries)
})
