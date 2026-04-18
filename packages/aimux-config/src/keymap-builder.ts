import type {
  Action,
  BindingDef,
  BindingOptions,
  GroupBuilderApi,
  KeymapBuilderApi,
  ModeBindingBuilderApi,
  ModeId,
  ModeKeymapDef,
  ResolvedKeymapConfig,
} from './types'

// ---------------------------------------------------------------------------
// GroupBuilder — sugar for <leader>-prefixed sub-trees
// ---------------------------------------------------------------------------

export class GroupBuilder implements GroupBuilderApi {
  readonly bindings: BindingDef[] = []

  constructor(
    private readonly prefix: string,
    private readonly groupName: string
  ) {}

  map(keys: string, action: Action, description?: string, opts?: BindingOptions): this {
    this.bindings.push({
      description,
      group: this.groupName,
      keys: `${this.prefix}${keys}`,
      repeatable: opts?.repeatable,
      result: action,
    })
    return this
  }

  group(prefix: string, name: string, configure: (g: GroupBuilderApi) => GroupBuilderApi): this {
    const sub = new GroupBuilder(`${this.prefix}${prefix}`, name)
    configure(sub)
    this.bindings.push(...sub.bindings)
    return this
  }
}

// ---------------------------------------------------------------------------
// ModeBindingBuilder
// ---------------------------------------------------------------------------

export class ModeBindingBuilder implements ModeBindingBuilderApi {
  private readonly bindings: BindingDef[] = []
  private readonly removals: string[] = []
  private _passthrough = false

  map(keys: string, action: Action, description?: string, opts?: BindingOptions): this {
    this.bindings.push({ description, keys, repeatable: opts?.repeatable, result: action })
    return this
  }

  unmap(keys: string): this {
    this.removals.push(keys)
    return this
  }

  group(prefix: string, name: string, configure: (g: GroupBuilderApi) => GroupBuilderApi): this {
    const gb = new GroupBuilder(prefix, name)
    configure(gb)
    this.bindings.push(...gb.bindings)
    return this
  }

  passthrough(): this {
    this._passthrough = true
    return this
  }

  /** @internal */
  _build(): ModeKeymapDef {
    return {
      bindings: this.bindings,
      isPassthrough: this._passthrough,
      removals: this.removals,
    }
  }
}

// ---------------------------------------------------------------------------
// KeymapBuilder
// ---------------------------------------------------------------------------

export class KeymapBuilder implements KeymapBuilderApi {
  private _leader = '<Space>'
  private _timeout = 300
  private readonly modes = new Map<ModeId, ModeKeymapDef>()

  leader(key: string): this {
    this._leader = key
    return this
  }

  timeout(ms: number): this {
    this._timeout = ms
    return this
  }

  mode(
    id: ModeId | readonly ModeId[],
    configure: (m: ModeBindingBuilderApi) => ModeBindingBuilderApi
  ): this {
    const builder = new ModeBindingBuilder()
    configure(builder)
    const incoming = builder._build()
    const ids = Array.isArray(id) ? id : [id]
    for (const modeId of ids) {
      const existing = this.modes.get(modeId)
      if (!existing) {
        // Fresh mode: clone so later merges don't mutate a shared array.
        this.modes.set(modeId, {
          bindings: [...incoming.bindings],
          isPassthrough: incoming.isPassthrough,
          removals: [...incoming.removals],
        })
        continue
      }
      // Merge: later bindings win over earlier ones sharing the same keys.
      const incomingKeys = new Set(incoming.bindings.map((b) => b.keys))
      this.modes.set(modeId, {
        bindings: [
          ...existing.bindings.filter((b) => !incomingKeys.has(b.keys)),
          ...incoming.bindings,
        ],
        isPassthrough: existing.isPassthrough || incoming.isPassthrough,
        removals: [...existing.removals, ...incoming.removals],
      })
    }
    return this
  }

  /** @internal — build the resolved config */
  _build(): ResolvedKeymapConfig {
    return {
      leader: this._leader,
      modes: this.modes,
      timeout: this._timeout,
    }
  }
}
