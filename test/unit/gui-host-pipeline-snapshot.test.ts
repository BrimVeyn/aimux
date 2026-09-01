// Regression for the C1-class bug documented in GUI_PARITY_AUDIT.md:
// processKeyResult used to dispatch all actions BEFORE building each effect's
// SideEffectContext. KeyResults that pair `close-modal` (action) with an effect
// that needs `state.modal.*` (e.g. save-snippet-editor) would silently no-op
// because the ctx's state snapshot was post-close.
//
// The fix snapshots state once at the top of processKeyResult and feeds it to
// every effect's ctx — mirroring the TUI's React render-closure semantics.

import type { CliRenderer } from '@opentui/core'

import { actions, getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { KeyResult } from '../../src/input/modes/types'
import type { SessionBackend } from '../../src/session-backend/types'

import { createPipeline } from '../../src/gui/host-pipeline'
import { createStubRenderer, createTabTimeouts } from '../../src/gui/host-side-effect-ctx'
import { registerAllModes } from '../../src/input/modes/handlers'
import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

// Isolate config writes (saveSnippetCatalog) under a tmp HOME so the test
// doesn't pollute the user's real ~/.config/aimux.
const originalHome = process.env.HOME
let tmpHome: string

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'aimux-snapshot-test-'))
  process.env.HOME = tmpHome
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  rmSync(tmpHome, { force: true, recursive: true })
})

function bootHost() {
  appStore.setState(createInitialState())

  const backend = {
    write: () => {},
  } as unknown as SessionBackend
  const renderer = createStubRenderer() as CliRenderer
  const timeouts = createTabTimeouts()

  const pipeline = createPipeline({
    backend,
    getThemeId: () => 'aimux',
    renderer,
    setThemeId: () => {},
    timeouts,
  })

  return { pipeline }
}

describe('GUI host pipeline · pre-action state snapshot', () => {
  test('saveSnippetEditor effect sees modal.editBuffer even though close-modal runs first', () => {
    const { pipeline } = bootHost()

    // Open the snippet-editor modal directly (web-native open path) and
    // populate the buffers as if the user had typed name + content.
    appStore.setState({
      ...appStore.getState(),
      focusMode: 'modal',
      modal: {
        activeField: 'name',
        contentBuffer: 'Audit this diff',
        editBuffer: 'Code Review',
        nameBuffer: '',
        projectTargetId: null,
        selectedIndex: 0,
        triggerBuffer: '',
        type: 'snippet-editor',
      },
      snippets: [],
    })

    // saveSnippetEditor is `r([close-modal], [save-snippet-editor], 'navigation')`.
    // Pre-fix: ctx.state.modal.type === null at effect time → no-op.
    // Post-fix: snapshot freezes modal as 'snippet-editor' → snippet persists.
    pipeline.processKeyResult(actions.saveSnippetEditor as KeyResult, 'modal.snippet-editor')

    const after = appStore.getState()
    expect(after.modal.type).toBeNull()
    expect(after.snippets).toHaveLength(1)
    expect(after.snippets[0]?.name).toBe('Code Review')
    expect(after.snippets[0]?.content).toBe('Audit this diff')
  })
})
