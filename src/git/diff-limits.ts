// Git plumbing and Bun's file API both hand a blob back as a single JS string. Past
// JavaScriptCore's string cap the allocation does not throw — it aborts the process
// with SIGTRAP, which no try/catch can intercept and which takes the whole TUI down
// with it. Every read of file content in the git layer is gated on this.
//
// 5 MB covers source files and mid-sized CSVs. Anything past it is a build artefact
// or a download, and nobody reviews those line-by-line.
export const MAX_DIFF_BYTES = 5 * 1024 * 1024

// PDFs never become a string: their bytes go straight to the rasteriser, so the
// string cap above does not bind them. They do sit in the diff cache whole, on both
// sides, which is what keeps this finite.
export const MAX_PDF_DIFF_BYTES = 15 * 1024 * 1024

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

export function diffByteLimit(path: string): number {
  return isPdfPath(path) ? MAX_PDF_DIFF_BYTES : MAX_DIFF_BYTES
}
