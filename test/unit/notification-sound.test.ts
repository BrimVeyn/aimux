import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_SOUND_IDS,
  playSoundFile,
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
    // ffplay and mpv open a window and keep running without these.
    expect(soundPlayerArgv('linux', '/usr/bin/ffplay', '/s.wav', 50)).toContain('-autoexit')
    expect(soundPlayerArgv('linux', '/usr/bin/mpv', '/s.wav', 50)).toContain('--no-video')
    expect(soundPlayerArgv('win32', 'powershell.exe', 'C:\\s.wav', 50)).toContain('-NonInteractive')
    // No volume flag exists for aplay; it plays, quietly ignoring the setting.
    expect(soundPlayerArgv('linux', '/usr/bin/aplay', '/s.wav', 50)).toEqual([
      '/usr/bin/aplay',
      '/s.wav',
    ])
  })

  test('volume is spelled in each player own units', () => {
    expect(soundPlayerArgv('darwin', '/usr/bin/afplay', '/s.wav', 35)).toEqual([
      '/usr/bin/afplay',
      '-v',
      '0.35',
      '/s.wav',
    ])
    expect(soundPlayerArgv('linux', '/usr/bin/paplay', '/s.wav', 50)).toEqual([
      '/usr/bin/paplay',
      '--volume=32768',
      '/s.wav',
    ])
    expect(soundPlayerArgv('linux', '/usr/bin/ffplay', '/s.wav', 35)).toContain('35')
    expect(soundPlayerArgv('linux', '/usr/bin/mpv', '/s.wav', 35)).toContain('--volume=35')
  })

  test('a volume outside the range is clamped, not passed on', () => {
    // The row cannot produce these, a hand-edited aimux.json can — and
    // `afplay -v 4` is four times as loud as the file, in the ear.
    expect(soundPlayerArgv('darwin', 'afplay', '/s.wav', 400)).toContain('1')
    expect(soundPlayerArgv('darwin', 'afplay', '/s.wav', -10)).toContain('0')
  })

  test('the throttle collapses a burst into one sound', () => {
    // Six tabs finishing in the same tick must not stack six players. Held down,
    // the "Test sound" row repeats far faster than that.
    expect(shouldPlayNow(1_000, 0)).toBe(true)
    expect(shouldPlayNow(1_010, 1_000)).toBe(false)
    expect(shouldPlayNow(1_700, 1_000)).toBe(true)
  })

  test('a throttled press is not reported as a failure', () => {
    // The settings row toasts "no audio player found" on false — a second press
    // inside the window must not claim the machine has no player.
    if (process.platform !== 'darwin') return
    const path = resolveSoundPath(BUILTIN_SOUND_IDS[0]) as string
    expect(playSoundFile(path, { volume: 0 })).toBe(true)
    expect(playSoundFile(path, { volume: 0 })).toBe(true)
  })
})
