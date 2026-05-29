import { describe, expect, test } from 'bun:test'

import { parseClientMessage } from '../../src/gui/protocol'

describe('parseClientMessage setSplitRatio', () => {
  test('accepts a well-formed setSplitRatio with axis', () => {
    const raw = JSON.stringify({
      axis: 'vertical',
      ratio: 0.6,
      t: 'setSplitRatio',
      tabId: 'tab-a',
    })
    expect(parseClientMessage(raw)).toEqual({
      axis: 'vertical',
      ratio: 0.6,
      t: 'setSplitRatio',
      tabId: 'tab-a',
    })
  })

  test('accepts setSplitRatio without axis (optional)', () => {
    const raw = JSON.stringify({ ratio: 0.4, t: 'setSplitRatio', tabId: 'tab-b' })
    expect(parseClientMessage(raw)).toEqual({ ratio: 0.4, t: 'setSplitRatio', tabId: 'tab-b' })
  })

  test('rejects setSplitRatio with non-number ratio', () => {
    const raw = JSON.stringify({ ratio: 'half', t: 'setSplitRatio', tabId: 'tab-c' })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects setSplitRatio with bad axis value', () => {
    const raw = JSON.stringify({ axis: 'diagonal', ratio: 0.5, t: 'setSplitRatio', tabId: 'x' })
    expect(parseClientMessage(raw)).toBeNull()
  })
})
