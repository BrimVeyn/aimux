import type { PluginServiceSpec } from '@brimveyn/aimux-plugin'

import type { PluginRecord } from './types'

import { logDebug } from '../debug/input-log'
import { buildExecEnv } from './exec-adapter'
import { appendPluginLog } from './log'

/**
 * Long-running processes a plugin declares in `services[]`, kept alive by the
 * daemon.
 *
 * `commands[]` is a one-shot argv with a timeout; a mobile relay, a file
 * watcher or a telemetry bridge is not a command that finishes. This is the
 * other shape: started when the plugin is known and enabled, stopped when it
 * is not, restarted according to `restart` with a backoff that doubles up to
 * half a minute — a crash loop should cost log lines, never a CPU.
 *
 * Same environment as a command (`AIMUX_SOCKET_PATH`, `AIMUX_BIN_PATH`, the
 * plugin's own directories), so a service in any language talks back through
 * the CLI it already has. Output goes to the plugin's log, line-buffered, so
 * `aimux plugin log` is where a service's stderr ends up.
 */

export type ServiceState = 'running' | 'backoff' | 'stopped' | 'failed'

export interface ServiceStatus {
  pluginId: string
  id: string
  state: ServiceState
  pid: number | null
  restarts: number
  /** Exit code of the last run that ended, or null while the first is alive. */
  lastExitCode: number | null
  command: string[]
}

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** Output kept per line before it is cut; a service that logs a megabyte per line is misusing this. */
const MAX_LINE = 4_000

interface Supervised {
  record: PluginRecord
  spec: PluginServiceSpec
  proc: ReturnType<typeof Bun.spawn> | null
  state: ServiceState
  restarts: number
  lastExitCode: number | null
  backoffMs: number
  timer: ReturnType<typeof setTimeout> | null
  stopping: boolean
}

function key(pluginId: string, id: string): string {
  return `${pluginId}/${id}`
}

function sameSpec(a: PluginServiceSpec, b: PluginServiceSpec): boolean {
  return (
    a.id === b.id &&
    (a.restart ?? 'on-failure') === (b.restart ?? 'on-failure') &&
    a.command.length === b.command.length &&
    a.command.every((part, index) => part === b.command[index])
  )
}

async function pipeToLog(
  stream: ReadableStream<Uint8Array> | null,
  pluginId: string,
  serviceId: string,
  level: 'info' | 'warn'
): Promise<void> {
  if (!stream) return
  const decoder = new TextDecoder()
  let carry = ''
  try {
    for await (const chunk of stream) {
      const parts = (carry + decoder.decode(chunk, { stream: true })).split('\n')
      carry = parts.pop() ?? ''
      for (const line of parts) {
        if (line === '') continue
        appendPluginLog(pluginId, {
          at: new Date().toISOString(),
          data: { service: serviceId },
          host: 'daemon',
          level,
          message: line.slice(0, MAX_LINE),
        })
      }
    }
  } catch {
    /* the process went away under the reader; its exit is logged separately */
  }
}

export class ServiceSupervisor {
  private readonly entries = new Map<string, Supervised>()
  private disposed = false

  /**
   * Makes the running set match the records: every service of an enabled
   * plugin is up, everything else is down, and a service whose argv changed
   * on disk is restarted with the new one.
   */
  reconcile(records: readonly PluginRecord[]): void {
    if (this.disposed) return
    const wanted = new Map<string, { record: PluginRecord; spec: PluginServiceSpec }>()
    for (const record of records) {
      if (!record.enabled) continue
      for (const spec of record.manifest.services ?? []) {
        wanted.set(key(record.id, spec.id), { record, spec })
      }
    }

    for (const [id, entry] of this.entries) {
      const next = wanted.get(id)
      if (next && next.record.root === entry.record.root && sameSpec(next.spec, entry.spec)) {
        entry.record = next.record
        continue
      }
      this.stopEntry(entry)
      this.entries.delete(id)
    }

    for (const [id, { record, spec }] of wanted) {
      if (this.entries.has(id)) continue
      const entry: Supervised = {
        backoffMs: BACKOFF_INITIAL_MS,
        lastExitCode: null,
        proc: null,
        record,
        restarts: 0,
        spec,
        state: 'stopped',
        stopping: false,
        timer: null,
      }
      this.entries.set(id, entry)
      this.launch(entry)
    }
  }

  private launch(entry: Supervised): void {
    if (this.disposed || entry.stopping) return
    const { record, spec } = entry
    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(spec.command, {
        cwd: record.root,
        env: { ...process.env, ...buildExecEnv(record, { service: spec.id }) },
        stderr: 'pipe',
        stdin: 'ignore',
        stdout: 'pipe',
      })
    } catch (error) {
      entry.state = 'failed'
      entry.lastExitCode = null
      appendPluginLog(record.id, {
        at: new Date().toISOString(),
        data: { command: spec.command, error: String(error), service: spec.id },
        host: 'daemon',
        level: 'error',
        message: 'service could not be spawned',
      })
      return
    }
    entry.proc = proc
    entry.state = 'running'
    logDebug('plugin.service.start', { pid: proc.pid, pluginId: record.id, service: spec.id })
    appendPluginLog(record.id, {
      at: new Date().toISOString(),
      data: { pid: proc.pid, service: spec.id },
      host: 'daemon',
      level: 'info',
      message: entry.restarts === 0 ? 'service started' : `service restarted (${entry.restarts})`,
    })
    void pipeToLog(proc.stdout as ReadableStream<Uint8Array> | null, record.id, spec.id, 'info')
    void pipeToLog(proc.stderr as ReadableStream<Uint8Array> | null, record.id, spec.id, 'warn')
    void (async () => {
      const exitCode = await proc.exited
      if (entry.proc !== proc) return
      entry.proc = null
      entry.lastExitCode = exitCode
      this.onExit(entry, exitCode)
    })()
  }

  private onExit(entry: Supervised, exitCode: number): void {
    const { record, spec } = entry
    logDebug('plugin.service.exit', { exitCode, pluginId: record.id, service: spec.id })
    if (entry.stopping || this.disposed) {
      entry.state = 'stopped'
      return
    }
    const policy = spec.restart ?? 'on-failure'
    const again = policy === 'always' || (policy === 'on-failure' && exitCode !== 0)
    appendPluginLog(record.id, {
      at: new Date().toISOString(),
      data: { exitCode, restart: again, service: spec.id },
      host: 'daemon',
      level: exitCode === 0 ? 'info' : 'warn',
      message: `service exited with code ${exitCode}`,
    })
    if (!again) {
      entry.state = exitCode === 0 ? 'stopped' : 'failed'
      return
    }
    entry.state = 'backoff'
    const delay = entry.backoffMs
    entry.backoffMs = Math.min(entry.backoffMs * 2, BACKOFF_MAX_MS)
    entry.timer = setTimeout(() => {
      entry.timer = null
      entry.restarts += 1
      this.launch(entry)
    }, delay)
  }

  private stopEntry(entry: Supervised): void {
    entry.stopping = true
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    const { proc } = entry
    if (proc !== null) {
      logDebug('plugin.service.stop', {
        pid: proc.pid,
        pluginId: entry.record.id,
        service: entry.spec.id,
      })
      proc.kill()
      // Given a moment to go quietly; a service that ignores SIGTERM is not
      // allowed to outlive its plugin.
      setTimeout(() => {
        if (entry.proc === proc) proc.kill('SIGKILL')
      }, 2_000).unref()
    }
    entry.state = 'stopped'
  }

  statuses(): ServiceStatus[] {
    return [...this.entries.values()].map((entry) => ({
      command: entry.spec.command,
      id: entry.spec.id,
      lastExitCode: entry.lastExitCode,
      pid: entry.proc?.pid ?? null,
      pluginId: entry.record.id,
      restarts: entry.restarts,
      state: entry.state,
    }))
  }

  /** Stops one service and starts it again with a fresh backoff. */
  restart(pluginId: string, serviceId: string): boolean {
    const entry = this.entries.get(key(pluginId, serviceId))
    if (!entry) return false
    this.stopEntry(entry)
    entry.stopping = false
    entry.backoffMs = BACKOFF_INITIAL_MS
    entry.restarts += 1
    this.launch(entry)
    return true
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) this.stopEntry(entry)
    this.entries.clear()
  }
}
