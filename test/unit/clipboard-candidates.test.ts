import { describe, expect, test } from 'bun:test'

import {
  copyCandidates,
  normalizeWindowsClipboardText,
  pasteCandidates,
} from '../../src/platform/clipboard'

const bins = (candidates: { argv: string[] }[]) => candidates.map((c) => c.argv[0])

describe('clipboard candidates', () => {
  test('macOS uses the pb* pair', () => {
    const platform = { env: {}, isWsl: false, platform: 'darwin' }
    expect(bins(copyCandidates(platform))).toEqual(['pbcopy'])
    expect(bins(pasteCandidates(platform))).toEqual(['pbpaste'])
  })

  test('WSL reaches the Windows clipboard first', () => {
    const platform = {
      env: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' },
      isWsl: true,
      platform: 'linux',
    }
    expect(bins(copyCandidates(platform))[0]).toBe('clip.exe')
    expect(bins(pasteCandidates(platform))[0]).toBe('powershell.exe')
  })

  test('WSL still falls back to the WSLg bridges', () => {
    const platform = { env: {}, isWsl: true, platform: 'linux' }
    expect(bins(copyCandidates(platform))).toContain('xclip')
    expect(bins(copyCandidates(platform))).toContain('wl-copy')
  })

  test('plain Linux prefers wl-copy under Wayland and xclip otherwise', () => {
    expect(
      bins(
        copyCandidates({ env: { WAYLAND_DISPLAY: 'wayland-0' }, isWsl: false, platform: 'linux' })
      )[0]
    ).toBe('wl-copy')
    expect(
      bins(copyCandidates({ env: { DISPLAY: ':0' }, isWsl: false, platform: 'linux' }))[0]
    ).toBe('xclip')
  })

  test('powershell output loses its CRLFs and invented trailing newline', () => {
    expect(normalizeWindowsClipboardText('one\r\ntwo\r\n')).toBe('one\ntwo')
    expect(normalizeWindowsClipboardText('bare')).toBe('bare')
  })
})
