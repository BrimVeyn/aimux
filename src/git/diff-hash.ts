// FNV-1a 32-bit hash. Fast, non-crypto, used to detect stale cached diff
// artefacts (parsed file, syntax highlights) when the raw diff text changes.
export function diffHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16)
}
