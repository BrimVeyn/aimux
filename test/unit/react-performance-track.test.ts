import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { withoutReactPerformanceTrack } from '../../src/app-runtime/react-performance-track'

describe('withoutReactPerformanceTrack', () => {
  test('hides console.timeStamp only while the import runs', async () => {
    const original = Reflect.get(console, 'timeStamp')
    const seen = await withoutReactPerformanceTrack(
      async () => typeof Reflect.get(console, 'timeStamp')
    )
    expect(seen).toBe('undefined')
    expect(Reflect.get(console, 'timeStamp')).toBe(original)
  })

  test('puts it back when the import throws', async () => {
    const original = Reflect.get(console, 'timeStamp')
    let failure: unknown
    try {
      await withoutReactPerformanceTrack(async () => {
        throw new Error('no such module')
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(Reflect.get(console, 'timeStamp')).toBe(original)
  })

  // The UI freeze behind PDF diffs: React's development build walked every
  // index of a typed-array prop after each commit — about four seconds for the
  // two megabytes here, minutes for two PDFs. A process of its own, so the
  // reconciler is evaluated the way the UI evaluates it.
  test('a commit handing a component a new multi-megabyte array stays instant', () => {
    const run = Bun.spawnSync(
      ['bun', join(import.meta.dir, '../fixtures/typed-array-prop-commit.tsx'), 'off'],
      { env: { ...process.env, NODE_ENV: 'development' } }
    )
    expect(run.exitCode).toBe(0)
    const { ms } = JSON.parse(run.stdout.toString()) as { ms: number }
    expect(ms).toBeLessThan(500)
  })
})
