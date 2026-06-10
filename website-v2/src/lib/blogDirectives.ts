// Directive pre-processor for long-form markdown (the field log and the
// manifesto). Extracted from BlogPostPage so pages can share it WITHOUT pulling
// in blogData (which eagerly resolves every post's content and throws at module
// load if any slug is missing). Keeping this dependency-free means a single bad
// blog entry can never crash an unrelated page.
//
// HTML comments in markdown declare how the NEXT block should render:
//   <!-- terminal -->            → CommandTerminal (CLI input/output)
//   <!-- syllogism: FILENAME --> → Document card with filename header
//   <!-- code -->                → CodeBlock (explicit, same as default)
//   <!-- figure: CAPTION -->     → Mermaid diagram with caption text
//   <!-- sidenote: LABEL? -->    → Tufte-style right-gutter aside, anchored to
//                                  the NEXT paragraph/blockquote.

export interface Directive {
  type: 'terminal' | 'syllogism' | 'code' | 'figure'
  arg?: string // filename for syllogism, caption for figure
}

// Sentinel inserted into prose blocks to flag them as sidenotes after
// react-markdown has parsed them. Uses a rare unicode pair so it survives
// markdown processing without being mistaken for content.
export const SIDENOTE_SENTINEL_OPEN = '⁂SN⁂'
export const SIDENOTE_SENTINEL_CLOSE = '⁂/SN⁂'
// Non-greedy capture of everything between the open and close sentinel.
export const SIDENOTE_PATTERN = /^⁂SN⁂([\s\S]*?)⁂\/SN⁂\s*/

/**
 * Pre-scan markdown content and extract directive comments.
 *
 * Code-fence directives (terminal/syllogism/code/figure) attach to the next
 * code fence and are returned in the `directives` map (keyed by 0-based
 * code-block index). Sidenote directives attach to the next paragraph or
 * blockquote and are inlined into that block with a sentinel pair.
 *
 * Returns the markdown with all directive comments stripped and sidenotes
 * sentinel-wrapped, plus the code-block directive map.
 */
export function extractDirectives(content: string): { cleaned: string; directives: Map<number, Directive> } {
  const directives = new Map<number, Directive>()

  const fencePattern = /^```/gm
  const fencePositions: number[] = []
  let fm: RegExpExecArray | null
  while ((fm = fencePattern.exec(content)) !== null) {
    fencePositions.push(fm.index)
  }

  const codeRanges: Array<[number, number]> = []
  for (let i = 0; i + 1 < fencePositions.length; i += 2) {
    const close = fencePositions[i + 1]
    codeRanges.push([fencePositions[i], close + 3])
  }
  const isInsideCodeRange = (pos: number): boolean =>
    codeRanges.some(([s, e]) => pos >= s && pos < e)

  const codeDirectivePattern = /<!--\s*(terminal|syllogism|code|figure)(?::\s*(.+?))?\s*-->\s*\n/g
  const sidenoteDirectivePattern = /<!--\s*sidenote(?::\s*(.+?))?\s*-->\s*\n/g

  type Op = { start: number; end: number; replacement?: string }
  const ops: Op[] = []

  let cdm: RegExpExecArray | null
  while ((cdm = codeDirectivePattern.exec(content)) !== null) {
    const directiveEnd = cdm.index + cdm[0].length
    const type = cdm[1] as Directive['type']
    const arg = cdm[2]?.trim()

    const nextFencePos = fencePositions.find((p) => p >= directiveEnd)
    if (nextFencePos !== undefined) {
      const openingFenceIndex = fencePositions.indexOf(nextFencePos)
      if (openingFenceIndex % 2 === 0) {
        directives.set(openingFenceIndex / 2, { type, arg })
      }
    }
    ops.push({ start: cdm.index, end: directiveEnd })
  }

  let sdm: RegExpExecArray | null
  while ((sdm = sidenoteDirectivePattern.exec(content)) !== null) {
    const directiveStart = sdm.index
    const directiveEnd = directiveStart + sdm[0].length
    const label = sdm[1]?.trim() ?? ''

    const tail = content.slice(directiveEnd)
    const lines = tail.split('\n')
    let offsetInTail = 0
    let anchorAbsStart: number | null = null
    let anchorKind: 'paragraph' | 'blockquote' | null = null

    for (const line of lines) {
      const trimmed = line.trim()
      const lineAbs = directiveEnd + offsetInTail
      if (trimmed === '' || /^<!--.*-->$/.test(trimmed)) {
        offsetInTail += line.length + 1
        continue
      }
      if (trimmed.startsWith('```')) {
        anchorAbsStart = null
        break
      }
      if (trimmed.startsWith('>')) {
        anchorKind = 'blockquote'
        anchorAbsStart = lineAbs + (line.length - line.trimStart().length)
      } else {
        anchorKind = 'paragraph'
        anchorAbsStart = lineAbs + (line.length - line.trimStart().length)
      }
      break
    }

    if (anchorAbsStart === null || anchorKind === null) {
      ops.push({ start: directiveStart, end: directiveEnd })
      continue
    }
    if (isInsideCodeRange(anchorAbsStart)) {
      ops.push({ start: directiveStart, end: directiveEnd })
      continue
    }

    const sentinel = `${SIDENOTE_SENTINEL_OPEN}${label}${SIDENOTE_SENTINEL_CLOSE}`
    ops.push({ start: directiveStart, end: directiveEnd })

    if (anchorKind === 'blockquote') {
      const tailStart = directiveEnd
      const remaining = content.slice(tailStart)
      const bqLines = remaining.split('\n')
      let firstBqLineIdx = -1
      for (let idx = 0; idx < bqLines.length; idx += 1) {
        const t = bqLines[idx].trim()
        if (t === '' || /^<!--.*-->$/.test(t)) continue
        if (t.startsWith('>')) {
          firstBqLineIdx = idx
          break
        }
        break
      }
      if (firstBqLineIdx === -1) {
        ops.push({ start: anchorAbsStart, end: anchorAbsStart, replacement: sentinel })
      } else {
        let cursor = tailStart
        for (let idx = 0; idx < firstBqLineIdx; idx += 1) cursor += bqLines[idx].length + 1
        const blockReplacements: Op[] = []
        for (let idx = firstBqLineIdx; idx < bqLines.length; idx += 1) {
          const line = bqLines[idx]
          const trimmed = line.trim()
          if (!trimmed.startsWith('>')) break
          const leadingWs = line.length - line.trimStart().length
          let cut = leadingWs + 1
          if (line[leadingWs + 1] === ' ') cut += 1
          const lineStart = cursor
          blockReplacements.push({ start: lineStart, end: lineStart + cut, replacement: '' })
          cursor += line.length + 1
        }
        const firstReplacement = blockReplacements[0]
        ops.push({ start: firstReplacement.end, end: firstReplacement.end, replacement: sentinel })
        for (const r of blockReplacements) ops.push(r)
      }
    } else {
      ops.push({ start: anchorAbsStart, end: anchorAbsStart, replacement: sentinel })
    }
  }

  ops.sort((a, b) => b.start - a.start)
  let cleaned = content
  for (const op of ops) {
    if (op.replacement !== undefined) {
      cleaned = cleaned.slice(0, op.start) + op.replacement + cleaned.slice(op.end)
    } else {
      cleaned = cleaned.slice(0, op.start) + cleaned.slice(op.end)
    }
  }

  return { cleaned, directives }
}
