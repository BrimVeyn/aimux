import { describe, expect, test } from 'bun:test'

import { getSidebarScrollTarget } from '../../src/ui/components/sidebar-scroll'

describe('getSidebarScrollTarget', () => {
  test('does nothing when there is no active tab', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: -1,
        nextActiveIndex: -1,
        tabCount: 0,
      })
    ).toBe('none')
  })

  test('scrolls active item into view on initial selection', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: -1,
        nextActiveIndex: 2,
        tabCount: 5,
      })
    ).toBe('active-item')
  })

  test('jumps to top when wrapping from last to first', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: 4,
        nextActiveIndex: 0,
        tabCount: 5,
      })
    ).toBe('top')
  })

  test('jumps to bottom when wrapping from first to last', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: 0,
        nextActiveIndex: 4,
        tabCount: 5,
      })
    ).toBe('bottom')
  })

  test('keeps active item visible on ordinary movement', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: 1,
        nextActiveIndex: 2,
        tabCount: 5,
      })
    ).toBe('active-item')
  })

  test('does nothing when active item does not change', () => {
    expect(
      getSidebarScrollTarget({
        previousActiveIndex: 2,
        nextActiveIndex: 2,
        tabCount: 5,
      })
    ).toBe('none')
  })
})
