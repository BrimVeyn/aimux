import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'

export function copyToSystemClipboard(text: string): void {
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' })
    void proc.stdin.write(text)
    void proc.stdin.end()
  } catch (error) {
    logDebug('platform.clipboard.copyError', {
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error('Copy failed')
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
