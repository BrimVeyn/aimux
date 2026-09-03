import { renderPluginNode } from '@brimveyn/aimux-plugin/testing'
import { expect, test } from 'bun:test'

import { List, Row } from '../../src/ui/plugin-kit'

const NO_ITEMS: readonly never[] = []
const renderNothing = (): null => null

/**
 * The kit's `ReactNode` slots, given nodes.
 *
 * `Row` typed its label and value as `ReactNode` and then wrapped whatever
 * arrived in a `<text>`. A caller who took the type at its word and passed a
 * `<text>` of their own — which is what three of the four example plugins do,
 * because a row's subject is often already coloured — got a `<text>` inside a
 * `<text>`, and opentui throws on that at mount. Not a widget drawn wrong: the
 * whole application failed to start.
 */

test('a Row styles a plain label and leaves a coloured one alone', async () => {
  const rendered = await renderPluginNode(<Row label={<text>⚙ 3</text>} value="third gear" />, {
    cols: 24,
    rows: 3,
  })

  expect(rendered.frame).toContain('⚙ 3')
  expect(rendered.frame).toContain('third gear')
  rendered.dispose()
})

test('a span in a slot is still styled by the row', async () => {
  const rendered = await renderPluginNode(<Row label={<span>spanned</span>} />, {
    cols: 24,
    rows: 3,
  })

  expect(rendered.frame).toContain('spanned')
  rendered.dispose()
})

test('an empty List accepts a node as well as a word', async () => {
  const rendered = await renderPluginNode(
    <List items={NO_ITEMS} empty={<text>nothing yet</text>} renderItem={renderNothing} />,
    { cols: 24, rows: 3 }
  )

  expect(rendered.frame).toContain('nothing yet')
  rendered.dispose()
})
