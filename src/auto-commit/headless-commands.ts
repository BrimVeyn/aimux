import type { AssistantId } from '../state/types'

export interface HeadlessInvocation {
  executable: string
  args: string[]
}

export type SupportedProvider = 'claude' | 'codex' | 'opencode'

const SUPPORTED: ReadonlySet<string> = new Set<SupportedProvider>(['claude', 'codex', 'opencode'])

export function isSupportedProvider(id: AssistantId | string): id is SupportedProvider {
  return SUPPORTED.has(id)
}

export function buildHeadlessInvocation(
  provider: AssistantId | string,
  prompt: string,
  model: string | undefined
): HeadlessInvocation | null {
  switch (provider) {
    case 'claude': {
      const args = ['-p', '--output-format', 'text']
      if (model) args.push('--model', model)
      args.push(prompt)
      return { args, executable: 'claude' }
    }
    case 'codex': {
      const args = ['exec']
      if (model) args.push('--model', model)
      args.push(prompt)
      return { args, executable: 'codex' }
    }
    case 'opencode': {
      return { args: ['run', prompt], executable: 'opencode' }
    }
    default:
      return null
  }
}
