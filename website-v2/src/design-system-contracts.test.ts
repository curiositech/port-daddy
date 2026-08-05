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
    expect(sourceTokens).toContain('--section-space-y: var(--space-7);')
    expect(sourceTokens).toContain('--section-space-y-lg: var(--space-8);')
    expect(sourceTokens).toContain('--section-intro-gap: var(--space-6);')
    expect(sourceTokens).toContain('--surface-padding-xl: var(--space-7);')
    expect(sourceTokens).toContain('--blog-section-break: 80px;')
    expect(sourceTokens).toContain('--blog-subsection-break: var(--space-7);')
    expect(sourceTokens).toContain('--blog-rule-gap: var(--space-7);')
    expect(semanticTokens).toContain('--surface-base:')
    expect(semanticTokens).toContain('--text-primary:')
    expect(semanticTokens).toContain('--scrim-backdrop:')
    expect(semanticTokens).toContain('--media-scrim:')
    expect(semanticTokens).toContain('--brand-primary-on-tint:')
    expect(semanticTokens).toContain('--brand-accent-on-tint:')
    expect(semanticTokens).toContain('--status-warning-on-tint:')
    expect(semanticTokens).toContain('--code-channel-scope:')
    expect(semanticTokens).not.toMatch(/#(?:dfff00|e8ff37|d8ff36|a7ff8b)\b/i)
    expect(semanticTokens).toContain('--brand-accent: #006b5f;')
    expect(semanticTokens).toContain('--brand-accent: #8fd0a7;')
    expect(roleTokens).toContain('--codeblock-bg: var(--code-bg);')
    expect(roleTokens).toContain('--bg-scrim: var(--scrim-backdrop);')
    expect(roleTokens).toContain('--bg-media-scrim: var(--media-scrim);')
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

  test('install surface (merged from the retired MCP page) uses shared primitives and tokenized color roles', () => {
    // The standalone /mcp page was retired; its install + skill + MCP story now
    // lives in MacInstallSection on the Mac app page. This contract follows it.
    const install = read('./components/landing/MacInstallSection.tsx')
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(|oklch\(/

    expect(install).toContain("from '@/components/site/primitives'")
    expect(install).toContain('PageContainer')
    expect(install).toContain('SurfacePanel')
    expect(install).toContain('CopyableCommandBlock')
    expect(install).not.toContain('import { Surface }')
    // No raw color literals or inline color styles — tokenized roles only.
    expect(install).not.toMatch(/style=\{\{[^}]*\b(?:color|background|border|boxShadow):/)
    expect(install).not.toMatch(colorLiteral)
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
    expect(blogPage).toContain('Harbor Blog')
    expect(blogPage).not.toMatch(colorLiteral)
  })

  test('blog surfaces stay flat, square, and centralized around post hero metadata', () => {
    const blogSources = [
      read('./pages/BlogPage.tsx'),
      read('./pages/BlogPostPage.tsx'),
      read('./components/blog/BlogComments.tsx'),
    ]
    const joined = blogSources.join('\n')

    expect(joined).not.toContain('const heroImages')
    expect(joined).not.toContain('blur-[')
    expect(joined).not.toContain('linear-gradient')
    expect(joined).not.toContain('group-hover:scale')
    expect(joined).not.toContain('sm:rounded')
    expect(joined).not.toContain('rounded-[')
    expect(joined).not.toContain('rounded-full')
    expect(joined).not.toContain('radius="2xl"')
    expect(joined).not.toContain('Anchor')
    expect(joined).not.toContain('Ship')
    expect(joined).not.toContain('Compass')
    expect(joined).toContain('post.heroImage')
    expect(joined).toContain('post.heroAlt')
  })

  // ---------------------------------------------------------------
  // BRAND.md must agree with tokens.semantic.css
  // ---------------------------------------------------------------
  // The 2026-05-22 fix: docs/design/BRAND.md is the canonical
  // human-readable palette doc — what blog hero prompt engineers,
  // OG-card generators, and outside designers read. The previous
  // failure mode was prose snapshots drifting from the CSS by
  // months while authors kept citing them. This test scans every
  // `--token: #hex` row in BRAND.md's tables and asserts the value
  // matches what tokens.semantic.css declares. If you change a
  // brand color, change BOTH files in the same commit.
  test('docs/design/BRAND.md hex values match tokens.semantic.css', () => {
    const brand = read('../docs/design/BRAND.md')
    const tokens = read('./styles/tokens.semantic.css')

    // Light-theme block ends where the dark-theme block begins.
    const lightThemeBlock = tokens.split(/\[data-theme='dark'\]/)[0]
    const tokenLineRe = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g

    const tokenLightHex = new Map<string, string>()
    for (const match of lightThemeBlock.matchAll(tokenLineRe)) {
      tokenLightHex.set(match[1], match[2].toLowerCase())
    }

    const darkThemeMatch = tokens.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)
    const tokenDarkHex = new Map<string, string>()
    if (darkThemeMatch) {
      for (const match of darkThemeMatch[1].matchAll(tokenLineRe)) {
        tokenDarkHex.set(match[1], match[2].toLowerCase())
      }
    }

    // BRAND.md table rows: `| \`--token\` | \`#hex\` | ... |`
    // First table = light, second = dark. Split on "### Dark theme".
    const [lightSection, darkSection = ''] = brand.split(/^### Dark theme/m)
    const tableRowRe = /\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(#[0-9a-fA-F]{3,8})`\s*\|/g

    const lightMismatches: string[] = []
    for (const match of lightSection.matchAll(tableRowRe)) {
      const [, token, hex] = match
      const docHex = hex.toLowerCase()
      const cssHex = tokenLightHex.get(token)
      if (!cssHex) {
        lightMismatches.push(`${token}: BRAND.md (${docHex}) missing from light theme in tokens.semantic.css`)
      } else if (cssHex !== docHex) {
        lightMismatches.push(`${token}: BRAND.md says ${docHex}, tokens.semantic.css light theme has ${cssHex}`)
      }
    }
    expect(
      lightMismatches.length === 0
        ? 'ok'
        : `Light theme drift between BRAND.md and tokens.semantic.css:\n  ${lightMismatches.join('\n  ')}`,
    ).toBe('ok')

    const darkMismatches: string[] = []
    for (const match of darkSection.matchAll(tableRowRe)) {
      const [, token, hex] = match
      const docHex = hex.toLowerCase()
      const cssHex = tokenDarkHex.get(token)
      if (!cssHex) {
        darkMismatches.push(`${token}: BRAND.md (${docHex}) missing from dark theme in tokens.semantic.css`)
      } else if (cssHex !== docHex) {
        darkMismatches.push(`${token}: BRAND.md says ${docHex}, tokens.semantic.css dark theme has ${cssHex}`)
      }
    }
    expect(
      darkMismatches.length === 0
        ? 'ok'
        : `Dark theme drift between BRAND.md and tokens.semantic.css:\n  ${darkMismatches.join('\n  ')}`,
    ).toBe('ok')

    // Sanity floor: at least 10 light-theme tokens documented.
    // Catches an empty/truncated BRAND.md that would silently pass
    // the no-mismatch check above.
    const lightDocCount = Array.from(lightSection.matchAll(/\|\s*`--[a-z0-9-]+`\s*\|\s*`#/g)).length
    expect(lightDocCount).toBeGreaterThanOrEqual(10)
  })

  // ---------------------------------------------------------------
  // Spacing system contract — landing components
  // ---------------------------------------------------------------
  // The Gestalt audit (2026-05-21) found 13 distinct spacing values
  // in use, breaking the ≤3-level mandate. Most usage already went
  // through the --space-N tokens (--space-0..10 = 0/4/8/12/16/24/32/
  // 48/64/96/128). The offenders were two off-scale slipups:
  //   - Features.tsx:290           gap-5         (= 20px, not in scale)
  //   - TerminalDemos.tsx:183      ml-[22px]     (arbitrary px)
  // This test pins the landing components to the token scale so the
  // next 20px-arbitrary regression fails CI before it ships.
  //
  // Allowed escapes:
  //   - mt-[0.45em] and similar em-relative inline-bullet alignment
  //     (these are font-relative, not px-rigid)
  //   - 0px / 2px borders, which are border-width concerns not spacing
  //   - The reduced-motion / scroll-snap utilities don't apply here
  test('landing components only use --space-N tokens for px-level spacing', () => {
    const landingDir = './components/landing'
    const files = collectSourceFiles(landingDir)
    // Only the components currently mounted by App.tsx — other
    // landing modules in the directory may be dead/legacy code we
    // haven't cleaned up. The contract applies to what ships.
    const mounted = [
      'Hero.tsx',
      'TerminalDemos.tsx',
      'CoordinationEnforcementSection.tsx',
      'AgentConversationSection.tsx',
      'TubeShowcase.tsx',
      'AgenticSocialProofSection.tsx',
      'Features.tsx',
      'CTABanner.tsx',
    ]
    const live = files.filter((path) =>
      mounted.some((name) => path.endsWith(name)),
    )
    expect(live.length).toBe(mounted.length)

    // Tailwind numeric escape hatches that bypass the token scale.
    // gap-5 = 20px (not in --space-N), p-5 = 20px, etc.
    const tailwindEscape = /\b(?:gap|p|m|space-y|space-x)-(?:5|7|9|11|13|14|15|17|18|19|20|22|24)\b/
    // Bare-px arbitrary values: gap-[20px], p-[14px], mt-[3px], etc.
    // Excludes em-relative values which are intentional (line-up to
    // baseline / x-height).
    const barePxArbitrary = /\b(?:gap|p|py|px|pt|pb|pl|pr|m|my|mx|mt|mb|ml|mr|space-y|space-x)-\[\d+(?:\.\d+)?px\]/

    // Strip JS/TS comments before matching — explanatory comments
    // routinely quote old (forbidden) class names like `ml-[22px]`
    // to document why they were changed, and those quotes are
    // intentional. The contract is about live JSX, not prose.
    const stripComments = (source: string) =>
      source
        // /* … */ block comments (including JSX {/* … */} which still
        // contain the inner comment as text — the {/* and */} are JSX
        // delimiters but the /* */ is a real JS comment; stripping
        // the /* */ payload covers both forms cleanly)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // // line comments
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

    for (const path of live) {
      const source = stripComments(read(path))
      const tailwindHits = source.match(new RegExp(tailwindEscape.source, 'g')) ?? []
      expect(
        tailwindHits.length === 0
          ? 'ok'
          : `${path} uses off-scale Tailwind spacing: ${tailwindHits.join(', ')}`,
      ).toBe('ok')

      const barePxHits = source.match(new RegExp(barePxArbitrary.source, 'g')) ?? []
      expect(
        barePxHits.length === 0
          ? 'ok'
          : `${path} uses bare-px spacing (use --space-N tokens): ${barePxHits.join(', ')}`,
      ).toBe('ok')
    }
  })
})
