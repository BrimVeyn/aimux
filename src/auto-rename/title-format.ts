// Shared shaping rules for tab titles, whether they come from a model
// (`title-runner`) or from the local fallback (`heuristic-title`). Both must
// produce the same silhouette: 2 to 6 words, at most 48 characters, no
// trailing punctuation.

export const MAX_TITLE_WORDS = 6
export const MAX_TITLE_LENGTH = 48

/** Scripts that do not separate words with spaces, where a one-"word" title is legitimate. */
export function usesUnspacedScript(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(
    text
  )
}

/**
 * Collapse whitespace, drop trailing punctuation, and clamp to the title
 * budget. Returns null when nothing usable is left.
 */
export function clampTitle(raw: string): string | null {
  const clean = raw
    .replaceAll(/\s+/gu, ' ')
    .replace(/[.!?,;:…]+$/u, '')
    .trim()
  const words = clean.split(' ').filter(Boolean)
  const unspaced = usesUnspacedScript(clean)
  if (words.length < 2 && !unspaced) return null

  let title = words.slice(0, MAX_TITLE_WORDS).join(' ')
  if (title.length > MAX_TITLE_LENGTH) {
    title = title
      .slice(0, MAX_TITLE_LENGTH)
      .replace(/\s+\S*$/u, '')
      .trim()
  }
  if (title === '') return null
  return title.split(' ').filter(Boolean).length < 2 && !unspaced ? null : title
}
