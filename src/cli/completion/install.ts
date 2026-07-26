/**
 * Installing the completion script — on demand (`aimux completion install`)
 * and automatically on first TUI launch.
 *
 * Auto-install is best-effort and silent: it drops ONE file in the shell's
 * conventional completions directory and never edits a dotfile. When the
 * chosen directory isn't guaranteed to be picked up (zsh `$fpath`), we report
 * `pendingShellConfig` so the caller can print the one-line fix instead of
 * silently rewriting the user's shell config.
 */

import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { version } from '../../../package.json'
import { logDebug } from '../../debug/input-log'
import { getConfigProfilesRootDir } from '../../profile-paths'
import { isSupportedShell, renderCompletionScript, type SupportedShell } from './scripts'

export interface InstallResult {
  path: string
  /** True when the file is written but the shell won't load it unaided. */
  pendingShellConfig: boolean
  shell: SupportedShell
}

interface InstallMarker {
  installedAt: string
  path: string
  shell: SupportedShell
  version: string
}

function home(): string {
  const fromEnv = process.env.HOME
  return fromEnv != null && fromEnv !== '' ? fromEnv : homedir()
}

function dataHome(): string {
  const xdg = process.env.XDG_DATA_HOME
  return xdg != null && xdg !== '' ? xdg : join(home(), '.local', 'share')
}

function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg != null && xdg !== '' ? xdg : join(home(), '.config')
}

/** Detect the user's shell from `$SHELL`. Returns null for anything exotic. */
export function detectShell(): SupportedShell | null {
  const shellPath = process.env.SHELL
  if (shellPath == null || shellPath === '') return null
  const name = basename(shellPath)
  return isSupportedShell(name) ? name : null
}

function isWritableDir(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function fpathEntries(): string[] {
  const raw = process.env.FPATH ?? process.env.fpath ?? ''
  return raw.split(':').filter((entry) => entry !== '')
}

/**
 * zsh only loads `_aimux` from a directory on `$fpath`. Prefer an existing,
 * writable, user-owned fpath entry; otherwise fall back to the conventional
 * site-functions dir and flag that the user must add it themselves.
 */
function zshTarget(): { onFpath: boolean; path: string } {
  const fallback = join(dataHome(), 'zsh', 'site-functions')
  const entries = fpathEntries()
  const userOwned = entries.filter((entry) => entry.startsWith(home()) && isWritableDir(entry))
  const preferred = userOwned[0]
  if (preferred !== undefined) return { onFpath: true, path: join(preferred, '_aimux') }
  return { onFpath: entries.includes(fallback), path: join(fallback, '_aimux') }
}

export function completionTarget(shell: SupportedShell): { onFpath: boolean; path: string } {
  switch (shell) {
    case 'bash':
      // bash-completion v2 lazy-loads `<name>` from here on first TAB.
      return {
        onFpath: true,
        path: join(dataHome(), 'bash-completion', 'completions', 'aimux'),
      }
    case 'fish':
      return { onFpath: true, path: join(configHome(), 'fish', 'completions', 'aimux.fish') }
    case 'zsh':
      return zshTarget()
  }
}

function markerPath(): string {
  return join(getConfigProfilesRootDir(), 'completion-install.json')
}

function readMarker(): InstallMarker | null {
  try {
    const raw = readFileSync(markerPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const marker = parsed as Partial<InstallMarker>
    if (typeof marker.path !== 'string' || typeof marker.version !== 'string') return null
    if (typeof marker.shell !== 'string' || !isSupportedShell(marker.shell)) return null
    return {
      installedAt: typeof marker.installedAt === 'string' ? marker.installedAt : '',
      path: marker.path,
      shell: marker.shell,
      version: marker.version,
    }
  } catch {
    return null
  }
}

function writeMarker(result: InstallResult): void {
  const marker: InstallMarker = {
    installedAt: new Date().toISOString(),
    path: result.path,
    shell: result.shell,
    version,
  }
  const path = markerPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`)
}

/** Write the completion script for `shell`. Throws if the write fails. */
export function installCompletionScript(shell: SupportedShell, command?: string): InstallResult {
  const target = completionTarget(shell)
  mkdirSync(dirname(target.path), { recursive: true })
  writeFileSync(target.path, renderCompletionScript(shell, command))
  const result: InstallResult = {
    path: target.path,
    pendingShellConfig: !target.onFpath,
    shell,
  }
  writeMarker(result)
  return result
}

/** The one-line fix a user needs when we couldn't guarantee auto-loading. */
export function shellConfigHint(result: InstallResult): string {
  if (!result.pendingShellConfig) return ''
  if (result.shell === 'zsh') {
    return `add to ~/.zshrc (before compinit): fpath=(${dirname(result.path)} $fpath)`
  }
  return `ensure your shell sources ${dirname(result.path)}`
}

export interface CompletionStatus {
  detail: string
  ok: boolean
}

/** What `aimux doctor` reports about shell completion. */
export function completionStatus(): CompletionStatus {
  const shell = detectShell()
  if (shell === null) {
    const name = process.env.SHELL ?? 'unknown'
    return { detail: `no completion script for ${name}`, ok: true }
  }
  const target = completionTarget(shell)
  if (!existsSync(target.path)) {
    return { detail: `${shell}: not installed — run \`aimux completion install\``, ok: false }
  }
  if (!target.onFpath) {
    const hint = shellConfigHint({ path: target.path, pendingShellConfig: true, shell })
    return { detail: `${shell}: ${target.path} (${hint})`, ok: false }
  }
  return { detail: `${shell}: ${target.path}`, ok: true }
}

function autoInstallDisabled(): boolean {
  const raw = process.env.AIMUX_NO_COMPLETION_INSTALL
  return raw != null && raw !== '' && raw !== '0'
}

/**
 * First-launch hook: install completion once per (version, shell), then never
 * touch it again. Re-runs after an upgrade so a script generated from an older
 * registry can't go stale. Best-effort — every failure is swallowed, because a
 * missing completion script must never keep the TUI from starting.
 */
export function maybeAutoInstallCompletion(): InstallResult | null {
  try {
    if (autoInstallDisabled()) return null
    const shell = detectShell()
    if (shell === null) return null

    const marker = readMarker()
    if (
      marker !== null &&
      marker.shell === shell &&
      marker.version === version &&
      existsSync(marker.path)
    ) {
      return null
    }

    const result = installCompletionScript(shell)
    logDebug('completion.autoInstalled', {
      path: result.path,
      pendingShellConfig: result.pendingShellConfig,
      shell: result.shell,
    })
    return result
  } catch (error) {
    logDebug('completion.autoInstallFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
