import type { ResolvedKeymapConfig } from '@brimveyn/aimux-config'

let activeKeymap: ResolvedKeymapConfig | null = null

export function setActiveKeymap(config: ResolvedKeymapConfig | null): void {
  activeKeymap = config
}

export function getActiveKeymap(): ResolvedKeymapConfig | null {
  return activeKeymap
}
