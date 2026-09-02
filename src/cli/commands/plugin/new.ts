import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import type { CliCommand } from '../../registry'

import { PLUGIN_MANIFEST_FILENAME } from '../../../plugins/manifest'
import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

/**
 * Scaffolds a plugin.
 *
 * The author loop is `new → link → edit → reload`, and the first step is the
 * one that decides whether the other three are pleasant. What it writes is
 * therefore not a hello-world: a manifest that validates, two halves that
 * apply and unload cleanly, and a test that passes — so `aimux plugin doctor`
 * reports real registrations before a line has been written, and the first red
 * is the author's own.
 *
 * The same scaffold is what the `aimux-plugin-author` skill tells an agent to
 * run, which is why the shapes are flags rather than prose: `--ui --daemon
 * --exec` is a decision an agent can make from a one-line request.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/

/** `acme.telegram-notify` → `TelegramNotify`, for a comment or a title. */
function titleFor(id: string): string {
  const name = id.slice(id.indexOf('.') + 1)
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function uiHalf(id: string, title: string): string {
  return `import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

/**
 * The UI half of ${id}. Runs in the process that draws the screen.
 *
 * Everything registered here comes back off when the plugin unloads — that is
 * what \`ctx.effect\` and the disposers the register calls return are for. You
 * do not have to keep them; the fiber already did.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext

    ctx.ui.widgets.register({
      id: 'panel',
      label: '${title}',
      render: () => {
        const { Panel, Row } = ctx.ui.kit
        return (
          <Panel title="${title}">
            <Row label="Hello" value="from ${id}" />
          </Panel>
        )
      },
    })

    ctx.log.info('${id} ui half applied')
  },
})
`
}

function daemonHalf(id: string): string {
  return `import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

/**
 * The daemon half of ${id}. Runs in the process that owns the PTYs, and keeps
 * running when no UI is attached — which is what makes it the right place for
 * anything that has to react while nobody is looking.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext

    ctx.on('tab:turnComplete', (payload) => {
      ctx.log.info('a turn finished', { payload })
    })

    ctx.log.info('${id} daemon half applied')
  },
})
`
}

function manifestFor(
  id: string,
  title: string,
  shapes: { ui: boolean; daemon: boolean; exec: boolean }
): string {
  const manifest: Record<string, unknown> = {
    apiVersion: PLUGIN_API_VERSION,
    description: `${title}, an aimux plugin`,
    id,
    name: title,
    version: '0.1.0',
  }
  const entries: Record<string, string> = {}
  if (shapes.ui) entries.ui = 'src/ui.tsx'
  if (shapes.daemon) entries.daemon = 'src/daemon.ts'
  if (Object.keys(entries).length > 0) manifest.entries = entries
  if (shapes.exec) {
    manifest.commands = [{ command: ['./commands/hello.sh'], id: 'hello', title: 'Say hello' }]
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function execCommand(id: string): string {
  return `#!/bin/sh
# A command aimux runs for you, with the plugin's world in the environment.
#
# AIMUX_BIN_PATH and AIMUX_SOCKET_PATH are the two that matter: with them this
# script can call back with \`aimux tab send\`, \`aimux worker run\`, and the
# rest — which is the whole contract. No SDK, nothing per language.
set -eu

echo "hello from ${id} (\\$AIMUX_PLUGIN_ROOT)"
`
}

function testFile(id: string, shapes: { ui: boolean; daemon: boolean }): string {
  const half = shapes.ui ? 'ui' : 'daemon'
  const host = shapes.ui ? 'ui' : 'daemon'
  return `import { createTestContext } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

import plugin from '../src/${half}'

/**
 * \`createTestContext\` is the plugin context with nothing behind it: the same
 * event bus, the same effect stack, and recorded services instead of a running
 * aimux. So a test is about what the plugin *does*, and needs no aimux at all.
 */
describe('${id}', () => {
  test('applies and unloads cleanly', async () => {
    const harness = createTestContext({ host: '${host}', id: '${id}' })

    await harness.apply(plugin)
    expect(harness.effectCount()).toBeGreaterThanOrEqual(0)

    // The property everything rests on: an unload leaves nothing behind.
    await harness.dispose()
    expect(harness.effectCount()).toBe(0)
  })
})
`
}

function readme(id: string, title: string, shapes: { ui: boolean; daemon: boolean }): string {
  return `# ${title}

An [aimux](https://github.com/BrimVeyn/aimux) plugin.

## Develop

    bun install
    aimux plugin link .        # register this directory, watched for edits
    aimux plugin doctor .      # validate the manifest and dry-run both halves
    aimux plugin log ${id}     # what it has been saying

Saving a file reloads the plugin in place. \`aimux plugin reload ${id}\` forces it.

## Layout

${shapes.ui ? '- `src/ui.tsx` — the half that runs in the process drawing the screen\n' : ''}${
    shapes.daemon
      ? '- `src/daemon.ts` — the half that runs in the daemon, with or without a UI attached\n'
      : ''
  }- \`${PLUGIN_MANIFEST_FILENAME}\` — what aimux reads before running any of your code
`
}

function packageJson(id: string): string {
  return `${JSON.stringify(
    {
      dependencies: { '@brimveyn/aimux-plugin': '^0.1.0' },
      devDependencies: { '@types/bun': 'latest', '@types/react': '^19' },
      name: id.replace('.', '-'),
      private: true,
      type: 'module',
      version: '0.1.0',
    },
    null,
    2
  )}\n`
}

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      jsx: 'react-jsx',
      lib: ['ESNext', 'DOM'],
      module: 'Preserve',
      moduleResolution: 'bundler',
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: 'ESNext',
      verbatimModuleSyntax: true,
    },
    include: ['src', 'test'],
  },
  null,
  2
)}\n`

export const pluginNew: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'id', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Include a UI half', kind: 'boolean', name: 'ui' },
    { description: 'Include a daemon half', kind: 'boolean', name: 'daemon' },
    { description: 'Include a manifest command (any language)', kind: 'boolean', name: 'exec' },
    { description: 'Where to create it (default: ./<id>)', kind: 'string', name: 'dir' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    if (!ID_PATTERN.test(id)) {
      throw new CliUsageError(
        `"${id}" is not a plugin id: lowercase, dot-separated, at least "<vendor>.<name>" ` +
          '(e.g. "acme.telegram-notify")'
      )
    }

    // Neither flag means both halves: someone who has not decided yet is
    // better served by a working example of each than by an empty directory.
    const wantsUi = ctx.args.flags.ui === true
    const wantsDaemon = ctx.args.flags.daemon === true
    const wantsExec = ctx.args.flags.exec === true
    const shapes =
      wantsUi || wantsDaemon || wantsExec
        ? { daemon: wantsDaemon, exec: wantsExec, ui: wantsUi }
        : { daemon: true, exec: false, ui: true }

    const dirFlag = ctx.args.flags.dir
    let target = resolve(process.cwd(), id)
    if (typeof dirFlag === 'string' && dirFlag !== '') {
      target = isAbsolute(dirFlag) ? dirFlag : resolve(process.cwd(), dirFlag)
    }

    if (existsSync(target)) {
      throw new CliUsageError(`${target} already exists — pass --dir to put it somewhere else`)
    }

    const title = titleFor(id)
    const files: Record<string, string> = {
      'package.json': packageJson(id),
      'README.md': readme(id, title, shapes),
      'tsconfig.json': TSCONFIG,
    }
    files[PLUGIN_MANIFEST_FILENAME] = manifestFor(id, title, shapes)
    if (shapes.ui) files['src/ui.tsx'] = uiHalf(id, title)
    if (shapes.daemon) files['src/daemon.ts'] = daemonHalf(id)
    if (shapes.ui || shapes.daemon) files['test/plugin.test.ts'] = testFile(id, shapes)
    if (shapes.exec) files['commands/hello.sh'] = execCommand(id)

    for (const [relative, contents] of Object.entries(files)) {
      const path = join(target, relative)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, contents, relative.endsWith('.sh') ? { mode: 0o755 } : undefined)
    }

    writeJson({
      created: Object.keys(files).sort(),
      id,
      // The next two commands, in order. An agent reads this as instructions.
      next: [`cd ${target} && bun install`, 'aimux plugin link .', 'aimux plugin doctor .'],
      root: target,
      shapes,
    })
    return await Promise.resolve(EXIT_OK)
  },
  summary: 'Scaffold a plugin that validates, typechecks and passes its test',
  verb: 'new',
}
