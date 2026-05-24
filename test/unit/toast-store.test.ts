import { beforeEach, expect, test } from 'bun:test'

import { toast, TOAST_CONFIG, toastStore } from '../../src/state/toast-store'

beforeEach(() => {
  toastStore.getState().clear()
})

test('show adds a toast with defaults and returns its id', () => {
  const id = toast.show({ message: 'hi' })
  const created = toastStore.getState().toasts[0]
  expect(toastStore.getState().toasts).toHaveLength(1)
  expect(created?.id).toBe(id)
  expect(created?.variant).toBe('info')
  expect(created?.position).toBe(TOAST_CONFIG.defaultPosition)
  expect(created?.durationMs).toBe(TOAST_CONFIG.defaultDurationMs)
  expect(created?.message).toBe('hi')
})

test('variant shortcuts set variant + message and accept overrides', () => {
  toast.success('done', { durationMs: 0, position: 'bottom-left' })
  const created = toastStore.getState().toasts[0]
  expect(created?.variant).toBe('success')
  expect(created?.message).toBe('done')
  expect(created?.position).toBe('bottom-left')
  expect(created?.durationMs).toBe(0)
})

test('dismiss removes only the targeted toast', () => {
  const a = toast.info('a')
  const b = toast.info('b')
  toast.dismiss(a)
  expect(toastStore.getState().toasts.map((entry) => entry.id)).toEqual([b])
})

test('clear removes all toasts', () => {
  toast.info('a')
  toast.error('b')
  toastStore.getState().clear()
  expect(toastStore.getState().toasts).toHaveLength(0)
})
