import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'

import { CONFIG_PATH } from '../../src/config'
import { getSessionCatalogPath } from '../../src/state/session-catalog'

describe('session catalog', () => {
  test('stores sessions in a separate ~/.config file', () => {
    expect(getSessionCatalogPath()).toBe(`${dirname(CONFIG_PATH)}/aimux-sessions.json`)
  })
})
