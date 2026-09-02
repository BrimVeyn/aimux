import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderPluginApiDoc } from '../../scripts/gen-plugin-api-doc'

/**
 * The reference is generated, and this is what makes that worth anything.
 *
 * Its audience is as often an agent as a human, and an agent that reads a
 * stale API invents one — so a page that has drifted from the sources is a
 * failing test, not a documentation chore someone will get to.
 */

const ROOT = join(new URL('../..', import.meta.url).pathname)

describe('the generated plugin API reference', () => {
  test('the committed page matches the sources', () => {
    const expected = renderPluginApiDoc()
    const committed = readFileSync(join(ROOT, 'docs/reference/plugin-api.md'), 'utf8')

    expect(committed).toBe(expected)
  })

  test('the copy the author skill ships is the same page', () => {
    const reference = readFileSync(join(ROOT, 'docs/reference/plugin-api.md'), 'utf8')
    const shipped = readFileSync(join(ROOT, 'skills/aimux-plugin-author/references/api.md'), 'utf8')

    expect(shipped).toBe(reference)
  })
})
