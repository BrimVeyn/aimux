import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decodeFrames,
  encode,
  encodeJson,
  OP_CLOSE,
  OP_FRAME,
  OP_HANDSHAKE,
  OP_PING,
  OP_PONG,
} from './ipc'
import { buildActivity, type DiscordActivity, type TabStatus, type TrackedTab } from './presence'

/**
 * The daemon half, and only the daemon half: it already knows every tab's
 * status, it outlives the UI, and a presence that disappeared when you
 * detached would be worse than none.
 *
 * Discord throttles activity updates, so the events do not drive the socket
 * directly — they mark the state dirty and a timer decides when to speak.
 */

const TICK_MS = 5_000
/** Discord's own limit is roughly one update per 15 seconds. */
const MIN_UPDATE_MS = 15_000
const RECONNECT_MS = 30_000

/**
 * Discord's socket lives under whichever runtime directory the client found
 * first, plus one subdirectory per sandbox. Ten indices because a second
 * client instance takes the next one.
 */
function socketPath(): string | null {
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, tmpdir(), '/tmp'].filter(
    (base): base is string => typeof base === 'string' && base !== ''
  )
  for (const base of bases) {
    for (const dir of [
      base,
      join(base, 'app/com.discordapp.Discord'),
      join(base, 'snap.discord'),
    ]) {
      for (let index = 0; index < 10; index += 1) {
        const candidate = join(dir, `discord-ipc-${index}`)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const applicationId =
      typeof ctx.config.applicationId === 'string' ? ctx.config.applicationId.trim() : ''
    const showProject = ctx.config.showProject !== false
    const largeImage = typeof ctx.config.largeImage === 'string' ? ctx.config.largeImage : ''

    if (applicationId === '') {
      ctx.log.warn('no applicationId configured — presence stays off')
      return
    }

    const startedAt = Date.now()
    const tabs = new Map<string, TrackedTab>()
    let activeProjectId: string | null = ctx.projects.list()[0]?.id ?? null
    let dirty = true

    // Seeding from the live tabs is what makes a hot reload invisible: the
    // presence comes back as it was instead of waiting for the next event.
    for (const tab of ctx.tabs.list()) {
      tabs.set(tab.id, { assistant: tab.assistant, projectId: tab.projectId, status: 'idle' })
    }

    const track = (tabId: string, projectId: string, status: TabStatus): void => {
      activeProjectId = projectId
      const known = tabs.get(tabId)
      if (known?.status === status) return
      tabs.set(tabId, {
        assistant: known?.assistant ?? ctx.tabs.get(tabId)?.assistant ?? 'agent',
        projectId,
        status,
      })
      dirty = true
    }

    ctx.on<{ tabId: string; projectId: string; status: TabStatus }>('tab:status', (event) => {
      track(event.tabId, event.projectId, event.status)
    })
    ctx.on<{ tabId: string; projectId: string }>('tab:question', (event) => {
      track(event.tabId, event.projectId, 'waiting-input')
    })
    ctx.on<{ tabId: string; projectId: string }>('tab:turnComplete', (event) => {
      track(event.tabId, event.projectId, 'idle')
    })
    ctx.on<{ tabId: string }>('tab:closed', (event) => {
      if (tabs.delete(event.tabId)) dirty = true
    })
    ctx.on<{ projectId: string }>('project:switched', (event) => {
      activeProjectId = event.projectId
      dirty = true
    })

    const activity = (): DiscordActivity => {
      const project = activeProjectId === null ? undefined : ctx.projects.get(activeProjectId)
      return buildActivity({
        largeImage,
        projectName: showProject ? (project?.name ?? null) : null,
        startedAt,
        tabs: [...tabs.values()],
      })
    }

    ctx.effect(() => {
      let socket: Socket | null = null
      let ready = false
      let sentAt = 0
      let sent = ''
      let attemptedAt = 0

      const setActivity = (next: DiscordActivity | null): void => {
        socket?.write(
          encodeJson(OP_FRAME, {
            args: { activity: next, pid: process.pid },
            cmd: 'SET_ACTIVITY',
            nonce: randomUUID(),
          })
        )
      }

      const onFrame = (op: number, body: Buffer): void => {
        if (op === OP_PING) {
          socket?.write(encode(OP_PONG, body))
          return
        }
        if (op === OP_CLOSE) {
          // Wrong application id, or Discord shutting down. Either way the
          // reconnect loop takes it from here.
          ctx.log.warn('discord closed the connection', { body: body.toString() })
          socket?.destroy()
          return
        }
        const message = JSON.parse(body.toString()) as { evt?: string; data?: unknown }
        if (message.evt === 'READY') {
          ready = true
          dirty = true
          ctx.log.info('connected to discord')
          return
        }
        if (message.evt === 'ERROR') ctx.log.warn('discord refused a frame', { data: message.data })
      }

      const open = (): void => {
        const path = socketPath()
        if (path === null) return
        let buffered: Buffer = Buffer.alloc(0)
        const next = connect(path)
        socket = next
        next.on('connect', () => {
          next.write(encodeJson(OP_HANDSHAKE, { client_id: applicationId, v: 1 }))
        })
        next.on('data', (chunk: Buffer) => {
          const { frames, rest } = decodeFrames(Buffer.concat([buffered, chunk]))
          buffered = rest
          for (const frame of frames) onFrame(frame.op, frame.body)
        })
        next.on('error', (error) => {
          ctx.log.debug('socket error', { error: error.message })
        })
        next.on('close', () => {
          if (socket !== next) return
          socket = null
          ready = false
        })
      }

      const tick = (): void => {
        // Nobody is looking: a presence is for a human reading a profile, and
        // a headless daemon holding a socket open to say so is work for
        // nothing. Detaching takes the presence down; attaching brings it back.
        if (ctx.clients.ui() === 0) {
          if (socket === null) return
          if (ready) setActivity(null)
          socket.end()
          socket = null
          ready = false
          // Attaching again should show the presence on the next tick, not
          // after a reconnect backoff, and it has to be sent afresh.
          attemptedAt = 0
          sent = ''
          dirty = true
          return
        }
        if (socket === null) {
          if (Date.now() - attemptedAt < RECONNECT_MS) return
          attemptedAt = Date.now()
          open()
          return
        }
        if (!ready || !dirty || Date.now() - sentAt < MIN_UPDATE_MS) return
        const next = activity()
        const encoded = JSON.stringify(next)
        dirty = false
        if (encoded === sent) return
        sent = encoded
        sentAt = Date.now()
        setActivity(next)
        // The only place this plugin's output is visible from a terminal.
        ctx.log.debug('presence updated', { details: next.details, state: next.state })
      }

      tick()
      const timer = setInterval(tick, TICK_MS)

      return () => {
        clearInterval(timer)
        // Leaving a stale "3 agents working" on a profile after an unload is
        // the one failure a user would actually notice.
        if (ready) setActivity(null)
        socket?.end()
        socket = null
      }
    })
  },
})
