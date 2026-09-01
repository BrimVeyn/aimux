import { existsSync, readFileSync } from 'node:fs'

import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'

export interface ClipboardCandidate {
  argv: string[]
  // powershell's Get-Clipboard emits CRLF line endings and appends a trailing
  // newline of its own; both have to be undone to get the copied text back.
  normalizeWindowsOutput?: boolean
}

export interface ClipboardPlatform {
  env: Record<string, string | undefined>
  isWsl: boolean
  platform: string
}

const POWERSHELL_PASTE: ClipboardCandidate = {
  argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard'],
  normalizeWindowsOutput: true,
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

export function detectClipboardPlatform(): ClipboardPlatform {
  return {
    env: process.env,
    isWsl: detectWsl(),
    platform: process.platform,
  }
}

function detectWsl(): boolean {
  if (process.platform !== 'linux') return false
  if (isSet(process.env.WSL_DISTRO_NAME) || isSet(process.env.WSL_INTEROP)) return true
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}

export function copyCandidates({ env, isWsl, platform }: ClipboardPlatform): ClipboardCandidate[] {
  if (platform === 'darwin') return [{ argv: ['pbcopy'] }]
  if (platform === 'win32') return [{ argv: ['clip'] }]

  const candidates: ClipboardCandidate[] = []
  // On WSL the Windows clipboard is the one the user pastes from, and clip.exe
  // always reaches it. The X/Wayland bridges only exist under WSLg.
  if (isWsl) {
    candidates.push({ argv: ['clip.exe'] }, { argv: ['/mnt/c/Windows/System32/clip.exe'] })
  }
  const wayland: ClipboardCandidate = { argv: ['wl-copy'] }
  const xorg: ClipboardCandidate[] = [
    { argv: ['xclip', '-selection', 'clipboard'] },
    { argv: ['xsel', '--clipboard', '--input'] },
  ]
  candidates.push(...(isSet(env.WAYLAND_DISPLAY) ? [wayland, ...xorg] : [...xorg, wayland]))
  return candidates
}

export function pasteCandidates({ env, isWsl, platform }: ClipboardPlatform): ClipboardCandidate[] {
  if (platform === 'darwin') return [{ argv: ['pbpaste'] }]
  if (platform === 'win32') return [POWERSHELL_PASTE]

  const candidates: ClipboardCandidate[] = []
  if (isWsl) candidates.push(POWERSHELL_PASTE)
  const wayland: ClipboardCandidate = { argv: ['wl-paste', '--no-newline'] }
  const xorg: ClipboardCandidate[] = [
    { argv: ['xclip', '-selection', 'clipboard', '-o'] },
    { argv: ['xsel', '--clipboard', '--output'] },
  ]
  candidates.push(...(isSet(env.WAYLAND_DISPLAY) ? [wayland, ...xorg] : [...xorg, wayland]))
  return candidates
}

function resolveCandidate(candidates: ClipboardCandidate[]): ClipboardCandidate | null {
  for (const candidate of candidates) {
    const [bin, ...args] = candidate.argv
    if (bin === undefined) continue
    let resolved: string | null
    if (bin.includes('/')) {
      resolved = existsSync(bin) ? bin : null
    } else {
      resolved = Bun.which(bin)
    }
    if (resolved !== null) return { ...candidate, argv: [resolved, ...args] }
  }
  return null
}

let cachedCopy: ClipboardCandidate | null | undefined
let cachedPaste: ClipboardCandidate | null | undefined

function copyCommand(): ClipboardCandidate | null {
  cachedCopy ??= resolveCandidate(copyCandidates(detectClipboardPlatform()))
  return cachedCopy
}

function pasteCommand(): ClipboardCandidate | null {
  cachedPaste ??= resolveCandidate(pasteCandidates(detectClipboardPlatform()))
  return cachedPaste
}

const MISSING_TOOL_MESSAGE =
  process.platform === 'darwin'
    ? 'Copy failed: pbcopy not found'
    : 'Copy failed: install xclip, wl-clipboard, or xsel'

export function copyToSystemClipboard(text: string): void {
  const command = copyCommand()
  if (!command) {
    logDebug('platform.clipboard.noCopyCommand', { platform: process.platform })
    toast.error(MISSING_TOOL_MESSAGE)
    return
  }
  try {
    const proc = Bun.spawn(command.argv, { stderr: 'pipe', stdin: 'pipe' })
    void proc.stdin.write(text)
    void proc.stdin.end()
    void (async () => {
      const code = await proc.exited
      if (code === 0) return
      logDebug('platform.clipboard.copyExit', { argv: command.argv, code })
      toast.error('Copy failed')
    })()
  } catch (error) {
    logDebug('platform.clipboard.copyError', {
      argv: command.argv,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error('Copy failed')
  }
}

export async function readFromSystemClipboard(): Promise<string> {
  const command = pasteCommand()
  if (!command) {
    logDebug('platform.clipboard.noPasteCommand', { platform: process.platform })
    return ''
  }
  try {
    const proc = Bun.spawn(command.argv, { stderr: 'pipe', stdout: 'pipe' })
    const text = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) {
      logDebug('platform.clipboard.readExit', { argv: command.argv, code })
      return ''
    }
    return command.normalizeWindowsOutput === true ? normalizeWindowsClipboardText(text) : text
  } catch (error) {
    logDebug('platform.clipboard.readError', {
      argv: command.argv,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

export function normalizeWindowsClipboardText(text: string): string {
  return text.replaceAll('\r\n', '\n').replace(/\n$/, '')
}
