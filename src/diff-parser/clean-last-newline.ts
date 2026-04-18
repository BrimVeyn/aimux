// Vendored from @pierre/diffs v1.1.15 — parser only. See AIMUX-14.

export function cleanLastNewline(contents: string): string {
  return contents.replace(/\n$|\r\n$/, '')
}
