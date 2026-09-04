import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'
import { platform } from 'node:os'

/**
 * Delivery. Two doors, both optional, both tried: an ntfy topic over HTTP and
 * the desktop through the OS's own notifier. The answer says which ones took
 * it, so the UI half can fall back to a toast when neither did.
 */

interface Deliver {
  kind: 'waiting-input' | 'turn-complete' | 'custom'
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
}

/** ntfy's priority scale is 1–5; a question is the one that should buzz. */
function priority(input: Deliver): string {
  if (input.kind === 'waiting-input' || input.level === 'error') return 'high'
  if (input.level === 'warning') return 'default'
  return 'low'
}

const TAGS: Record<Deliver['kind'], string> = {
  'custom': 'bell',
  'turn-complete': 'white_check_mark',
  'waiting-input': 'question',
}

async function toNtfy(
  server: string,
  topic: string,
  token: string,
  input: Deliver
): Promise<string | null> {
  const headers: Record<string, string> = {
    Priority: priority(input),
    Tags: TAGS[input.kind],
    Title: input.title,
  }
  if (token !== '') headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`, {
    body: input.message === '' ? input.title : input.message,
    headers,
    method: 'POST',
  })
  return response.ok ? null : `ntfy answered ${response.status}`
}

/** Safe inside an AppleScript string literal. */
function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

async function toDesktop(input: Deliver): Promise<string | null> {
  const argv =
    platform() === 'darwin'
      ? [
          'osascript',
          '-e',
          `display notification ${appleScriptString(input.message)} with title ${appleScriptString(input.title)}`,
        ]
      : ['notify-send', input.title, input.message]
  try {
    const proc = Bun.spawn(argv, { stderr: 'pipe', stdout: 'ignore' })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    return exitCode === 0 ? null : stderr.trim() || `${argv[0]} exited ${exitCode}`
  } catch {
    return `${argv[0]} is not installed`
  }
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const topic = typeof ctx.config.topic === 'string' ? ctx.config.topic.trim() : ''
    const server = typeof ctx.config.server === 'string' ? ctx.config.server : 'https://ntfy.sh'
    const token = typeof ctx.config.token === 'string' ? ctx.config.token : ''
    const desktop = ctx.config.desktop !== false

    ctx.rpc.handle('deliver', async (payload) => {
      const input = payload as Deliver
      const delivered: string[] = []
      const reasons: string[] = []

      if (topic !== '') {
        try {
          const refused = await toNtfy(server, topic, token, input)
          if (refused === null) delivered.push('ntfy')
          else reasons.push(refused)
        } catch (error) {
          reasons.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (desktop) {
        const refused = await toDesktop(input)
        if (refused === null) delivered.push('desktop')
        else reasons.push(refused)
      }
      if (topic === '' && !desktop) reasons.push('nothing configured')

      // The message is not logged: it can be an agent's question, and the log
      // is a file. The kind and the doors are what a person debugging needs.
      ctx.log.info('delivered', { delivered, kind: input.kind, reasons })
      return { delivered, ...(reasons.length === 0 ? {} : { reason: reasons.join('; ') }) }
    })

    ctx.log.info('ntfy ready', { desktop, ntfy: topic !== '', server })
  },
})
