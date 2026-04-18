// Vendored from @pierre/diffs v1.1.15 — parser only. See AIMUX-14.

export const COMMIT_METADATA_SPLIT = /(?=^From [a-f0-9]+ .+$)/m
export const GIT_DIFF_FILE_BREAK_REGEX = /(?=^diff --git)/gm
export const UNIFIED_DIFF_FILE_BREAK_REGEX = /(?=^---\s+\S)/gm
export const FILE_CONTEXT_BLOB = /(?=^@@ )/gm
export const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?/m
export const SPLIT_WITH_NEWLINES = /(?<=\n)/
export const FILENAME_HEADER_REGEX = /^(---|\+\+\+)\s+([^\t\r\n]+)/
export const FILENAME_HEADER_REGEX_GIT = /^(---|\+\+\+)\s+[ab]\/([^\t\r\n]+)/
export const ALTERNATE_FILE_NAMES_GIT =
  /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/
export const INDEX_LINE_METADATA = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/i
