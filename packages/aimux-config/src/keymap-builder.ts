import type {
  Action,
  BindingDef,
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

  map(keys: string, action: Action): this {
    this.bindings.push({ group: this.groupName, keys: `${this.prefix}${keys}`, result: action })
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

  map(keys: string, action: Action): this {
    this.bindings.push({ keys, result: action })
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

  mode(id: ModeId, configure: (m: ModeBindingBuilderApi) => ModeBindingBuilderApi): this {
    const builder = new ModeBindingBuilder()
    configure(builder)
    this.modes.set(id, builder._build())
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
