import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The pool worktree directories draw their name from: `worktrees/aimux/crimson`
 * instead of `worktrees/r-8677d8c4/Actuellement-tout-les-pr-44fff`. Colors, not
 * hashes, because the name has to be sayable ("switch to teal") and the pool has
 * to be fixed and knowable in code — no model call to name a directory.
 *
 * One word, lowercase, no diacritics, distinct at a glance, and each with the
 * hex it is actually named after. The hex is the one place in the app a literal
 * colour is right: here the colour *is* the name, so a theme token would be
 * drawing something other than what the directory is called.
 *
 * Exactly 240, which is the size the mosaic is laid out against: 240 divides by
 * 48, 40, 30, 24, 20, 16, 15, 12, 10, 8, 6, 5, 4, 3 and 2, so whatever width the
 * page is given there is a row length that comes out square. Add or remove a
 * colour and the mosaic starts leaving a ragged last row.
 */
export const WORKTREE_COLOR_HEX: Readonly<Record<string, string>> = {
  absinthe: '#76b583',
  alabaster: '#edeae0',
  alizarin: '#e32636',
  almond: '#efdecd',
  aloe: '#7fa87f',
  amaranth: '#e52b50',
  amber: '#ffbf00',
  amethyst: '#9966cc',
  anthracite: '#2f3134',
  apricot: '#fbceb1',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  arctic: '#d7e8ef',
  artichoke: '#8f9779',
  ash: '#b2beb5',
  asparagus: '#87a96b',
  auburn: '#a52a2a',
  avocado: '#568203',
  azure: '#007fff',
  banana: '#ffe135',
  barley: '#dfc98d',
  basil: '#579229',
  bayberry: '#4d7b62',
  beige: '#e8dcc0',
  bergamot: '#9cb071',
  bisque: '#ffe4c4',
  bistre: '#3d2b1f',
  blossom: '#f8c8dc',
  blueberry: '#4f86f7',
  blush: '#de5d83',
  bordeaux: '#5c1a2b',
  bramble: '#4a3c46',
  brass: '#b5a642',
  brick: '#9c463a',
  bronze: '#cd7f32',
  buff: '#f0dc82',
  burgundy: '#800020',
  butter: '#f5e05e',
  buttermilk: '#fbf3c9',
  butterscotch: '#d59a4a',
  cabernet: '#4c1420',
  cactus: '#5b6f55',
  cadet: '#536872',
  camel: '#c19a6b',
  cameo: '#e0b6a2',
  cantaloupe: '#ffa062',
  caramel: '#c68e17',
  carbon: '#2b2b2b',
  cardinal: '#c41e3a',
  carmine: '#960018',
  carnation: '#ffa6c9',
  cashew: '#d0ae8b',
  caviar: '#232326',
  cedar: '#58493c',
  celadon: '#ace1af',
  celery: '#b8d15a',
  cerise: '#de3163',
  cerulean: '#2a52be',
  chalk: '#dfdfd6',
  chambray: '#4f6d8a',
  champagne: '#f7e7ce',
  charcoal: '#36454f',
  chartreuse: '#7fff00',
  cheddar: '#f5a623',
  cherry: '#d2042d',
  chestnut: '#954535',
  chicory: '#6f7ec5',
  chili: '#b32d2d',
  chive: '#63764a',
  chocolate: '#7b3f00',
  cider: '#b8611a',
  cinder: '#3a3a3c',
  cinnamon: '#d2691e',
  citron: '#e4d00a',
  clay: '#b66a50',
  clementine: '#ff8b34',
  clove: '#6b4423',
  clover: '#46a35a',
  coal: '#23252b',
  cobalt: '#0047ab',
  cocoa: '#6b4226',
  coconut: '#efe4d6',
  coffee: '#6f4e37',
  cognac: '#9a463d',
  conifer: '#4d7f4d',
  copper: '#b87333',
  coral: '#ff7f50',
  cork: '#b98a5b',
  corn: '#fbec5d',
  cornflower: '#6495ed',
  cotton: '#f6f4ee',
  cranberry: '#9b1b30',
  cream: '#fffdd0',
  crimson: '#dc143c',
  crocus: '#9a86c9',
  cucumber: '#7fa855',
  currant: '#6b1d3a',
  curry: '#cc9a1e',
  custard: '#f3e17a',
  cyan: '#00c8d7',
  cypress: '#5a6f52',
  daffodil: '#ffdf3f',
  dahlia: '#b0407c',
  daisy: '#fbe870',
  damask: '#cf7188',
  dandelion: '#f7d53b',
  denim: '#1560bd',
  dijon: '#c49102',
  dill: '#8a9a5b',
  dogwood: '#d9b8c4',
  dove: '#d5d2ca',
  driftwood: '#a08b71',
  dune: '#c8b58e',
  dusk: '#4b4a63',
  ebony: '#3a3b3c',
  edamame: '#8fa85a',
  eggplant: '#614051',
  eggshell: '#f0ead6',
  elderberry: '#4a2545',
  ember: '#d2591a',
  emerald: '#50c878',
  endive: '#d5dba3',
  espresso: '#3b2620',
  eucalyptus: '#5f9a80',
  fawn: '#e5aa70',
  fennel: '#93a56b',
  fern: '#4f7942',
  fig: '#5a3a4a',
  fjord: '#3b5a72',
  flame: '#e25822',
  flax: '#eedc82',
  flint: '#6f6f6a',
  fog: '#b9bbb6',
  forest: '#228b22',
  fossil: '#cbc3ab',
  frost: '#ddeaf0',
  fuchsia: '#c154c1',
  fudge: '#7a4a2b',
  gardenia: '#f4efe4',
  garnet: '#733635',
  geranium: '#d33e43',
  ginger: '#b06500',
  glacier: '#b6d3d8',
  gold: '#ffd700',
  gooseberry: '#8fa03a',
  granite: '#676767',
  grape: '#6f2da8',
  graphite: '#4b4b4d',
  grass: '#5aa02c',
  greige: '#bcb3a6',
  guava: '#ef7d6b',
  gunmetal: '#2a3439',
  harbor: '#47606f',
  hazel: '#8e7618',
  heather: '#b7a3c3',
  hemlock: '#4f5f4a',
  hemp: '#a89a75',
  henna: '#b1512b',
  hibiscus: '#d94b7a',
  honey: '#eba937',
  honeydew: '#d5eab0',
  hyacinth: '#7a6ec0',
  iceberg: '#b4d2e0',
  indigo: '#4b0082',
  iris: '#5a4fcf',
  iron: '#4a4e54',
  ivory: '#fffff0',
  jade: '#00a86b',
  jasmine: '#f8de7e',
  jasper: '#9b3d3d',
  jonquil: '#f4ca16',
  juniper: '#4a6e63',
  jute: '#b5a281',
  kelp: '#4a5d3a',
  khaki: '#c3b091',
  kiwi: '#8ee53f',
  lagoon: '#3aa6a0',
  lapis: '#26619c',
  larkspur: '#6a7fd0',
  laurel: '#5b7f5a',
  lavender: '#b57edc',
  leather: '#8a5c3b',
  lemon: '#fff44f',
  lentil: '#a08a5e',
  lettuce: '#a3c94a',
  lilac: '#c8a2c8',
  lime: '#bfff00',
  magenta: '#ff00ff',
  mahogany: '#c04000',
  maroon: '#800000',
  mauve: '#e0b0ff',
  mint: '#3eb489',
  mocha: '#967969',
  mustard: '#ffdb58',
  navy: '#000080',
  ochre: '#cc7722',
  olive: '#808000',
  onyx: '#353839',
  opal: '#a8c3bc',
  orange: '#ff7f00',
  orchid: '#da70d6',
  oyster: '#dcd7c1',
  peach: '#ffe5b4',
  pearl: '#eae0c8',
  periwinkle: '#ccccff',
  pewter: '#899499',
  pine: '#01796f',
  pistachio: '#93c572',
  plum: '#8e4585',
  pumpkin: '#ff7518',
  purple: '#a020f0',
  quartz: '#51484f',
  raspberry: '#e30b5c',
  ruby: '#e0115f',
  russet: '#80461b',
  saffron: '#f4c430',
  sage: '#bcb88a',
  salmon: '#fa8072',
  sand: '#c2b280',
  sapphire: '#0f52ba',
  scarlet: '#ff2400',
  sepia: '#704214',
  sienna: '#882d17',
  silver: '#c0c0c0',
  slate: '#708090',
  steel: '#4682b4',
  tangerine: '#f28500',
  teal: '#008080',
  thistle: '#d8bfd8',
  topaz: '#ffc87c',
  turquoise: '#40e0d0',
  umber: '#635147',
  vanilla: '#f3e5ab',
  verdigris: '#43b3ae',
  vermilion: '#e34234',
  violet: '#7f00ff',
  walnut: '#5c5248',
  wheat: '#f5deb3',
  wine: '#722f37',
  zaffre: '#0014a8',
}

/** Hue, saturation and lightness in 0..1, from a `#rrggbb`. */
function hsl(hex: string): { h: number; l: number; s: number } {
  const packed = Number.parseInt(hex.slice(1), 16)
  const r = ((packed >> 16) & 0xff) / 0xff
  const g = ((packed >> 8) & 0xff) / 0xff
  const b = (packed & 0xff) / 0xff
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const chroma = max - min
  if (chroma === 0) return { h: 0, l, s: 0 }
  let sixth = 0
  if (max === r) sixth = ((g - b) / chroma + 6) % 6
  else if (max === g) sixth = (b - r) / chroma + 2
  else sixth = (r - g) / chroma + 4
  return { h: sixth / 6, l, s: chroma / (1 - Math.abs(2 * l - 1)) }
}

/** Below this a colour reads as a grey, and sorting it by its hue is noise. */
const NEUTRAL_SATURATION = 0.12
/** Hues coarse enough that a band holds several colours to shade through. */
const HUE_BANDS = 12

/**
 * Which band a colour sorts into: its twelfth of the wheel, or the one past the
 * end of the wheel for the greys, which trail the spectrum rather than
 * scattering single dull dots through it.
 */
function hueBand({ h, s }: { h: number; s: number }): number {
  return s < NEUTRAL_SATURATION ? HUE_BANDS : Math.floor(h * HUE_BANDS)
}

/**
 * Spectrum order — the order the mosaic reads in.
 *
 * Banded rather than sorted on raw hue: neighbouring hues differ in lightness
 * far more than they differ in hue, so a strict hue sort comes out as stripes of
 * noise. Twelve bands, each shading through lightness, reads as a rainbow.
 *
 * The shading reverses every other band. Run them all light-to-dark and each
 * boundary is a cliff — the darkest brown butting against the palest cream —
 * where alternating leaves every band starting where the last one ended.
 *
 * The map above stays alphabetical, because that is the one a person edits and
 * checks for duplicates. This is derived from it, so there is no second list to
 * keep in step.
 */
export const WORKTREE_COLORS: readonly string[] = Object.keys(WORKTREE_COLOR_HEX).sort((a, b) => {
  const left = hsl(WORKTREE_COLOR_HEX[a] ?? '#000000')
  const right = hsl(WORKTREE_COLOR_HEX[b] ?? '#000000')
  const band = hueBand(left)
  if (band !== hueBand(right)) return band - hueBand(right)
  // Light to dark on even bands, dark to light on odd ones.
  const shade = band % 2 === 0 ? right.l - left.l : left.l - right.l
  return shade || (a < b ? -1 : 1)
})

/**
 * How many workspaces each colour has ever named.
 *
 * The directory listing says which colours are taken *right now* — that is what
 * allocation needs, and deleting a workspace frees its colour again. This file
 * is the other question: how often a colour has come up over the life of the
 * install, which is the only reason the mosaic has anything to show on a machine
 * with two workspaces open.
 */
export type WorktreeColorCounts = Record<string, number>

/** Resolved per call, not at module scope, so a `HOME` override in tests reaches it. */
export function worktreeColorCountsPath(): string {
  const home = process.env.HOME ?? homedir()
  return join(home, '.config', 'aimux', 'worktree-colors.json')
}

export function readWorktreeColorCounts(): WorktreeColorCounts {
  try {
    const parsed: unknown = JSON.parse(readFileSync(worktreeColorCountsPath(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      )
    )
  } catch {
    // No file yet, or someone hand-edited it into nonsense. Either way the
    // honest answer is "nothing recorded", never a crash on the stats screen.
    return {}
  }
}

/**
 * Adds one to a colour's tally. Silent on failure — a decorative count is never
 * worth failing a workspace creation over.
 *
 * ponytail: read-modify-write, so two workspaces created in the same instant can
 * lose one increment. Move to an append-only log if the count ever has to be
 * exact.
 */
export function recordWorktreeColor(color: string): void {
  try {
    const path = worktreeColorCountsPath()
    const counts = readWorktreeColorCounts()
    counts[color] = (counts[color] ?? 0) + 1
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(counts))
    renameSync(temporary, path)
  } catch {
    // Unwritable config dir. The worktree still exists and still has its name.
  }
}
