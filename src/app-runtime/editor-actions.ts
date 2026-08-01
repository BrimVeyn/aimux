import {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  KNOWN_GUI_EDITORS,
} from '@brimveyn/aimux-config'
import { existsSync } from 'node:fs'
import { join as joinPath, resolve as resolvePath } from 'node:path'

import type { SideEffectContext } from './side-effect-context'

import { logInputDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { isCommandAvailable, shellSplit } from '../pty/command-registry'
import { getSnippetsCatalogPath, isConfigSnippetId } from '../state/snippet-catalog'
import { getSelectedSnippet } from './selection'

/**
 * Open the file backing the currently selected snippet in the user's editor.
 * Config-pinned snippets (id starts with `config:`) live in `aimux.config.ts`
 * (or `.js`); user-edited snippets live in `aimux-snippets.json`.
 *
 * On error (no editor, editor not in PATH) the failure is silent: there is no
 * snippet-picker status line. The user can check the debug log.
 */
export function openSelectedSnippetSourceInEditor(ctx: SideEffectContext): void {
  const snippet = getSelectedSnippet(ctx.state)
  if (!snippet) return

  const configDir = getProfileConfigDir()
  let absolutePath: string

  if (isConfigSnippetId(snippet.id)) {
    const tsPath = joinPath(configDir, 'aimux.config.ts')
    const jsPath = joinPath(configDir, 'aimux.config.js')
    absolutePath = existsSync(jsPath) && !existsSync(tsPath) ? jsPath : tsPath
  } else {
    absolutePath = getSnippetsCatalogPath()
  }

  launchEditorOnFile(ctx, absolutePath, configDir, (message) => {
    logInputDebug('snippets.openInEditor.error', { message, path: absolutePath })
    ctx.dispatch({ message, type: 'snippet-picker-set-message' })
  })
}

export function openFileInEditor(ctx: SideEffectContext, relPath: string): void {
  const fileEntry = ctx.state.gitPanel.files.find((f) => f.path === relPath)
  const cwd = fileEntry?.repoPath ?? ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) {
    ctx.dispatch({ message: 'no working directory', type: 'git-mode-set-message' })
    return
  }
  const absolutePath = resolvePath(cwd, relPath)
  launchEditorOnFile(ctx, absolutePath, cwd, (message) =>
    ctx.dispatch({ message, type: 'git-mode-set-message' })
  )
}

function launchEditorOnFile(
  ctx: SideEffectContext,
  absolutePath: string,
  cwd: string,
  onError: (message: string) => void
): void {
  const config = getExternalEditorConfig()
  const rawCommand = config.command ?? process.env.VISUAL ?? process.env.EDITOR
  if (rawCommand == null || rawCommand === '' || rawCommand.trim() === '') {
    onError('no $EDITOR/$VISUAL set — configure externalEditor in aimux.config.ts')
    return
  }

  const cmdParts = shellSplit(rawCommand)
  const executable = cmdParts[0]
  if (!(executable != null && executable !== '')) {
    onError('invalid editor command')
    return
  }
  const baseName = executable.split('/').pop() ?? executable
  const extraCmdArgs = cmdParts.slice(1)

  const kind: 'gui' | 'tui' = config.kind ?? (KNOWN_GUI_EDITORS.has(baseName) ? 'gui' : 'tui')

  const templateArgs = config.args ?? DEFAULT_EDITOR_ARGS[baseName] ?? ['{file}']
  // No line target — let substitution strip `{line}` placeholders so we don't
  // defeat the editor's "restore last cursor position" feature.
  const resolvedArgs = [...extraCmdArgs, ...substituteEditorArgs(templateArgs, absolutePath)]

  if (!isCommandAvailable(executable)) {
    onError(`editor not found in PATH: ${executable}`)
    return
  }

  if (kind === 'gui') {
    spawnDetached(ctx, [executable, ...resolvedArgs], cwd)
    return
  }

  if (config.terminal && config.terminal.length > 0) {
    const shellCmd = buildShellCmd(cwd, executable, resolvedArgs)
    const argv = config.terminal.map((a) =>
      a.replaceAll('{cmd}', shellCmd).replaceAll('{cwd}', cwd)
    )
    spawnDetached(ctx, argv, cwd)
    return
  }

  void openEditorInline(ctx, executable, resolvedArgs, cwd)
}

/**
 * Substitute `{file}` and `{line}` placeholders in an editor-arg template.
 *
 * When `line` is `undefined` we drop the line bits cleanly so we don't pass a
 * misleading `:1` / `+1` that would defeat the editor's "restore last cursor
 * position" feature:
 *   `['--line', '{line}', '{file}']` → `['{file}']`
 *   `['+{line}', '{file}']`          → `['{file}']`
 *   `['-g', '{file}:{line}']`        → `['-g', '{file}']`
 *   `['{file}:{line}']`              → `['{file}']`
 */
function substituteEditorArgs(template: string[], file: string, line?: string): string[] {
  if (line !== undefined) {
    return template.map((a) => a.replaceAll('{file}', file).replaceAll('{line}', line))
  }
  const out: string[] = []
  for (let i = 0; i < template.length; i++) {
    const arg = template[i] ?? ''
    // Drop a flag immediately followed by a bare `{line}` arg (--line, -line, etc.).
    if (template[i + 1] === '{line}') {
      i++
      continue
    }
    // Drop standalone line tokens like `{line}`, `+{line}`, `:{line}`.
    if (/^[+:]?\{line\}$/.test(arg)) continue
    // Strip trailing `:{line}` or `+{line}` from compound tokens like `{file}:{line}`.
    out.push(arg.replaceAll(/[:+]\{line\}/g, '').replaceAll('{file}', file))
  }
  return out
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

function buildShellCmd(cwd: string, executable: string, args: string[]): string {
  const quoted = [executable, ...args].map(shellQuote).join(' ')
  return `cd ${shellQuote(cwd)} && ${quoted}`
}

function spawnDetached(ctx: SideEffectContext, argv: string[], cwd?: string): void {
  try {
    const child = Bun.spawn(argv, {
      cwd,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    void (async () => {
      const stderr = await new Response(child.stderr).text()
      const code = await child.exited
      if (code !== 0) {
        const firstStderrLine = stderr.trim().split('\n')[0]
        const firstLine =
          firstStderrLine != null && firstStderrLine !== '' ? firstStderrLine : `exit ${code}`
        ctx.dispatch({ message: `editor: ${firstLine}`, type: 'git-mode-set-message' })
      }
    })()
    child.unref()
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  }
}

/**
 * Suspend the opentui renderer, hand the TTY to the editor (inheriting
 * stdin/stdout/stderr), then resume and force a redraw on exit. Matches the
 * shellout pattern used by opencode (packages/opencode/src/cli/cmd/tui/util/editor.ts).
 */
async function openEditorInline(
  ctx: SideEffectContext,
  executable: string,
  args: string[],
  cwd: string
): Promise<void> {
  const { renderer } = ctx
  try {
    renderer.suspend()
    renderer.currentRenderBuffer.clear()
    const proc = Bun.spawn([executable, ...args], {
      cwd,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })
    await proc.exited
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn editor'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  } finally {
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}
