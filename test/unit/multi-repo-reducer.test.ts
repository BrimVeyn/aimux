import { expect, test } from 'bun:test'

import type { DiscoveredRepo } from '../../src/state/types'

import { computeRepoPrefixes } from '../../src/state/reducers/multi-repo-state'
import { appReducer, createInitialState } from '../../src/state/store'

test('set-repos stores repos + computes prefixes', () => {
  const repos: DiscoveredRepo[] = [
    { isRoot: true, name: 'root', path: '/ws' },
    { isRoot: false, name: 'api', path: '/ws/api' },
    { isRoot: false, name: 'web', path: '/ws/web' },
  ]
  const state = createInitialState()
  const next = appReducer(state, { repos, type: 'multi-repo-set-repos' })
  expect(next.multiRepo.repos).toEqual(repos)
  expect(next.multiRepo.prefixes['/ws']).toBe('')
  expect(next.multiRepo.prefixes['/ws/api']).toBe('a')
  expect(next.multiRepo.prefixes['/ws/web']).toBe('w')
})

test('multi-repo-clear resets state', () => {
  const repos: DiscoveredRepo[] = [{ isRoot: false, name: 'a', path: '/ws/a' }]
  let state = createInitialState()
  state = appReducer(state, { repos, type: 'multi-repo-set-repos' })
  state = appReducer(state, { type: 'multi-repo-clear' })
  expect(state.multiRepo.repos).toEqual([])
  expect(state.multiRepo.prefixes).toEqual({})
})

test('prefixes: distinct first letters — length 1', () => {
  const p = computeRepoPrefixes([
    { isRoot: false, name: 'alpha', path: '/a' },
    { isRoot: false, name: 'beta', path: '/b' },
    { isRoot: false, name: 'gamma', path: '/g' },
  ])
  expect(p['/a']).toBe('a')
  expect(p['/b']).toBe('b')
  expect(p['/g']).toBe('g')
})

test('prefixes: collision on first letter — extends to 2', () => {
  const p = computeRepoPrefixes([
    { isRoot: false, name: 'alpha', path: '/a1' },
    { isRoot: false, name: 'apollo', path: '/a2' },
    { isRoot: false, name: 'beta', path: '/b' },
  ])
  expect(p['/a1']).toBe('al')
  expect(p['/a2']).toBe('ap')
  expect(p['/b']).toBe('b')
})

test('prefixes: collision on 2 letters — extends to 3', () => {
  const p = computeRepoPrefixes([
    { isRoot: false, name: 'alpha', path: '/a1' },
    { isRoot: false, name: 'alphb', path: '/a2' },
    { isRoot: false, name: 'alphc', path: '/a3' },
  ])
  expect(p['/a1']).toBe('alpha')
  expect(p['/a2']).toBe('alphb')
  expect(p['/a3']).toBe('alphc')
})

test('prefixes: root repo gets empty string', () => {
  const p = computeRepoPrefixes([
    { isRoot: true, name: 'main', path: '/' },
    { isRoot: false, name: 'sub', path: '/sub' },
  ])
  expect(p['/']).toBe('')
  expect(p['/sub']).toBe('s')
})
