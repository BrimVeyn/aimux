// Vendored from @pierre/diffs v1.1.15 — parser only. See AIMUX-14.
/* eslint-disable eqeqeq, no-console, typescript/strict-boolean-expressions, no-else-return, unicorn/no-array-for-each */

import type {
  ChangeContent,
  ContextContent,
  FileContents,
  FileDiffMetadata,
  HunkContent,
  ParsedPatch,
} from './types'

import { cleanLastNewline } from './clean-last-newline'
import {
  ALTERNATE_FILE_NAMES_GIT,
  COMMIT_METADATA_SPLIT,
  FILE_CONTEXT_BLOB,
  FILENAME_HEADER_REGEX,
  FILENAME_HEADER_REGEX_GIT,
  GIT_DIFF_FILE_BREAK_REGEX,
  HUNK_HEADER,
  INDEX_LINE_METADATA,
  SPLIT_WITH_NEWLINES,
  UNIFIED_DIFF_FILE_BREAK_REGEX,
} from './constants'
import { parseLineType } from './parse-line-type'

interface ProcessFileOptions {
  cacheKey?: string
  isGitDiff?: boolean
  oldFile?: FileContents
  newFile?: FileContents
  throwOnError?: boolean
}

function createContentGroup(
  type: 'change' | 'context',
  deletionLineIndex: number,
  additionLineIndex: number
): HunkContent {
  if (type === 'change') {
    return { additionLineIndex, additions: 0, deletionLineIndex, deletions: 0, type: 'change' }
  }
  return { additionLineIndex, deletionLineIndex, lines: 0, type: 'context' }
}

export function processFile(
  fileDiffString: string,
  {
    cacheKey,
    isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString),
    newFile,
    oldFile,
    throwOnError = false,
  }: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  let lastHunkEnd = 0
  const hunks = fileDiffString.split(FILE_CONTEXT_BLOB)
  let currentFile: FileDiffMetadata | undefined
  const isPartial = oldFile == null || newFile == null
  let deletionLineIndex = 0
  let additionLineIndex = 0
  for (const hunk of hunks) {
    const lines = hunk.split(SPLIT_WITH_NEWLINES)
    const firstLine = lines.shift()
    if (firstLine == null) {
      if (throwOnError) throw new Error('parsePatchContent: invalid hunk')
      else console.error('parsePatchContent: invalid hunk', hunk)
      continue
    }
    const fileHeaderMatch = firstLine.match(HUNK_HEADER)
    let additionLines = 0
    let deletionLines = 0
    if (fileHeaderMatch == null || currentFile == null) {
      if (currentFile != null) {
        if (throwOnError) throw new Error('parsePatchContent: Invalid hunk')
        else console.error('parsePatchContent: Invalid hunk', hunk)
        continue
      }
      currentFile = {
        additionLines:
          !isPartial && oldFile != null && newFile != null
            ? newFile.contents.split(SPLIT_WITH_NEWLINES)
            : [],
        cacheKey,
        deletionLines:
          !isPartial && oldFile != null && newFile != null
            ? oldFile.contents.split(SPLIT_WITH_NEWLINES)
            : [],
        hunks: [],
        isPartial,
        name: '',
        splitLineCount: 0,
        type: 'change',
        unifiedLineCount: 0,
      }
      if (currentFile.additionLines.length === 1 && newFile?.contents === '') {
        currentFile.additionLines.length = 0
      }
      if (currentFile.deletionLines.length === 1 && oldFile?.contents === '') {
        currentFile.deletionLines.length = 0
      }
      lines.unshift(firstLine)
      for (const line of lines) {
        const filenameMatch = line.match(
          isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX
        )
        if (line.startsWith('diff --git')) {
          const match = line.trim().match(ALTERNATE_FILE_NAMES_GIT)
          if (match) {
            const prevName = match[1] ?? match[2]
            const name = match[3] ?? match[4]
            if (name != null) {
              currentFile.name = name.trim()
              if (prevName != null && prevName !== name) currentFile.prevName = prevName.trim()
            }
          }
        } else if (filenameMatch != null) {
          const [, type, fileName] = filenameMatch
          if (fileName != null && fileName !== '/dev/null') {
            if (type === '---') {
              currentFile.prevName = fileName.trim()
              currentFile.name = fileName.trim()
            } else if (type === '+++') {
              currentFile.name = fileName.trim()
            }
          }
        } else if (isGitDiff) {
          if (line.startsWith('new mode ')) currentFile.mode = line.replace('new mode', '').trim()
          if (line.startsWith('old mode ')) {
            currentFile.prevMode = line.replace('old mode', '').trim()
          }
          if (line.startsWith('new file mode')) {
            currentFile.type = 'new'
            currentFile.mode = line.replace('new file mode', '').trim()
          }
          if (line.startsWith('deleted file mode')) {
            currentFile.type = 'deleted'
            currentFile.mode = line.replace('deleted file mode', '').trim()
          }
          if (line.startsWith('similarity index')) {
            currentFile.type = line.startsWith('similarity index 100%')
              ? 'rename-pure'
              : 'rename-changed'
          }
          if (line.startsWith('index ')) {
            const [, prevObjectId, newObjectId, mode] = line.trim().match(INDEX_LINE_METADATA) ?? []
            if (prevObjectId != null) currentFile.prevObjectId = prevObjectId
            if (newObjectId != null) currentFile.newObjectId = newObjectId
            if (mode != null) currentFile.mode = mode
          }
          if (line.startsWith('rename from ')) {
            currentFile.prevName = line.replace('rename from ', '').trim()
          }
          if (line.startsWith('rename to ')) {
            currentFile.name = line.replace('rename to ', '').trim()
          }
        }
      }
      continue
    }
    let currentContent: HunkContent | undefined
    let lastLineType: 'addition' | 'deletion' | 'context' | undefined
    while (
      lines.length > 0 &&
      (lines.at(-1) === '\n' ||
        lines.at(-1) === '\r' ||
        lines.at(-1) === '\r\n' ||
        lines.at(-1) === '')
    ) {
      lines.pop()
    }
    const additionStart = parseInt(fileHeaderMatch[3] ?? '', 10)
    const deletionStart = parseInt(fileHeaderMatch[1] ?? '', 10)
    deletionLineIndex = isPartial ? deletionLineIndex : deletionStart - 1
    additionLineIndex = isPartial ? additionLineIndex : additionStart - 1
    const hunkData = {
      additionCount: parseInt(fileHeaderMatch[4] ?? '1', 10),
      additionLineIndex,
      additionLines,
      additionStart,
      collapsedBefore: 0,
      deletionCount: parseInt(fileHeaderMatch[2] ?? '1', 10),
      deletionLineIndex,
      deletionLines,
      deletionStart,
      hunkContent: [] as HunkContent[],
      hunkContext: fileHeaderMatch[5],
      hunkSpecs: firstLine,
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
      splitLineCount: 0,
      splitLineStart: 0,
      unifiedLineCount: 0,
      unifiedLineStart: 0,
    }
    if (
      isNaN(hunkData.additionCount) ||
      isNaN(hunkData.deletionCount) ||
      isNaN(hunkData.additionStart) ||
      isNaN(hunkData.deletionStart)
    ) {
      if (throwOnError) throw new Error('parsePatchContent: invalid hunk metadata')
      else console.error('parsePatchContent: invalid hunk metadata', hunkData)
      continue
    }
    for (const rawLine of lines) {
      const parsedLine = parseLineType(rawLine)
      if (parsedLine == null) {
        console.error('processFile: invalid rawLine:', rawLine)
        continue
      }
      const { line, type } = parsedLine
      if (type === 'addition') {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup('change', deletionLineIndex, additionLineIndex)
          hunkData.hunkContent.push(currentContent)
        }
        additionLineIndex++
        if (isPartial) currentFile.additionLines.push(line)
        ;(currentContent as ChangeContent).additions++
        additionLines++
        lastLineType = 'addition'
      } else if (type === 'deletion') {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup('change', deletionLineIndex, additionLineIndex)
          hunkData.hunkContent.push(currentContent)
        }
        deletionLineIndex++
        if (isPartial) currentFile.deletionLines.push(line)
        ;(currentContent as ChangeContent).deletions++
        deletionLines++
        lastLineType = 'deletion'
      } else if (type === 'context') {
        if (currentContent == null || currentContent.type !== 'context') {
          currentContent = createContentGroup('context', deletionLineIndex, additionLineIndex)
          hunkData.hunkContent.push(currentContent)
        }
        additionLineIndex++
        deletionLineIndex++
        if (isPartial) {
          currentFile.deletionLines.push(line)
          currentFile.additionLines.push(line)
        }
        ;(currentContent as ContextContent).lines++
        lastLineType = 'context'
      } else if (type === 'metadata' && currentContent != null) {
        if (currentContent.type === 'context') {
          hunkData.noEOFCRAdditions = true
          hunkData.noEOFCRDeletions = true
        } else if (lastLineType === 'deletion') hunkData.noEOFCRDeletions = true
        else if (lastLineType === 'addition') hunkData.noEOFCRAdditions = true
        if (isPartial && (lastLineType === 'addition' || lastLineType === 'context')) {
          const lastIndex = currentFile.additionLines.length - 1
          const last = currentFile.additionLines[lastIndex]
          if (lastIndex >= 0 && last != null) {
            currentFile.additionLines[lastIndex] = cleanLastNewline(last)
          }
        }
        if (isPartial && (lastLineType === 'deletion' || lastLineType === 'context')) {
          const lastIndex = currentFile.deletionLines.length - 1
          const last = currentFile.deletionLines[lastIndex]
          if (lastIndex >= 0 && last != null) {
            currentFile.deletionLines[lastIndex] = cleanLastNewline(last)
          }
        }
      }
    }
    hunkData.additionLines = additionLines
    hunkData.deletionLines = deletionLines
    hunkData.collapsedBefore = Math.max(hunkData.additionStart - 1 - lastHunkEnd, 0)
    currentFile.hunks.push(hunkData)
    lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1
    for (const content of hunkData.hunkContent) {
      if (content.type === 'context') {
        hunkData.splitLineCount += content.lines
        hunkData.unifiedLineCount += content.lines
      } else {
        hunkData.splitLineCount += Math.max(content.additions, content.deletions)
        hunkData.unifiedLineCount += content.deletions + content.additions
      }
    }
    hunkData.splitLineStart = currentFile.splitLineCount + hunkData.collapsedBefore
    hunkData.unifiedLineStart = currentFile.unifiedLineCount + hunkData.collapsedBefore
    currentFile.splitLineCount += hunkData.collapsedBefore + hunkData.splitLineCount
    currentFile.unifiedLineCount += hunkData.collapsedBefore + hunkData.unifiedLineCount
  }
  if (currentFile == null) return
  const lastHunk = currentFile.hunks.at(-1)
  if (
    lastHunk != null &&
    !isPartial &&
    currentFile.additionLines.length > 0 &&
    currentFile.deletionLines.length > 0
  ) {
    const lastHunkEnd$1 = lastHunk.additionStart + lastHunk.additionCount - 1
    const totalFileLines = currentFile.additionLines.length
    const collapsedAfter = Math.max(totalFileLines - lastHunkEnd$1, 0)
    currentFile.splitLineCount += collapsedAfter
    currentFile.unifiedLineCount += collapsedAfter
  }
  if (!isGitDiff) {
    if (currentFile.prevName != null && currentFile.name !== currentFile.prevName) {
      currentFile.type = currentFile.hunks.length > 0 ? 'rename-changed' : 'rename-pure'
    } else if (newFile != null && newFile.contents === '') currentFile.type = 'deleted'
    else if (oldFile != null && oldFile.contents === '') currentFile.type = 'new'
  }
  if (currentFile.type !== 'rename-pure' && currentFile.type !== 'rename-changed') {
    currentFile.prevName = undefined
  }
  return currentFile
}

export function processPatch(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch {
  const isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(data)
  const rawFiles = data.split(isGitDiff ? GIT_DIFF_FILE_BREAK_REGEX : UNIFIED_DIFF_FILE_BREAK_REGEX)
  let patchMetadata: string | undefined
  const files: FileDiffMetadata[] = []
  for (const fileOrPatchMetadata of rawFiles) {
    if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
      if (patchMetadata == null) patchMetadata = fileOrPatchMetadata
      else if (throwOnError) throw new Error('parsePatchContent: unknown file blob')
      else console.error('parsePatchContent: unknown file blob:', fileOrPatchMetadata)
      continue
    } else if (!isGitDiff && !UNIFIED_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
      if (patchMetadata == null) patchMetadata = fileOrPatchMetadata
      else if (throwOnError) throw new Error('parsePatchContent: unknown file blob')
      else console.error('parsePatchContent: unknown file blob:', fileOrPatchMetadata)
      continue
    }
    const currentFile = processFile(fileOrPatchMetadata, {
      cacheKey: cacheKeyPrefix != null ? `${cacheKeyPrefix}-${files.length}` : undefined,
      isGitDiff,
      throwOnError,
    })
    if (currentFile != null) files.push(currentFile)
  }
  return { files, patchMetadata }
}

/**
 * Parses a patch file string into an array of parsed patches.
 */
export function parsePatchFiles(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch[] {
  const patches: ParsedPatch[] = []
  for (const patch of data.split(COMMIT_METADATA_SPLIT)) {
    try {
      patches.push(
        processPatch(
          patch,
          cacheKeyPrefix != null ? `${cacheKeyPrefix}-${patches.length}` : undefined,
          throwOnError
        )
      )
    } catch (error) {
      if (throwOnError) throw error
      else console.error(error)
    }
  }
  return patches
}
