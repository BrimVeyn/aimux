import type { Subprocess } from 'bun'

import { logDebug } from '../debug/input-log'

// Location of the built Tauri shell binary, relative to the repo root. Only the
// release binary is auto-launched: it embeds the frontend and runs standalone.
// A debug build expects the Vite dev server (devUrl), so for development the
// user runs `bun run tauri dev` in `desktop/` instead.
const SHELL_BINARY_CANDIDATES = ['desktop/src-tauri/target/release/aimux-gui']

function repoRoot(): URL {
  // src/gui/launch-shell.ts -> repo root
  return new URL('../../', import.meta.url)
}

async function resolveShellBinary(): Promise<string | null> {
  for (const candidate of SHELL_BINARY_CANDIDATES) {
    const path = new URL(candidate, repoRoot()).pathname
    if (await Bun.file(path).exists()) {
      return path
    }
  }
  return null
}

/**
 * Spawn the prebuilt Tauri shell pointing at the GUI host. Returns the
 * subprocess, or null when no built binary is found (dev workflow: the user
 * runs `bun run tauri dev` in `desktop/` themselves).
 */
export async function launchShell(port: number): Promise<Subprocess | null> {
  const binary = await resolveShellBinary()
  if (binary === null) {
    logDebug('gui.launchShell.noBinary', { candidates: SHELL_BINARY_CANDIDATES })
    return null
  }

  logDebug('gui.launchShell.spawn', { binary, port })
  return Bun.spawn([binary], {
    env: { ...process.env, AIMUX_GUI_PORT: String(port) },
    stderr: 'inherit',
    stdout: 'inherit',
  })
}
