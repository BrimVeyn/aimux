import type { DiffData } from '../state/types'

/**
 * Projection-side helper: rewrite a `DiffData`'s image byte fields from
 * `Uint8Array` to base64 strings before the projection ships to the browser.
 *
 * Why: `JSON.stringify(uint8)` produces `{"0":..., "1":...}` (a plain object
 * keyed by numeric indices), which is both wasteful on the wire and unusable
 * client-side. Base64 round-trips cleanly through JSON and drops straight
 * into `<img src="data:image/...;base64,...">`.
 *
 * Type fudge: the returned object's `imageBytesBefore`/`imageBytesAfter` are
 * typed as `Uint8Array` (matching the `DiffData` interface) but actually hold
 * `string`s at runtime once this function rewrites them. The browser reads
 * these via `DiffDataLite` in `desktop/src/lib/types.ts`, where the same
 * fields are declared as `string`. This divergence is intentional and lives
 * only between projection emit and websocket serialization.
 */
export function encodeDiffImages(d: DiffData): DiffData {
  if (!(d.imageBytesBefore instanceof Uint8Array) && !(d.imageBytesAfter instanceof Uint8Array)) {
    return d
  }
  const next: DiffData = { ...d }
  if (d.imageBytesBefore instanceof Uint8Array) {
    // Cast through unknown — at the projection boundary the field carries a
    // base64 string; the browser's `DiffDataLite.imageBytesBefore` is `string`.
    next.imageBytesBefore = Buffer.from(d.imageBytesBefore).toString(
      'base64'
    ) as unknown as Uint8Array
  }
  if (d.imageBytesAfter instanceof Uint8Array) {
    next.imageBytesAfter = Buffer.from(d.imageBytesAfter).toString(
      'base64'
    ) as unknown as Uint8Array
  }
  return next
}
