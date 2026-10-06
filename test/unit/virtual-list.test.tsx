import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act, useState } from 'react'

import { followCursor } from '../../src/ui/components/primitives/virtual-rows'
import { VirtualList } from '../../src/ui/plugin-kit'

describe('followCursor', () => {
  test('moves only as far as it takes to keep three rows around the cursor', () => {
    expect(followCursor(0, 5, 10, 100)).toBe(0)
    expect(followCursor(0, 7, 10, 100)).toBe(1)
    expect(followCursor(50, 52, 10, 100)).toBe(49)
    // Never past either end.
    expect(followCursor(0, 99, 10, 100)).toBe(90)
    expect(followCursor(40, 0, 10, 100)).toBe(0)
    // No cursor: the top is only clamped.
    expect(followCursor(500, -1, 10, 100)).toBe(90)
  })
})

const ITEMS = Array.from({ length: 20_000 }, (_, i) => `row ${i}`)

let select: (index: number) => void = () => {}
let rendered = 0

function Host() {
  const [selected, setSelected] = useState(0)
  select = setSelected
  return (
    <box height={10} flexDirection="column">
      <VirtualList
        items={ITEMS}
        selectedIndex={selected}
        renderItem={(item) => {
          rendered++
          return <text>{item as string}</text>
        }}
      />
    </box>
  )
}

async function settle(renderOnce: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {})
    await renderOnce()
  }
}

describe('VirtualList', () => {
  test('draws the rows on screen and no others, following the cursor', async () => {
    const { captureCharFrame, renderOnce } = await testRender(<Host />, { height: 10, width: 30 })
    await settle(renderOnce)
    const lines = (): string[] =>
      captureCharFrame()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    expect(lines()).toEqual(Array.from({ length: 10 }, (_, i) => `row ${i}`))

    rendered = 0
    await act(async () => select(15_000))
    await settle(renderOnce)
    expect(lines()[0]).toBe('row 14994')
    expect(lines()).toContain('row 15000')
    // Twenty thousand items, a screenful drawn.
    expect(rendered).toBeLessThan(60)
  })
})
