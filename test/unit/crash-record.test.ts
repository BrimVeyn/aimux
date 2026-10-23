import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UI_CRASH_LOG_FILENAME } from '../../src/app-runtime/crash-record'

let runtimeDir: string

beforeAll(async () => {
  runtimeDir = await mkdtemp(join(tmpdir(), 'aimux-crash-record-'))
})

afterAll(async () => {
  await rm(runtimeDir, { force: true, recursive: true })
})

test('an uncaught exception is written to the state directory and still ends the process', async () => {
  const probe = `
    import { installCrashRecord } from '${join(import.meta.dir, '../../src/app-runtime/crash-record.ts')}'
    installCrashRecord()
    function failDeepInside() { throw new Error('probe went wrong') }
    setTimeout(failDeepInside, 0)
    setTimeout(() => process.stdout.write('survived'), 200)
  `
  const run = Bun.spawnSync(['bun', '-e', probe], {
    env: { ...process.env, AIMUX_PROFILE: 'crash-probe', XDG_RUNTIME_DIR: runtimeDir },
  })
  expect(run.exitCode).not.toBe(0)
  expect(run.stdout.toString()).not.toContain('survived')

  const record = await readFile(
    join(runtimeDir, 'aimux-crash-probe', UI_CRASH_LOG_FILENAME),
    'utf8'
  )
  expect(record).toContain('uncaughtException')
  expect(record).toContain('probe went wrong')
  expect(record).toContain('failDeepInside')
})
