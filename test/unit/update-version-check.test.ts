import { afterEach, describe, expect, test } from 'bun:test'

import { fetchLatestNpmVersion, isNewerVersion } from '../../src/update/version-check'

describe('isNewerVersion', () => {
  test('returns true when latest is newer', () => {
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(true)
  })

  test('returns false when versions are equal', () => {
    expect(isNewerVersion('1.3.0', '1.3.0')).toBe(false)
  })

  test('returns false when latest is older', () => {
    expect(isNewerVersion('1.2.0', '1.3.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })

  test('tolerates leading v prefix', () => {
    expect(isNewerVersion('v1.3.1', '1.3.0')).toBe(true)
    expect(isNewerVersion('1.3.0', 'v1.3.0')).toBe(false)
  })

  test('returns false for malformed input', () => {
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '')).toBe(false)
  })

  test('strips pre-release suffix when comparing core numbers', () => {
    expect(isNewerVersion('1.3.0-rc.1', '1.2.9')).toBe(true)
    expect(isNewerVersion('1.3.0', '1.3.0-rc.1')).toBe(false)
  })
})

describe('fetchLatestNpmVersion env override', () => {
  const originalOverride = process.env.AIMUX_DEBUG_UPDATE_LATEST

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.AIMUX_DEBUG_UPDATE_LATEST
    } else {
      process.env.AIMUX_DEBUG_UPDATE_LATEST = originalOverride
    }
  })

  test('returns the env override when set without performing network I/O', async () => {
    process.env.AIMUX_DEBUG_UPDATE_LATEST = '9.9.9'
    const result = await fetchLatestNpmVersion('@brimveyn/aimux')
    expect(result).toBe('9.9.9')
  })
})
