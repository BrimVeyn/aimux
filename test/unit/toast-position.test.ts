import { expect, test } from 'bun:test'

import {
  parseToastPosition,
  slideOffsetStyle,
  stackContainerProps,
} from '../../src/ui/components/overlays/toast/toast-position'

test('parseToastPosition splits vertical/horizontal', () => {
  expect(parseToastPosition('top-right')).toEqual({ horizontal: 'right', vertical: 'top' })
  expect(parseToastPosition('bottom-center')).toEqual({ horizontal: 'center', vertical: 'bottom' })
})

test('stackContainerProps anchors left/right corners to their edge', () => {
  expect(stackContainerProps({ horizontal: 'right', vertical: 'top' }, 1)).toMatchObject({
    alignItems: 'flex-end',
    right: 1,
    top: 1,
  })
  expect(stackContainerProps({ horizontal: 'left', vertical: 'bottom' }, 1)).toMatchObject({
    alignItems: 'flex-start',
    bottom: 1,
    left: 1,
  })
})

test('stackContainerProps spans and centers for center anchors', () => {
  expect(stackContainerProps({ horizontal: 'center', vertical: 'bottom' }, 1)).toMatchObject({
    alignItems: 'center',
    bottom: 1,
    left: 1,
    right: 1,
  })
})

test('slideOffsetStyle pushes off the entering edge via negative margin', () => {
  expect(slideOffsetStyle({ horizontal: 'right', vertical: 'top' }, 5)).toEqual({ marginRight: -5 })
  expect(slideOffsetStyle({ horizontal: 'left', vertical: 'bottom' }, 5)).toEqual({
    marginLeft: -5,
  })
  expect(slideOffsetStyle({ horizontal: 'center', vertical: 'top' }, 4)).toEqual({ marginTop: -4 })
  expect(slideOffsetStyle({ horizontal: 'center', vertical: 'bottom' }, 4)).toEqual({
    marginBottom: -4,
  })
})
