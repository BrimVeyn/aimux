import { describe, expect, test } from 'bun:test'

import { rewriteSharedSpecifiers } from '../../src/plugins/module-loader'

/**
 * A plugin and aimux must share one copy of React, opentui and the plugin
 * package. The bundler marks them external; this is what points the resulting
 * bare specifiers at aimux's own files.
 *
 * If it misses one, the specifier stays bare in the artifact and the half
 * fails to load with "Cannot find package" — an error naming a file the plugin
 * author never wrote, about a package they can see in their `node_modules`.
 */

const RESOLUTIONS = new Map([
  ['@brimveyn/aimux-plugin', '/aimux/packages/aimux-plugin/src/index.ts'],
  ['react', '/aimux/node_modules/react/index.js'],
])

describe('rewriting shared specifiers', () => {
  test('a single-line import', () => {
    const out = rewriteSharedSpecifiers(
      `import { definePlugin } from "@brimveyn/aimux-plugin";`,
      RESOLUTIONS
    )
    expect(out).toBe(`import { definePlugin } from "/aimux/packages/aimux-plugin/src/index.ts";`)
  })

  test('an import that spans lines, which is any list a formatter has wrapped', () => {
    const source = [
      'import {',
      '  definePlugin,',
      '  PluginNode',
      '} from "@brimveyn/aimux-plugin";',
    ].join('\n')

    const out = rewriteSharedSpecifiers(source, RESOLUTIONS)
    expect(out).toContain('"/aimux/packages/aimux-plugin/src/index.ts"')
    expect(out).not.toContain('"@brimveyn/aimux-plugin"')
    // Everything but the specifier is reproduced exactly.
    expect(out.split('\n').slice(0, 3)).toEqual(source.split('\n').slice(0, 3))
  })

  test('several imports in one file, wrapped or not', () => {
    const source = [
      'import { jsxDEV } from "react";',
      'import {',
      '  definePlugin,',
      '  UiPluginContext',
      '} from "@brimveyn/aimux-plugin";',
      'import { untouched } from "./local";',
    ].join('\n')

    const out = rewriteSharedSpecifiers(source, RESOLUTIONS)
    expect(out).toContain('"/aimux/node_modules/react/index.js"')
    expect(out).toContain('"/aimux/packages/aimux-plugin/src/index.ts"')
    // A specifier that is not shared is left alone: it was bundled in.
    expect(out).toContain('"./local"')
  })

  test('a re-export', () => {
    const out = rewriteSharedSpecifiers(`export { definePlugin } from "react";`, RESOLUTIONS)
    expect(out).toBe(`export { definePlugin } from "/aimux/node_modules/react/index.js";`)
  })

  test('a side-effect import', () => {
    expect(rewriteSharedSpecifiers(`import "react";`, RESOLUTIONS)).toBe(
      `import "/aimux/node_modules/react/index.js";`
    )
  })

  test('a specifier that merely starts the same is not rewritten', () => {
    const out = rewriteSharedSpecifiers(
      `import x from "@brimveyn/aimux-plugin-extras";`,
      RESOLUTIONS
    )
    expect(out).toContain('"@brimveyn/aimux-plugin-extras"')
  })
})
