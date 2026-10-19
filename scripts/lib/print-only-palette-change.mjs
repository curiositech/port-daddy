/** Exact print-only declarations in the shared web/Book palette registry. */
const BOOK_EDGE_DECLARATION = /^--book-block-(?:proof|property|hypothesis|calculation|invariant|definition|checked|protocol|neutral)\s*:\s*#[0-9a-fA-F]{6}\s*;$/

// This deliberately accepts a narrow CSS form, not arbitrary CSS rewrites.
// Preserve quoted content and comment token boundaries; unavailable, unclosed
// or structurally malformed snapshots never earn a motion-proof exemption.
function withoutComments(css) {
  if (typeof css !== 'string' || !css.trim()) return null
  let output = '', quote = '', depth = 0
  for (let i = 0; i < css.length; i++) {
    const char = css[i]
    if (quote) {
      if (char === '\n' || char === '\r') return null
      output += char
      if (char === '\\') {
        if (i + 1 === css.length || /[\r\n]/.test(css[i + 1])) return null
        output += css[++i]
      } else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
      output += char
    } else if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) return null
      output += ' ' + css.slice(i, end + 2).replace(/[^\n]/g, '')
      i = end + 1
    } else {
      if (char === '{') depth++
      if (char === '}' && --depth < 0) return null
      output += char
    }
  }
  return quote || depth !== 0 ? null : output
}

function remainingCss(css) {
  const stripped = withoutComments(css)
  if (stripped === null) return null
  const retained = []
  let previous = ''
  for (const raw of stripped.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Only a whole declaration in declaration position can be removed. A
    // selector, var() value, unknown token or partial declaration stays visible.
    if (!(BOOK_EDGE_DECLARATION.test(line) && /[;{]$/.test(previous))) retained.push(line)
    previous = line
  }
  return retained.join('\n')
}

export function isPrintOnlyBookPaletteChange(before, after) {
  const oldCss = remainingCss(before)
  const newCss = remainingCss(after)
  return oldCss !== null && newCss !== null && oldCss === newCss
}
