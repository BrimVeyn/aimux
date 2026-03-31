import { logDebug } from '../debug/input-log'

export function copyToSystemClipboard(text: string): void {
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' })
    proc.stdin.write(text)
    proc.stdin.end()
  } catch (error) {
    logDebug('platform.clipboard.copyError', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
