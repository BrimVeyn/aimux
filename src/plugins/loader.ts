import type { PluginConfigEntry } from '@brimveyn/aimux-config'
import type { PluginContext, PluginHost } from '@brimveyn/aimux-plugin'

import type { BuiltinPlugin } from './builtin'
import type { PluginRecord, PluginRpcTransport, PluginStatus } from './types'

import { logDebug } from '../debug/input-log'
import { discoverPlugins, type PluginDiscoveryIssue } from './discovery'
import { PluginKernel } from './kernel'
import { appendPluginLog } from './log'
import { watchPlugins } from './watch'

/**
 * The seam between "what is on disk" and "what is running". Both hosts create
 * one of these; everything process-specific — the transport, what to do with
 * a status change — is injected.
 *
 * It is deliberately not a singleton. Tests build one per case, and a future
 * Worker-hosted daemon half would build one inside the worker with a different
 * transport and no other change.
 */
export interface PluginRuntimeOptions {
  host: PluginHost
  transport: PluginRpcTransport
  /** `resolvedConfig.plugins` — the `aimux.config.ts` half of discovery. */
  userPlugins: readonly PluginConfigEntry[]
  /**
   * Plugins shipped inside aimux. Injected rather than imported so a test
   * builds a runtime with none of them, and so the list is visible at the two
   * call sites that matter — `src/ui/plugin-host.tsx` and
   * `src/daemon/plugin-host.ts` — instead of being an implicit global.
   */
  builtins?: readonly BuiltinPlugin[]
  onStatusChange?: (statuses: PluginStatus[]) => void
  /**
   * Discovery problems: a missing directory, a malformed manifest, a config
   * value of the wrong type. Surfaced as toasts in the UI and on stderr in the
   * daemon log — never swallowed, because a plugin that silently does not load
   * is the worst outcome available.
   */
  onIssues?: (issues: PluginDiscoveryIssue[]) => void
  /** Attaches host-specific services to each plugin context. */
  extendContext?: (ctx: PluginContext) => void
}

export class PluginRuntime {
  readonly kernel: PluginKernel

  private records: PluginRecord[] = []
  private currentIssues: PluginDiscoveryIssue[] = []
  private unwatch: (() => void) | null = null
  private started = false

  constructor(private readonly options: PluginRuntimeOptions) {
    this.kernel = new PluginKernel({
      host: options.host,
      transport: options.transport,
      ...(options.onStatusChange === undefined ? {} : { onStatusChange: options.onStatusChange }),
      ...(options.extendContext === undefined ? {} : { extendContext: options.extendContext }),
    })
  }

  private async discover(): Promise<{
    issues: PluginDiscoveryIssue[]
    records: PluginRecord[]
  }> {
    return discoverPlugins(this.options.userPlugins, undefined, this.options.builtins)
  }

  get issues(): readonly PluginDiscoveryIssue[] {
    return this.currentIssues
  }

  statuses(): PluginStatus[] {
    return this.kernel.statuses()
  }

  /** Every discovered plugin, loaded or not — what `aimux plugin list` shows. */
  knownRecords(): readonly PluginRecord[] {
    return this.records
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.refresh()
  }

  /**
   * Re-reads the registry and user config, reconciles the kernel, and restarts
   * the watchers. Called on boot and after anything that changes the plugin
   * set — `plugin link`, `plugin enable`, an edited registry.
   */
  async refresh(): Promise<void> {
    const { issues, records } = await this.discover()
    this.records = records
    this.currentIssues = issues

    for (const issue of issues) {
      logDebug('plugin.issue', { host: this.options.host, ...issue })
      if (issue.id !== undefined) {
        appendPluginLog(issue.id, {
          at: new Date().toISOString(),
          host: this.options.host,
          level: 'warn',
          message: issue.message,
        })
      }
    }
    if (issues.length > 0) this.options.onIssues?.(issues)

    await this.kernel.apply(records)
    this.restartWatchers()
  }

  private restartWatchers(): void {
    this.unwatch?.()
    // Only halves this host actually runs are worth watching: a UI-only plugin
    // changing must not churn the daemon's fibers.
    const watchable = this.records.filter(
      (record) =>
        record.enabled &&
        // A built-in has no directory to watch; it reloads with aimux.
        record.builtin === undefined &&
        record.manifest.entries?.[this.options.host] !== undefined
    )
    this.unwatch = watchPlugins({
      onChange: (ids) => {
        void this.handleWatchEvent(ids)
      },
      records: watchable,
    })
  }

  private async handleWatchEvent(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      // The manifest may itself have changed — a new entry, a new config
      // field — so re-read before reloading rather than reusing a stale one.
      const previous = this.records.find((record) => record.id === id)
      await this.refreshRecord(id)
      const next = this.records.find((record) => record.id === id)
      if (!next) continue
      if (previous && manifestShapeChanged(previous, next)) {
        await this.kernel.apply(this.records)
        continue
      }
      await this.kernel.reload(id)
    }
  }

  private async refreshRecord(id: string): Promise<void> {
    const { issues, records } = await this.discover()
    this.currentIssues = issues
    const updated = records.find((record) => record.id === id)
    if (!updated) return
    this.records = this.records.map((record) => (record.id === id ? updated : record))
  }

  /** Manual reload — `aimux plugin reload [id]`. */
  async reload(id?: string): Promise<void> {
    await this.refresh()
    await this.kernel.reload(id)
  }

  async stop(): Promise<void> {
    this.unwatch?.()
    this.unwatch = null
    this.started = false
    await this.kernel.dispose()
  }
}

/**
 * Whether the change needs a full reconcile rather than a reload: a half
 * appearing or disappearing, or the plugin being enabled or disabled, changes
 * which fibers should exist at all.
 */
function manifestShapeChanged(previous: PluginRecord, next: PluginRecord): boolean {
  if (previous.enabled !== next.enabled) return true
  const before = previous.manifest.entries ?? {}
  const after = next.manifest.entries ?? {}
  return before.ui !== after.ui || before.daemon !== after.daemon
}
