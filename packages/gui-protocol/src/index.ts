// Source of truth for the GUI host ↔ desktop wire contract.
// Import surface for both halves of the bridge:
//   - host:    `@aimux/gui-protocol`
//   - desktop: `@aimux/gui-protocol` (mapped via tsconfig + vite alias)
// The host MUST produce the explicit AppStateProjection — adding a field to
// the projection requires adding it here first.

export * from './messages'
export * from './projection'

/** Wire-protocol version. Bump on any breaking change to messages/projection. */
export const PROTOCOL_VERSION = 1
