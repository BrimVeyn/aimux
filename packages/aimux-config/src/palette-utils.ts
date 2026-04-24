import type { AimuxPalette } from './types'

/** Merge a partial palette onto a base palette. */
export function extendPalette(
  base: AimuxPalette,
  overrides: Partial<AimuxPalette> | undefined
): AimuxPalette {
  if (!overrides) return base
  return { ...base, ...overrides }
}
