// All wire-level types live in `@aimux/gui-protocol`. This file re-exports them
// so existing relative imports (`@/lib/types`) keep working. Add new shared
// types to the package, not here.
export * from "@aimux/gui-protocol";
