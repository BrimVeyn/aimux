import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'
import { cpus, loadavg } from 'node:os'

import type { Sample } from './sample'

/**
 * Sampling belongs in the daemon, and not for tidiness: the UI process is
 * drawing frames, and a subprocess spawned on its timer is jank the user can
 * see. It also keeps sampling while no UI is attached, so the graph has
 * history to show when one comes back.
 */

const MIN_POLL_MS = 1_000

/**
 * Load average over cores. Not "CPU %" — it counts runnable work rather than
 * busy time, so it can exceed 1 on a loaded machine — but it needs no
 * subprocess and it is the same number on macOS and Linux.
 */
function cpuLoad(): number | null {
  const cores = cpus().length
  if (cores === 0) return null
  const [oneMinute = 0] = loadavg()
  return Math.min(1, oneMinute / cores)
}

/**
 * Whatever the user pointed `gpuCommand` at, reduced to the first number on
 * stdout. A missing tool is not an error worth reporting every three seconds:
 * the sample is simply `null` and the UI draws a gap.
 */
async function gpuLoad(command: string): Promise<number | null> {
  const argv = command.trim().split(/\s+/).filter(Boolean)
  if (argv.length === 0) return null
  try {
    const proc = Bun.spawn(argv, { stderr: 'ignore', stdout: 'pipe' })
    const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exitCode !== 0) return null
    const match = /-?\d+(?:\.\d+)?/.exec(text)
    return match === null ? null : Math.min(1, Math.max(0, Number(match[0]) / 100))
  } catch {
    return null
  }
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const configured = typeof ctx.config.pollSeconds === 'number' ? ctx.config.pollSeconds : 3
    const intervalMs = Math.max(MIN_POLL_MS, configured * 1_000)
    const gpuCommand = typeof ctx.config.gpuCommand === 'string' ? ctx.config.gpuCommand : ''

    ctx.effect(() => {
      let stopped = false

      const tick = async (): Promise<void> => {
        const sample: Sample = {
          at: Date.now(),
          cpu: cpuLoad(),
          gpu: await gpuLoad(gpuCommand),
        }
        if (stopped) return
        // One-way: a sample nobody is listening to should cost nothing, and
        // there is no answer to wait for.
        ctx.rpc.broadcast('sample', sample)
      }

      void tick()
      const timer = setInterval(() => {
        void tick()
      }, intervalMs)

      // The timer is why this is inside `ctx.effect`. A plugin holding an
      // interval it does not give back survives its own unload.
      return () => {
        stopped = true
        clearInterval(timer)
      }
    })

    ctx.log.info('sampling', { gpu: gpuCommand !== '', intervalMs })
  },
})
