export interface HeadlessInvocation {
  executable: string
  args: string[]
}

export type SupportedProvider = 'claude' | 'codex' | 'opencode' | 'grok'

const SUPPORTED: ReadonlySet<string> = new Set<SupportedProvider>([
  'claude',
  'codex',
  'opencode',
  'grok',
])

export function isSupportedProvider(id: string): id is SupportedProvider {
  return SUPPORTED.has(id)
}

export function buildHeadlessInvocation(
  provider: string,
  prompt: string,
  model: string | undefined
): HeadlessInvocation | null {
  switch (provider) {
    case 'claude': {
      const args = ['-p', '--output-format', 'text']
      if (model != null && model !== '') args.push('--model', model)
      args.push(prompt)
      return { args, executable: 'claude' }
    }
    case 'codex': {
      const args = ['exec']
      if (model != null && model !== '') args.push('--model', model)
      args.push(prompt)
      return { args, executable: 'codex' }
    }
    case 'opencode': {
      return { args: ['run', prompt], executable: 'opencode' }
    }
    case 'grok': {
      // Headless: grok -p "<prompt>" [-m <model>]. Model appended after prompt value to
      // match documented example shape `grok -p "..." -m my-model`. No output-format flag.
      const args: string[] = ['-p', prompt]
      if (model != null && model !== '') args.push('-m', model)
      return { args, executable: 'grok' }
    }
    default:
      return null
  }
}
