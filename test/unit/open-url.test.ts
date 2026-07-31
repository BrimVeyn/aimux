import { describe, expect, test } from 'bun:test'

import { openUrlCommand } from '../../src/platform/open-url'

const URL = 'https://github.com/BrimVeyn/aimux/pull/98'

describe('openUrlCommand', () => {
  test('picks the platform opener', () => {
    expect(openUrlCommand('darwin', false, URL)).toEqual(['open', URL])
    expect(openUrlCommand('linux', false, URL)).toEqual(['xdg-open', URL])
    expect(openUrlCommand('win32', false, URL)).toEqual(['explorer.exe', URL])
  })

  test('routes WSL to the Windows browser', () => {
    expect(openUrlCommand('linux', true, URL)).toEqual(['explorer.exe', URL])
  })

  test('refuses anything that is not plain https', () => {
    for (const bad of [
      'http://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://example.com a b',
      '',
    ]) {
      expect(openUrlCommand('darwin', false, bad)).toBeNull()
    }
  })
})
