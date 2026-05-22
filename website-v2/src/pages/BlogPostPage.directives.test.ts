import { describe, expect, test } from 'vitest'
import { extractDirectives } from './BlogPostPage'

// Sentinel characters the renderer uses to flag sidenote anchors after
// markdown processing. Kept in sync with BlogPostPage.tsx.
const SN_OPEN = '⁂SN⁂'
const SN_CLOSE = '⁂/SN⁂'

describe('extractDirectives — code-fence directives (regression)', () => {
  test('terminal directive attaches to the next opening fence', () => {
    const src = [
      'Intro prose.',
      '',
      '<!-- terminal -->',
      '```bash',
      'pd status',
      '```',
      '',
      'Outro.',
    ].join('\n')
    const { cleaned, directives } = extractDirectives(src)
    expect(cleaned).not.toMatch(/terminal/)
    expect(directives.get(0)).toEqual({ type: 'terminal', arg: undefined })
  })

  test('figure directive captures its caption', () => {
    const src = [
      '<!-- figure: Four phases of a port claim -->',
      '```mermaid',
      'graph TD;',
      '```',
    ].join('\n')
    const { directives } = extractDirectives(src)
    expect(directives.get(0)).toEqual({
      type: 'figure',
      arg: 'Four phases of a port claim',
    })
  })

  test('syllogism directive captures filename arg', () => {
    const src = [
      '<!-- syllogism: PROOF.md -->',
      '```',
      'PREMISE: x',
      'THEREFORE y',
      '```',
    ].join('\n')
    const { directives } = extractDirectives(src)
    expect(directives.get(0)).toEqual({ type: 'syllogism', arg: 'PROOF.md' })
  })
})

describe('extractDirectives — sidenote directives', () => {
  test('sidenote attaches to the next paragraph (not a code fence)', () => {
    const src = [
      'Lead paragraph.',
      '',
      '<!-- sidenote: 1 -->',
      'This is the sidenote prose.',
      '',
      'Following paragraph.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    // Directive comment stripped
    expect(cleaned).not.toMatch(/<!--/)
    // Sentinel injected at the start of the next paragraph
    expect(cleaned).toMatch(
      new RegExp(
        `\\n\\n${SN_OPEN}1${SN_CLOSE}This is the sidenote prose\\.`,
      ),
    )
  })

  test('sidenote with no label still attaches', () => {
    const src = [
      '<!-- sidenote -->',
      'Anchorless sidenote body.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    expect(cleaned).toBe(`${SN_OPEN}${SN_CLOSE}Anchorless sidenote body.`)
  })

  test('sidenote on a blockquote strips the `>` and inlines as a paragraph', () => {
    const src = [
      'Lead paragraph.',
      '',
      '<!-- sidenote: aside -->',
      '> Quote body here.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    // The blockquote markers are stripped so the sidenote-tagged content
    // becomes a regular paragraph carrying the sentinel; this prevents a
    // stray <blockquote> from wrapping the eventual <aside>.
    expect(cleaned).toMatch(
      new RegExp(`\\n\\n${SN_OPEN}aside${SN_CLOSE}Quote body here\\.`),
    )
    expect(cleaned).not.toMatch(/^>\s*⁂SN/m)
  })

  test('sidenote on a multi-line blockquote strips `>` from every continuation line', () => {
    const src = [
      '<!-- sidenote: long -->',
      '> First line of the quote.',
      '> Second line still in the quote.',
      '',
      'Regular following paragraph.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    expect(cleaned).toBe(
      [
        `${SN_OPEN}long${SN_CLOSE}First line of the quote.`,
        'Second line still in the quote.',
        '',
        'Regular following paragraph.',
      ].join('\n'),
    )
  })

  test('sidenote does NOT attach to a code fence (skips it, strips directive)', () => {
    const src = [
      '<!-- sidenote: bad -->',
      '```bash',
      'echo "this is a fence not prose"',
      '```',
      '',
      'Subsequent paragraph.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    // Directive removed, no sentinel injected anywhere.
    expect(cleaned).not.toMatch(/<!--/)
    expect(cleaned).not.toContain(SN_OPEN)
    expect(cleaned).toContain('echo "this is a fence not prose"')
  })

  test('multiple sidenotes each attach to their own next paragraph', () => {
    const src = [
      'First para.',
      '',
      '<!-- sidenote: A -->',
      'Sidenote one.',
      '',
      'Second para.',
      '',
      '<!-- sidenote: B -->',
      'Sidenote two.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    expect(cleaned).toMatch(new RegExp(`${SN_OPEN}A${SN_CLOSE}Sidenote one\\.`))
    expect(cleaned).toMatch(new RegExp(`${SN_OPEN}B${SN_CLOSE}Sidenote two\\.`))
  })

  test('sidenote and code-fence directives can coexist independently', () => {
    const src = [
      '<!-- terminal -->',
      '```bash',
      'pd status',
      '```',
      '',
      '<!-- sidenote: 1 -->',
      'Aside about the command above.',
    ].join('\n')
    const { cleaned, directives } = extractDirectives(src)
    expect(directives.get(0)).toEqual({ type: 'terminal', arg: undefined })
    expect(cleaned).toMatch(
      new RegExp(`${SN_OPEN}1${SN_CLOSE}Aside about the command above\\.`),
    )
  })

  test('sidenote skips blank lines between directive and anchor', () => {
    const src = [
      '<!-- sidenote: gap -->',
      '',
      '',
      'Real anchor paragraph.',
    ].join('\n')
    const { cleaned } = extractDirectives(src)
    expect(cleaned).toMatch(
      new RegExp(`${SN_OPEN}gap${SN_CLOSE}Real anchor paragraph\\.`),
    )
  })
})
