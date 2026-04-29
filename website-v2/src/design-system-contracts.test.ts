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
    expect(primitives).toContain('export function BrandWordmark')
    expect(primitives).not.toContain('<img')
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
    const cta = read('./components/landing/CTABanner.tsx')
    const showcase = read('./components/landing/ControlPlaneShowcase.tsx')

    for (const source of [hero, features, demos, cta]) {
      expect(source).toContain('PageContainer')
    }

    for (const source of [hero, features, demos]) {
      expect(source).toContain('SectionIntro')
    }

    expect(showcase).toContain('SurfacePanel')
    expect(showcase).toContain('BracketLabel')
    expect(showcase).toContain('Single-daemon control plane')
  })

  test('active landing shell stays on the Swiss/editorial primitives instead of ad hoc soft chrome', () => {
    const hero = read('./components/landing/Hero.tsx')
    const features = read('./components/landing/Features.tsx')
    const demos = read('./components/landing/TerminalDemos.tsx')
    const cta = read('./components/landing/CTABanner.tsx')
    const nav = read('./components/landing/Nav.tsx')
    const footer = read('./components/layout/Footer.tsx')
    const siteFooter = read('./components/site/SiteFooter.tsx')
    const showcase = read('./components/landing/ControlPlaneShowcase.tsx')

    expect(hero).toContain('hero-portdaddy.png')
    expect(hero).toContain('SurfacePanel')
    expect(hero).toContain('LandingStatsStrip')
    expect(hero).not.toContain('bg-gradient-to-r')

    expect(showcase).toContain('SurfacePanel')
    expect(showcase).toContain('Representative local runtime')
    expect(showcase).not.toContain('force-directed')

    expect(features).toContain('SurfacePanel')
    expect(features).toContain('BracketLabel')
    expect(features).not.toContain("import { Surface }")

    expect(demos).toContain('SurfacePanel')
    expect(demos).not.toContain('rounded-[var(--radius-lg)]')

    expect(cta).toContain('SurfacePanel')
    expect(cta).not.toContain('rounded-full')

    expect(nav).toContain('BrandWordmark')
    expect(nav).toContain('PageContainer')
    expect(nav).not.toContain('BrandMark')
    expect(nav).not.toContain('rounded-full')

    expect(footer).toContain('SiteFooter')
    expect(siteFooter).toContain('BrandWordmark')
    expect(siteFooter).not.toContain('BrandMark')
    expect(siteFooter).not.toContain('rounded-full')
  })

  test('tutorial shell and active getting-started lesson stay on shared public primitives', () => {
    const tutorialLayout = read('./components/tutorials/TutorialLayout.tsx')
    const tutorialProgress = read('./components/tutorials/TutorialProgress.tsx')
    const reorientationPanel = read('./components/tutorials/ReorientationPanel.tsx')
    const gettingStarted = read('./pages/tutorials/GettingStarted.tsx')
    const fleet = read('./pages/tutorials/Fleet.tsx')
    const dashboard = read('./pages/tutorials/Dashboard.tsx')

    expect(tutorialLayout).toContain('PageContainer')
    expect(tutorialLayout).toContain('BracketLink')
    expect(tutorialLayout).toContain('SurfacePanel')
    expect(tutorialLayout).toContain('max-w-[94rem]')
    expect(tutorialLayout).toContain('prose-p:max-w-[52rem]')
    expect(tutorialLayout).toContain('prose-p:text-[var(--text-primary)]')
    expect(tutorialLayout).not.toContain('rounded-[40px]')
    expect(tutorialLayout).not.toContain('blur-[140px]')
    expect(tutorialLayout).not.toContain("import { Badge }")

    expect(tutorialProgress).toContain('SurfacePanel')
    expect(tutorialProgress).toContain('BracketLabel')
    expect(tutorialProgress).not.toContain("import { Surface }")

    expect(reorientationPanel).toContain('SurfacePanel')
    expect(reorientationPanel).not.toContain('rounded-xl')

    expect(gettingStarted).toContain('CommandBlock')
    expect(gettingStarted).toContain('DocsCodeBlock')
    expect(gettingStarted).toContain('DocsNoteCard')
    expect(gettingStarted).toContain('xl:grid-cols-2')
    expect(gettingStarted).not.toContain("import { Surface }")
    expect(gettingStarted).not.toContain("import { Badge }")

    expect(fleet).toContain('DocsNoteCard')
    expect(fleet).toContain('DocsCodeBlock')
    expect(fleet).toContain('SurfacePanel')
    expect(fleet).toContain('BracketLink')
    expect(fleet).not.toContain("import { Surface }")
    expect(fleet).not.toContain("import { Badge }")
    expect(fleet).not.toContain('text-xs text-[var(--text-secondary)]')

    expect(dashboard).toContain('CommandBlock')
    expect(dashboard).toContain('DocsCodeBlock')
    expect(dashboard).toContain('DocsNoteCard')
    expect(dashboard).toContain('SurfacePanel')
    expect(dashboard).toContain('BracketLink')
    expect(dashboard).not.toContain("import { Surface }")
    expect(dashboard).not.toContain("import { Badge }")
    expect(dashboard).not.toContain("import { CodeBlock }")
  })

  test('dashboard route redirects to the tutorial preview instead of maintaining a second hosted shell', () => {
    const main = read('./main.tsx')
    const dashboard = read('./pages/tutorials/Dashboard.tsx')
    const hero = read('./components/landing/Hero.tsx')
    const showcase = read('./components/landing/ControlPlaneShowcase.tsx')

    expect(main).toContain('<Navigate to="/tutorials/dashboard" replace />')
    expect(main).not.toContain('DashboardPage')
    expect(hero).toContain('hero-portdaddy.png')
    expect(hero).not.toContain('ControlPlaneShowcase')
    expect(dashboard).toContain('ControlPlaneShowcase')
    expect(showcase).toContain('Representative local runtime')
    expect(showcase).toContain('Needs-attention view')
    expect(showcase).toContain('Session notes and mutations')
    expect(dashboard).not.toContain('useDashboardStats')
    expect(dashboard).not.toContain('useActivityStream')
    expect(dashboard).not.toContain('useTimeline')
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
