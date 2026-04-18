// Vendored from @pierre/diffs v1.1.15 — parser only. See AIMUX-14.
// Parser-only subset of the library's types. Renderer/shiki/hast types removed.

export type ChangeTypes = 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'

export type HunkLineType = 'context' | 'expanded' | 'addition' | 'deletion' | 'metadata'

export interface ContextContent {
  type: 'context'
  lines: number
  additionLineIndex: number
  deletionLineIndex: number
}

export interface ChangeContent {
  type: 'change'
  deletions: number
  deletionLineIndex: number
  additions: number
  additionLineIndex: number
}

export type HunkContent = ContextContent | ChangeContent

export interface Hunk {
  collapsedBefore: number
  additionStart: number
  additionCount: number
  additionLines: number
  additionLineIndex: number
  deletionStart: number
  deletionCount: number
  deletionLines: number
  deletionLineIndex: number
  hunkContent: HunkContent[]
  hunkContext?: string
  hunkSpecs?: string
  splitLineStart: number
  splitLineCount: number
  unifiedLineStart: number
  unifiedLineCount: number
  noEOFCRDeletions: boolean
  noEOFCRAdditions: boolean
}

export interface FileDiffMetadata {
  name: string
  prevName?: string
  lang?: string
  newObjectId?: string
  prevObjectId?: string
  mode?: string
  prevMode?: string
  type: ChangeTypes
  hunks: Hunk[]
  splitLineCount: number
  unifiedLineCount: number
  isPartial: boolean
  deletionLines: string[]
  additionLines: string[]
  cacheKey?: string
}

export interface ParsedPatch {
  patchMetadata?: string
  files: FileDiffMetadata[]
}

export interface FileContents {
  name: string
  contents: string
  lang?: string
  header?: string
  cacheKey?: string
}
