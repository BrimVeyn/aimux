import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ASSISTANT_OPTIONS,
  assistantAcceptsPromptArg,
  buildAssistantModelArgs,
  buildAssistantSessionArgs,
  getAssistantOption,
  parseCommand,
  shellQuote,
} from '../../src/pty/command-registry'

function option(id: string) {
  const found = ASSISTANT_OPTIONS.find((o) => o.id === id)
  if (!found) throw new Error(`no assistant ${id}`)
  return found
}

describe('command registry', () => {
  test('exposes the expected assistants', () => {
    expect(ASSISTANT_OPTIONS.map((o) => o.id)).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'kimi',
      'antigravity',
      'terminal',
    ])
  })

  test('falls back to the first assistant for out-of-range indexes', () => {
    expect(getAssistantOption(99).id).toBe('claude')
  })
})

describe('parseCommand', () => {
  test('splits plain commands on whitespace', () => {
    expect(parseCommand('claude')).toEqual({ args: [], executable: 'claude' })
    expect(parseCommand('  codex   --model  gpt-5  ')).toEqual({
      args: ['--model', 'gpt-5'],
      executable: 'codex',
    })
    expect(parseCommand('')).toEqual({ args: [], executable: '' })
  })

  test('keeps double-quoted segments whole', () => {
    expect(parseCommand('code --user-data-dir "/tmp/foo bar"')).toEqual({
      args: ['--user-data-dir', '/tmp/foo bar'],
      executable: 'code',
    })
  })

  test('keeps single-quoted segments whole, including the executable', () => {
    expect(parseCommand("'/Applications/My Editor/bin/code' --wait")).toEqual({
      args: ['--wait'],
      executable: '/Applications/My Editor/bin/code',
    })
  })

  test('honours backslash-escaped spaces', () => {
    expect(parseCommand('bash /Users/a\\ b/setup.sh')).toEqual({
      args: ['/Users/a b/setup.sh'],
      executable: 'bash',
    })
  })

  test('round-trips a shellQuote-d path back to one argument', () => {
    // The setup runner builds `bash <quoted script path>`; $HOME can hold both a
    // space and an apostrophe.
    for (const path of ['/Users/a b/setup.sh', "/Users/O'Brien/My Stuff/setup.sh"]) {
      expect(parseCommand(`bash ${shellQuote(path)}`)).toEqual({
        args: [path],
        executable: 'bash',
      })
    }
  })

  test('treats a quote inside the other quote style as a literal', () => {
    expect(parseCommand(`echo "it's fine"`)).toEqual({
      args: ["it's fine"],
      executable: 'echo',
    })
  })
})

describe('assistantAcceptsPromptArg', () => {
  test('true for the CLIs that take an interactive positional prompt', () => {
    expect(assistantAcceptsPromptArg('claude', {})).toBe(true)
    expect(assistantAcceptsPromptArg('codex', {})).toBe(true)
  })

  test('false where the positional means something else, or is unknown', () => {
    // `opencode [project]` is a path, and its `run` subcommand is not
    // interactive — so it stays on the paste fallback.
    expect(assistantAcceptsPromptArg('opencode', {})).toBe(false)
    expect(assistantAcceptsPromptArg('terminal', {})).toBe(false)
  })

  test('a custom command keeps the vendor capability', () => {
    // Still the same CLI, just with the user's own flags — or an absolute path
    // to it.
    expect(assistantAcceptsPromptArg('claude', { claude: 'claude --model opus' })).toBe(true)
    expect(assistantAcceptsPromptArg('claude', { claude: '/usr/local/bin/claude' })).toBe(true)
  })

  test('a wrapper falls back to pasting', () => {
    // A wrapper that forgets `"$@"` would swallow the prompt with no error
    // anywhere, and pasting works for any command.
    expect(assistantAcceptsPromptArg('claude', { claude: 'my-wrapper.sh' })).toBe(false)
    expect(assistantAcceptsPromptArg('claude', { claude: 'npx claude' })).toBe(false)
  })

  test('false for an unknown assistant id', () => {
    expect(assistantAcceptsPromptArg('nope', { nope: 'nope' })).toBe(false)
  })
})

describe('buildAssistantModelArgs', () => {
  test('claude maps model + effort to native flags', () => {
    expect(buildAssistantModelArgs(option('claude'), { effort: 'high', model: 'opus' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ])
  })

  test('codex maps effort to a config override', () => {
    expect(
      buildAssistantModelArgs(option('codex'), { effort: 'high', model: 'gpt-5-codex' })
    ).toEqual(['--model', 'gpt-5-codex', '-c', 'model_reasoning_effort=high'])
  })

  test('empty selection yields no args', () => {
    expect(buildAssistantModelArgs(option('claude'), {})).toEqual([])
    expect(buildAssistantModelArgs(option('claude'), { effort: '', model: '' })).toEqual([])
  })

  test('opencode supports --model but rejects --effort', () => {
    expect(buildAssistantModelArgs(option('opencode'), { model: 'anthropic/claude-opus' })).toEqual(
      ['--model', 'anthropic/claude-opus']
    )
    expect(() => buildAssistantModelArgs(option('opencode'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })

  test('grok maps model to -m and effort to --effort', () => {
    expect(buildAssistantModelArgs(option('grok'), { effort: 'high', model: 'grok-4.5' })).toEqual([
      '-m',
      'grok-4.5',
      '--effort',
      'high',
    ])
    expect(buildAssistantModelArgs(option('grok'), { model: 'custom' })).toEqual(['-m', 'custom'])
  })

  test('kimi supports --model but rejects --effort', () => {
    expect(buildAssistantModelArgs(option('kimi'), { model: 'kimi-code/kimi-for-coding' })).toEqual(
      ['--model', 'kimi-code/kimi-for-coding']
    )
    expect(() => buildAssistantModelArgs(option('kimi'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })

  test('terminal rejects both model and effort', () => {
    expect(() => buildAssistantModelArgs(option('terminal'), { model: 'x' })).toThrow(
      'does not support --model'
    )
    expect(() => buildAssistantModelArgs(option('terminal'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })
})

describe('assistant session args', () => {
  const NO_CUSTOM: Record<string, string> = {}

  test('claims a fresh id when the vendor has no conversation for it', () => {
    const id = crypto.randomUUID()
    expect(buildAssistantSessionArgs('claude', NO_CUSTOM, id)).toEqual(['--session-id', id])
  })

  test('resumes once a transcript exists under that id', () => {
    // The real lookup, against the real directory layout — the whole point of
    // the flag flip is that the filesystem decides it, so stubbing it would
    // test nothing. Scoped to a uuid-named file in a directory of our own.
    const id = crypto.randomUUID()
    const dir = join(homedir(), '.claude', 'projects', 'aimux-session-args-test')
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${id}.jsonl`), '{}\n')
      expect(buildAssistantSessionArgs('claude', NO_CUSTOM, id)).toEqual(['--resume', id])
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('treats a machine that has never run the vendor CLI as having no conversation', () => {
    // The regression CI caught and a dev box cannot: `~/.claude/projects` is
    // missing on a fresh install, and the glob reports that by throwing rather
    // than yielding nothing.
    //
    // In a subprocess because Bun resolves `os.homedir()` once at startup — a
    // HOME reassigned mid-test is silently ignored, which is exactly how the
    // first version of this test passed against the unfixed code. The
    // alternative was reading the env directly in production purely to be
    // testable; a spawn is cheaper than a seam.
    const probe = `
      import { buildAssistantSessionArgs } from '${join(import.meta.dir, '../../src/pty/command-registry.ts')}'
      process.stdout.write(JSON.stringify(buildAssistantSessionArgs('claude', {}, 'probe-id')))
    `
    const run = Bun.spawnSync(['bun', '-e', probe], {
      env: { ...process.env, HOME: join(tmpdir(), `aimux-no-claude-${crypto.randomUUID()}`) },
    })
    expect(run.stderr.toString()).toBe('')
    expect(JSON.parse(run.stdout.toString())).toEqual(['--session-id', 'probe-id'])
  })

  test('stays out of the way when the assistant has no session support', () => {
    expect(buildAssistantSessionArgs('codex', NO_CUSTOM, crypto.randomUUID())).toEqual([])
    expect(buildAssistantSessionArgs('terminal', NO_CUSTOM, crypto.randomUUID())).toEqual([])
  })

  test('declines a wrapper command, whose flags are not the vendor CLI’s', () => {
    expect(
      buildAssistantSessionArgs('claude', { claude: 'my-wrapper.sh' }, crypto.randomUUID())
    ).toEqual([])
  })

  test('extra flags are fine as long as the program is still claude', () => {
    const id = crypto.randomUUID()
    expect(
      buildAssistantSessionArgs('claude', { claude: 'claude --dangerously-skip-permissions' }, id)
    ).toEqual(['--session-id', id])
  })

  test('declines a command that already manages its own session', () => {
    for (const custom of ['claude --resume abc', 'claude -c', 'claude --session-id fixed']) {
      expect(buildAssistantSessionArgs('claude', { claude: custom }, crypto.randomUUID())).toEqual(
        []
      )
    }
  })
})
