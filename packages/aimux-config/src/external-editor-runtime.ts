import type { ExternalEditorConfig } from './types'

/**
 * Holds the resolved external-editor config so side effects (which run outside
 * React) can read it synchronously. Set once at startup by the app.
 */

let current: ExternalEditorConfig = {}

export function setExternalEditorConfig(value: ExternalEditorConfig): void {
  current = value
}

export function getExternalEditorConfig(): ExternalEditorConfig {
  return current
}

/** Editors known to be GUI — spawned detached so they don't claim aimux's TTY. */
export const KNOWN_GUI_EDITORS: ReadonlySet<string> = new Set([
  'appcode',
  'atom',
  'clion',
  'code',
  'code-insiders',
  'codium',
  'cursor',
  'datagrip',
  'fleet',
  'gedit',
  'goland',
  'gvim',
  'idea',
  'kate',
  'macvim',
  'mate',
  'mvim',
  'phpstorm',
  'pycharm',
  'rider',
  'rubymine',
  'subl',
  'sublime_text',
  'vscodium',
  'webstorm',
  'windsurf',
  'zed',
])

/** Per-editor default argv with `{file}` / `{line}` placeholders. */
export const DEFAULT_EDITOR_ARGS: Record<string, string[]> = {
  'clion': ['--line', '{line}', '{file}'],
  'code': ['-g', '{file}:{line}'],
  'code-insiders': ['-g', '{file}:{line}'],
  'codium': ['-g', '{file}:{line}'],
  'cursor': ['-g', '{file}:{line}'],
  'emacs': ['+{line}', '{file}'],
  'fleet': ['{file}:{line}'],
  'goland': ['--line', '{line}', '{file}'],
  'gvim': ['+{line}', '{file}'],
  'helix': ['{file}:{line}'],
  'hx': ['{file}:{line}'],
  'idea': ['--line', '{line}', '{file}'],
  'micro': ['{file}:{line}'],
  'mvim': ['+{line}', '{file}'],
  'nano': ['+{line}', '{file}'],
  'nvim': ['+{line}', '{file}'],
  'phpstorm': ['--line', '{line}', '{file}'],
  'pycharm': ['--line', '{line}', '{file}'],
  'rider': ['--line', '{line}', '{file}'],
  'rubymine': ['--line', '{line}', '{file}'],
  'subl': ['{file}:{line}'],
  'sublime_text': ['{file}:{line}'],
  'vim': ['+{line}', '{file}'],
  'vscodium': ['-g', '{file}:{line}'],
  'webstorm': ['--line', '{line}', '{file}'],
  'windsurf': ['-g', '{file}:{line}'],
  'zed': ['{file}:{line}'],
}
