import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'
import { detectClipboardPlatform } from './clipboard'

/**
 * URLs here come from the GitHub API, i.e. outside the process. Handing an
 * arbitrary scheme to the OS opener is a code-execution path (`file://`,
 * `javascript:`, custom app handlers), so only plain https is allowed through.
 */
function isSafeUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/.test(url)
}

export function openUrlCommand(platform: string, isWsl: boolean, url: string): string[] | null {
  if (!isSafeUrl(url)) return null
  if (platform === 'darwin') return ['open', url]
  // Under WSL the browser lives on the Windows side; explorer.exe is the one
  // bridge present on every install (wslview/xdg-open often are not).
  if (platform === 'win32' || isWsl) return ['explorer.exe', url]
  return ['xdg-open', url]
}

export function openUrl(url: string): void {
  const { isWsl, platform } = detectClipboardPlatform()
  const argv = openUrlCommand(platform, isWsl, url)
  if (!argv) {
    logDebug('platform.openUrl.rejected', { url })
    return
  }
  try {
    Bun.spawn(argv, { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  } catch (error) {
    logDebug('platform.openUrl.error', {
      argv,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(`Could not open ${argv[0]}`)
  }
}
