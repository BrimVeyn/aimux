import { renderPluginNode } from '@brimveyn/aimux-plugin/testing'
import { expect, test } from 'bun:test'
import { useEffect, useState } from 'react'

/**
 * `@brimveyn/aimux-plugin/testing`, from the outside.
 *
 * `createTestContext` answers what a plugin *registers*; nothing answered what
 * it draws. A widget whose renderer throws on an empty data set registers
 * exactly as cleanly as one that works, and until now an author outside this
 * repo had no way to catch that — aimux has a test renderer, and they did not.
 */

test('a widget node is drawn, and its text is assertable', async () => {
  const rendered = await renderPluginNode(
    <box>
      <text>CPU 42%</text>
    </box>,
    { cols: 20, rows: 4 }
  )

  expect(rendered.frame).toContain('CPU 42%')
  rendered.dispose()
})

test('a widget that fills in after mount can be waited for', async () => {
  function Late(): React.ReactNode {
    const [value, setValue] = useState<string | null>(null)
    useEffect(() => {
      const timer = setTimeout(() => setValue('loaded'), 20)
      return () => {
        clearTimeout(timer)
      }
    }, [])
    return <text>{value ?? 'loading'}</text>
  }

  const rendered = await renderPluginNode(<Late />, {
    cols: 20,
    rows: 3,
    until: (frame) => frame.includes('loaded'),
  })

  // Without `until` this would have asserted on the first frame, which says
  // `loading` — the exact shape of a flaky test.
  expect(rendered.frame).toContain('loaded')
  rendered.dispose()
})
