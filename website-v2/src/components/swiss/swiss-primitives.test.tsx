// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Eyebrow, PartNumeral, Slab } from './index'
import textbook from '../../data/textbook.json'

// These three primitives are the foundation every later conversion wave
// builds on (see docs/design/swiss-system/ROADMAP.md) -- a silent bug here
// propagates into every surface that adopts them. Rather than assert
// against a hard-coded list of part slugs, the ones that matter are read
// straight out of textbook.json: adding a part there without giving it a
// role-token pair in tokens.roles.css must fail this suite, not ship quietly.

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const tokensRolesCss = readFileSync(join(here, '..', '..', 'styles', 'tokens.roles.css'), 'utf8')

const partSlugs: string[] = (textbook as { parts: Array<{ slug: string }> }).parts.map((p) => p.slug)

const BOGUS_SLUG = 'not-a-real-part'

function hasRoleTokenPair(css: string, slug: string): boolean {
  return new RegExp(`--part-${slug}:\\s`).test(css) && new RegExp(`--part-${slug}-on:\\s`).test(css)
}

describe('Slab', () => {
  test('renders its children', () => {
    render(<Slab slug="machine">hello</Slab>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  test('marks itself on-block so a nested heading inherits the block foreground', () => {
    render(<Slab slug="machine">hello</Slab>)
    expect(screen.getByText('hello')).toHaveClass('on-block')
  })

  test('every part slug in textbook.json has a role token pair to resolve', () => {
    expect(partSlugs.length).toBeGreaterThan(0)
    for (const slug of partSlugs) {
      expect(hasRoleTokenPair(tokensRolesCss, slug)).toBe(true)
    }
  })

  test.each(partSlugs)('resolves var(--part-%s) / var(--part-%s-on) mechanically from the slug', (slug) => {
    const { container } = render(<Slab slug={slug}>x</Slab>)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.background).toBe(`var(--part-${slug})`)
    expect(el.style.color).toBe(`var(--part-${slug}-on)`)
  })

  test('a slug with no matching token degrades visibly, not silently', () => {
    // Prove the fixture itself is honest: tokens.roles.css genuinely has no
    // entry for this slug.
    expect(hasRoleTokenPair(tokensRolesCss, BOGUS_SLUG)).toBe(false)
    const { container } = render(<Slab slug={BOGUS_SLUG}>x</Slab>)
    const el = container.firstElementChild as HTMLElement
    // Slab does not substitute a fallback colour when the token is missing --
    // it still emits the reference unconditionally. A browser resolving
    // var(--part-not-a-real-part) against a stylesheet that never defines it
    // paints no background at all: a visibly blank block, not a
    // wrong-but-plausible colour standing in for the real one.
    expect(el.style.background).toBe(`var(--part-${BOGUS_SLUG})`)
    expect(el.style.color).toBe(`var(--part-${BOGUS_SLUG}-on)`)
  })
})

describe('PartNumeral', () => {
  test('renders the number, zero-padded to two digits', () => {
    render(<PartNumeral n={3} slug="machine" />)
    expect(screen.getByText('03')).toBeInTheDocument()
  })

  test('renders three digits unpadded past 99', () => {
    render(<PartNumeral n={123} slug="machine" />)
    expect(screen.getByText('123')).toBeInTheDocument()
  })

  test.each(partSlugs)('resolves var(--part-%s) / var(--part-%s-on) mechanically from the slug', (slug) => {
    const { container } = render(<PartNumeral n={1} slug={slug} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.background).toBe(`var(--part-${slug})`)
    expect(el.style.color).toBe(`var(--part-${slug}-on)`)
  })

  test('a slug with no matching token degrades visibly, not silently', () => {
    expect(hasRoleTokenPair(tokensRolesCss, BOGUS_SLUG)).toBe(false)
    const { container } = render(<PartNumeral n={1} slug={BOGUS_SLUG} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.background).toBe(`var(--part-${BOGUS_SLUG})`)
    expect(el.style.color).toBe(`var(--part-${BOGUS_SLUG}-on)`)
  })
})

describe('Eyebrow', () => {
  test('renders its children', () => {
    render(<Eyebrow>Part three · the person · chapter five</Eyebrow>)
    expect(screen.getByText('Part three · the person · chapter five')).toBeInTheDocument()
  })
})
