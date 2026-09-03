/**
 * Services are how a plugin declares what it needs without ordering the load
 * itself. A fiber listing `inject: ['ui', 'tabs']` stays `pending` until both
 * are provided, then applies; if one is withdrawn — its provider unloaded —
 * every dependent unloads too, because the alternative is a live plugin
 * holding a reference to a disposed one.
 */

interface Entry {
  value: unknown
  /** Plugin id, or `undefined` for a service the host itself provides. */
  owner?: string
}

export type ServiceChangeListener = (name: string, present: boolean) => void

export class ServiceRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<ServiceChangeListener>()

  /**
   * Publishes a service. Returns the withdrawal disposer, which the provider's
   * fiber registers so an unload takes the service with it.
   *
   * Re-providing a name that is already taken throws: silently shadowing
   * another plugin's service would make load order decide behaviour.
   */
  provide(name: string, value: unknown, owner?: string): () => void {
    const existing = this.entries.get(name)
    if (existing) {
      throw new Error(
        `service "${name}" is already provided by ${existing.owner ?? 'the host'}; a service name has one owner`
      )
    }
    const entry: Entry = { owner, value }
    this.entries.set(name, entry)
    this.notify(name, true)

    return () => {
      if (this.entries.get(name) !== entry) return
      this.entries.delete(name)
      this.notify(name, false)
    }
  }

  get<T = unknown>(name: string): T | undefined {
    return this.entries.get(name)?.value as T | undefined
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** The subset of `names` that is not currently provided. */
  missing(names: readonly string[]): string[] {
    return names.filter((name) => !this.entries.has(name))
  }

  /** Names owned by a given plugin — used when force-unloading it. */
  ownedBy(owner: string): string[] {
    const owned: string[] = []
    for (const [name, entry] of this.entries) {
      if (entry.owner === owner) owned.push(name)
    }
    return owned
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  onChange(listener: ServiceChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(name: string, present: boolean): void {
    // Snapshot: a listener that unloads a fiber will mutate this set.
    const snapshot = [...this.listeners]
    for (const listener of snapshot) listener(name, present)
  }
}
