/* eslint-disable no-console -- bench script: console is the UI */
/**
 * Benchmark the PTY render pipeline: snapshotTerminal + areTerminalSnapshotsEqual.
 *
 * These two functions run on every PTY data chunk in the daemon. With
 * AIMUX_RENDER_DEBOUNCE_MS=0 (the default), they fire as fast as the event
 * loop allows — so any cost here multiplies by chunks-per-second, per tab.
 *
 * Usage:
 *   bun run scripts/bench-pty-pipeline.ts
 *
 * Tweak with env vars:
 *   AIMUX_BENCH_COLS, AIMUX_BENCH_ROWS, AIMUX_BENCH_ITERS, AIMUX_BENCH_TABS
 */
import { Terminal } from '@xterm/headless'

import { PtyManager } from '../src/pty/pty-manager'
import { areTerminalSnapshotsEqual, snapshotTerminal } from '../src/pty/terminal-snapshot'

const COLS = Number(process.env.AIMUX_BENCH_COLS ?? 200)
const ROWS = Number(process.env.AIMUX_BENCH_ROWS ?? 50)
const ITERS = Number(process.env.AIMUX_BENCH_ITERS ?? 2_000)
const TABS = Number(process.env.AIMUX_BENCH_TABS ?? 4)

interface Stat {
  label: string
  iters: number
  totalMs: number
  perOpUs: number
  opsPerSec: number
}

function fmt(stat: Stat): string {
  return [
    stat.label.padEnd(48),
    `${stat.iters.toString().padStart(7)} iters`,
    `${stat.totalMs.toFixed(2).padStart(9)} ms total`,
    `${stat.perOpUs.toFixed(2).padStart(9)} µs/op`,
    `${Math.round(stat.opsPerSec).toLocaleString().padStart(12)} ops/s`,
  ].join('  ')
}

function bench(label: string, iters: number, fn: () => void): Stat {
  // Warmup
  for (let i = 0; i < Math.min(50, iters); i++) fn()
  const start = Bun.nanoseconds()
  for (let i = 0; i < iters; i++) fn()
  const elapsed = Bun.nanoseconds() - start
  const totalMs = Number(elapsed) / 1_000_000
  const perOpUs = (totalMs * 1000) / iters
  const opsPerSec = (iters / totalMs) * 1000
  return { iters, label, opsPerSec, perOpUs, totalMs }
}

function makeTerminal(): Terminal {
  const term = new Terminal({
    allowProposedApi: true,
    cols: COLS,
    rows: ROWS,
    scrollback: 1000,
  })
  return term
}

function fillTerminal(term: Terminal, lines: number): Promise<void> {
  // Mix of plain text + ANSI color/style sequences to exercise the cell
  // decoding path realistically. Use a callback to await the writes.
  return new Promise((resolve) => {
    let pending = lines
    const flush = () => {
      pending -= 1
      if (pending <= 0) resolve()
    }
    const idLabel = (i: number): string => `[${i.toString().padStart(4, '0')}] `.repeat(2)
    const styledBlock = `\x1b[1mbold\x1b[0m italic content here `.repeat(3)
    for (let i = 0; i < lines; i++) {
      const fg = 31 + (i % 6)
      const text = `\x1b[${fg}m${idLabel(i)}${styledBlock}tail line ${i}\r\n`
      term.write(text, flush)
    }
  })
}

console.log(`\nbench-pty-pipeline: cols=${COLS} rows=${ROWS} iters=${ITERS} tabs=${TABS}\n`)

const term = makeTerminal()
await fillTerminal(term, 500) // bigger than scrollback so we exercise the buffer

// 1) snapshotTerminal — the per-render allocation cost
const stats: Stat[] = []
stats.push(
  bench('snapshotTerminal (full viewport build)', ITERS, () => {
    snapshotTerminal(term, true)
  })
)

// 2) areTerminalSnapshotsEqual — equal case (no changes)
const a = snapshotTerminal(term, true)
const b = snapshotTerminal(term, true)
stats.push(
  bench('areTerminalSnapshotsEqual (equal)', ITERS, () => {
    areTerminalSnapshotsEqual(a, b)
  })
)

// 3) areTerminalSnapshotsEqual — changed case (cursor move)
const c = snapshotTerminal(term, true)
term.write('x')
const d = snapshotTerminal(term, true)
stats.push(
  bench('areTerminalSnapshotsEqual (changed)', ITERS, () => {
    areTerminalSnapshotsEqual(c, d)
  })
)

// 4) Combined: snapshot + diff (simulates one daemon render cycle)
let last = snapshotTerminal(term, true)
stats.push(
  bench('snapshot + areEqual (one render cycle)', ITERS, () => {
    const next = snapshotTerminal(term, true)
    areTerminalSnapshotsEqual(last, next)
    last = next
  })
)

// 5) N tabs × one render cycle each — what the daemon does per "frame"
const tabs = Array.from({ length: TABS }, () => makeTerminal())
await Promise.all(tabs.map((t) => fillTerminal(t, 500)))
const tabSnapshots: ReturnType<typeof snapshotTerminal>[] = tabs.map((t) =>
  snapshotTerminal(t, true)
)
stats.push(
  bench(`${TABS} tabs × (snapshot + diff) per frame`, Math.floor(ITERS / 2), () => {
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i]
      if (!t) continue
      const next = snapshotTerminal(t, true)
      areTerminalSnapshotsEqual(tabSnapshots[i], next)
      tabSnapshots[i] = next
    }
  })
)

console.log(stats.map(fmt).join('\n'))
console.log()

// Practical interpretation
const oneCycle = stats[3]
const tabsCycle = stats[4]
if (oneCycle && tabsCycle) {
  const cyclesPerSec1 = oneCycle.opsPerSec
  const tabFramesPerSec = tabsCycle.opsPerSec
  const cpuPctAt60Hz = (60 / cyclesPerSec1) * 100
  const cpuPctTabsAt60Hz = (60 / tabFramesPerSec) * 100
  const lines = [
    `Interpretation:`,
    `  - One tab streaming at 60Hz: ~${cpuPctAt60Hz.toFixed(2)}% CPU just for snapshot+diff`,
    `  - ${TABS} tabs streaming at 60Hz: ~${cpuPctTabsAt60Hz.toFixed(2)}% CPU just for snapshot+diff`,
    `  - DATA_DEBOUNCE_MS controls how often render fires per tab when streaming (see streaming bench below)`,
  ]
  console.log(lines.join('\n'))
}

/**
 * Streaming benchmark: drive a real PtyManager with a fast-producing process
 * and count how often `render` actually fires. This is what changes when you
 * tweak AIMUX_RENDER_DEBOUNCE_MS.
 */
async function streamingBench(): Promise<void> {
  // Reflect the *actual* value used by pty-manager: env override if set, else
  // the in-source default (kept in sync with pty-manager.DATA_DEBOUNCE_MS).
  const PTY_MANAGER_DEFAULT_DEBOUNCE_MS = 8
  const envDebounce = process.env.AIMUX_RENDER_DEBOUNCE_MS
  const debounceMs =
    envDebounce !== undefined ? Number(envDebounce) : PTY_MANAGER_DEFAULT_DEBOUNCE_MS
  const lineCount = Number(process.env.AIMUX_BENCH_STREAM_LINES ?? 5000)
  const manager = new PtyManager()
  let renderCount = 0
  const cpuStart = process.cpuUsage()
  const wallStart = Bun.nanoseconds()

  manager.on('render', () => {
    renderCount += 1
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('streaming bench timed out'))
    }, 30_000)
    manager.on('error', (_id, msg) => {
      clearTimeout(timeout)
      reject(new Error(msg))
    })
    manager.on('exit', () => {
      clearTimeout(timeout)
      // Give the final coalesced flush a tick to land.
      setTimeout(resolve, 50)
    })

    // bun -e: stream `lineCount` lines spaced over time, mimicking an AI
    // assistant streaming tokens (small chunk every few ms). Without spacing,
    // the whole burst coalesces into 1-2 flushes regardless of debounce, which
    // hides the very behavior we're trying to measure.
    const childScript = `
      const total = ${lineCount}
      const chunkSize = 25
      let i = 0
      function tick() {
        const end = Math.min(i + chunkSize, total)
        while (i < end) {
          process.stdout.write('streaming line ' + i + ' ' + 'x'.repeat(40) + '\\n')
          i++
        }
        if (i < total) setTimeout(tick, 4)
      }
      tick()
    `
    manager.createSession({
      args: ['-e', childScript],
      cols: COLS,
      command: 'bun',
      cwd: process.cwd(),
      rows: ROWS,
      tabId: 'stream-tab',
    })
  })

  const wallMs = Number(Bun.nanoseconds() - wallStart) / 1_000_000
  const cpu = process.cpuUsage(cpuStart)
  const cpuMs = (cpu.user + cpu.system) / 1000
  const cpuPct = (cpuMs / wallMs) * 100

  console.log()
  console.log(`Streaming bench (real PTY, ${lineCount} lines, debounce=${debounceMs}ms):`)
  console.log(`  wall time:        ${wallMs.toFixed(1)} ms`)
  console.log(`  cpu time:         ${cpuMs.toFixed(1)} ms (${cpuPct.toFixed(1)}% CPU)`)
  console.log(`  render events:    ${renderCount}`)
  console.log(`  renders/sec:      ${((renderCount / wallMs) * 1000).toFixed(0)}`)
  console.log(`  cpu/render:       ${(cpuMs / Math.max(1, renderCount)).toFixed(2)} ms`)
  manager.disposeAll()
}

await streamingBench()

/**
 * Validate fix #2 (skip render when no clients): with broadcast disabled,
 * snapshot + diff + emit are bypassed. xterm.write still runs (PTY data
 * keeps the buffer correct), so the residual cost is just PTY ingestion +
 * xterm parsing — the per-chunk render cost should be ~0 renders fired.
 */
async function broadcastGateBench(): Promise<void> {
  const lineCount = Number(process.env.AIMUX_BENCH_STREAM_LINES ?? 5000)

  for (const enabled of [true, false]) {
    const manager = new PtyManager()
    manager.setBroadcastEnabled(enabled)
    let renderCount = 0
    const cpuStart = process.cpuUsage()
    const wallStart = Bun.nanoseconds()
    manager.on('render', () => {
      renderCount += 1
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('broadcast bench timed out')), 30_000)
      manager.on('error', (_id, msg) => {
        clearTimeout(timeout)
        reject(new Error(msg))
      })
      manager.on('exit', () => {
        clearTimeout(timeout)
        setTimeout(resolve, 50)
      })

      const childScript = `
        const total = ${lineCount}
        const chunkSize = 25
        let i = 0
        function tick() {
          const end = Math.min(i + chunkSize, total)
          while (i < end) {
            process.stdout.write('streaming line ' + i + ' ' + 'x'.repeat(40) + '\\n')
            i++
          }
          if (i < total) setTimeout(tick, 4)
        }
        tick()
      `
      manager.createSession({
        args: ['-e', childScript],
        cols: COLS,
        command: 'bun',
        cwd: process.cwd(),
        rows: ROWS,
        tabId: 'gate-tab',
      })
    })

    const wallMs = Number(Bun.nanoseconds() - wallStart) / 1_000_000
    const cpu = process.cpuUsage(cpuStart)
    const cpuMs = (cpu.user + cpu.system) / 1000
    const cpuPct = (cpuMs / wallMs) * 100

    console.log()
    console.log(
      `Broadcast-gate bench (${lineCount} lines, broadcastEnabled=${enabled.toString()}):`
    )
    console.log(`  wall time:        ${wallMs.toFixed(1)} ms`)
    console.log(`  cpu time:         ${cpuMs.toFixed(1)} ms (${cpuPct.toFixed(1)}% CPU)`)
    console.log(`  render events:    ${renderCount}`)
    manager.disposeAll()
  }
}

await broadcastGateBench()
