import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { executeSideEffect } from '../../src/app-runtime/side-effects'
import { appReducer, createInitialState } from '../../src/state/store'

const NOW = '2026-07-31T00:00:00.000Z'

/**
 * Point the assistants at a binary every machine has. `startTabSession` marks a
 * tab as errored when its executable is not on PATH, and the injector rightly
 * abandons an errored tab — so without this the test silently passes only where
 * `claude` happens to be installed, and reports "the prompt was never sent" on
 * a machine that simply lacks it.
 *
 * The stand-in has to be *named* `claude`: `assistantAcceptsPromptArg` only
 * hands the prompt to argv when the custom command still runs the vendor's own
 * program, so a bare `/bin/cat` would exercise the paste path instead.
 * `opencode` has no prompt argument either way.
 */
const FAKE_BIN = mkdtempSync(join(tmpdir(), 'aimux-prompt-bin-'))
symlinkSync('/bin/cat', join(FAKE_BIN, 'claude'))
const AVAILABLE_COMMANDS = { claude: join(FAKE_BIN, 'claude'), opencode: '/bin/cat' }

afterAll(() => rmSync(FAKE_BIN, { force: true, recursive: true }))

/** Index of `opencode` in `ASSISTANT_OPTIONS`. */
const OPENCODE_INDEX = 2

function seed(): AppState {
  const base = createInitialState(AVAILABLE_COMMANDS, [
    {
      activeWorkspaceId: 'workspace-new',
      createdAt: NOW,
      id: 'project-1',
      lastOpenedAt: NOW,
      name: 'repo',
      updatedAt: NOW,
      workspaces: [
        {
          branch: 'aimux/placeholder',
          createdAt: NOW,
          createdByAimux: true,
          id: 'workspace-new',
          name: 'Placeholder',
          path: '/tmp/aimux-wt/repo/placeholder',
          repoRoot: '/repo',
          source: 'aimux-temp',
          updatedAt: NOW,
        },
      ],
    },
  ])
  return appReducer(
    { ...base, currentProjectId: 'project-1' },
    {
      pendingWorkspace: {
        projectId: 'project-1',
        prompt: 'fix the scroll drift',
        workspaceId: 'workspace-new',
      },
      type: 'open-new-tab-modal',
    }
  )
}

/** Poll until `done()` holds, so the assertion waits on the app, not the clock. */
async function until(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > deadline) throw new Error('timed out waiting for the prompt to submit')
    await Bun.sleep(20)
  }
}

/** A store that actually applies dispatches, like the real one. */
function harness(initial: AppState) {
  let state = initial
  const writes: { tabId: string; input: string }[] = []
  const started: { command: string; args: string[] }[] = []
  const backend = {
    createSession: (params: { command: string; args: string[] }) => void started.push(params),
    resizeTab: () => {},
    scrollViewportToBottom: () => {},
    write: (tabId: string, input: string) => void writes.push({ input, tabId }),
  }
  const ctx = {
    activeTab: undefined,
    backend: backend as never,
    clearIdleTimer: () => {},
    clearStartupGrace: () => {},
    dispatch: (action: AppAction) => {
      state = appReducer(state, action)
    },
    getCurrentProjectProjectPath: (): string | undefined => undefined,
    getState: () => state,
    renderer: { destroy() {} } as never,
    setThemeId: () => {},
    startStartupGrace: () => {},
    get state() {
      return state
    },
    themeId: 'opencode' as const,
  }
  return { ctx, started, writes }
}

test('the chained launch pins the tab and hands the prompt over at spawn', async () => {
  const { ctx, started, writes } = harness(seed())

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)

  const tab = ctx.getState().tabs[0]
  if (!tab) throw new Error('expected the launch to create a tab')
  expect(tab.workspaceId).toBe('workspace-new')

  // `claude` takes an interactive positional prompt, so it arrives in argv. No
  // readiness poll, no screen probe, no retries — and nothing typed into the pty.
  expect(started).toHaveLength(1)
  expect(started[0]?.args).toEqual(['fix the scroll drift'])

  // The prompt must not leak into `command`: that string is shown in the UI,
  // persisted in the snapshot, and round-tripped by the custom-command editor.
  expect(tab.command).toBe(AVAILABLE_COMMANDS.claude)

  await Bun.sleep(300)
  expect(writes).toEqual([])
})

test('an assistant without a prompt argument still gets the prompt pasted', async () => {
  const { ctx, started, writes } = harness(
    appReducer(seed(), { index: OPENCODE_INDEX, type: 'set-modal-selection-index' })
  )

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)

  const tab = ctx.getState().tabs[0]
  if (!tab) throw new Error('expected the launch to create a tab')
  expect(tab.assistant).toBe('opencode')
  // `opencode`'s positional is a project path, so argv must stay clean.
  expect(started[0]?.args).toEqual([])

  // The assistant enables bracketed paste and echoes what it was handed.
  ctx.dispatch({
    source: 'data',
    tabId: tab.id,
    terminalModes: { ...tab.terminalModes, bracketedPasteMode: true },
    type: 'replace-tab-viewport',
    viewport: {
      baseY: 0,
      cursorVisible: true,
      lines: [{ spans: [{ text: '> fix the scroll drift' }] }],
      viewportY: 0,
    },
  })

  // Wait for the submit, not for a duration: the injector polls at 100ms and
  // waits out an echo window, so any fixed sleep is a bet on how loaded the
  // machine is. This one lost that bet on a CI-class box.
  await until(() => writes.at(-1)?.input === '\r')

  const sent = writes.map((entry) => entry.input).join('')
  expect(sent).toContain('fix the scroll drift')
  expect(writes.every((entry) => entry.tabId === tab.id)).toBe(true)
})

test('a plain new tab sends nothing', async () => {
  const base = createInitialState(AVAILABLE_COMMANDS, [])
  const { ctx, writes } = harness(appReducer(base, { type: 'open-new-tab-modal' }))

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)
  await Bun.sleep(300)

  expect(writes).toEqual([])
})

test('<C-n> opens the picker on the repo checkout too, without asking for a worktree', () => {
  const base = seed()
  const project = base.projects[0]
  if (!project) throw new Error('expected a seeded project')
  const onPrimary: AppState = {
    ...base,
    modal: { cursorPos: 0, editBuffer: null, projectTargetId: null, selectedIndex: 0, type: null },
    projects: [
      {
        ...project,
        activeWorkspaceId: 'workspace-primary',
        workspaces: [
          {
            createdAt: NOW,
            createdByAimux: false,
            id: 'workspace-primary',
            name: 'repo',
            path: '/repo',
            repoRoot: '/repo',
            source: 'primary',
            updatedAt: NOW,
          },
        ],
      },
    ],
  }
  const { ctx } = harness(onPrimary)

  executeSideEffect({ type: 'open-new-tab' }, ctx)

  // The primary is a workspace like any other as far as tabs go: a worktree
  // costs a checkout with no `.env` and no `node_modules`, so plenty of repos
  // never want one. `<C-p>` is the offer, not the toll gate.
  expect(ctx.getState().modal.type).toBe('new-tab')

  executeSideEffect({ type: 'launch-selected-assistant' }, ctx)

  // Pinned to the checkout, not left unbound: an unowned tab surfaces under
  // whichever workspace happens to be primary, which is only right by accident.
  expect(ctx.getState().tabs[0]?.workspaceId).toBe('workspace-primary')
})

test('<C-n> opens the picker once a real workspace is active', () => {
  const { ctx } = harness({
    ...seed(),
    modal: { cursorPos: 0, editBuffer: null, projectTargetId: null, selectedIndex: 0, type: null },
  })

  executeSideEffect({ type: 'open-new-tab' }, ctx)

  expect(ctx.getState().modal.type).toBe('new-tab')
})
