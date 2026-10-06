/**
 * The shiki grammar a file is highlighted with. Grammars are loaded on first
 * use (`ensureShikiLang`), so an entry here costs nothing until a file of
 * that kind is opened.
 */
const EXT_TO_SHIKI: Record<string, string> = {
  astro: 'astro',
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  fish: 'fish',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hcl: 'hcl',
  hpp: 'cpp',
  hs: 'haskell',
  html: 'html',
  ini: 'ini',
  java: 'java',
  jl: 'julia',
  js: 'javascript',
  json: 'json',
  json5: 'json5',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  ml: 'ocaml',
  mts: 'typescript',
  nix: 'nix',
  php: 'php',
  pl: 'perl',
  prisma: 'prisma',
  proto: 'proto',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scala: 'scala',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  tex: 'latex',
  tf: 'terraform',
  tfvars: 'terraform',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vim: 'vim',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'zsh',
}

/** Whole names, lower-cased, that carry no extension or a misleading one. */
const NAME_TO_SHIKI: Record<string, string> = {
  '.env': 'dotenv',
  'dockerfile': 'dockerfile',
  'gnumakefile': 'make',
  'makefile': 'make',
}

export function filetypeFromPath(path: string): string | undefined {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  const named = NAME_TO_SHIKI[name]
  if (named !== undefined) return named
  // `.env.local`, `Dockerfile.dev`: the kind is the first part, not the last.
  if (name.startsWith('.env.')) return 'dotenv'
  if (name.startsWith('dockerfile.')) return 'dockerfile'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return EXT_TO_SHIKI[name.slice(dot + 1)]
}
