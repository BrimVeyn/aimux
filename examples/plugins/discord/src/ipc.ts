/**
 * Discord's local RPC framing, which is the whole of its "SDK": a Unix socket
 * carrying `int32LE op | int32LE length | JSON`. No dependency does anything
 * for us here that these thirty lines do not.
 */

export const OP_HANDSHAKE = 0
export const OP_FRAME = 1
export const OP_CLOSE = 2
export const OP_PING = 3
export const OP_PONG = 4

const HEADER_BYTES = 8

export interface DecodedFrame {
  op: number
  body: Buffer
}

export function encode(op: number, body: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

export function encodeJson(op: number, payload: unknown): Buffer {
  return encode(op, Buffer.from(JSON.stringify(payload)))
}

/**
 * Every whole frame in the buffer, plus what is left over. A socket read is
 * not a frame: Discord's READY arrives split from the first activity reply as
 * often as it does not, and the tail has to survive until the next chunk.
 */
export function decodeFrames(buffer: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = []
  let rest = buffer
  while (rest.length >= HEADER_BYTES) {
    const length = rest.readInt32LE(4)
    if (rest.length < HEADER_BYTES + length) break
    frames.push({
      body: rest.subarray(HEADER_BYTES, HEADER_BYTES + length),
      op: rest.readInt32LE(0),
    })
    rest = rest.subarray(HEADER_BYTES + length)
  }
  return { frames, rest }
}
