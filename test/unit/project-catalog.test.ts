import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'

import { getConfigPath } from '../../src/config'
import { getProjectCatalogPath } from '../../src/state/project-catalog'

describe('project catalog', () => {
  test('stores projects in a separate ~/.config file', () => {
    expect(getProjectCatalogPath()).toBe(`${dirname(getConfigPath())}/aimux-sessions.json`)
  })
})
