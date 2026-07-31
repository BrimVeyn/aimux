import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getProjectCatalogPath, loadProjectCatalog } from '../../src/state/project-catalog'

const NOW = '2024-01-01T00:00:00.000Z'

let home: string
let originalHome: string | undefined

/**
 * A v1 record, using the pre-rename key names exactly as they were on disk.
 * The paths are real directories: load-time reconciliation prunes aimux-temp
 * worktrees whose directory has vanished, which would otherwise hide whether
 * the migration carried the record across.
 */
function legacyRecord() {
  return {
    activeWorktreeId: 'wt-feature',
    createdAt: NOW,
    id: 'session-abc123',
    lastOpenedAt: NOW,
    name: 'aimux',
    // v1 mirrored the *active worktree's* path here rather than the repo.
    projectPath: featurePath(),
    updatedAt: NOW,
    workspaceSnapshot: {
      activeTabId: 'tab-1',
      lastActiveTabByWorktree: { 'wt-feature': 'tab-1' },
      savedAt: NOW,
      sidebar: { visible: true, width: 30 },
      tabs: [
        {
          assistant: 'claude',
          buffer: '',
          command: 'claude',
          id: 'tab-1',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Claude',
          worktreeId: 'wt-feature',
        },
      ],
      version: 1,
    },
    worktrees: [
      {
        createdAt: NOW,
        createdByAimux: false,
        id: 'wt-main',
        name: 'main',
        path: repoPath(),
        repoRoot: repoPath(),
        source: 'primary',
        updatedAt: NOW,
      },
      {
        createdAt: NOW,
        createdByAimux: true,
        id: 'wt-feature',
        name: 'feature',
        path: featurePath(),
        repoRoot: repoPath(),
        source: 'aimux-temp',
        updatedAt: NOW,
      },
    ],
  }
}

function configDir(): string {
  return join(home, '.config', 'aimux', 'default')
}

function repoPath(): string {
  return join(home, 'repo', 'aimux')
}

function featurePath(): string {
  return join(home, 'wt', 'feature')
}

function writeLegacy(): void {
  mkdirSync(configDir(), { recursive: true })
  mkdirSync(repoPath(), { recursive: true })
  mkdirSync(featurePath(), { recursive: true })
  writeFileSync(
    join(configDir(), 'aimux-sessions.json'),
    JSON.stringify({ sessions: [legacyRecord()], version: 1 }, null, 2)
  )
}

beforeEach(() => {
  originalHome = process.env.HOME
  home = mkdtempSync(join(tmpdir(), 'aimux-migrate-'))
  process.env.HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(home, { force: true, recursive: true })
})

test('migrates a v1 session catalog into v2 projects', () => {
  writeLegacy()

  const projects = loadProjectCatalog()
  expect(projects).toHaveLength(1)
  const project = projects[0]
  if (!project) throw new Error('expected a migrated project')

  // Ids are opaque and may be scripted — they must survive untouched.
  expect(project.id).toBe('session-abc123')
  expect(project.name).toBe('aimux')

  // worktrees -> workspaces, activeWorktreeId -> activeWorkspaceId
  expect(project.workspaces?.map((w) => w.id)).toEqual(['wt-main', 'wt-feature'])
  expect(project.activeWorkspaceId).toBe('wt-feature')
  expect(project.workspaces?.[0]?.source).toBe('primary')

  // projectPath is healed from the active worktree's path to the repo root.
  expect(project.projectPath).toBe(repoPath())

  // workspaceSnapshot -> projectSnapshot, and each tab's worktreeId -> workspaceId
  expect(project.projectSnapshot?.tabs[0]?.workspaceId).toBe('wt-feature')
  expect(project.projectSnapshot?.lastActiveTabByWorkspace).toEqual({ 'wt-feature': 'tab-1' })
  expect(project.projectSnapshot?.activeTabId).toBe('tab-1')
})

test('writes aimux-projects.json v2 and leaves the v1 file in place', () => {
  writeLegacy()
  loadProjectCatalog()

  expect(getProjectCatalogPath()).toBe(join(configDir(), 'aimux-projects.json'))
  const written = JSON.parse(readFileSync(getProjectCatalogPath(), 'utf8')) as {
    version: number
    projects: { id: string }[]
  }
  expect(written.version).toBe(2)
  expect(written.projects[0]?.id).toBe('session-abc123')

  // Rollback safety: the old file is not deleted.
  expect(existsSync(join(configDir(), 'aimux-sessions.json'))).toBe(true)
})

test('an existing v2 catalog wins and the migration does not re-run', () => {
  writeLegacy()
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(
    join(configDir(), 'aimux-projects.json'),
    JSON.stringify(
      {
        projects: [
          {
            createdAt: NOW,
            id: 'project-v2',
            lastOpenedAt: NOW,
            name: 'already migrated',
            updatedAt: NOW,
          },
        ],
        version: 2,
      },
      null,
      2
    )
  )

  const projects = loadProjectCatalog()
  expect(projects.map((p) => p.id)).toEqual(['project-v2'])
})

test('no catalog at all yields no projects', () => {
  expect(loadProjectCatalog()).toEqual([])
})
