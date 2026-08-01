import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_SOUND_IDS,
  resolveSoundPath,
  shouldPlayNow,
  SOUND_OFF,
  soundPlayerArgv,
} from '../../src/platform/play-sound'

describe('notification sound', () => {
  test('every shipped sound resolves to a file that exists', async () => {
    for (const id of BUILTIN_SOUND_IDS) {
      const path = resolveSoundPath(id)
      expect(path, `${id} has no shipped file`).not.toBeNull()
      expect(await Bun.file(path as string).exists()).toBe(true)
    }
  })

  test('off and unknown ids resolve to nothing', () => {
    expect(resolveSoundPath(SOUND_OFF)).toBeNull()
    expect(resolveSoundPath('')).toBeNull()
    expect(resolveSoundPath('not-a-sound-anyone-shipped')).toBeNull()
  })

  test('each player gets the arguments it needs', () => {
    expect(soundPlayerArgv('darwin', '/usr/bin/afplay', '/s.wav')).toEqual([
      '/usr/bin/afplay',
      '/s.wav',
    ])
    expect(soundPlayerArgv('linux', '/usr/bin/paplay', '/s.wav')).toEqual([
      '/usr/bin/paplay',
      '/s.wav',
    ])
    // ffplay and mpv open a window and keep running without these.
    expect(soundPlayerArgv('linux', '/usr/bin/ffplay', '/s.wav')).toContain('-autoexit')
    expect(soundPlayerArgv('linux', '/usr/bin/mpv', '/s.wav')).toContain('--no-video')
    expect(soundPlayerArgv('win32', 'powershell.exe', 'C:\\s.wav')).toContain('-NonInteractive')
  })

  test('the throttle collapses a burst into one sound', () => {
    // Six tabs finishing in the same tick must not stack six players.
    expect(shouldPlayNow(1_000, 0)).toBe(true)
    expect(shouldPlayNow(1_010, 1_000)).toBe(false)
    expect(shouldPlayNow(1_700, 1_000)).toBe(true)
  })
})
