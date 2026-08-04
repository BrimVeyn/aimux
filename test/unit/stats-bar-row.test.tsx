import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'

import { BarRow } from '../../src/ui/components/stats/shared'

/**
 * The bar's geometry can only be checked by rendering it.
 *
 * `buildTable` and `buildChart` are pure string building precisely so they can
 * be tested; a bar is three flex children, and what went wrong here lived in
 * the layout rather than in the arithmetic. opentui floors a text node at one
 * column, so an *empty* one is a column wide — the row whose bar was full had
 * a zero-length track that still took a cell, pushing its value one column
 * right and off the end of the row.
 */

const WIDTH = 40
const VALUE = '4 175'

async function renderRow(value: number, max: number): Promise<string> {
  const { captureCharFrame, renderOnce } = await testRender(
    <BarRow label="Tue" max={max} value={value} valueText={VALUE} width={WIDTH} />,
    { height: 3, width: WIDTH }
  )
  await renderOnce()
  return captureCharFrame().split('\n')[0] ?? ''
}

describe('BarRow', () => {
  test('the value ends on the last column whatever the bar length', async () => {
    // A full bar, a partial one and an empty one: the two ends are where a
    // missing half turns into an empty text node.
    for (const [name, value] of [
      ['full', 10],
      ['partial', 5],
      ['empty', 0],
    ] as const) {
      const line = await renderRow(value, 10)
      expect(`${name}: ${line.trimEnd()}`).toBe(`${name}: ${line.trimEnd().slice(0, -5)}${VALUE}`)
      expect(`${name}: ${String(line.trimEnd().length)}`).toBe(`${name}: ${String(WIDTH)}`)
    }
  })

  test('a full bar leaves no track behind it', async () => {
    const line = await renderRow(10, 10)
    expect(line).toContain('\u{2584}')
    expect(line).not.toContain('\u{2581}')
  })
})
