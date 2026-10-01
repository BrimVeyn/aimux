// A minimal but well-formed PDF: one page per entry, each drawing its string in
// Helvetica. Offsets in the xref are exact, so poppler reads it without repair.
export function makePdf(pages: readonly string[]): Uint8Array {
  const objects: string[] = []
  const kids: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('') // Pages, filled once the kids are known.
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const text of pages) {
    const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    const contentId = objects.length
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    )
    kids.push(`${objects.length} 0 R`)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [i, obj] of objects.entries()) {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}
