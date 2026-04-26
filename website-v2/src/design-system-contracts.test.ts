import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function collectSourceFiles(relativeDir: string): string[] {
  const dirUrl = new URL(relativeDir, import.meta.url)
  const entries = readdirSync(dirUrl)

  return entries.flatMap((entry) => {
    const childRelative = `${relativeDir}/${entry}`
    const childUrl = new URL(childRelative, import.meta.url)
    const stat = statSync(childUrl)

    if (stat.isDirectory()) return collectSourceFiles(childRelative)
    if (!/\.(ts|tsx)$/.test(entry)) return []
    if (/\.stories\.tsx$/.test(entry)) return []

    return [childRelative]
  })
}

describe('design system contracts', () => {
  test('tokens define the semantic layout values that back the normalized website shell', () => {
    const sourceTokens = read('./styles/tokens.source.css')
    const semanticTokens = read('./styles/tokens.semantic.css')
    const roleTokens = read('./styles/tokens.roles.css')

    expect(sourceTokens).toContain('--layout-max-width: 1200px;')
    expect(sourceTokens).toContain('--layout-max-width-wide: 1440px;')
    expect(sourceTokens).toContain('--layout-gutter: var(--space-5);')
    expect(sourceTokens).toContain('--layout-gutter-lg: var(--space-6);')
    expect(sourceTokens).toContain('--section-space-y: var(--space-8);')
    expect(sourceTokens).toContain('--section-space-y-lg: var(--space-9);')
    expect(sourceTokens).toContain('--section-intro-gap: var(--space-6);')
    expect(sourceTokens).toContain('--surface-padding-xl: var(--space-7);')
    expect(sourceTokens).toContain('--blog-section-break: 80px;')
    expect(sourceTokens).toContain('--blog-subsection-break: var(--space-7);')
    expect(sourceTokens).toContain('--blog-rule-gap: var(--space-7);')
    expect(semanticTokens).toContain('--surface-base:')
    expect(semanticTokens).toContain('--text-primary:')
    expect(roleTokens).toContain('--codeblock-bg: var(--code-bg);')
  })

  test('the active token entrypoint preserves the three-layer import order', () => {
    const tokens = read('./styles/tokens.css').trim()

    expect(tokens).toBe([
      '@import "./tokens.source.css";',
      '@import "./tokens.semantic.css";',
      '@import "./tokens.roles.css";',
    ].join('\n'))
  })

  test('protected design-system modules do not introduce raw color literals', () => {
    const protectedFiles = [
      ...collectSourceFiles('./components/ui'),
      ...collectSourceFiles('./components/site'),
      ...collectSourceFiles('./components/docs'),
      ...collectSourceFiles('./lib'),
    ].filter((file) => file !== './components/ui/SignalFlags.tsx')

    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(|oklch\(/

    for (const file of protectedFiles) {
      expect(read(file), `${file} should consume tokenized color roles`).not.toMatch(colorLiteral)
    }
  })

  test('route modules are lazy-loaded instead of bundled through static page imports', () => {
    const mainSource = read('./main.tsx')

    expect(read('./components/layout/RouteFallback.tsx')).toContain('role="status"')
    expect(mainSource).toContain('<Suspense fallback={<RouteFallback />}>')
    expect(mainSource).toContain("const App = lazy(() => import('./App'))")
    expect(mainSource).toContain("import('@/pages/docs/ApiReference')")
    expect(mainSource).toContain('path=":sectionSlug/*"')
    expect(mainSource).not.toMatch(/^import .+ from ['"]@\/pages/m)
    expect(mainSource).not.toMatch(/^import .+ from ['"]\.\/App/m)
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
