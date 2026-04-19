import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('design system contracts', () => {
  test('tokens define the semantic layout values that back the normalized website shell', () => {
    const tokens = read('./styles/tokens.css')

    expect(tokens).toContain('--layout-max-width: 1200px;')
    expect(tokens).toContain('--layout-max-width-wide: 1440px;')
    expect(tokens).toContain('--layout-gutter: var(--space-5);')
    expect(tokens).toContain('--layout-gutter-lg: var(--space-6);')
    expect(tokens).toContain('--section-space-y: var(--space-8);')
    expect(tokens).toContain('--section-space-y-lg: var(--space-9);')
    expect(tokens).toContain('--section-intro-gap: var(--space-6);')
    expect(tokens).toContain('--surface-padding-xl: var(--space-7);')
    expect(tokens).toContain('--blog-section-break: 80px;')
    expect(tokens).toContain('--blog-subsection-break: var(--space-7);')
    expect(tokens).toContain('--blog-rule-gap: var(--space-7);')
  })

  test('no active source files still reference the undefined space-12 or space-20 tokens', () => {
    const sources = [
      read('./index.css'),
      read('./components/ui/Surface.tsx'),
      read('./components/landing/Hero.tsx'),
      read('./components/landing/Features.tsx'),
      read('./components/landing/TerminalDemos.tsx'),
    ].join('\n')

    expect(sources).not.toContain('--space-12')
    expect(sources).not.toContain('--space-20')
  })

  test('shared website primitives export the normalized page-container and section-intro surface', () => {
    const primitives = read('./components/site/primitives.tsx')

    expect(primitives).toContain('export function PageContainer')
    expect(primitives).toContain('export function SectionIntro')
    expect(primitives).toContain("max-w-[var(--layout-max-width)]")
    expect(primitives).toContain("max-w-[var(--layout-max-width-wide)]")
    expect(primitives).toContain('px-[var(--layout-gutter)]')
    expect(primitives).toContain('lg:px-[var(--layout-gutter-lg)]')
    expect(primitives).toContain('space-y-[var(--section-intro-gap)]')
  })

  test('preserved landing sections consume the canonical layout primitives', () => {
    const hero = read('./components/landing/Hero.tsx')
    const features = read('./components/landing/Features.tsx')
    const demos = read('./components/landing/TerminalDemos.tsx')

    for (const source of [hero, features, demos]) {
      expect(source).toContain('PageContainer')
      expect(source).toContain('SectionIntro')
    }
  })

  test('legacy docs detail generators consume shared website primitives instead of ad hoc surface composition', () => {
    const commandPage = read('./components/docs/CommandPage.tsx')
    const sdkFunctionPage = read('./components/docs/SdkFunctionPage.tsx')

    for (const source of [commandPage, sdkFunctionPage]) {
      expect(source).toContain('SectionIntro')
      expect(source).toContain('DocsNoteCard')
      expect(source).toContain('BracketLink')
      expect(source).toContain('SurfacePanel')
      expect(source).not.toContain("import { Surface }")
    }
  })

  test('storybook covers the normalized website layout primitives', () => {
    const stories = read('./components/site/PublicPrimitives.stories.tsx')

    expect(stories).toContain('LayoutPrimitives')
    expect(stories).toContain('PageContainer')
    expect(stories).toContain('SectionIntro')
  })
})
