import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'

import { getConfigPath } from '../../src/config'
import { getSessionCatalogPath } from '../../src/state/session-catalog'

describe('session catalog', () => {
  test('stores sessions in a separate ~/.config file', () => {
    expect(getSessionCatalogPath()).toBe(`${dirname(getConfigPath())}/aimux-sessions.json`)
  })
})
