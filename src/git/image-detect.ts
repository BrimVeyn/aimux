const MIME_BY_EXT: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

function extOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot < slash) return ''
  return path.slice(dot + 1).toLowerCase()
}

export function isImagePath(path: string): boolean {
  return extOf(path) in MIME_BY_EXT
}

export function imageMimeFromPath(path: string): string {
  return MIME_BY_EXT[extOf(path)] ?? 'application/octet-stream'
}

export function imageFormatLabel(path: string): string {
  const ext = extOf(path)
  if (ext === 'jpg') return 'jpeg'
  return ext || 'image'
}
