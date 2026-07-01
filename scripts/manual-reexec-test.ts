#!/usr/bin/env bun
/* eslint-disable no-console -- this IS the harness UI */
//
// Semi-manual end-to-end harness for the daemon hot-reexec path
// (docs/developer/hot-reexec.md).
//
// What it does (each step pauses for you to inspect, unless --auto):
//
//   1. Boot a TM + daemon under the isolated profile `reexec-test` so this
//      cannot disturb your dev runtime. Prints the daemon's PID + version.
//   2. Attach a fake UI session, spawn a ticker PTY (sh counter @ 2 Hz).
//      Subscribes to tabRender, tracks the highest "tick N" we observe so
//      we have a watermark to compare against after the swap.
//   3. Pause — peek at /tmp/aimux-test or `ls $XDG_RUNTIME_DIR/aimux-reexec-test`,
//      tail the daemon log, anything you want.
//   4. Send prepareReexec over the same socket. Print the ack, watch the
//      canonical socket dirent disappear, spawn the successor daemon. The
//      TM stays alive throughout — verify with `lsof -p <tm-pid>` if you
//      want to confirm the PTY master FD is still open.
//   5. Reconnect to the (new) daemon. Print its PID + version (must differ
//      from step 1). Re-attach the same session. Subscribes to renders
//      again, samples the new highest "tick N". Asserts N_after > N_before.
//   6. Teardown — kill the ticker, dispose the session, kill TM + daemon,
//      remove sockets.
//
// Run with:
//
//   bun run reexec-test          # interactive (default)
//   bun run reexec-test --auto   # no prompts, sleep between phases
//   bun run reexec-test teardown # nuke leftover state (no other steps)
//
// If a previous run crashed mid-way, run `teardown` first.

import { connect, type Socket } from 'node:net'

import {
  consumeDaemonHandoff,
  getDaemonOldSocketPath,
  getIpcDaemonSocketPath,
  getTerminalManagerSocketPath,
  readDaemonPidFile,
  readDaemonVersionFile,
  removeDaemonSidecars,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
} from '../src/daemon/runtime-paths'
import {
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
  type ProtocolHelloResult,
  type ServerEvent,
  type ServerResponse,
} from '../src/ipc/protocol'
import {
  findIpcDaemonPid,
  findTerminalManagerPid,
  killProcess,
  spawnDaemonReexec,
  spawnDetachedIpcDaemon,
  spawnDetachedTerminalManager,
} from '../src/platform/daemon-control'

// Both env vars are supposed to be set by the npm-script wrapper so
// Bun.spawn-ed children inherit them from this process's initial env. Set
// them defensively here too in case someone invokes the .ts directly —
// path helpers read AIMUX_PROFILE at call time, so the mutation is honoured
// in the parent process; the only thing it misses is spawned children, but
// those will fall back to the default profile, get caught by the
// "already-running" check, and the harness will fail loudly.
process.env.AIMUX_PROFILE = process.env.AIMUX_PROFILE ?? 'reexec-test'
process.env.AIMUX_HOT_REEXEC = process.env.AIMUX_HOT_REEXEC ?? '1'
if (process.env.AIMUX_PROFILE !== 'reexec-test') {
  console.error(
    `harness expects AIMUX_PROFILE=reexec-test (got ${process.env.AIMUX_PROFILE}). Run via 'bun run reexec-test' instead.`
  )
  process.exit(1)
}

const AUTO: boolean = process.argv.includes('--auto')
const TEARDOWN_ONLY: boolean = process.argv.includes('teardown')

const SESSION_ID = 'manual-reexec-session'
const TAB_ID = 'manual-reexec-tab'
// 2 Hz counter, large i so it survives a long inspection pause.
const TICKER_CMD = 'sh'
const TICKER_ARGS = ['-c', 'i=0; while true; do i=$((i+1)); echo "tick $i"; sleep 0.5; done']

// ─── tiny logging UI ──────────────────────────────────────────────────────
const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

function header(step: number, title: string): void {
  console.log(`\n${C.bold(C.cyan(`▶ Step ${step}: ${title}`))}`)
}

function info(label: string, value: string | number | null | undefined): void {
  console.log(`  ${C.dim(label.padEnd(22))} ${value ?? C.dim('(null)')}`)
}

function ok(message: string): void {
  console.log(`  ${C.green('✓')} ${message}`)
}

function warn(message: string): void {
  console.log(`  ${C.yellow('!')} ${message}`)
}

function fail(message: string): never {
  console.log(`  ${C.red('✗')} ${message}`)
  process.exit(1)
}

async function pause(message: string): Promise<void> {
  if (AUTO) {
    console.log(`  ${C.dim(`(auto) ${message} — sleeping 2s`)}`)
    await Bun.sleep(2_000)
    return
  }
  process.stdout.write(`  ${C.dim(`press Enter to ${message}…`)}`)
  await new Promise<void>((resolve) => {
    const onData = () => {
      process.stdin.off('data', onData)
      process.stdin.pause()
      resolve()
    }
    process.stdin.resume()
    process.stdin.once('data', onData)
  })
}

// ─── thin daemon client ───────────────────────────────────────────────────
interface OpenSocket {
  socket: Socket
  decoder: MessageDecoder<ServerResponse | ServerEvent>
  pending: Map<string, (msg: ServerResponse) => void>
  onEvent: (event: ServerEvent) => void
  highestTick: { value: number }
}

function trackTicksInChunk(
  view: { lines: { spans: { text: string }[] }[] },
  hi: { value: number }
): void {
  for (const line of view.lines) {
    const text = line.spans.map((s) => s.text).join('')
    const matches = text.matchAll(/tick (\d+)/g)
    for (const match of matches) {
      const n = Number(match[1])
      if (Number.isFinite(n) && n > hi.value) hi.value = n
    }
  }
}

async function openConnection(socketPath: string): Promise<OpenSocket> {
  return new Promise<OpenSocket>((resolve, reject) => {
    const socket = connect(socketPath)
    const decoder = new MessageDecoder<ServerResponse | ServerEvent>(parseServerMessage)
    const pending = new Map<string, (msg: ServerResponse) => void>()
    const highestTick = { value: 0 }
    const handle: OpenSocket = {
      decoder,
      highestTick,
      onEvent: () => {
        // overridden by callers that want render events
      },
      pending,
      socket,
    }
    socket.once('connect', () => resolve(handle))
    socket.once('error', reject)
    socket.on('data', (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          if ('id' in message) {
            const cb = pending.get(message.id)
            if (cb) {
              pending.delete(message.id)
              cb(message)
            }
            continue
          }
          if (message.type === 'tabRender') {
            trackTicksInChunk(message.payload.viewport, highestTick)
          }
          handle.onEvent(message)
        }
      } catch (error) {
        warn(`decoder error: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  })
}

async function request(
  open: OpenSocket,
  req: ClientRequest,
  timeoutMs = 5_000
): Promise<ServerResponse> {
  return new Promise<ServerResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      open.pending.delete(req.id)
      reject(new Error(`request ${req.type} timed out`))
    }, timeoutMs)
    open.pending.set(req.id, (msg) => {
      clearTimeout(timer)
      resolve(msg)
    })
    open.socket.write(encodeMessage(req))
  })
}

async function hello(open: OpenSocket): Promise<ProtocolHelloResult> {
  const response = await request(open, {
    id: crypto.randomUUID(),
    payload: { maxVersion: IPC_PROTOCOL_VERSION, minVersion: IPC_PROTOCOL_MIN_VERSION },
    type: 'hello',
  })
  if (response.type !== 'helloResult') {
    throw new Error(
      `unexpected hello response: ${response.type === 'error' ? response.payload.message : response.type}`
    )
  }
  return response.payload
}

async function attach(open: OpenSocket, protocolVersion: number): Promise<void> {
  const response = await request(open, {
    id: crypto.randomUUID(),
    payload: { cols: 80, protocolVersion, rows: 24, sessionId: SESSION_ID },
    type: 'attach',
  })
  if (response.type !== 'attachResult') {
    throw new Error(
      `unexpected attach response: ${response.type === 'error' ? response.payload.message : response.type}`
    )
  }
  info('tabs on attach', response.payload.tabs.length)
  for (const tab of response.payload.tabs) {
    info(`  • tab ${tab.id}`, `${tab.command} (status: ${tab.status})`)
  }
}

async function createTickerTab(open: OpenSocket): Promise<void> {
  const response = await request(open, {
    id: crypto.randomUUID(),
    payload: {
      args: TICKER_ARGS,
      assistant: 'claude',
      cols: 80,
      command: TICKER_CMD,
      rows: 24,
      tabId: TAB_ID,
      title: 'reexec-test ticker',
    },
    type: 'createTab',
  })
  if (response.type !== 'ok') {
    throw new Error(
      `createTab failed: ${response.type === 'error' ? response.payload.message : response.type}`
    )
  }
}

async function disposeSession(open: OpenSocket): Promise<void> {
  await request(open, { id: crypto.randomUUID(), payload: {}, type: 'disposeAll' })
}

async function waitForTicks(open: OpenSocket, atLeast: number, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (open.highestTick.value >= atLeast) return open.highestTick.value
    await Bun.sleep(100)
  }
  return open.highestTick.value
}

async function sendPrepareReexec(open: OpenSocket): Promise<void> {
  // The daemon closes the socket after acking, so the existing request()
  // helper's pending map is fine — once the ack arrives we return.
  const response = await request(
    open,
    { id: crypto.randomUUID(), payload: { reason: 'manual-test' }, type: 'prepareReexec' },
    8_000
  )
  if (response.type !== 'reexecAck') {
    throw new Error(
      `prepareReexec failed: ${response.type === 'error' ? response.payload.message : response.type}`
    )
  }
  info('handoff file', response.payload.handoffPath)
  info('renamed socket', response.payload.renamedSocketPath)
}

async function waitForSocketReady(socketPath: string, timeoutMs = 8_000): Promise<boolean> {
  // The platform helper inside spawnDetached* polls for 2s. Cold-start
  // `bun run src/index.tsx` against a TS entry point can take longer than
  // that on a freshly cleared profile (no warm bake), so the harness polls
  // for a wider window itself and treats the underlying helper's "false"
  // return as advisory.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = connect(socketPath)
    const reachable = await new Promise<boolean>((resolve) => {
      probe.once('connect', () => {
        probe.destroy()
        resolve(true)
      })
      probe.once('error', () => resolve(false))
    })
    if (reachable) return true
    await Bun.sleep(100)
  }
  return false
}

async function waitForSocketRemoval(socketPath: string, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = connect(socketPath)
    const reachable = await new Promise<boolean>((resolve) => {
      probe.once('connect', () => {
        probe.destroy()
        resolve(true)
      })
      probe.once('error', () => resolve(false))
    })
    if (!reachable) return true
    await Bun.sleep(50)
  }
  return false
}

async function killByPid(pid: number | null, label: string): Promise<void> {
  if (pid === null) {
    info(label, 'no pid found — skipping')
    return
  }
  try {
    await killProcess(pid)
    ok(`${label} pid ${pid} stopped`)
  } catch (error) {
    warn(`${label} kill failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function teardown(): Promise<void> {
  header(0, 'Teardown — clearing reexec-test profile state')
  await killByPid(await findIpcDaemonPid(), 'daemon')
  await killByPid(await findTerminalManagerPid(), 'terminal-manager')
  removeDaemonSocketIfExists()
  removeTerminalManagerSocketIfExists()
  removeDaemonSidecars()
  // consumeDaemonHandoff is single-use — call it once to drain any leftover
  // from a previously crashed reexec.
  const leftover = consumeDaemonHandoff()
  if (leftover) info('leftover handoff', JSON.stringify(leftover))
  ok('teardown complete')
}

async function main(): Promise<void> {
  console.log(C.bold('aimux hot-reexec semi-manual test harness'))
  info('profile', process.env.AIMUX_PROFILE)
  info('daemon socket', getIpcDaemonSocketPath())
  info('TM socket', getTerminalManagerSocketPath())
  info('AIMUX_HOT_REEXEC', process.env.AIMUX_HOT_REEXEC)

  if (TEARDOWN_ONLY) {
    await teardown()
    return
  }

  // Always start from a clean slate. If a previous run left orphaned state
  // the spawn would refuse with "daemon already running".
  await teardown()

  // ─── Step 1: boot TM + daemon ─────────────────────────────────────────
  header(1, 'Boot terminal-manager + daemon (isolated profile)')
  info('socket dir', getIpcDaemonSocketPath().replace('/daemon.sock', ''))
  ok('spawning terminal-manager…')
  // The platform spawner returns whether it observed the socket within its
  // 2s window. Cold-start under bun run can take longer; treat the return
  // value as advisory and confirm with our own longer-window poll.
  await spawnDetachedTerminalManager()
  if (!(await waitForSocketReady(getTerminalManagerSocketPath())))
    fail('terminal-manager socket never appeared')
  ok('spawning daemon…')
  await spawnDetachedIpcDaemon()
  if (!(await waitForSocketReady(getIpcDaemonSocketPath()))) fail('daemon socket never appeared')
  // Give daemon a beat to write its sidecar files.
  await Bun.sleep(150)
  const oldDaemonPid = readDaemonPidFile() ?? (await findIpcDaemonPid())
  const oldDaemonVersion = readDaemonVersionFile()
  const oldTmPid = await findTerminalManagerPid()
  info('old daemon pid', oldDaemonPid)
  info('old daemon version', oldDaemonVersion)
  info('TM pid', oldTmPid)

  // ─── Step 2: attach + spawn ticker ────────────────────────────────────
  header(2, 'Attach session and spawn the ticker PTY')
  const before = await openConnection(getIpcDaemonSocketPath())
  const helloResult = await hello(before)
  info('selectedVersion', helloResult.selectedVersion)
  info('capabilities', JSON.stringify(helloResult.capabilities))
  if (!helloResult.capabilities.includes(IPC_CAPABILITY_HOT_REEXEC)) {
    fail(`daemon does not advertise ${IPC_CAPABILITY_HOT_REEXEC} — the binary is too old`)
  }
  ok(`daemon advertises ${IPC_CAPABILITY_HOT_REEXEC}`)
  await attach(before, helloResult.selectedVersion)
  await createTickerTab(before)
  ok('ticker tab created — waiting for tick 5 to confirm it is running…')
  const ticksBefore = await waitForTicks(before, 5)
  if (ticksBefore < 5) {
    fail(`only saw ${ticksBefore} ticks within 5s — PTY may not be producing output`)
  }
  info('ticks observed', ticksBefore)

  await pause('inspect anything you want (sockets, lsof, daemon log), then continue')

  // ─── Step 3: snapshot watermark just before the swap ──────────────────
  header(3, 'Snapshot the tick watermark right before reexec')
  const watermark = before.highestTick.value
  info('tick watermark', watermark)
  ok('this is the number we will compare against after the swap')

  // ─── Step 4: prepareReexec + spawn successor ──────────────────────────
  header(4, 'Send prepareReexec, wait for socket release, spawn successor')
  await sendPrepareReexec(before)
  // The daemon exits ~250ms after acking. Wait for the dirent to be gone.
  const removed = await waitForSocketRemoval(getIpcDaemonSocketPath(), 3_000)
  if (!removed) warn('canonical socket did not disappear within 3s — proceeding anyway')
  else ok('canonical socket path freed')
  info(
    'renamed socket present',
    String((await import('node:fs')).existsSync(getDaemonOldSocketPath()))
  )
  ok('spawning successor daemon binary…')
  await spawnDaemonReexec()
  if (!(await waitForSocketReady(getIpcDaemonSocketPath()))) fail('successor daemon never bound')
  // Successor sidecars take a beat to land after the socket bind.
  await Bun.sleep(200)
  const newDaemonPid = readDaemonPidFile() ?? (await findIpcDaemonPid())
  const newDaemonVersion = readDaemonVersionFile()
  info('new daemon pid', newDaemonPid)
  info('new daemon version', newDaemonVersion)
  const newTmPid = await findTerminalManagerPid()
  info('TM pid (must match)', newTmPid)
  if (oldDaemonPid !== null && newDaemonPid === oldDaemonPid) {
    warn('new daemon pid equals old — did the predecessor actually exit?')
  } else {
    ok('daemon pid changed')
  }
  if (oldTmPid !== null && newTmPid !== oldTmPid) {
    fail(
      `TM pid changed (${oldTmPid} → ${newTmPid}) — the whole point of hot-reexec is that it doesn't`
    )
  } else {
    ok('TM pid unchanged — PTYs preserved')
  }

  await pause('reconnect and check the ticker is still ticking')

  // ─── Step 5: reconnect, observe ticker still ticking ──────────────────
  header(5, 'Reconnect, re-attach session, verify the ticker continued')
  const after = await openConnection(getIpcDaemonSocketPath())
  const helloAfter = await hello(after)
  info('selectedVersion', helloAfter.selectedVersion)
  info('processVersion', helloAfter.processVersion)
  await attach(after, helloAfter.selectedVersion)
  ok('waiting for ticks higher than the pre-swap watermark…')
  const target = watermark + 3
  const ticksAfter = await waitForTicks(after, target, 5_000)
  info('tick watermark (before)', watermark)
  info('tick watermark (after)', ticksAfter)
  if (ticksAfter > watermark) {
    ok(`ticker continued from before — PTY survived the daemon swap (${watermark} → ${ticksAfter})`)
  } else {
    fail(
      `ticker did NOT continue (${watermark} → ${ticksAfter}). The PTY was lost — Ring 3 regression`
    )
  }

  await pause('clean up')

  // ─── Step 6: teardown ─────────────────────────────────────────────────
  header(6, 'Dispose session, kill daemon + TM, remove sockets')
  try {
    await disposeSession(after)
  } catch (error) {
    warn(`disposeAll failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  after.socket.destroy()
  before.socket.destroy()
  await teardown()
  console.log(`\n${C.bold(C.green('✓ Hot-reexec end-to-end passed.'))}`)
}

try {
  await main()
} catch (error) {
  console.error(
    `\n${C.red('✗ harness crashed:')} ${error instanceof Error ? error.message : String(error)}`
  )
  if (error instanceof Error && error.stack !== undefined && error.stack !== '') {
    console.error(error.stack)
  }
  process.exit(1)
}
