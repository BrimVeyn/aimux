import { describe, expect, test } from 'bun:test'

import {
  decodeFrames,
  encode,
  encodeJson,
  OP_FRAME,
  OP_HANDSHAKE,
} from '../../examples/plugins/discord/src/ipc'
import {
  buildActivity,
  fit,
  summarize,
  type TrackedTab,
} from '../../examples/plugins/discord/src/presence'

/**
 * The two halves of the example that are not wiring: the byte layout Discord
 * expects, and which of three states a profile should show.
 */

function tab(status: TrackedTab['status'], assistant = 'claude'): TrackedTab {
  return { assistant, projectId: 'p1', status }
}

describe('discord ipc framing', () => {
  test('round-trips a frame', () => {
    const { frames, rest } = decodeFrames(encodeJson(OP_HANDSHAKE, { v: 1 }))
    expect(rest.length).toBe(0)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.op).toBe(OP_HANDSHAKE)
    expect(JSON.parse(frames[0]?.body.toString() ?? '')).toEqual({ v: 1 })
  })

  test('keeps a partial frame for the next chunk', () => {
    const whole = Buffer.concat([
      encodeJson(OP_HANDSHAKE, { v: 1 }),
      encodeJson(OP_FRAME, { a: 2 }),
    ])
    const split = whole.length - 3
    const first = decodeFrames(whole.subarray(0, split))
    expect(first.frames).toHaveLength(1)

    const second = decodeFrames(Buffer.concat([first.rest, whole.subarray(split)]))
    expect(second.frames).toHaveLength(1)
    expect(second.rest.length).toBe(0)
    expect(JSON.parse(second.frames[0]?.body.toString() ?? '')).toEqual({ a: 2 })
  })

  test('writes the header Discord reads', () => {
    const frame = encode(OP_FRAME, Buffer.from('hi'))
    expect(frame.readInt32LE(0)).toBe(OP_FRAME)
    expect(frame.readInt32LE(4)).toBe(2)
  })
})

describe('discord presence', () => {
  test('a blocked agent outranks working ones', () => {
    expect(summarize([tab('working'), tab('waiting-input'), tab('working')])).toBe(
      '1 agent waiting on input'
    )
  })

  test('work outranks idle, and the count is plural', () => {
    expect(summarize([tab('working'), tab('working'), tab('idle')])).toBe('2 agents working')
  })

  test('a quiet session still says something', () => {
    expect(summarize([tab('idle')])).toBe('1 agent idle')
    expect(summarize([])).toBe('no agents running')
  })

  test('names the project, and lists each assistant once', () => {
    const activity = buildActivity({
      largeImage: '',
      projectName: 'aimux',
      startedAt: 1_000,
      tabs: [tab('working'), tab('idle'), tab('working', 'codex')],
    })
    expect(activity.details).toBe('aimux')
    expect(activity.state).toBe('2 agents working')
    expect(activity.timestamps.start).toBe(1_000)
    expect(activity.assets?.large_text).toBe('claude · codex')
    expect(activity.assets?.large_image).toBeUndefined()
  })

  test('withheld project name falls back to the app', () => {
    const activity = buildActivity({ largeImage: '', projectName: null, startedAt: 0, tabs: [] })
    expect(activity.details).toBe('aimux')
    expect(activity.assets).toBeUndefined()
  })

  test('fits an over-long field', () => {
    expect(fit('x'.repeat(200))).toHaveLength(128)
    expect(fit('short')).toBe('short')
  })
})
