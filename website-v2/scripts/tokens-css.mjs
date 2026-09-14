/**
 * tokens-css.mjs — read the light-theme custom properties out of a token file.
 *
 * Both palette guards need the same answer to the same question ("what hex is
 * this token in the light theme"), and two copies of that parser is the defect
 * class these guards exist to catch, so it lives here once.
 *
 * The light theme is the FIRST `:root` block; dark themes and media-query
 * overrides follow it and are deliberately not read.
 */

/** Map of `--token` -> uppercase six-digit hex, for the light theme only. */
export function lightTokens(css) {
  const start = css.indexOf(':root')
  if (start < 0) throw new Error('no :root block in the token file')
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const block = css.slice(open + 1, end)
  const tokens = new Map()
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*#([0-9a-fA-F]{6})\b/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].toUpperCase())
  }
  return tokens
}
