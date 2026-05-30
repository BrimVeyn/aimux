import type { Subprocess } from 'bun'

import { logDebug } from '../debug/input-log'
import { getProfileName } from '../profile-paths'

function desktopDir(): string {
  // src/gui/launch-vite-dev.ts -> desktop/
  return new URL('../../desktop/', import.meta.url).pathname
}

/**
 * Spawn Vite's dev server inside `desktop/` so a single command boots both the
 * host (WS on 7878) and the frontend (HMR on 1420). No-op outside the dev
 * profile so production users running `aimux --gui` never end up with a stray
 * vite process. Returns null when not spawned.
 */
export function launchViteDev(): Subprocess | null {
  if (getProfileName() !== 'dev') {
    logDebug('gui.launchViteDev.skipped', { reason: 'not-dev-profile' })
    return null
  }
  if (process.env.AIMUX_GUI_SKIP_VITE === '1') {
    logDebug('gui.launchViteDev.skipped', { reason: 'AIMUX_GUI_SKIP_VITE' })
    return null
  }

  const cwd = desktopDir()
  logDebug('gui.launchViteDev.spawn', { cwd })
  // Inherit stdio: Vite's own colored output is more useful than a re-prefixed
  // copy, and the banner we print below makes the two stream sources obvious.
  return Bun.spawn(['bun', 'run', 'dev'], {
    cwd,
    env: process.env,
    stderr: 'inherit',
    stdout: 'inherit',
  })
}
