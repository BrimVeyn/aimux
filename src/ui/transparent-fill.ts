import { type BoxRenderable, type OptimizedBuffer, RGBA } from '@opentui/core'

export const TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0)

// opentui's BoxRenderable only paints a fill when `backgroundColor.a > 0`, so
// a fully transparent bg leaks the chrome characters underneath. These helpers
// run from a box's `renderAfter` hook (after the box paints itself, before its
// children render) and manually overwrite every interior cell with a blank
// space so the region reads as "emptied" instead of leaking.
//
// Two gotchas we hit by reading the zig source (packages/core/src/zig/buffer.zig):
//  1. `setCellWithAlphaBlending` early-returns via `isFullyTransparent` when
//     both fg and bg alpha are 0 — nothing gets written.
//  2. Its `blendCells` deliberately preserves the destination char when the
//     overlay char is `DEFAULT_SPACE_CHAR` (codepoint 32) so that drawing a
//     space on top of existing text does not erase it.
//
// `setCell` (→ `bufferSetCell` → zig `buffer.set`) bypasses both: it writes
// the cell unconditionally, no alpha check, no blending, no char preservation.

// Bordered boxes: inset by 1 cell so the painted border is preserved.
export function fillBorderedBoxInterior(this: BoxRenderable, buffer: OptimizedBuffer): void {
  const x0 = this.screenX
  const y0 = this.screenY
  const w = this.width
  const h = this.height
  const startX = x0 + 1
  const startY = y0 + 1
  const endX = x0 + w - 1
  const endY = y0 + h - 1
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      buffer.setCell(x, y, ' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA)
    }
  }
}

// Borderless boxes: fill the full bounds (no inset).
export function fillBoxInterior(this: BoxRenderable, buffer: OptimizedBuffer): void {
  const x0 = this.screenX
  const y0 = this.screenY
  const endX = x0 + this.width
  const endY = y0 + this.height
  for (let y = y0; y < endY; y++) {
    for (let x = x0; x < endX; x++) {
      buffer.setCell(x, y, ' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA)
    }
  }
}
