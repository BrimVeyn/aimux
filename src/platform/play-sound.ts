// Notification sounds: the shipped three, plus whatever the user drops in
// their profile's `sounds/` directory. Shaped like `open-url.ts` — a pure
// command builder the tests can read, and one impure function that spawns it.
//
// Everything here fails quietly. A missing player or an unreadable file is a
// silent notification, never a toast per event.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'

/** The value `notifications.sound` holds when the user wants silence. */
export const SOUND_OFF = 'off'

/** Shipped sounds, in the order the settings row offers them. */
export const BUILTIN_SOUND_IDS = ['plane', 'bell', 'ding'] as const

/**
 * Extensions offered from the drop-in directory. `afplay` and `ffplay` handle
 * all of them; `paplay`/`aplay` only really handle wav — which is why the
 * shipped three are wav.
 */
const SOUND_EXTENSIONS = new Set(['.wav', '.m4a', '.mp3', '.aiff', '.aif', '.ogg', '.flac'])

/** No more than one sound per window, however many tabs finish at once. */
const THROTTLE_MS = 700

/**
 * Percent of the file's own level. These are notifications for someone sitting
 * in front of the terminal, not an alarm across the room, and the shipped three
 * are loud at their own scale — hence a default well under full.
 */
export const DEFAULT_VOLUME = 35

/** Where a user drops their own sounds. Named in the settings row. */
export function getCustomSoundsDir(): string {
  return join(getProfileConfigDir(), 'sounds')
}

/**
 * Absolute path to a shipped sound. Resolved from this module's URL, the same
 * walk-up `resolveHookScriptPath` does, so it works wherever aimux is installed.
 */
function builtinSoundPath(id: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', 'assets', 'sounds', `${id}.wav`),
    resolve(here, '..', '..', 'assets', 'sounds', `${id}.wav`),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Ids of the files the user has dropped in, without their extension. Deduped:
 * `bell-2.wav` and `bell-2.mp3` are one option, and `resolveSoundPath` picks
 * between them the same way every time.
 */
export function listCustomSoundIds(): string[] {
  try {
    const ids = readdirSync(getCustomSoundsDir())
      .filter((name) => SOUND_EXTENSIONS.has(extname(name).toLowerCase()))
      .map((name) => name.slice(0, -extname(name).length))
      .filter(
        (id) => id !== '' && !BUILTIN_SOUND_IDS.includes(id as (typeof BUILTIN_SOUND_IDS)[number])
      )
    return [...new Set(ids)].sort()
  } catch {
    // No directory is the common case, not an error.
    return []
  }
}

/** The file behind a sound id, shipped or dropped in, or null when there is none. */
export function resolveSoundPath(id: string): string | null {
  if (id === '' || id === SOUND_OFF) return null
  if (BUILTIN_SOUND_IDS.includes(id as (typeof BUILTIN_SOUND_IDS)[number])) {
    return builtinSoundPath(id)
  }
  const dir = getCustomSoundsDir()
  for (const extension of SOUND_EXTENSIONS) {
    const candidate = join(dir, `${id}${extension}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * How to invoke one player on one file, at `volume` percent. `bin` is whichever
 * player was found; the caller does the looking, so this stays pure.
 *
 * Every player spells volume differently, and two of them cannot say it at all
 * — `aplay` and PowerShell's `SoundPlayer` play at the system level whatever we
 * ask, which the setting's description admits rather than pretending otherwise.
 */
export function soundPlayerArgv(
  platform: string,
  bin: string,
  path: string,
  volume: number
): string[] {
  const percent = Math.min(100, Math.max(0, Math.round(volume)))
  if (platform === 'win32') {
    // The path is a filename the user chose. PowerShell escapes a quote inside
    // a single-quoted string by doubling it; without this a name containing one
    // ends the string and the rest of it is executed.
    const quoted = path.replaceAll("'", "''")
    return [
      bin,
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(New-Object Media.SoundPlayer '${quoted}').PlaySync()`,
    ]
  }
  if (bin.endsWith('afplay')) return [bin, '-v', String(percent / 100), path]
  if (bin.endsWith('paplay')) return [bin, `--volume=${Math.round((percent / 100) * 65_536)}`, path]
  if (bin.endsWith('ffplay')) {
    return [bin, '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(percent), path]
  }
  if (bin.endsWith('mpv')) return [bin, '--no-video', '--really-quiet', `--volume=${percent}`, path]
  return [bin, path]
}

/**
 * Players in preference order. macOS ships afplay; on Linux nothing is
 * guaranteed, so we take the first one installed. `Bun.which` is the lookup —
 * spawning a missing binary would throw once per notification.
 */
function findPlayer(platform: string): string | null {
  let candidates = ['paplay', 'aplay', 'ffplay', 'mpv']
  if (platform === 'darwin') candidates = ['afplay']
  if (platform === 'win32') candidates = ['powershell.exe', 'powershell']
  for (const candidate of candidates) {
    const found = Bun.which(candidate)
    if (found != null && found !== '') return found
  }
  return null
}

let lastPlayedAt = 0
let playing: { kill: () => void } | null = null

/**
 * Whether enough time has passed since the last sound. Separate from the play
 * itself so the window is testable without a clock.
 */
export function shouldPlayNow(now: number, previous: number): boolean {
  return now - previous >= THROTTLE_MS
}

/**
 * Play a sound file. Returns false only when nothing could play at all — a
 * missing player or a failed spawn — which is what the settings screen's "Test
 * sound" row reports. A throttled call is not a failure.
 *
 * The throttle covers every caller, the test row included: held down, its key
 * repeats tens of times a second, and one live player per press is enough to
 * take CoreAudio down with it.
 */
export function playSoundFile(path: string, options?: { volume?: number }): boolean {
  const now = Date.now()
  if (!shouldPlayNow(now, lastPlayedAt)) return true
  const platform = process.platform
  const bin = findPlayer(platform)
  if (bin == null) {
    logDebug('platform.playSound.noPlayer', { platform })
    return false
  }
  const argv = soundPlayerArgv(platform, bin, path, options?.volume ?? DEFAULT_VOLUME)
  try {
    // Cut the previous one rather than layer on top of it. Players come and go
    // on their own, so killing an already-exited one has to be harmless.
    playing?.kill()
    playing = Bun.spawn(argv, { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
    lastPlayedAt = now
    return true
  } catch (error) {
    logDebug('platform.playSound.error', {
      argv,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
