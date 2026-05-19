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

export async function readFromSystemClipboard(): Promise<string> {
  try {
    const proc = Bun.spawn(['pbpaste'], { stdout: 'pipe' })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return text
  } catch (error) {
    logDebug('platform.clipboard.readError', {
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}
