import { describe, expect, it } from 'bun:test'

import { runCli } from '../../src/services/ai-usage/spawn'

describe('runCli', () => {
  it('returns an error instead of throwing when the cwd is gone', async () => {
    const result = await runCli('git', ['status'], 5_000, '/aimux/no/such/dir')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('git')
  })

  it('returns an error instead of throwing when the binary is missing', async () => {
    const result = await runCli('aimux-does-not-exist', [])
    expect(result.ok).toBe(false)
  })
})
