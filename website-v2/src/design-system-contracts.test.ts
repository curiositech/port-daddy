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
    expect(sourceTokens).toContain('--layout-grid-columns: 12;')
    expect(sourceTokens).toContain('--layout-grid-gap: var(--space-5);')
    expect(sourceTokens).toContain('--layout-copy-measure: 62ch;')
    expect(sourceTokens).toContain('--section-space-y: var(--space-8);')
    expect(sourceTokens).toContain('--section-space-y-lg: var(--space-9);')
    expect(sourceTokens).toContain('--section-intro-gap: var(--space-6);')
    expect(sourceTokens).toContain('--surface-padding-xl: var(--space-7);')
    expect(sourceTokens).toContain('--blog-section-break: 80px;')
    expect(sourceTokens).toContain('--blog-subsection-break: var(--space-7);')
    expect(sourceTokens).toContain('--blog-rule-gap: var(--space-7);')
    expect(semanticTokens).toContain('--surface-base:')
    expect(semanticTokens).toContain('--text-primary:')
    expect(semanticTokens).toContain('--brand-primary-on-tint:')
    expect(semanticTokens).toContain('--brand-accent-on-tint:')
    expect(semanticTokens).toContain('--status-warning-on-tint:')
    expect(semanticTokens).toContain('--code-channel-scope:')
    expect(semanticTokens).not.toMatch(/#(?:dfff00|e8ff37|d8ff36|a7ff8b)\b/i)
    expect(semanticTokens).toContain('--brand-accent: #006b5f;')
    expect(semanticTokens).toContain('--brand-accent: #8fd0a7;')
    expect(roleTokens).toContain('--codeblock-bg: var(--code-bg);')
    expect(roleTokens).toContain('--grid-columns: var(--layout-grid-columns);')
    expect(roleTokens).toContain('--measure-copy: var(--layout-copy-measure);')
  })

  test('the active token entrypoint preserves the three-layer import order', () => {
    const tokens = read('./styles/tokens.css').trim()

    expect(tokens).toBe([
      '@import "./tokens.source.css";',
      '@import "./tokens.semantic.css";',
      '@import "./tokens.roles.css";',
    ].join('\n'))
  })

  test('legacy relief paths stay flattened across shared website primitives', () => {
    const semanticTokens = read('./styles/tokens.semantic.css')
    const roleTokens = read('./styles/tokens.roles.css')
    const indexCss = read('./index.css')
    const protectedReliefSources = [
      read('./components/ui/Surface.tsx'),
      read('./components/ui/Button.tsx'),
      read('./components/site/primitives.tsx'),
      read('./components/landing/TerminalReplay.tsx'),
      read('./components/landing/HowItWorks.tsx'),
      read('./components/landing/DemoGallery.tsx'),
      read('./components/landing/HarborViz.tsx'),
    ].join('\n')

    expect(semanticTokens.match(/--shadow-raised: none;/g)).toHaveLength(2)
    expect(semanticTokens.match(/--shadow-inset: none;/g)).toHaveLength(2)
    expect(semanticTokens.match(/--shadow-sm: none;/g)).toHaveLength(2)
    expect(semanticTokens.match(/--shadow-flat: none;/g)).toHaveLength(2)
    expect(semanticTokens.match(/--shadow-pressed: none;/g)).toHaveLength(2)
    expect(roleTokens).not.toContain('shadow-neu')
    expect(indexCss).toContain('--tw-shadow: 0 0 #0000 !important;')
    expect(indexCss).toContain('--tw-blur: blur(0) !important;')
    expect(indexCss).toContain('backdrop-filter: none !important;')
    expect(indexCss).not.toContain('Neumorphic')
    expect(indexCss).not.toContain('.neu-inset')
    expect(protectedReliefSources).not.toContain('neu-shadow')
    expect(protectedReliefSources).not.toContain('neu-highlight')
    expect(protectedReliefSources).not.toContain('translate(3px, 3px)')
    expect(protectedReliefSources).not.toContain('drop-shadow')
    expect(protectedReliefSources).not.toContain('0 0 20px')
    expect(protectedReliefSources).not.toMatch(/inset 1px|inset 2px/)
  })

  test('protected design-system modules do not introduce raw color literals', () => {
    const protectedFiles = [
      ...collectSourceFiles('./components/ui'),
      ...collectSourceFiles('./components/site'),
      ...collectSourceFiles('./components/layout'),
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
    expect(primitives).toContain('export function SwissGrid')
    expect(primitives).toContain('export function SwissGridItem')
    expect(primitives).toContain('export function SectionIntro')
    expect(primitives).toContain("max-w-[var(--layout-max-width)]")
    expect(primitives).toContain("max-w-[var(--layout-max-width-wide)]")
    expect(primitives).toContain('mx-auto w-full min-w-0')
    expect(primitives).toContain('px-[var(--layout-gutter)]')
    expect(primitives).toContain('lg:px-[var(--layout-gutter-lg)]')
    expect(primitives).toContain('lg:grid-cols-12')
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

  test('hero headline emphasis stays inside the brand token system', () => {
    const hero = read('./components/landing/Hero.tsx')

    expect(hero).toContain('text-[var(--brand-primary)]')
    expect(hero).not.toContain('bg-gradient-to-r')
    expect(hero).not.toContain('bg-clip-text')
    expect(hero).not.toContain('text-transparent')
    expect(hero).not.toContain('var(--status-error)')
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

  test('MCP proof route consumes shared primitives and tokenized color roles', () => {
    const mcpPage = read('./pages/MCPPage.tsx')
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(|oklch\(/

    expect(mcpPage).toContain("from '@/components/site/primitives'")
    expect(mcpPage).toContain('PageContainer')
    expect(mcpPage).toContain('SwissGrid')
    expect(mcpPage).toContain('SwissGridItem')
    expect(mcpPage).toContain('SectionIntro')
    expect(mcpPage).toContain('SurfacePanel')
    expect(mcpPage).toContain('DocsCodeBlock')
    expect(mcpPage).toContain('onKeyDown')
    expect(mcpPage).toContain('aria-orientation="vertical"')
    expect(mcpPage).toContain('tabIndex={activeIndex === index ? 0 : -1}')
    expect(mcpPage).toContain("event.key === 'ArrowDown'")
    expect(mcpPage).toContain("event.key === 'End'")
    expect(mcpPage).toContain('focus-visible:outline-[var(--interactive-focus)]')
    expect(mcpPage).not.toContain("import { Surface }")
    expect(mcpPage).not.toContain('grid-cols-[1.05fr,0.95fr]')
    expect(mcpPage).not.toContain('grid-cols-[0.9fr,1.1fr]')
    expect(mcpPage).not.toContain('grid-cols-[1fr,1fr]')
    expect(mcpPage).not.toContain('grid-cols-[1fr,1fr,1.3fr]')
    expect(mcpPage).not.toContain('grid-cols-[18rem,1fr]')
    expect(mcpPage).not.toMatch(/style=\{\{[^}]*\b(?:color|background|border|boxShadow):/)
    expect(mcpPage).not.toMatch(colorLiteral)
  })

  test('storybook covers the normalized website layout primitives', () => {
    const stories = read('./components/site/PublicPrimitives.stories.tsx')

    expect(stories).toContain('LayoutPrimitives')
    expect(stories).toContain('StateMatrix')
    expect(stories).toContain('PageContainer')
    expect(stories).toContain('SwissGrid')
    expect(stories).toContain('SwissGridItem')
    expect(stories).toContain('SectionIntro')
  })

  test('storybook and MCP a11y evidence are wired as release gates', () => {
    const packageJson = read('../package.json')
    const storybookMain = read('../.storybook/main.ts')
    const storybookPreview = read('../.storybook/preview.ts')
    const mcpStory = read('./pages/MCPPage.stories.tsx')
    const a11yScript = read('../scripts/check-mcp-a11y.mjs')
    const stateMatrixStories = [
      read('./components/ui/Button.stories.tsx'),
      read('./components/ui/Badge.stories.tsx'),
      read('./components/ui/Surface.stories.tsx'),
      read('./components/ui/CodeBlock.stories.tsx'),
      read('./components/site/PublicPrimitives.stories.tsx'),
    ]

    expect(packageJson).toContain('"@storybook/addon-a11y": "10.2.19"')
    expect(packageJson).toContain('"test:a11y:mcp": "node scripts/check-mcp-a11y.mjs"')
    expect(storybookMain).toContain("'@storybook/addon-a11y'")
    expect(storybookPreview).toContain("test: 'error'")
    expect(storybookPreview).toContain("'wcag2aaa'")
    expect(storybookPreview).toContain("'color-contrast-enhanced': { enabled: true }")
    expect(mcpStory).toContain("title: 'Pages/MCP Proof Route'")
    expect(mcpStory).toContain('MobileAuditFrame')
    expect(a11yScript).toContain('wcag2aaa')
    expect(a11yScript).toContain('assertNoHorizontalOverflow')
    expect(a11yScript).toContain('runKeyboardChecks')

    for (const source of stateMatrixStories) {
      expect(source).toContain('StateMatrix')
      expect(source).toContain("test: 'error'")
    }
  })

  test('the public shell uses the shared site header and footer instead of the legacy landing shell', () => {
    const mainLayout = read('./components/layout/MainLayout.tsx')
    const app = read('./App.tsx')
    const footer = read('./components/layout/Footer.tsx')
    const headerStory = read('./components/site/SiteHeader.stories.tsx')

    expect(mainLayout).toContain("import { SiteHeader } from '@/components/site/SiteHeader'")
    expect(mainLayout).toContain('<SiteHeader />')
    expect(mainLayout).not.toContain("components/landing/Nav")
    expect(read('./components/site/SiteHeader.tsx')).toContain('data-shell="site-header"')
    expect(app).not.toContain("components/landing/Nav")
    expect(app).not.toContain('<Nav />')
    expect(footer.trim()).toBe("export { SiteFooter as Footer } from '@/components/site/SiteFooter'")
    expect(headerStory).toContain('ShellFrame')
    expect(headerStory).toContain('StateMatrix')
    expect(headerStory).toContain('SiteFooter')
    expect(headerStory).toContain("test: 'error'")
  })

  test('contrast-critical shell surfaces use dedicated high-contrast role tokens', () => {
    const badge = read('./components/ui/Badge.tsx')
    const blogPage = read('./pages/BlogPage.tsx')
    const codeBlock = read('./components/ui/CodeBlock.tsx')
    const primitives = read('./components/site/primitives.tsx')
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(|oklch\(/

    expect(badge).toContain('var(--status-error-on-tint)')
    expect(badge).toContain('var(--brand-accent-on-tint)')
    expect(badge).toContain('var(--status-success-on-tint)')
    expect(badge).toContain('var(--status-warning-on-tint)')
    expect(codeBlock).toContain('var(--code-channel-scope)')
    expect(codeBlock).toContain('var(--code-channel-sep)')
    expect(primitives).not.toContain('className="opacity-80"')
    expect(blogPage).toContain('badgeMeta.background')
    expect(blogPage).not.toMatch(colorLiteral)
  })
})
