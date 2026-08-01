import { describe, expect, test } from 'bun:test'

import { planCompletion, TOP_LEVEL_COMMANDS } from '../../src/cli/completion/plan'
import { renderCompletionScript, SUPPORTED_SHELLS } from '../../src/cli/completion/scripts'
import { COMMANDS } from '../../src/cli/registry'

/** Plan for a command line written as words, with the cursor on the last one. */
function planFor(words: string[]): ReturnType<typeof planCompletion> {
  return planCompletion(words, words.length - 1)
}

function valuesOf(plan: ReturnType<typeof planCompletion>): string[] {
  return plan.kind === 'candidates' ? plan.candidates.map((c) => c.value) : []
}

describe('completion planner', () => {
  test('completes groups and top-level commands at the first word', () => {
    const values = valuesOf(planFor(['aimux', '']))
    expect(values).toContain('tab')
    expect(values).toContain('worker')
    expect(values).toContain('doctor')
    expect(values).toContain('completion')
  })

  test('filters the first word by its prefix', () => {
    expect(valuesOf(planFor(['aimux', 'work']))).toEqual(['workspace', 'worker'])
  })

  test('offers long help flags when the first word starts with a dash', () => {
    expect(valuesOf(planFor(['aimux', '--']))).toEqual(['--help', '--version'])
  })

  test('completes verbs within a group', () => {
    const values = valuesOf(planFor(['aimux', 'tab', '']))
    expect(values).toContain('list')
    expect(values).toContain('send')
    expect(values).not.toContain('create-workspace')
  })

  test('verb candidates carry the registry summary as their description', () => {
    const plan = planFor(['aimux', 'worker', 'run'])
    const run = plan.kind === 'candidates' ? plan.candidates[0] : undefined
    expect(run?.value).toBe('run')
    expect(run?.description).toBe(
      COMMANDS.find((c) => c.group === 'worker' && c.verb === 'run')?.summary
    )
  })

  test('unknown groups and verbs complete nothing', () => {
    expect(planFor(['aimux', 'banana', '']).kind).toBe('none')
    expect(planFor(['aimux', 'tab', 'banana', '']).kind).toBe('none')
  })

  test('completes flag names after a verb', () => {
    const values = valuesOf(planFor(['aimux', 'tab', 'send', 'tab-1', '--']))
    expect(values).toContain('--enter')
    expect(values).toContain('--keys')
    expect(values).toContain('--project')
  })

  test('drops flags that are already on the line', () => {
    const values = valuesOf(planFor(['aimux', 'tab', 'send', 'tab-1', '--enter', '--']))
    expect(values).not.toContain('--enter')
    expect(values).toContain('--keys')
  })

  test('completes a static value vocabulary for the flag being valued', () => {
    expect(valuesOf(planFor(['aimux', 'tab', 'wait', 'tab-1', '--status', '']))).toEqual([
      'idle',
      'waiting-input',
      'working',
    ])
  })

  test('completes values in the --flag=value form, prefix included', () => {
    expect(valuesOf(planFor(['aimux', 'tab', 'snapshot', 't1', '--format=']))).toEqual([
      '--format=json',
      '--format=text',
    ])
  })

  test('defers to the shell for path-taking flags', () => {
    expect(planFor(['aimux', 'tab', 'run', 't1', '--prompt-file', '']).kind).toBe('files')
    expect(planFor(['aimux', 'worker', 'run', '--prompt-file=']).kind).toBe('files')
  })

  test('boolean flags do not swallow the next word as their value', () => {
    // `--enter` takes no value, so the cursor is back on a positional (<text>,
    // free text) rather than on a flag value.
    expect(planFor(['aimux', 'tab', 'send', 'tab-1', '--enter', '']).kind).toBe('none')
  })

  test('optional-string flags only bind a value via =', () => {
    // A bare `--new-workspace` is boolean-like, so the next word is a flag slot.
    const values = valuesOf(planFor(['aimux', 'tab', 'create', '--new-workspace', '--as']))
    expect(values).toEqual(['--assistant'])
  })

  test('plans a dynamic lookup for positionals that name live objects', () => {
    const plan = planFor(['aimux', 'tab', 'send', ''])
    expect(plan).toEqual({ kind: 'dynamic', prefix: '', source: 'tab', word: '' })
  })

  test('counts positionals so the second one plans separately', () => {
    // <tabId> is filled, so the cursor sits on <text> — free text, not a tab id.
    expect(planFor(['aimux', 'tab', 'send', 'tab-1', '']).kind).toBe('none')
  })

  test('flag values are not mistaken for positionals', () => {
    // `--project main` consumes two words; <tabId> is still unfilled.
    const plan = planFor(['aimux', 'tab', 'send', '--project', 'main', ''])
    expect(plan).toEqual({ kind: 'dynamic', prefix: '', source: 'tab', word: '' })
  })

  test('carries the prefix through --flag=value dynamic lookups', () => {
    expect(planFor(['aimux', 'tab', 'list', '--project=ma'])).toEqual({
      kind: 'dynamic',
      prefix: '--project=',
      source: 'project',
      word: 'ma',
    })
  })

  test('after -- everything is a positional, never a flag', () => {
    expect(planFor(['aimux', 'tab', 'send', 't1', '--', '--enter']).kind).toBe('none')
  })

  test('completes the completion command itself', () => {
    const values = valuesOf(planFor(['aimux', 'completion', '']))
    expect(values).toEqual(['bash', 'fish', 'zsh', 'install'])
  })

  test('a cursor before the first argument completes nothing', () => {
    expect(planCompletion(['aimux'], 0).kind).toBe('none')
  })
})

describe('completion registry coverage', () => {
  test('every value-taking flag declares a completion source', () => {
    const missing: string[] = []
    for (const command of COMMANDS) {
      for (const flag of command.flags) {
        if (flag.kind === 'boolean' || flag.kind === 'number') continue
        if (!flag.complete) missing.push(`${command.group} ${command.verb} --${flag.name}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('every positional declares a completion source', () => {
    const missing: string[] = []
    for (const command of COMMANDS) {
      for (const arg of command.args) {
        if (!arg.complete) missing.push(`${command.group} ${command.verb} <${arg.name}>`)
      }
    }
    expect(missing).toEqual([])
  })

  test('advertised top-level commands are still handled by the entrypoint', async () => {
    const source = await Bun.file(`${import.meta.dir}/../../src/index.tsx`).text()
    for (const candidate of TOP_LEVEL_COMMANDS) {
      expect(source).toContain(`'${candidate.value}'`)
    }
  })
})

describe('completion scripts', () => {
  test('every supported shell renders a script that calls __complete', () => {
    for (const shell of SUPPORTED_SHELLS) {
      const script = renderCompletionScript(shell)
      expect(script).toContain('aimux __complete')
      expect(script.length).toBeGreaterThan(100)
    }
  })

  test('the invocation is overridable for dev checkouts', () => {
    const script = renderCompletionScript('zsh', 'bun run /tmp/aimux/src/index.tsx')
    expect(script).toContain('bun run /tmp/aimux/src/index.tsx __complete')
  })

  test('fish declares the path-taking flags it should file-complete', () => {
    const script = renderCompletionScript('fish')
    expect(script).toContain('complete -c aimux -l prompt-file -r -F')
    expect(script).toContain('complete -c aimux -l cwd -r -F')
  })
})
