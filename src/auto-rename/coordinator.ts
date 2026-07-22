import type { AssistantId } from '../state/types'

import { isSupportedProvider } from '../auto-commit/headless-commands'
import { PromptCapture } from './prompt-capture'
import { generateTabTitle, type TitleSpawnFn } from './title-runner'

export interface AutoRenameConfigSnapshot {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
}

export interface AutoRenameTab {
  id: string
  assistant: AssistantId
  title: string
  autoRenameStatus?: 'eligible' | 'attempted'
}

export interface AutoRenameCoordinatorOptions {
  config: AutoRenameConfigSnapshot
  getTab: (tabId: string) => AutoRenameTab | undefined
  updateTab: (
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' }
  ) => void
  spawn?: TitleSpawnFn
}

export function initialAutoRenameStatus(
  config: AutoRenameConfigSnapshot,
  assistant: AssistantId,
  candidate: boolean
): 'eligible' | undefined {
  return config.enabled && candidate && isSupportedProvider(assistant) ? 'eligible' : undefined
}

export class AutoRenameCoordinator {
  private readonly captures = new Map<string, PromptCapture>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly options: AutoRenameCoordinatorOptions) {}

  register(tab: AutoRenameTab): void {
    if (tab.autoRenameStatus === 'eligible' && !this.captures.has(tab.id)) {
      this.captures.set(tab.id, new PromptCapture())
    }
  }

  unregister(tabId: string): void {
    this.controllers.get(tabId)?.abort()
    this.controllers.delete(tabId)
    this.captures.delete(tabId)
  }

  manualRename(tabId: string): void {
    this.unregister(tabId)
  }

  observeWrite(tabId: string, input: string): void {
    const tab = this.options.getTab(tabId)
    if (!tab || tab.autoRenameStatus !== 'eligible') return
    let capture = this.captures.get(tabId)
    if (!capture) {
      capture = new PromptCapture()
      this.captures.set(tabId, capture)
    }
    const result = capture.feed(input)
    if (result.type === 'pending') return

    this.captures.delete(tabId)
    this.options.updateTab(tabId, { autoRenameStatus: 'attempted' })
    const prompt = result.prompt
    if (prompt === null) return
    const controller = new AbortController()
    this.controllers.set(tabId, controller)
    const originalTitle = tab.title

    void (async () => {
      const title = await generateTabTitle({
        firstPrompt: prompt,
        model: this.options.config.models[tab.assistant],
        provider: tab.assistant,
        signal: controller.signal,
        spawn: this.options.spawn,
        timeoutMs: this.options.config.timeoutMs,
      })
      if (this.controllers.get(tabId) !== controller) return
      this.controllers.delete(tabId)
      if (title == null || title === '') return
      const current = this.options.getTab(tabId)
      if (!current || current.autoRenameStatus !== 'attempted' || current.title !== originalTitle)
        return
      this.options.updateTab(tabId, { autoRenameStatus: 'attempted', title })
    })()
  }
}
