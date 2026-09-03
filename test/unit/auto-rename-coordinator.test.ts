import { expect, test } from 'bun:test'

import {
  type AutoRenameConfigSnapshot,
  AutoRenameCoordinator,
  type AutoRenameTab,
  initialAutoRenameStatus,
} from '../../src/auto-rename/coordinator'
import { PromptObserver } from '../../src/prompts/prompt-observer'

const config: AutoRenameConfigSnapshot = {
  enabled: true,
  maxAttempts: 3,
  minPromptWords: 3,
  models: { claude: 'fast' },
  settleMs: 0,
  timeoutMs: 1_000,
}

/** Let the settle timer fire and the generation promise chain drain. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function makeTab(): AutoRenameTab {
  return { assistant: 'claude', autoRenameStatus: 'eligible', id: 'tab-1', title: 'Claude' }
}

/**
 * The coordinator with the observer in front of it, which is how the daemon
 * wires them: keystrokes and hook payloads reach `PromptObserver`, and what it
 * is confident about reaches auto-rename. The tests below type bytes and expect
 * titles, so they need the pair rather than either half.
 */
function makeCoordinator(
  tab: AutoRenameTab,
  spawn: NonNullable<ConstructorParameters<typeof AutoRenameCoordinator>[0]['spawn']>,
  overrides: Partial<AutoRenameConfigSnapshot> = {}
): AutoRenameCoordinator & { observeWrite: PromptObserver['observeWrite'] } & {
  observePrompt: PromptObserver['observePrompt']
} {
  const coordinator = new AutoRenameCoordinator({
    config: { ...config, ...overrides },
    getTab: () => tab,
    spawn,
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)
  const observer = new PromptObserver({
    onPrompt: (tabId, prompt) => coordinator.onPrompt(tabId, prompt),
  })
  return Object.assign(coordinator, {
    observePrompt: (tabId: string, prompt: string) => observer.observePrompt(tabId, prompt),
    observeWrite: (tabId: string, input: string) => observer.observeWrite(tabId, input),
  })
}

test('only marks supported candidate tabs as eligible', () => {
  expect(initialAutoRenameStatus(config, 'claude', true)).toBe('eligible')
  expect(initialAutoRenameStatus(config, 'terminal', true)).toBeUndefined()
  expect(initialAutoRenameStatus(config, 'claude', false)).toBeUndefined()
})

test('applies the generated title and stops watching the tab', async () => {
  const tab = makeTab()
  let calls = 0
  const coordinator = makeCoordinator(tab, async () => {
    calls++
    return { exitCode: 0, stdout: 'Corriger le cache' }
  })

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()

  expect(tab.title).toBe('Corriger le cache')
  expect(tab.autoRenameStatus).toBe('attempted')

  coordinator.observeWrite(tab.id, 'Un deuxieme prompt different\r')
  await settle()
  expect(calls).toBe(1)
})

test('folds prompts submitted inside the settle window into one title request', async () => {
  const tab = makeTab()
  const prompts: string[] = []
  const coordinator = makeCoordinator(
    tab,
    async (invocation) => {
      prompts.push(invocation.args.at(-1) ?? '')
      return { exitCode: 0, stdout: 'Cache du worker pool' }
    },
    { settleMs: 30 }
  )

  coordinator.observeWrite(tab.id, 'Corrige le cache\r')
  coordinator.observeWrite(tab.id, 'en fait seulement pour le worker pool\r')
  await new Promise((resolve) => setTimeout(resolve, 60))

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Corrige le cache')
  expect(prompts[0]).toContain('worker pool')
})

test('ignores dialog answers, menu picks and slash commands without consuming an attempt', async () => {
  const tab = makeTab()
  let calls = 0
  const coordinator = makeCoordinator(tab, async () => {
    calls++
    return { exitCode: 0, stdout: 'Titre genere' }
  })

  for (const noise of ['\r', '1\r', 'y\r', 'oui\r', '/model\r', '!ls -la\r', 'continue\r']) {
    coordinator.observeWrite(tab.id, noise)
  }
  await settle()
  expect(calls).toBe(0)
  expect(tab.autoRenameStatus).toBe('eligible')
  expect(tab.title).toBe('Claude')

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()
  expect(calls).toBe(1)
  expect(tab.title).toBe('Titre genere')
})

test('an unreadable submission does not burn the tab attempt', async () => {
  const tab = makeTab()
  const prompts: string[] = []
  const coordinator = makeCoordinator(tab, async (invocation) => {
    prompts.push(invocation.args.at(-1) ?? '')
    return { exitCode: 0, stdout: 'Titre genere' }
  })

  coordinator.observeWrite(tab.id, 'partial\x1b[Ahistory result\r')
  await settle()
  expect(prompts).toHaveLength(0)
  expect(tab.autoRenameStatus).toBe('eligible')

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()
  expect(prompts).toHaveLength(1)
  expect(tab.title).toBe('Titre genere')
})

test('a shift+enter newline stays part of the captured prompt', async () => {
  const tab = makeTab()
  const prompts: string[] = []
  const coordinator = makeCoordinator(tab, async (invocation) => {
    prompts.push(invocation.args.at(-1) ?? '')
    return { exitCode: 0, stdout: 'Titre genere' }
  })

  coordinator.observeWrite(tab.id, 'Corrige le cache\x1b\rpour le worker pool\r')
  await settle()

  expect(prompts[0]).toContain('Corrige le cache')
  expect(prompts[0]).toContain('worker pool')
})

test('reattaching an eligible tab does not discard a partially typed prompt', async () => {
  const tab = makeTab()
  let generatedPrompt = ''
  const coordinator = makeCoordinator(tab, async (invocation) => {
    generatedPrompt = invocation.args.at(-1) ?? ''
    return { exitCode: 0, stdout: 'Complete request' }
  })

  coordinator.observeWrite(tab.id, 'Complete ')
  coordinator.register(tab)
  coordinator.observeWrite(tab.id, 'this whole request\r')
  await settle()

  expect(generatedPrompt).toContain('Complete this whole request')
})

test('retries on the next prompt after a failed generation', async () => {
  const tab = makeTab()
  let calls = 0
  const coordinator = makeCoordinator(tab, async () => {
    calls++
    return calls === 1 ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: 'Titre genere' }
  })

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()
  expect(tab.title).toBe('Claude')
  expect(tab.autoRenameStatus).toBe('eligible')

  coordinator.observeWrite(tab.id, 'Ajoute aussi un test de regression\r')
  await settle()
  expect(calls).toBe(2)
  expect(tab.title).toBe('Titre genere')
  expect(tab.autoRenameStatus).toBe('attempted')
})

test('falls back to a locally derived title once the attempt budget is spent', async () => {
  const tab = makeTab()
  let calls = 0
  const coordinator = makeCoordinator(
    tab,
    async () => {
      calls++
      return { exitCode: 1, stdout: '' }
    },
    { maxAttempts: 2 }
  )

  coordinator.observeWrite(tab.id, 'please fix the cache invalidation bug\r')
  await settle()
  expect(tab.title).toBe('Claude')

  coordinator.observeWrite(tab.id, 'and add a regression test for it\r')
  await settle()

  expect(calls).toBe(2)
  expect(tab.autoRenameStatus).toBe('attempted')
  expect(tab.title).toBe('Fix the cache invalidation bug')
})

test('prefers the hook prompt over keystroke reconstruction and never doubles it', async () => {
  const tab = makeTab()
  const prompts: string[] = []
  const coordinator = makeCoordinator(tab, async (invocation) => {
    prompts.push(invocation.args.at(-1) ?? '')
    return { exitCode: 0, stdout: 'Titre genere' }
  })

  // The keystroke path sees the submission first, the hook lands right after.
  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  coordinator.observePrompt(tab.id, 'Corrige le cache utilisateur')
  await settle()

  expect(prompts).toHaveLength(1)
  expect(prompts[0]?.split('Corrige le cache utilisateur')).toHaveLength(2)
})

test('a hook-driven tab ignores keystrokes that never reach a prompt', async () => {
  const tab = makeTab()
  const prompts: string[] = []
  const coordinator = makeCoordinator(
    tab,
    async (invocation) => {
      prompts.push(invocation.args.at(-1) ?? '')
      return { exitCode: 0, stdout: 'Titre genere' }
    },
    { settleMs: 30 }
  )

  coordinator.observePrompt(tab.id, 'Corrige le cache utilisateur')
  // Menu navigation inside the TUI after the prompt was submitted.
  coordinator.observeWrite(tab.id, 'Do you trust this folder\r')
  await new Promise((resolve) => setTimeout(resolve, 60))

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Corrige le cache utilisateur')
  expect(prompts[0]).not.toContain('trust this folder')
})

test('manual rename wins over an in-flight generation', async () => {
  const tab = makeTab()
  let finish: ((value: { exitCode: number; stdout: string }) => void) | undefined
  const coordinator = makeCoordinator(
    tab,
    async () =>
      await new Promise((resolve) => {
        finish = resolve
      })
  )

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()
  coordinator.manualRename(tab.id)
  tab.title = 'Mon titre'
  finish?.({ exitCode: 0, stdout: 'Titre genere' })
  await settle()

  expect(tab.title).toBe('Mon titre')
})

test('a closed tab drops its pending generation', async () => {
  const tab = makeTab()
  let finish: ((value: { exitCode: number; stdout: string }) => void) | undefined
  const coordinator = makeCoordinator(
    tab,
    async () =>
      await new Promise((resolve) => {
        finish = resolve
      })
  )

  coordinator.observeWrite(tab.id, 'Corrige le cache utilisateur\r')
  await settle()
  coordinator.unregister(tab.id)
  finish?.({ exitCode: 0, stdout: 'Titre genere' })
  await settle()

  expect(tab.title).toBe('Claude')
  expect(tab.autoRenameStatus).toBe('eligible')
})
