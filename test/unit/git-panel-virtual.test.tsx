import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act } from 'react'

import type { GitFileEntry, GitPanelState } from '../../src/state/types'

import { appStore } from '../../src/state/app-store'
import { treeGuides } from '../../src/state/git-tree'
import { GitPanel } from '../../src/ui/components/git/git-panel'

const file = (path: string, section: GitFileEntry['section']): GitFileEntry => ({
  added: 1,
  path,
  removed: 1,
  section,
  status: 'M',
})

async function draw(panel: GitPanelState, selected: string): Promise<string[]> {
  const { captureCharFrame, renderOnce } = await testRender(
    <box height={12} flexDirection="column">
      <GitPanel gitPanel={panel} projectPath="/repo" selectedEntryKey={selected} />
    </box>,
    { height: 12, width: 50 }
  )
  for (let i = 0; i < 3; i++) {
    await act(async () => {})
    await renderOnce()
  }
  return captureCharFrame()
    .split('\n')
    .map((line) => line.trimEnd())
}

describe('git mode sidebar', () => {
  test('a tree: guides tie each row to its folder, a glyph says what it is', async () => {
    const panel: GitPanelState = {
      ahead: 0,
      behind: 0,
      branch: 'main',
      error: null,
      files: [
        file('src/ui/b.tsx', 'unstaged'),
        file('src/a.ts', 'unstaged'),
        file('main.tf', 'unstaged'),
      ],
    }
    const lines = await draw(panel, 'unstaged:main.tf')
    expect(lines.slice(1, 6).map((line) => line.replace(/ +[+].*$/, ''))).toEqual([
      '   \u{e5fe} src',
      '   ├ \u{e5fe} ui',
      'M  │ └ \u{e7ba} b.tsx',
      'M  └ \u{e628} a.ts',
      'M  \u{e69a} main.tf',
    ])
  })

  test('with icons off, the folders are arrows and the files their names', async () => {
    appStore.getState().dispatch({ patch: { icons: { enabled: false } }, type: 'set-git-pane' })
    try {
      const panel: GitPanelState = {
        ahead: 0,
        behind: 0,
        branch: 'main',
        error: null,
        files: [file('src/a.ts', 'unstaged')],
      }
      const lines = await draw(panel, 'unstaged:src/a.ts')
      expect(lines.slice(1, 3).map((line) => line.replace(/ +[+].*$/, ''))).toEqual([
        '   ▾ src',
        'M  └ a.ts',
      ])
    } finally {
      appStore.getState().dispatch({ patch: { icons: { enabled: true } }, type: 'set-git-pane' })
    }
  })

  test('sections keep their headings and the blank line between them', async () => {
    const panel: GitPanelState = {
      ahead: 0,
      behind: 0,
      branch: 'main',
      error: null,
      files: [file('a.ts', 'staged'), file('b.ts', 'unstaged')],
    }
    const lines = await draw(panel, 'unstaged:b.ts')
    expect(lines.slice(0, 5).map((line) => line.replaceAll(/\s+/g, ' ').trim())).toEqual([
      'Staged Changes (1)',
      'M \u{e628} a.ts +1 −1',
      '',
      'Changes (1) tree | flat',
      'M \u{e628} b.ts +1 −1',
    ])
  })

  test('thousands of changes: the selected one is drawn, in the middle, and only a screenful', async () => {
    const files = Array.from({ length: 5000 }, (_, i) =>
      file(`f${String(i).padStart(4, '0')}.ts`, 'unstaged')
    )
    const panel: GitPanelState = { ahead: 0, behind: 0, branch: 'main', error: null, files }
    const lines = await draw(panel, 'unstaged:f4000.ts')
    const at = lines.findIndex((line) => line.includes('f4000.ts'))
    expect(at).toBeGreaterThan(3)
    expect(at).toBeLessThan(8)
    expect(lines.filter((line) => line.includes('.ts')).length).toBeLessThanOrEqual(12)
  })
})

describe('treeGuides', () => {
  test('a continuing folder keeps its line down; the last row of one closes it', () => {
    const depths = [0, 1, 2, 2, 1, 0, 1].map((depth) => ({ depth }))
    expect(treeGuides(depths)).toEqual(['', '├ ', '│ ├ ', '│ └ ', '└ ', '', '└ '])
  })
})
