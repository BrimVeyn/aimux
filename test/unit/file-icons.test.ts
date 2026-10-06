import { describe, expect, test } from 'bun:test'

import { FILE_ICON, fileIcon, folderIcon } from '../../src/ui/file-icons'

describe('icons', () => {
  test('by whole name first, then by how the name starts, then by extension', () => {
    expect(fileIcon('package.json').glyph).toBe('\u{e71e}')
    expect(fileIcon('apps/web/vite.config.ts').glyph).toBe('\u{e8d7}')
    expect(fileIcon('.env.production').glyph).toBe('\u{f462}')
    expect(fileIcon('src/ui/view.tsx').glyph).toBe('\u{e7ba}')
    expect(fileIcon('README.md').glyph).toBe('\u{f00ba}')
    expect(fileIcon('Dockerfile.dev').glyph).toBe('\u{f0868}')
  })

  test('anything unknown is a plain file; a folder says whether it is open', () => {
    expect(fileIcon('notes.unknown')).toBe(FILE_ICON)
    expect(fileIcon('Procfile')).toBe(FILE_ICON)
    expect(folderIcon(true).glyph).not.toBe(folderIcon(false).glyph)
  })

  test('coloured by theme token, never by a status colour', () => {
    for (const path of ['a.ts', 'a.js', 'a.rs', 'a.png', '.gitignore', 'x']) {
      expect(['error', 'success', 'warning']).not.toContain(fileIcon(path).tone)
    }
  })
})
