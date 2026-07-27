import { expect, test } from 'bun:test'

import { heuristicTitle } from '../../src/auto-rename/heuristic-title'

test('drops leading politeness and starts at the verb', () => {
  expect(heuristicTitle('hey, could you please fix the cache invalidation bug')).toBe(
    'Fix the cache invalidation bug'
  )
  expect(heuristicTitle("peux-tu corriger le cache du worker pool s'il te plait")).toBe(
    'Corriger le cache du worker pool'
  )
})

test('keeps only the opening clause', () => {
  expect(heuristicTitle('fix the cache invalidation and then add a regression test')).toBe(
    'Fix the cache invalidation'
  )
})

test('uses the first meaningful line and strips markup', () => {
  expect(heuristicTitle('```\ncode\n```\n- rewrite the worker pool scheduler\nmore detail')).toBe(
    'Rewrite the worker pool scheduler'
  )
})

test('respects the six word and 48 character budget', () => {
  const title = heuristicTitle(
    'refactor the entire terminal manager rendering pipeline for smaller diffs'
  )
  expect(title?.split(' ').length).toBeLessThanOrEqual(6)
  expect(title?.length).toBeLessThanOrEqual(48)
})

test('returns null when nothing usable is left', () => {
  expect(heuristicTitle('   ')).toBeNull()
  expect(heuristicTitle('please')).toBeNull()
})
