import { describe, expect, test } from 'bun:test'

import { filetypeFromPath } from '../../src/ui/components/git/diff-renderer/filetype'
import { tokenizeSide } from '../../src/ui/components/git/diff-renderer/highlight'

describe('filetypeFromPath', () => {
  test('by extension, by whole name, and by how a name starts', () => {
    expect(filetypeFromPath('infra/main.tf')).toBe('terraform')
    expect(filetypeFromPath('envs/prod.tfvars')).toBe('terraform')
    expect(filetypeFromPath('config.hcl')).toBe('hcl')
    expect(filetypeFromPath('src/App.TSX')).toBe('tsx')
    expect(filetypeFromPath('Dockerfile')).toBe('dockerfile')
    expect(filetypeFromPath('docker/Dockerfile.dev')).toBe('dockerfile')
    expect(filetypeFromPath('Makefile')).toBe('make')
    expect(filetypeFromPath('.env.local')).toBe('dotenv')
    expect(filetypeFromPath('LICENSE')).toBeUndefined()
    expect(filetypeFromPath('notes.unknown')).toBeUndefined()
  })

  test('terraform is highlighted, not drawn in one colour', async () => {
    const tokens = await tokenizeSide(
      ['resource "aws_s3_bucket" "logs" {', '  bucket = "my-logs"', '  count  = 2', '}'],
      'terraform'
    )
    const colours = new Set(tokens.flat().map((token) => token.color))
    expect(colours.size).toBeGreaterThan(2)
  })
})
