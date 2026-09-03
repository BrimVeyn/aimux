import { expect, test } from 'bun:test'

import {
  type AutoRenameConfigSnapshot,
  AutoRenameCoordinator,
  type AutoRenameTab,
} from '../../src/auto-rename/coordinator'
import { PromptObserver } from '../../src/prompts/prompt-observer'

/**
 * Prompt observation, now that it is nobody's private business.
 *
 * It used to live inside the auto-rename coordinator, behind that feature's
 * eligibility check: it watched a tab until the tab had a title, then went
 * quiet. Right for auto-rename, and the reason `tab:prompt` could not be
 * emitted from there — the event would have stopped for a tab the moment it got
 * named, with nothing in the payload saying so.
 */

function observed(): { observer: PromptObserver; seen: { prompt: string; source: string }[] } {
  const seen: { prompt: string; source: string }[] = []
  const observer = new PromptObserver({
    onPrompt: (_tabId, prompt, source) => seen.push({ prompt, source }),
  })
  return { observer, seen }
}

test('a submission typed into the PTY is reconstructed', () => {
  const { observer, seen } = observed()
  observer.observeWrite('tab-1', 'Corrige le cache')
  expect(seen).toEqual([])
  observer.observeWrite('tab-1', ' utilisateur\r')
  expect(seen).toEqual([{ prompt: 'Corrige le cache utilisateur', source: 'keystrokes' }])
})

test('a reconstruction it cannot trust is dropped, not guessed at', () => {
  const { observer, seen } = observed()
  // History recall: the cursor-up escape means what lands in the buffer is not
  // what the user typed, and a wrong prompt is worse than a missing one.
  observer.observeWrite('tab-1', 'partial\x1b[Ahistory result\r')
  expect(seen).toEqual([])
})

test('a hook wins, and keeps winning', () => {
  const { observer, seen } = observed()
  observer.observeWrite('tab-1', 'half a prom')
  observer.observePrompt('tab-1', 'the real prompt')
  // The half-built reconstruction belonged to the submission the hook reported.
  observer.observeWrite('tab-1', 'pt\r')

  expect(seen).toEqual([{ prompt: 'the real prompt', source: 'hook' }])
})

test('tabs do not bleed into each other', () => {
  const { observer, seen } = observed()
  observer.observeWrite('tab-1', 'first prompt here')
  observer.observeWrite('tab-2', 'second prompt here\r')
  observer.observeWrite('tab-1', '\r')

  expect(seen).toEqual([
    { prompt: 'second prompt here', source: 'keystrokes' },
    { prompt: 'first prompt here', source: 'keystrokes' },
  ])
})

test('a closed tab keeps nothing', () => {
  const { observer, seen } = observed()
  observer.observeWrite('tab-1', 'half typed')
  observer.forget('tab-1')
  observer.observeWrite('tab-1', ' rest of it\r')

  // The buffer went with the tab, so what comes back is only what was typed
  // after it was re-created.
  expect(seen).toEqual([{ prompt: 'rest of it', source: 'keystrokes' }])
})

/**
 * The regression that made the extraction necessary: auto-rename stops caring
 * about a tab once it has named it, and everyone else must not.
 */
test('it keeps reporting after auto-rename has stopped listening', () => {
  const tab: AutoRenameTab = {
    assistant: 'claude',
    autoRenameStatus: 'eligible',
    id: 'tab-1',
    title: 'Claude',
  }
  const config: AutoRenameConfigSnapshot = {
    enabled: true,
    minPromptWords: 3,
    models: {},
    settleMs: 10_000,
    timeoutMs: 1_000,
  }
  const coordinator = new AutoRenameCoordinator({
    config,
    getTab: () => tab,
    spawn: async () => ({ exitCode: 0, stdout: 'Titre' }),
    updateTab: (_tabId, patch) => Object.assign(tab, patch),
  })
  coordinator.register(tab)

  const seen: string[] = []
  const observer = new PromptObserver({
    onPrompt: (tabId, prompt) => {
      seen.push(prompt)
      coordinator.onPrompt(tabId, prompt)
    },
  })

  observer.observeWrite('tab-1', 'Corrige le cache utilisateur\r')
  // aimux has had its shot at a title; the tab is no longer eligible.
  tab.autoRenameStatus = 'attempted'
  observer.observeWrite('tab-1', 'Et maintenant le worker pool\r')

  expect(seen).toEqual(['Corrige le cache utilisateur', 'Et maintenant le worker pool'])
  coordinator.unregister('tab-1')
})
