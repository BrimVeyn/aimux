import { expect, test } from 'bun:test'

import { type GhAccount, nextGhAccount, parseGhAuthStatus } from '../../src/git/gh-auth'
import { ghErrorMessage } from '../../src/git/pr-status'

// Verbatim `gh auth status` output, three accounts on one host.
const REAL_STATUS = `github.com
  ✓ Logged in to github.com account nbardavid (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account nbardavid-rainpath (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************

  ✓ Logged in to github.com account nicolas-barrere (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
`

test('parseGhAuthStatus attributes each active flag to the account above it', () => {
  const accounts = parseGhAuthStatus(REAL_STATUS)
  expect(accounts.map((a) => a.user)).toEqual([
    'nbardavid',
    'nbardavid-rainpath',
    'nicolas-barrere',
  ])
  expect(accounts.map((a) => a.active)).toEqual([true, false, false])
  expect(accounts[0]?.host).toBe('github.com')
})

test('parseGhAuthStatus returns nothing when no account is logged in', () => {
  expect(parseGhAuthStatus('You are not logged into any GitHub hosts.')).toEqual([])
})

test('nextGhAccount cycles past the active account and wraps', () => {
  const accounts = parseGhAuthStatus(REAL_STATUS)
  expect(nextGhAccount(accounts)?.user).toBe('nbardavid-rainpath')
  const last: GhAccount[] = accounts.map((a, i) => ({ ...a, active: i === 2 }))
  expect(nextGhAccount(last)?.user).toBe('nbardavid')
})

test('nextGhAccount has nowhere to go with a single account', () => {
  expect(nextGhAccount(parseGhAuthStatus(REAL_STATUS).slice(0, 1))).toBeNull()
})

test('ghErrorMessage names the repo behind a GraphQL resolve failure', () => {
  const stderr =
    "GraphQL: Could not resolve to a Repository with the name 'galadrimteam/massilia-voyages'. (repository)"
  expect(ghErrorMessage(stderr)).toBe('No access to galadrimteam/massilia-voyages')
})

test('ghErrorMessage collapses an auth failure to one line', () => {
  expect(ghErrorMessage('error: Bad credentials\nTry `gh auth login`')).toBe(
    'Not logged in to GitHub'
  )
})

test('ghErrorMessage falls back to the first meaningful line', () => {
  expect(ghErrorMessage('\n  error: something exploded\nstack…')).toBe('something exploded')
})
