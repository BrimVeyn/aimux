import { getMultiRepoConfig, setMultiRepoConfig } from '@brimveyn/aimux-config'

import type { GitFileListMode } from '../../state/types'
import type { SettingSection, SettingValue } from '../types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'

function isFileListMode(value: SettingValue): value is GitFileListMode {
  return value === 'tree' || value === 'flat'
}

/**
 * The file list and diff preferences already live in `AppState` and have their own
 * persistence, so those rows delegate. The two with no toggle of their own —
 * prefetch radius and the diff counter — are stored here and pushed into
 * `AppState` on change; multi-repo is a module singleton, like auto-commit.
 */
export const GIT_SECTION: SettingSection = {
  id: 'git',
  label: 'Git',
  rows: [
    {
      description: 'Show changed files as a tree, or as one flat list of paths.',
      id: 'git.fileListMode',
      kind: 'select',
      label: 'File list',
      options: [
        { label: 'tree', value: 'tree' },
        { label: 'flat', value: 'flat' },
      ],
      read: (ctx) => ctx.state.gitPane.fileListMode,
      storage: 'app',
      // Flips rather than sets, because flipping is what also reconciles the git
      // view's selected entry with the new shape of the list. Safe because
      // `writeRow` never hands a row the value it already holds — with two
      // options, flipping and setting agree. A third would need the action to
      // take a target first; `settings-schema.test.ts` holds that line.
      write: (value) => {
        if (!isFileListMode(value)) return
        dispatchGlobal({ type: 'git-mode-toggle-file-list-mode' })
        runSideEffectGlobal({ mode: value, type: 'persist-git-file-list-mode' })
      },
    },
    {
      description: 'Collapse folder chains with a single child into one line.',
      id: 'git.treeCompaction',
      kind: 'toggle',
      label: 'Compact the tree',
      read: (ctx) => ctx.state.gitPane.treeCompaction,
      storage: 'app',
      write: (value) => {
        dispatchGlobal({ type: 'git-mode-toggle-tree-compaction' })
        runSideEffectGlobal({ enabled: value === true, type: 'persist-git-tree-compaction' })
      },
    },
    {
      apply: (value) =>
        dispatchGlobal({ patch: { diffCount: { enabled: value === true } }, type: 'set-git-pane' }),
      description: 'Added and removed line counts next to each file.',
      fallback: true,
      fromConfig: (config) => config.gitPane?.diffCount?.enabled,
      id: 'git.diffCount',
      kind: 'toggle',
      label: 'Diff counts',
      storage: 'settings',
    },
    {
      apply: (value) => {
        if (typeof value === 'number') {
          dispatchGlobal({ patch: { prefetchRadius: value }, type: 'set-git-pane' })
        }
      },
      description: 'Load this many diffs either side of the cursor ahead of time. 0 disables it.',
      fallback: 5,
      fromConfig: (config) => config.gitPane?.prefetchRadius,
      id: 'git.prefetchRadius',
      kind: 'number',
      label: 'Diff prefetch',
      max: 50,
      min: 0,
      step: 1,
      storage: 'settings',
    },
    {
      // No `apply`: the reader is `resolveWorktreeBaseRef`, which reads the
      // config file itself so the CLI's `workspace create` — where this screen
      // never hydrates — agrees with the TUI instead of always fetching.
      description: 'Fetch the base branch before forking from it. Off forks from your local copy.',
      fallback: true,
      id: 'git.fetchBase',
      kind: 'toggle',
      label: 'Refresh the base branch',
      storage: 'settings',
    },
    {
      apply: (value) => setMultiRepoConfig({ ...getMultiRepoConfig(), enabled: value === true }),
      description: 'Aggregate the status of git repos nested under the project.',
      fallback: true,
      fromConfig: (config) => config.multiRepo?.enabled,
      id: 'multiRepo.enabled',
      kind: 'toggle',
      label: 'Multi-repo',
      storage: 'settings',
    },
    {
      apply: (value) => {
        if (typeof value === 'number') {
          setMultiRepoConfig({ ...getMultiRepoConfig(), maxDepth: value })
        }
      },
      description: 'How far below the project to look for them. 1 = its direct children.',
      fallback: 1,
      fromConfig: (config) => config.multiRepo?.maxDepth,
      id: 'multiRepo.maxDepth',
      kind: 'number',
      label: 'Multi-repo depth',
      max: 5,
      min: 1,
      step: 1,
      storage: 'settings',
    },
  ],
}
