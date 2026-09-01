import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `App` re-renders on every dispatch. The config-file baseline setters feed
 * module-level singletons, so calling them from the render body overwrites what
 * the settings screen applied on top of that baseline — a changed separator (or
 * auto-commit, multi-repo, external editor) reverts on the next keypress.
 *
 * Render-body calls sit at 2-space indent; the lazy initializer they belong in
 * puts them at 4.
 */
test('config baseline setters are not called from the render body', () => {
  const source = readFileSync(join(import.meta.dir, '../../src/app.tsx'), 'utf8')
  const offenders = source
    .split('\n')
    .filter((line) =>
      /^ {2}set(AutoCommitEnabled|MultiRepoConfig|ExternalEditorConfig|StatusBarSeparator)\(/.test(
        line
      )
    )
  expect(offenders).toEqual([])
})
