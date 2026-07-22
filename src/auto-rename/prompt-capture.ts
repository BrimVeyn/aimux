const MAX_PROMPT_LENGTH = 8_000

export type PromptCaptureResult = { type: 'pending' } | { type: 'submitted'; prompt: string | null }

export class PromptCapture {
  private chars: string[] = []
  private cursor = 0
  private escapeBuffer = ''
  private bracketedPaste = false
  private unreliable = false

  feed(input: string): PromptCaptureResult {
    for (const char of input) {
      if (this.escapeBuffer !== '') {
        this.feedEscape(char)
        continue
      }

      if (char === '\x1b') {
        this.escapeBuffer = char
        continue
      }

      if (this.bracketedPaste) {
        this.insert(char === '\r' ? '\n' : char)
        continue
      }

      if (char === '\r' || char === '\n') {
        if (this.unreliable) {
          this.reset()
          return { prompt: null, type: 'submitted' }
        }
        const prompt = this.value().trim()
        this.reset()
        if (prompt !== '') return { prompt, type: 'submitted' }
        continue
      }

      if (char === '\x7f' || char === '\b') {
        this.backspace()
        continue
      }
      if (char === '\x01') {
        this.cursor = 0
        continue
      }
      if (char === '\x05') {
        this.cursor = this.chars.length
        continue
      }
      if (char === '\x02') {
        this.cursor = Math.max(0, this.cursor - 1)
        continue
      }
      if (char === '\x06') {
        this.cursor = Math.min(this.chars.length, this.cursor + 1)
        continue
      }
      if (char === '\x04') {
        if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1)
        continue
      }
      if (char === '\x0b') {
        this.chars.splice(this.cursor)
        continue
      }
      if (char === '\x15') {
        this.chars = []
        this.cursor = 0
        continue
      }
      if (char === '\x17') {
        this.deleteWord()
        continue
      }
      if (char === '\x03') {
        this.reset()
        continue
      }
      if (char === '\x0c') continue
      if (char < ' ' || char === '\x7f') {
        this.invalidateCurrentSubmission()
        continue
      }
      this.insert(char)
    }
    return { type: 'pending' }
  }

  reset(): void {
    this.chars = []
    this.cursor = 0
    this.escapeBuffer = ''
    this.bracketedPaste = false
    this.unreliable = false
  }

  private value(): string {
    return this.chars.join('').slice(0, MAX_PROMPT_LENGTH)
  }

  private insert(char: string): void {
    if (this.chars.length >= MAX_PROMPT_LENGTH) return
    this.chars.splice(this.cursor, 0, char)
    this.cursor++
  }

  private backspace(): void {
    if (this.cursor === 0) return
    this.chars.splice(this.cursor - 1, 1)
    this.cursor--
  }

  private deleteWord(): void {
    while (this.cursor > 0 && /\s/u.test(this.chars[this.cursor - 1] ?? '')) this.backspace()
    while (this.cursor > 0 && !/\s/u.test(this.chars[this.cursor - 1] ?? '')) this.backspace()
  }

  private feedEscape(char: string): void {
    this.escapeBuffer += char
    const sequence = this.escapeBuffer

    if (
      sequence.length === 2 &&
      sequence !== '\x1b[' &&
      sequence !== '\x1b]' &&
      sequence !== '\x1bO'
    ) {
      this.escapeBuffer = ''
      this.invalidateCurrentSubmission()
      return
    }

    if (sequence.startsWith('\x1b]')) {
      if (char === '\x07' || sequence.endsWith('\x1b\\')) this.escapeBuffer = ''
      return
    }

    if (sequence.startsWith('\x1bO')) {
      if (sequence.length < 3) return
      this.escapeBuffer = ''
      this.applyCursorSequence(sequence.at(-1) ?? '')
      return
    }

    if (!sequence.startsWith('\x1b[')) return
    if (sequence.length <= 2) return
    if (!/[\x40-\x7e]$/u.test(char)) return

    this.escapeBuffer = ''
    switch (sequence) {
      case '\x1b[200~':
        this.bracketedPaste = true
        return
      case '\x1b[201~':
        this.bracketedPaste = false
        return
      case '\x1b[1~':
        this.cursor = 0
        return
      case '\x1b[4~':
        this.cursor = this.chars.length
        return
      case '\x1b[3~':
        if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1)
        return
    }

    const final = sequence.at(-1) ?? ''
    const parameters = sequence.slice(2, -1)
    if ((final === 'C' || final === 'D') && parameters.includes(';')) {
      this.invalidateCurrentSubmission()
      return
    }
    const primaryParameter = parameters.split(';')[0]
    const parsedCount = Number.parseInt(primaryParameter ?? '', 10)
    const count = Number.isFinite(parsedCount) ? Math.max(1, parsedCount) : 1
    this.applyCursorSequence(final, count)
  }

  private applyCursorSequence(final: string, count = 1): void {
    switch (final) {
      case 'A':
      case 'B':
        // History navigation replaces the editor buffer with content that was
        // never sent through this input stream. Skip this submission rather
        // than generating a title from an inaccurate reconstruction.
        this.invalidateCurrentSubmission()
        return
      case 'D':
        this.cursor = Math.max(0, this.cursor - count)
        return
      case 'C':
        this.cursor = Math.min(this.chars.length, this.cursor + count)
        return
      case 'H':
        this.cursor = 0
        return
      case 'F':
        this.cursor = this.chars.length
        return
    }
  }

  private invalidateCurrentSubmission(): void {
    this.chars = []
    this.cursor = 0
    this.unreliable = true
  }
}
