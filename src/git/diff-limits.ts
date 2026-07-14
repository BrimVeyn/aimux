// Git plumbing and Bun's file API both hand a blob back as a single JS string. Past
// JavaScriptCore's string cap the allocation does not throw — it aborts the process
// with SIGTRAP, which no try/catch can intercept and which takes the whole TUI down
// with it. Every read of file content in the git layer is gated on this.
//
// 5 MB covers source files and mid-sized CSVs. Anything past it is a build artefact
// or a download, and nobody reviews those line-by-line.
export const MAX_DIFF_BYTES = 5 * 1024 * 1024
