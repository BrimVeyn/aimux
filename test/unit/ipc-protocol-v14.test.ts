import { expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_TAB_METADATA,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_VERSION,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

test('v14 advertises additive tab metadata support', () => {
  expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(14)
  expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_TAB_METADATA)
})

test('parses manual tab rename requests', () => {
  expect(
    parseClientRequest({
      id: 'req-1',
      payload: { tabId: 'tab-1', title: 'Cache fix' },
      type: 'renameTab',
    })
  ).toMatchObject({ type: 'renameTab' })
})

test('parses auto-rename metadata events', () => {
  expect(
    parseServerMessage({
      payload: {
        autoRenameStatus: 'attempted',
        projectId: 'project-1',
        tabId: 'tab-1',
        title: 'Cache fix',
      },
      type: 'tabMetadataUpdated',
    })
  ).toMatchObject({ type: 'tabMetadataUpdated' })
})
