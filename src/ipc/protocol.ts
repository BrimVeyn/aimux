import type { TabSession, TerminalModeState, TerminalSnapshot } from '../state/types'
import type { WorkspaceSnapshotV1 } from '../state/types'

export interface AttachRequest {
  sessionId: string
  cols: number
  rows: number
  workspaceSnapshot?: WorkspaceSnapshotV1
}

export interface AttachResult {
  tabs: TabSession[]
  activeTabId: string | null
}

export type ClientRequest =
  | { id: string; type: 'attach'; payload: AttachRequest }
  | {
      id: string
      type: 'createTab'
      payload: {
        tabId: string
        assistant: TabSession['assistant']
        title: string
        command: string
        args?: string[]
        cols: number
        rows: number
        cwd?: string
      }
    }
  | { id: string; type: 'write'; payload: { tabId: string; data: string } }
  | { id: string; type: 'resizeClient'; payload: { cols: number; rows: number } }
  | { id: string; type: 'scroll'; payload: { tabId: string; deltaLines: number } }
  | { id: string; type: 'scrollToBottom'; payload: { tabId: string } }
  | { id: string; type: 'setActiveTab'; payload: { tabId: string | null } }
  | { id: string; type: 'closeTab'; payload: { tabId: string } }
  | { id: string; type: 'disposeAll'; payload: Record<string, never> }
  | { id: string; type: 'ping'; payload: Record<string, never> }

export type ServerResponse =
  | { id: string; type: 'ok'; payload: Record<string, never> }
  | { id: string; type: 'attachResult'; payload: AttachResult }
  | { id: string; type: 'error'; payload: { message: string } }

export type ServerEvent =
  | {
      type: 'tabRender'
      payload: { tabId: string; viewport: TerminalSnapshot; terminalModes: TerminalModeState }
    }
  | { type: 'tabExit'; payload: { tabId: string; exitCode: number } }
  | { type: 'tabError'; payload: { tabId: string; message: string } }

export type IpcMessage = ClientRequest | ServerResponse | ServerEvent

export function encodeMessage(message: IpcMessage): Buffer {
  const payload = JSON.stringify(message)
  return Buffer.from(`${Buffer.byteLength(payload, 'utf8')}\n${payload}`, 'utf8')
}

export class MessageDecoder<TMessage = IpcMessage> {
  private buffer = Buffer.alloc(0)
  private expectedPayloadBytes: number | null = null

  push(chunk: string | Uint8Array): TMessage[] {
    const nextChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    this.buffer = this.buffer.length === 0 ? nextChunk : Buffer.concat([this.buffer, nextChunk])

    const messages: TMessage[] = []
    while (true) {
      if (this.expectedPayloadBytes === null) {
        const separatorIndex = this.buffer.indexOf(0x0a)
        if (separatorIndex === -1) {
          break
        }

        const header = this.buffer.subarray(0, separatorIndex).toString('utf8')
        if (!/^\d+$/.test(header)) {
          throw new Error(`Invalid IPC frame header: ${JSON.stringify(header)}`)
        }

        this.expectedPayloadBytes = Number.parseInt(header, 10)
        this.buffer = this.buffer.subarray(separatorIndex + 1)
      }

      if (this.buffer.length < this.expectedPayloadBytes) {
        break
      }

      const payload = this.buffer.subarray(0, this.expectedPayloadBytes).toString('utf8')
      this.buffer = this.buffer.subarray(this.expectedPayloadBytes)
      this.expectedPayloadBytes = null
      messages.push(JSON.parse(payload) as TMessage)
    }

    return messages
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
    this.expectedPayloadBytes = null
  }
}
