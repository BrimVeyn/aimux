import { describe, expect, test } from 'bun:test'

import { applyGhosttyShellIntegration } from '../../src/pty/ghostty-shell-integration'

const RESOURCES_DIR = '/Applications/Ghostty.app/Contents/Resources/ghostty'
const INTEGRATION_DIR = `${RESOURCES_DIR}/shell-integration/zsh`

const fileExists = () => true
const fileMissing = () => false

describe('applyGhosttyShellIntegration', () => {
  test('points ZDOTDIR at the Ghostty integration dir for zsh', () => {
    const env = applyGhosttyShellIntegration(
      { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR },
      '/bin/zsh',
      fileExists
    )
    expect(env.ZDOTDIR).toBe(INTEGRATION_DIR)
    expect(env.GHOSTTY_ZSH_ZDOTDIR).toBeUndefined()
  })

  test('preserves the user ZDOTDIR through GHOSTTY_ZSH_ZDOTDIR', () => {
    const env = applyGhosttyShellIntegration(
      { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR, ZDOTDIR: '/Users/me/.config/zsh' },
      'zsh',
      fileExists
    )
    expect(env.ZDOTDIR).toBe(INTEGRATION_DIR)
    expect(env.GHOSTTY_ZSH_ZDOTDIR).toBe('/Users/me/.config/zsh')
  })

  test('leaves non-zsh commands untouched', () => {
    const input = { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR }
    expect(applyGhosttyShellIntegration(input, 'claude', fileExists)).toBe(input)
    expect(applyGhosttyShellIntegration(input, '/bin/bash', fileExists)).toBe(input)
  })

  test('is a no-op outside Ghostty', () => {
    const input = { TERM: 'xterm-256color' }
    expect(applyGhosttyShellIntegration(input, '/bin/zsh', fileExists)).toBe(input)
  })

  test('is a no-op when the integration .zshenv is missing', () => {
    const input = { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR }
    expect(applyGhosttyShellIntegration(input, '/bin/zsh', fileMissing)).toBe(input)
  })

  test('is idempotent when ZDOTDIR already targets the integration dir', () => {
    const input = { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR, ZDOTDIR: INTEGRATION_DIR }
    expect(applyGhosttyShellIntegration(input, '/bin/zsh', fileExists)).toBe(input)
  })

  test('does not mutate the input env', () => {
    const input = { GHOSTTY_RESOURCES_DIR: RESOURCES_DIR, ZDOTDIR: '/Users/me' }
    applyGhosttyShellIntegration(input, '/bin/zsh', fileExists)
    expect(input.ZDOTDIR).toBe('/Users/me')
  })
})
