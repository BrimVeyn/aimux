const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

export function buildPtyPastePayload(text: string, bracketedPasteMode: boolean): string {
  if (!bracketedPasteMode) {
    return text
  }

  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`
}

export { BRACKETED_PASTE_END, BRACKETED_PASTE_START }
