/**
 * A Nerd Font glyph for every kind of file, as nvim-web-devicons draws them —
 * in git mode's sidebar, and handed to plugins as `kit.fileIcon`.
 *
 * Coloured by theme token, never by hex: a brand colour reads on the theme it
 * was picked against and nowhere else, and aimux ships thirty-odd. The syntax
 * tokens are the variety a theme already gives code — the TypeScript icon is
 * drawn in the colour the theme draws types — and the git status colours are
 * left alone: a yellow icon next to a yellow `M` would say "changed" twice.
 */

export type IconTone =
  | 'syntaxFunction'
  | 'syntaxKeyword'
  | 'syntaxNumber'
  | 'syntaxOperator'
  | 'syntaxString'
  | 'syntaxType'
  | 'syntaxVariable'
  | 'text'
  | 'textMuted'

export interface Icon {
  glyph: string
  tone: IconTone
}

const icon = (glyph: string, tone: IconTone): Icon => ({ glyph, tone })

// The tones, by the hue they carry in most themes.
const BLUE = 'syntaxFunction'
const CYAN = 'syntaxOperator'
const YELLOW = 'syntaxType'
const ORANGE = 'syntaxNumber'
const RED = 'syntaxVariable'
const GREEN = 'syntaxString'
const PURPLE = 'syntaxKeyword'
const GREY = 'textMuted'
const WHITE = 'text'

const TS = icon('\u{e628}', BLUE)
const REACT = icon('\u{e7ba}', CYAN)
const JS = icon('\u{e60c}', YELLOW)
const JSON_FILE = icon('\u{e60b}', YELLOW)
const MARKDOWN = icon('\u{f48a}', WHITE)
const CONFIG = icon('\u{e615}', GREY)
const IMAGE = icon('\u{e60d}', PURPLE)
const SHELL = icon('\u{e795}', GREEN)
const ARCHIVE = icon('\u{f410}', ORANGE)
const VIDEO = icon('\u{f03d}', ORANGE)
const AUDIO = icon('\u{f001}', CYAN)
const FONT = icon('\u{e659}', WHITE)
const C = icon('\u{e61e}', BLUE)
const CPP = icon('\u{e61d}', BLUE)
const GIT = icon('\u{e702}', ORANGE)
const DOCKER = icon('\u{f0868}', BLUE)
const NPM = icon('\u{e71e}', RED)
const ENV = icon('\u{f462}', YELLOW)
const LOCK = icon('\u{e672}', GREY)
const ESLINT = icon('\u{e655}', PURPLE)
const PRETTIER = icon('\u{e6b4}', CYAN)
const VITE = icon('\u{e8d7}', PURPLE)
const VITEST = icon('\u{e8d9}', GREEN)
const TAILWIND = icon('\u{e8ba}', CYAN)

export const FILE_ICON = icon('\u{f0219}', GREY)
const FOLDER_CLOSED = icon('\u{e5ff}', BLUE)
const FOLDER_OPEN = icon('\u{e5fe}', BLUE)

const BY_EXTENSION: Readonly<Record<string, Icon>> = {
  '7z': ARCHIVE,
  'astro': icon('\u{e6b3}', ORANGE),
  'avif': IMAGE,
  'bash': SHELL,
  'bmp': IMAGE,
  'c': C,
  'cc': CPP,
  'cfg': CONFIG,
  'cjs': JS,
  'conf': CONFIG,
  'cpp': CPP,
  'css': icon('\u{e749}', BLUE),
  'csv': icon('\u{e64a}', GREEN),
  'cts': TS,
  'dart': icon('\u{e798}', BLUE),
  'db': icon('\u{e64d}', WHITE),
  'ex': icon('\u{e62d}', PURPLE),
  'exs': icon('\u{e62d}', PURPLE),
  'fish': SHELL,
  'flac': AUDIO,
  'gif': IMAGE,
  'go': icon('\u{e627}', CYAN),
  'gql': icon('\u{e662}', PURPLE),
  'graphql': icon('\u{e662}', PURPLE),
  'gz': ARCHIVE,
  'h': C,
  'hpp': CPP,
  'hs': icon('\u{e777}', PURPLE),
  'htm': icon('\u{e736}', ORANGE),
  'html': icon('\u{e736}', ORANGE),
  'ico': IMAGE,
  'ini': CONFIG,
  'java': icon('\u{e738}', RED),
  'jpeg': IMAGE,
  'jpg': IMAGE,
  'js': JS,
  'json': JSON_FILE,
  'json5': JSON_FILE,
  'jsonc': JSON_FILE,
  'jsx': REACT,
  'kt': icon('\u{e634}', PURPLE),
  'kts': icon('\u{e634}', PURPLE),
  'lock': LOCK,
  'log': icon('\u{f0331}', GREY),
  'lua': icon('\u{e620}', BLUE),
  'md': MARKDOWN,
  'mdc': MARKDOWN,
  'mdx': icon('\u{f48a}', BLUE),
  'mjs': JS,
  'mkv': VIDEO,
  'mov': VIDEO,
  'mp3': AUDIO,
  'mp4': VIDEO,
  'mts': TS,
  'nix': icon('\u{f313}', BLUE),
  'ogg': AUDIO,
  'otf': FONT,
  'pdf': icon('\u{e67d}', RED),
  'php': icon('\u{e608}', PURPLE),
  'png': IMAGE,
  'prisma': icon('\u{e684}', BLUE),
  'ps1': icon('\u{e683}', BLUE),
  'py': icon('\u{e606}', YELLOW),
  'rar': ARCHIVE,
  'rb': icon('\u{e791}', RED),
  'rs': icon('\u{e7a8}', ORANGE),
  'sass': icon('\u{e603}', RED),
  'scss': icon('\u{e603}', RED),
  'sh': SHELL,
  'sql': icon('\u{e706}', WHITE),
  'sqlite': icon('\u{e64d}', WHITE),
  'svelte': icon('\u{e697}', ORANGE),
  'svg': icon('\u{f0721}', ORANGE),
  'swift': icon('\u{e755}', ORANGE),
  'tar': ARCHIVE,
  'tex': icon('\u{e69b}', GREEN),
  'tf': icon('\u{e69a}', PURPLE),
  'tgz': ARCHIVE,
  'toml': icon('\u{e6b2}', ORANGE),
  'ts': TS,
  'tsv': icon('\u{e64a}', GREEN),
  'tsx': REACT,
  'ttf': FONT,
  'txt': icon('\u{f0219}', WHITE),
  'vim': icon('\u{e62b}', GREEN),
  'vue': icon('\u{e6a0}', GREEN),
  'wasm': icon('\u{e6a1}', PURPLE),
  'wav': AUDIO,
  'webm': VIDEO,
  'webp': IMAGE,
  'woff': FONT,
  'woff2': FONT,
  'xml': icon('\u{f05c0}', ORANGE),
  'yaml': CONFIG,
  'yml': CONFIG,
  'zig': icon('\u{e6a9}', ORANGE),
  'zip': ARCHIVE,
  'zsh': SHELL,
}

/** Whole names, lower-cased, that say more than their extension. */
const BY_NAME: Readonly<Record<string, Icon>> = {
  '.ds_store': CONFIG,
  '.editorconfig': icon('\u{e652}', WHITE),
  '.gitattributes': GIT,
  '.gitignore': GIT,
  '.gitkeep': GIT,
  '.gitmodules': GIT,
  '.npmrc': NPM,
  '.nvmrc': icon('\u{e718}', GREEN),
  'bun.lock': icon('\u{e76f}', WHITE),
  'bun.lockb': icon('\u{e76f}', WHITE),
  'compose.yaml': DOCKER,
  'compose.yml': DOCKER,
  'docker-compose.yaml': DOCKER,
  'docker-compose.yml': DOCKER,
  'dockerfile': DOCKER,
  'license': icon('\u{e60a}', YELLOW),
  'license.md': icon('\u{e60a}', YELLOW),
  'makefile': icon('\u{e673}', GREY),
  'package-lock.json': NPM,
  'package.json': NPM,
  'pnpm-lock.yaml': LOCK,
  'readme': icon('\u{f00ba}', WHITE),
  'readme.md': icon('\u{f00ba}', WHITE),
  'tsconfig.json': icon('\u{e69d}', BLUE),
  'yarn.lock': LOCK,
}

/** Names that start the same way and mean the same thing: `vite.config.ts`, `.env.local`. */
const BY_PREFIX: readonly [string, Icon][] = [
  ['.env', ENV],
  ['.eslintrc', ESLINT],
  ['eslint.config.', ESLINT],
  ['.prettierrc', PRETTIER],
  ['prettier.config.', PRETTIER],
  ['tailwind.config.', TAILWIND],
  ['tsconfig.', icon('\u{e69d}', BLUE)],
  ['vite.config.', VITE],
  ['vitest.config.', VITEST],
  ['dockerfile', DOCKER],
]

/** The icon for a file, by its name — `a/b/vite.config.ts` and `vite.config.ts` alike. */
export function fileIcon(path: string): Icon {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  const named = BY_NAME[name]
  if (named !== undefined) return named
  for (const [prefix, found] of BY_PREFIX) if (name.startsWith(prefix)) return found
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return FILE_ICON
  return BY_EXTENSION[name.slice(dot + 1)] ?? FILE_ICON
}

export function folderIcon(open: boolean): Icon {
  return open ? FOLDER_OPEN : FOLDER_CLOSED
}
