export { type BlockEntry, diffUnits } from './block-diff'
export { splitUnifiedDiff } from './sides'
export {
  parseUnits,
  plainText,
  type Span,
  type SpanStyle,
  type TableAlign,
  type Unit,
} from './units'
export { diffLines, diffSpans, type Piece, type PieceOp, sideOf } from './word-diff'

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}
