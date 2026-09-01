import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  completionStatus,
  completionTarget,
  detectShell,
  installCompletionScript,
  maybeAutoInstallCompletion,
} from '../../src/cli/completion/install'

const ENV_KEYS = [
  'AIMUX_NO_COMPLETION_INSTALL',
  'FPATH',
  'HOME',
  'SHELL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const

let home = ''
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  home = mkdtempSync(join(tmpdir(), 'aimux-completion-'))
  process.env.HOME = home
  delete process.env.XDG_DATA_HOME
  delete process.env.XDG_CONFIG_HOME
  delete process.env.FPATH
  delete process.env.AIMUX_NO_COMPLETION_INSTALL
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { force: true, recursive: true })
})

describe('shell detection', () => {
  test('reads the basename of $SHELL', () => {
    process.env.SHELL = '/usr/local/bin/fish'
    expect(detectShell()).toBe('fish')
  })

  test('unsupported shells detect as null rather than guessing', () => {
    process.env.SHELL = '/bin/nu'
    expect(detectShell()).toBeNull()
  })
})

describe('install targets', () => {
  test('bash and fish land in their conventional directories', () => {
    expect(completionTarget('bash').path).toBe(
      join(home, '.local/share/bash-completion/completions/aimux')
    )
    expect(completionTarget('fish').path).toBe(join(home, '.config/fish/completions/aimux.fish'))
  })

  test('zsh prefers a writable $fpath entry owned by the user', () => {
    const zfunc = join(home, '.zfunc')
    mkdirSync(zfunc)
    process.env.FPATH = `/usr/share/zsh/functions:${zfunc}`
    expect(completionTarget('zsh')).toEqual({ onFpath: true, path: join(zfunc, '_aimux') })
  })

  test('zsh falls back to site-functions and flags the missing fpath entry', () => {
    expect(completionTarget('zsh')).toEqual({
      onFpath: false,
      path: join(home, '.local/share/zsh/site-functions/_aimux'),
    })
  })

  test('system fpath directories are never written to', () => {
    process.env.FPATH = '/usr/share/zsh/functions'
    expect(completionTarget('zsh').path.startsWith(home)).toBe(true)
  })
})

describe('auto-install', () => {
  test('writes the script and a marker on first launch', () => {
    process.env.SHELL = '/usr/bin/fish'
    const result = maybeAutoInstallCompletion()
    expect(result?.shell).toBe('fish')
    expect(readFileSync(result?.path ?? '', 'utf8')).toContain('__aimux_complete')
    expect(existsSync(join(home, '.config/aimux/completion-install.json'))).toBe(true)
  })

  test('is a no-op on every launch after the first', () => {
    process.env.SHELL = '/usr/bin/fish'
    expect(maybeAutoInstallCompletion()).not.toBeNull()
    expect(maybeAutoInstallCompletion()).toBeNull()
  })

  test('reinstalls when the script has been removed', () => {
    process.env.SHELL = '/usr/bin/fish'
    const first = maybeAutoInstallCompletion()
    rmSync(first?.path ?? '')
    expect(maybeAutoInstallCompletion()).not.toBeNull()
  })

  test('reinstalls when the user switches shells', () => {
    process.env.SHELL = '/usr/bin/fish'
    maybeAutoInstallCompletion()
    process.env.SHELL = '/bin/bash'
    expect(maybeAutoInstallCompletion()?.shell).toBe('bash')
  })

  test('AIMUX_NO_COMPLETION_INSTALL opts out entirely', () => {
    process.env.SHELL = '/usr/bin/fish'
    process.env.AIMUX_NO_COMPLETION_INSTALL = '1'
    expect(maybeAutoInstallCompletion()).toBeNull()
    expect(existsSync(join(home, '.config/fish/completions/aimux.fish'))).toBe(false)
  })

  test('an unsupported shell installs nothing', () => {
    process.env.SHELL = '/bin/nu'
    expect(maybeAutoInstallCompletion()).toBeNull()
  })
})

describe('doctor status', () => {
  test('reports the installed path once the script is in place', () => {
    process.env.SHELL = '/usr/bin/fish'
    installCompletionScript('fish')
    const status = completionStatus()
    expect(status.ok).toBe(true)
    expect(status.detail).toContain('aimux.fish')
  })

  test('flags a missing script as actionable', () => {
    process.env.SHELL = '/bin/bash'
    expect(completionStatus()).toEqual({
      detail: 'bash: not installed — run `aimux completion install`',
      ok: false,
    })
  })

  test('flags a zsh script that fpath will not pick up', () => {
    process.env.SHELL = '/usr/bin/zsh'
    installCompletionScript('zsh')
    const status = completionStatus()
    expect(status.ok).toBe(false)
    expect(status.detail).toContain('fpath=(')
  })

  test('says nothing is expected for an unsupported shell', () => {
    process.env.SHELL = '/bin/nu'
    expect(completionStatus().ok).toBe(true)
  })
})
