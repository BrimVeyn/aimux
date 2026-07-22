import { expect, test } from 'bun:test'

import {
  AutoRenameCoordinator,
  type AutoRenameTab,
  initialAutoRenameStatus,
} from '../../src/auto-rename/coordinator'

const config = { enabled: true, models: { claude: 'fast' }, timeoutMs: 1_000 }

test('only marks supported candidate tabs as eligible', () => {
  expect(initialAutoRenameStatus(config, 'claude', true)).toBe('eligible')
  expect(initialAutoRenameStatus(config, 'terminal', true)).toBeUndefined()
  expect(initialAutoRenameStatus(config, 'claude', false)).toBeUndefined()
})

test('attempts once and applies the generated title', async () => {
  const tab: AutoRenameTab = {
    assistant: 'claude',
    autoRenameStatus: 'eligible',
    id: 'tab-1',
    title: 'Claude',
  }
  let calls = 0
  const coordinator = new AutoRenameCoordinator({
    config,
    getTab: () => tab,
    spawn: async () => {
      calls++
      return { exitCode: 0, stdout: 'Corriger le cache' }
    },
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'Corrige le cache\r')
  await Promise.resolve()
  await Promise.resolve()
  expect(tab.autoRenameStatus).toBe('attempted')
  expect(tab.title).toBe('Corriger le cache')
  coordinator.observeWrite(tab.id, 'Second prompt\r')
  expect(calls).toBe(1)
})

test('reattaching an eligible tab does not discard a partially typed prompt', async () => {
  const tab: AutoRenameTab = {
    assistant: 'claude',
    autoRenameStatus: 'eligible',
    id: 'tab-1',
    title: 'Claude',
  }
  let generatedPrompt = ''
  const coordinator = new AutoRenameCoordinator({
    config,
    getTab: () => tab,
    spawn: async (invocation) => {
      generatedPrompt = invocation.args.at(-1) ?? ''
      return { exitCode: 0, stdout: 'Complete request' }
    },
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'Complete ')
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'this request\r')
  await Promise.resolve()
  await Promise.resolve()
  expect(generatedPrompt).toContain('Complete this request')
})

test('an uncapturable first submission consumes the only attempt without spawning', () => {
  const tab: AutoRenameTab = {
    assistant: 'claude',
    autoRenameStatus: 'eligible',
    id: 'tab-1',
    title: 'Claude',
  }
  let calls = 0
  const coordinator = new AutoRenameCoordinator({
    config,
    getTab: () => tab,
    spawn: async () => {
      calls++
      return { exitCode: 0, stdout: 'Generated title' }
    },
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'partial\x1b[Ahistory result\r')
  coordinator.observeWrite(tab.id, 'Second prompt\r')

  expect(tab.autoRenameStatus).toBe('attempted')
  expect(calls).toBe(0)
})

test('manual rename wins over an in-flight generation', async () => {
  const tab: AutoRenameTab = {
    assistant: 'claude',
    autoRenameStatus: 'eligible',
    id: 'tab-1',
    title: 'Claude',
  }
  let finish: ((value: { exitCode: number; stdout: string }) => void) | undefined
  const coordinator = new AutoRenameCoordinator({
    config,
    getTab: () => tab,
    spawn: async () =>
      await new Promise((resolve) => {
        finish = resolve
      }),
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'Do the work\r')
  coordinator.manualRename(tab.id)
  tab.title = 'Mon titre'
  finish?.({ exitCode: 0, stdout: 'Generated title' })
  await Promise.resolve()
  await Promise.resolve()
  expect(tab.title).toBe('Mon titre')
})
