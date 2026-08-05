import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_SURFACES } from './data/product'
import { docsFamilyOrder, docsOverviewRoute, docsFamilyRoutes, findDocsRouteByPath, findDocsRouteBySlug } from './data/docs-routes'
import { docsFamilies, findDocsFamily } from './data/publicSite'
import { docsContentSections, findDocsContentPage, findDocsContentSection } from './docs-content'

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function readRuntime(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
}

function toLinear(channel: number) {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function contrastRatio(foreground: string, background: string) {
  const [r1, g1, b1] = hexToRgb(foreground).map(toLinear)
  const [r2, g2, b2] = hexToRgb(background).map(toLinear)
  const l1 = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1
  const l2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('public shell contracts', () => {
  test('routed docs shell imports and uses the shared panel primitives', () => {
    const files = [
      {
        path: './components/site/DocsSidebar.tsx',
        required: [
          'BracketNavLink',
          'DocsNoteCard',
          'PanelBody',
          'findDocsContentSection',
          'useLocation',
          'Start here',
          'Sections',
          'Pages in this section',
        ],
        forbidden: [
          /text-\[11px\]/,
          /text-sm leading-\[1\.5\]/,
          /tracking-\[-0\.04em\]/,
          /Read the system/,
          /Technical entry points/,
          /DocsCard/,
        ],
      },
      {
        path: './components/docs/DocsLayout.tsx',
        required: [
          'DocsSidebar',
          'Outlet',
          'DocsFamilyNav',
          'Docs family navigation',
          'docsSidebarFamilies',
          'overflow-hidden',
          'left-1/4',
          'left-1/2',
          'left-3/4',
        ],
        forbidden: [/gap-8/, /px-6 py-10/, /sm:px-8/, /lg:px-10 lg:py-12/],
      },
      {
        path: './pages/docs/DocsOverview.tsx',
        required: [
          'DocsHero',
          'CommandBlock',
          'DocsNoteCard',
          'BracketLink',
          'overviewOrder',
          'What Port Daddy Is And How To Use It',
          'Start here. Read deeper when you need it.',
        ],
        forbidden: [
          /text-\[11px\]/,
          /pl-5/,
          /tracking-\[-0\.05em\]/,
          /tracking-\[-0\.06em\]/,
          /compatibility, or roadmap/,
          /Branch by concern/,
          /Use this route when the goal is technical evaluation/,
          /sectionLinkClass/,
          /After <BracketLink/,
        ],
      },
      {
        path: './pages/docs/DocsSectionPage.tsx',
        required: [
          'DocsHero',
          'DocsModulePanel',
          'DocsNoteCard',
          'DocsCodeBlock',
          'BracketAnchor',
          'BracketNavLink',
          'findDocsContentSection',
          'findDocsContentPage',
          'What this page answers',
          'Section map',
          'scroll-mt-[calc(var(--space-10)+var(--space-6))]',
        ],
        forbidden: [
          /text-\[11px\]/,
          /pl-5/,
          /tracking-\[-0\.05em\]/,
          /tracking-\[-0\.06em\]/,
          /compatibility/,
          /Route focus/,
          /Inside this route/,
          /What you will get/,
          /Availability/,
          /Next in this section/,
          /What you'll do/,
          /What this section covers/,
          /Inside this section/,
          /<pre className=/,
        ],
      },
    ]

    for (const file of files) {
      const source = read(file.path)

      for (const symbol of file.required) {
        expect(source, `${file.path} should use ${symbol}`).toContain(symbol)
      }

      for (const pattern of file.forbidden) {
        expect(source, `${file.path} should not carry ad hoc panel typography: ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  test('whitepaper route truth stays on the current public truth', () => {
    const dataSource = read('./data/publicSite.ts')
    const docsRouteSource = read('./data/docs-routes.ts')
    const mainSource = read('./main.tsx')
    const docsOverview = read('./pages/docs/DocsOverview.tsx')
    const docsSidebar = read('./components/site/DocsSidebar.tsx')

    expect(dataSource).toContain('brew install curiositech/tap/port-daddy && pd setup')
    expect(dataSource).not.toContain('npm install -g port-daddy\\npd setup')
    expect(docsRouteSource).not.toContain("slug: 'whitepaper'")
    expect(docsRouteSource).toContain("slug: 'best-practices'")
    expect(docsRouteSource).not.toContain("truth: 'Compatibility'")
    expect(mainSource).toContain('path=":sectionSlug/*"')
    expect(mainSource).toContain('path="/whitepaper"')
    expect(docsOverview).toContain("href: '/whitepaper'")
    expect(docsSidebar).toContain('to="/whitepaper"')
  })

  test('whitepaper page uses the current editorial layout instead of the old ceremonial hero', () => {
    const whitepaper = read('./pages/whitepaper/index.tsx')
    const paperData = read('./data/whitePapers.ts')

    expect(whitepaper).toContain('Research dossier')
    expect(whitepaper).toContain('The Port Daddy papers.')
    expect(whitepaper).toContain('Available papers')
    expect(whitepaper).toContain('Argument map')
    expect(whitepaper).toContain('Reading order')
    expect(whitepaper).toContain('signed local identity first')
    expect(whitepaper).toContain('useSearchParams')
    expect(whitepaper).toContain('Read guide')
    expect(paperData.indexOf("id: 'anchor-protocol'")).toBeLessThan(paperData.indexOf("id: 'bonded-commons'"))
    expect(whitepaper).not.toContain('White Papers')
    expect(whitepaper).not.toContain('Formal Foundations')
    expect(whitepaper).not.toContain('How the Papers Relate')
    expect(whitepaper).not.toContain('rounded-[28px]')
    expect(whitepaper).not.toContain('shadow-inset')
    expect(whitepaper).not.toContain('Anchor size')
  })

  test('homepage keeps both public papers visible from the landing CTA', () => {
    const cta = read('./components/landing/CTABanner.tsx')
    const paperData = read('./data/whitePapers.ts')

    expect(cta).toContain('WHITE_PAPERS')
    expect(paperData).toContain('The Anchor Protocol')
    expect(paperData).toContain('The Bonded Commons')
    expect(cta).toContain('Read inline')
    expect(cta).toContain('paper.readerHref')
    expect(cta).toContain('paper.pdfPath')
    expect(paperData).toContain('/whitepaper/anchor-protocol')
    expect(paperData).toContain('/whitepaper/bonded-commons')
    expect(paperData).toContain('/whitepaper/anchor-protocol-whitepaper.pdf')
    expect(paperData).toContain('/whitepaper/agent-transactions-whitepaper.pdf')
    expect(cta).toContain('Read both papers')
    // The "Coordination feedback" / "Dogfood restore" sub-panel was
    // stripped intentionally per the 2026-05-20 IA audit — it was
    // internal build-process commentary at the closing CTA, which is
    // exactly when the reader should be converting, not reading about
    // how the page was authored. Tests no longer assert that panel.
    expect(cta).not.toContain('Coordination feedback')
    expect(cta).not.toContain('Dogfood restore')
  })

  test('individual whitepaper pages explain value and embed PDFs inline', () => {
    const mainSource = read('./main.tsx')
    const detailPage = read('./pages/whitepaper/PaperDetailPage.tsx')
    const metadata = read('./data/siteMetadata.ts')
    const seo = read('../scripts/generate-seo-artifacts.mjs')

    expect(mainSource).toContain('path="/whitepaper/:paperSlug"')
    expect(detailPage).toContain('What this paper is saying')
    expect(detailPage).toContain('Why this paper matters')
    expect(detailPage).toContain('Future value')
    expect(detailPage).toContain('Inline PDF reader')
    expect(detailPage).toContain('<iframe')
    expect(detailPage).toContain('paperPdfUrl(paper)')
    expect(metadata).toContain('WHITE_PAPERS.map')
    expect(seo).toContain('/whitepaper/anchor-protocol')
    expect(seo).toContain('/whitepaper/bonded-commons')
  })

  test('docs shell copy points to the public whitepaper without replacement-brand framing', () => {
    const appSource = read('./App.tsx')
    const docsOverview = read('./pages/docs/DocsOverview.tsx')
    const docsSidebar = read('./components/site/DocsSidebar.tsx')
    const header = read('./components/site/SiteHeader.tsx')

    expect(docsOverview).toContain("href: '/whitepaper'")
    expect(docsOverview).toContain('Start with Get Started if you are installing Port Daddy for the first time.')
    expect(docsSidebar).toContain('One canonical first run.')
    expect(docsSidebar).toContain('Whitepaper')
    expect(header).toContain('Port Daddy')
    expect(header).not.toContain('agentsd')
    expect(appSource).not.toContain('/docs/whitepaper')
  })

  test('header and footer preserve current-site reachability from the docs shell', () => {
    const header = read('./components/site/SiteHeader.tsx')
    const footer = read('./components/site/SiteFooter.tsx')

    expect(header).toContain('/mac-preview')
    expect(header).toContain('/examples')
    expect(header).toContain('/agents')
    // Skills+MCP page retired and merged into the Mac app page; no /mcp in nav.
    expect(header).not.toContain("/mcp")
    expect(header).toContain('/pd-tube')
    expect(header).toContain('Tube Playground')
    expect(header).toContain('/blog')
    expect(header).not.toContain('/agents/agent-skill')
    expect(header).toContain('/tutorials')
    expect(header).not.toContain('/roadmap')
    expect(header).toContain('/manifesto')
    expect(header).toContain('Home')
    expect(header).not.toContain('/dashboard')
    expect(header).toContain('Port Daddy')
    expect(header).toContain('Compressed primary navigation')
    expect(header).toContain('!max-w-none')
    expect(header).toContain('inline-flex shrink-0 items-center')
    expect(header).not.toContain('absolute right-0 top-0 h-full w-3')
    expect(footer).not.toContain('/dashboard')
    expect(footer).toContain('/mac-preview')
    expect(footer).toContain('/agents')
    expect(footer).toContain('Install & MCP')
    expect(footer).toContain('Harbor Blog')
    expect(footer).not.toContain('/roadmap')
    expect(footer).toContain('/docs/quickstart')
    expect(footer).toContain('/docs/cli')
    expect(footer).toContain('/docs/sdk')
    expect(footer).toContain('/docs/mcp')
    expect(footer).toContain('/docs/api')
    expect(footer).toContain('/library')
    expect(footer).toContain('/agents/templates')
    expect(footer).toContain('/tutorials')

    const forbidden = [
      /text-\[11px\]/,
      /tracking-\[-0\.06em\]/,
      /text-sm/,
      /\/docs\/security/,
      /\/docs\/operations/,
      /\/docs\/getting-started/,
    ]

    for (const pattern of forbidden) {
      expect(header).not.toMatch(pattern)
      expect(footer).not.toMatch(pattern)
    }
  })

  test('Mac Preview has a top-level console gallery for every Fleet Control Center surface', () => {
    const appSurfaceTitles = APP_SURFACES.map((surface) => surface.title)
    const appSurfaceIds = APP_SURFACES.map((surface) => surface.id)
    const macPreview = read('./pages/MacPreviewPage.tsx')
    const showcase = read('./components/landing/MacAppShowcase.tsx')

    expect(macPreview).toContain('Flow, Roadmap')
    expect(showcase).toContain('Fleet Control Center gallery')
    expect(appSurfaceTitles).toEqual(expect.arrayContaining([
      'Flow',
      'Agents',
      'Roadmap',
      'Resources',
      'Activity',
      'Channels',
      'Inbox',
      'Spawned Runs',
      'Memory',
      'YAML',
      'Shipwright Harbor',
      'Shipwright Focus',
      'Shipwright Simulation',
      'Shipwright Control',
    ]))
    expect(appSurfaceIds).toEqual(expect.arrayContaining([
      'fleet-flow',
      'agents',
      'roadmap',
      'resources',
      'activity',
      'channels',
      'inbox',
      'spawned-runs',
      'memory',
      'yaml',
      'shipwright-harbor',
      'shipwright-focus',
      'shipwright-simulation',
      'shipwright-control',
    ]))
    expect(appSurfaceIds).not.toContain('public-roadmap-page')
  })

  test('docs overview and sidebar keep the broader public site reachable from the docs shell', () => {
    const docsOverview = read('./pages/docs/DocsOverview.tsx')
    const docsSidebar = read('./components/site/DocsSidebar.tsx')

    expect(docsOverview).toContain('Keep the rest of the site in play.')
    expect(docsOverview).not.toContain('/dashboard')
    expect(docsOverview).toContain('/mac-preview')
    expect(docsOverview).toContain('/examples')
    expect(docsOverview).not.toContain('/docs/examples')
    expect(docsOverview).toContain('/agents/templates')
    expect(docsOverview).toContain('/mcp')
    expect(docsOverview).toContain('/agents')
    expect(docsOverview).not.toContain('/roadmap')
    expect(docsSidebar).toContain('The rest of the website stays live.')
    expect(docsSidebar).not.toContain('/dashboard')
    expect(docsSidebar).toContain('/mac-preview')
    expect(docsSidebar).toContain('/examples')
    expect(docsSidebar).not.toContain('/docs/examples')
    expect(docsSidebar).toContain('/agents/templates')
    expect(docsSidebar).toContain('/mcp')
    expect(docsSidebar).toContain('/agents')
    expect(docsSidebar).not.toContain('/roadmap')
  })

  test('docs families stay under /docs while the main router preserves the current site surface', () => {
    const mainSource = read('./main.tsx')

    expect(docsOverviewRoute.path).toBe('/docs')
    expect(docsFamilyOrder).toEqual([
      'get-started',
      'concepts',
      'best-practices',
      'tutorials',
      'reference-architectures',
      'reference',
    ])

    for (const slug of docsFamilyOrder) {
      const route = findDocsRouteBySlug(slug)
      expect(route?.path.startsWith('/docs/')).toBe(true)
      expect(route?.path.split('/')[1]).toBe('docs')
    }

    for (const routePath of [
      'path="/mac-preview"',
      'path="/examples"',
      'path="/mcp"',
      'path="/agents/agent-skill"',
      'path="/templates"',
      'path="/agents/:section"',
      'path="/agents"',
      'path="/tutorials"',
      'path="/blog"',
      'path="/whitepaper"',
      'path="cli"',
      'path="cli/roadmap"',
      'path="sdk"',
      'path="mcp"',
      'path="api"',
      'path="examples/*"',
      'path=":sectionSlug/*"',
    ]) {
      expect(mainSource).toContain(routePath)
    }
    expect(mainSource).not.toContain('path="/roadmap"')
    expect(mainSource).not.toContain('path="/dashboard"')
    expect(mainSource).not.toContain('path="/tutorials/dashboard"')
  })

  test('public docs expose live roadmap feedback without resurrecting the retired roadmap page', () => {
    const cliOverview = read('./pages/docs/CliOverview.tsx')
    const roadmapCommand = read('./pages/docs/cli/RoadmapCommand.tsx')
    const mainSource = read('./main.tsx')

    expect(mainSource).toContain('path="cli/roadmap"')
    expect(mainSource).not.toContain('path="/roadmap"')
    expect(cliOverview).toContain('/docs/cli/roadmap')
    expect(roadmapCommand).toContain('pd roadmap ack <feedbackId>')
    expect(roadmapCommand).toContain('--feedback-status <status>')
    expect(roadmapCommand).toContain('tuple-backed feedback primitive')
    expect(roadmapCommand).toContain('Fleet Control Center')
  })

  test('home page stays on the existing landing composition instead of the replacement shell', () => {
    const appSource = read('./App.tsx')

    expect(appSource).toContain('<Hero />')
    expect(appSource).toContain('<Features />')
    expect(appSource).toContain('<TerminalDemos />')
    expect(appSource).toContain('<CTABanner />')
    expect(appSource).not.toContain('Install agentsd')
    expect(appSource).not.toContain('agentsd.ai')
  })

  test('public copy uses the AI infrastructure evaluator lens without slipping into inside-baseball framing', () => {
    const sources = {
      hero: read('./components/landing/Hero.tsx'),
      conversation: read('./components/landing/AgentConversationSection.tsx'),
      socialProof: read('./components/landing/AgenticSocialProofSection.tsx'),
      enforcement: read('./components/landing/CoordinationEnforcementSection.tsx'),
      about: read('./pages/AboutPage.tsx'),
      blog: read('./pages/BlogPage.tsx'),
      examples: read('./pages/ExamplesPage.tsx'),
      tutorials: read('./pages/TutorialsPage.tsx'),
      metadata: read('./data/siteMetadata.ts'),
      docsRoutes: read('./data/docs-routes.ts'),
      sectionIntros: read('./data/section-intros.ts'),
    }

    expect(sources.hero).toContain('For AI engineering teams')
    expect(sources.hero).toContain('shared-state substrate')
    expect(sources.hero).toContain('Evaluate Mac preview')
    expect(sources.conversation).toContain('Coordination is state agents can read.')
    expect(sources.conversation).toContain('Why AI tooling teams care')
    expect(sources.socialProof).toContain('Dogfood receipts')
    expect(sources.socialProof).toContain('These are not customer testimonials.')
    expect(sources.enforcement).toContain('Operators need the control plane.')
    expect(sources.about).toContain('Why AI Infrastructure Teams Should Care')
    expect(sources.about).toContain('The control plane under')
    expect(sources.blog).toContain('AI infrastructure notes')
    expect(sources.blog).toContain('Engineering notes for agent control planes')
    expect(sources.examples).toContain('Executable local loops for agent products.')
    expect(sources.tutorials).toContain('Learn the control plane like an operator.')
    expect(sources.metadata).toContain('local control plane and shared-state substrate')
    expect(sources.docsRoutes).toContain('AI tooling team')
    expect(sources.sectionIntros).toContain('minimum substrate for running multiple AI agents')

    const combined = Object.values(sources).join('\n')
    const forbiddenPhrases = [
      'Agents coordinate through observable state.',
      'The daemon that keeps',
      'multi-agent chaos in check',
      'About the Maritime Theme',
      'A technical journal for the work Port Daddy is actually doing now',
      'acquisition-grade thesis',
      'Agentic social proof',
      'terminal-only marketing blocks',
      'fixed loopback endpoint',
    ]

    for (const phrase of forbiddenPhrases) {
      expect(combined).not.toContain(phrase)
    }
  })

  test('role glossary tooltips stay layout-inert until hover or focus', () => {
    const roleTerm = read('./components/site/RoleTerm.tsx')

    expect(roleTerm).toContain('hidden w-[min(18rem,calc(100vw-var(--space-6)))]')
    expect(roleTerm).toContain('group-focus-within:block')
    expect(roleTerm).toContain('group-hover:block')
    expect(roleTerm).not.toContain('invisible absolute')
  })

  test('example file path chips wrap instead of forcing mobile page overflow', () => {
    const examplesPage = read('./pages/ExamplesPage.tsx')

    expect(examplesPage).toContain('!block min-w-0 break-all !whitespace-normal')
  })

  test('docs route helpers resolve canonical families and current legacy section slugs', () => {
    expect(findDocsRouteBySlug('get-started')?.path).toBe('/docs/get-started')
    expect(findDocsRouteBySlug('getting-started')?.path).toBe('/docs/get-started')
    expect(findDocsRouteBySlug('operations')?.slug).toBe('best-practices')
    expect(findDocsRouteBySlug('architecture')?.slug).toBe('reference-architectures')
    expect(findDocsRouteBySlug('guides')?.slug).toBe('tutorials')
    expect(findDocsRouteBySlug('examples')).toBeUndefined()
    expect(findDocsRouteBySlug('security')).toBeUndefined()
    expect(findDocsRouteByPath('/docs')?.slug).toBe('overview')
    expect(findDocsRouteByPath('/docs/reference-architectures/harbor-bootstrap')?.slug).toBe('reference-architectures')
    expect(findDocsRouteByPath('/docs/examples/fleet/salvage')).toBeUndefined()
    expect(findDocsFamily('guides')?.title).toBe('Tutorials')
    expect(docsFamilies.map((section) => section.slug)).toEqual([
      'get-started',
      'concepts',
      'best-practices',
      'tutorials',
      'reference-architectures',
      'reference',
    ])
  })

  test('structured docs content is available for canonical leaf pages', () => {
    expect(docsContentSections.map((section) => section.slug)).toEqual([
      'get-started',
      'concepts',
      'best-practices',
      'tutorials',
      'reference-architectures',
      'reference',
    ])
    expect(
      docsFamilyRoutes
        .map((route) => route.slug)
        .filter((slug) => slug !== 'overview')
        .sort(),
    ).toEqual(docsContentSections.map((section) => section.slug).sort())

    expect(findDocsContentSection('get-started')?.pages.map((page) => page.slug)).toEqual([
      'install',
      'verify-runtime',
      'first-coordination-success',
      'stale-daemon-cli-runtime',
    ])
    expect(findDocsContentSection('concepts')?.pages.map((page) => page.slug)).toEqual([
      'daemon-and-authority',
      'sessions-locks-and-tuples',
      'harbors-and-identity',
      'eleven-product-primitives',
    ])
    expect(findDocsContentSection('best-practices')?.pages.map((page) => page.slug)).toEqual([
      'operator-loop',
      'runtime-truth',
      'coordination-discipline',
      'testing-and-promotion',
      'onboarding-surfaces',
    ])
    expect(findDocsContentSection('examples')).toBeUndefined()
    expect(findDocsContentSection('tutorials')?.pages.map((page) => page.slug)).toEqual([
      'bootstrap-a-project-fleet',
      'recover-a-dead-agent-session',
      'launch-and-inspect-a-spawn',
      'walk-the-eleven-primitives',
      'pd-tube-agent-handoffs',
      'relay-pki-boundary',
    ])
    expect(findDocsContentSection('reference-architectures')?.pages.map((page) => page.slug)).toEqual([
      'single-machine-control-plane',
      'fleet-automation-loop',
      'delegation-surfaces',
    ])
    expect(findDocsContentSection('reference')?.pages.map((page) => page.slug)).toEqual([
      'core-cli-commands',
      'typescript-sdk-surface',
      'mcp-tool-surface',
      'daemon-http-surface',
      'harbor-capabilities-and-scopes',
    ])
    expect(findDocsContentPage('get-started', 'install')?.truth).toBe('source-backed')
    expect(findDocsContentPage('concepts', 'harbors-and-identity')?.truth).toBe('source-backed')
    expect(findDocsContentPage('best-practices', 'onboarding-surfaces')?.truth).toBe('blocked')
    expect(findDocsContentPage('examples', 'exchange-state-through-tuples')).toBeUndefined()
    expect(findDocsContentPage('tutorials', 'launch-and-inspect-a-spawn')?.truth).toBe('source-backed')
    expect(findDocsContentPage('tutorials', 'pd-tube-agent-handoffs')?.truth).toBe('source-backed')
    expect(findDocsContentPage('tutorials', 'relay-pki-boundary')?.truth).toBe('source-backed')
    expect(findDocsContentPage('reference-architectures', 'delegation-surfaces')?.truth).toBe('source-backed')
    expect(findDocsContentPage('reference', 'daemon-http-surface')?.truth).toBe('source-backed')
  })

  test('every docs content page starts with real paragraph-first documentation', () => {
    for (const section of docsContentSections) {
      expect(section.pages.length, `${section.slug} should have real leaf pages`).toBeGreaterThan(0)

      for (const page of section.pages) {
        const firstBlock = page.blocks[0]
        expect(firstBlock?.type, `${section.slug}/${page.slug} should start with a paragraph block`).toBe('paragraph')

        if (firstBlock?.type === 'paragraph') {
          const leadParagraphs = firstBlock.paragraphs ?? (firstBlock.text ? [firstBlock.text] : [])
          expect(leadParagraphs.length, `${section.slug}/${page.slug} should open with multiple paragraphs`).toBeGreaterThanOrEqual(2)
        }

        expect(page.blocks.length, `${section.slug}/${page.slug} should have more than one content block`).toBeGreaterThanOrEqual(2)
        expect(page.sources.length, `${section.slug}/${page.slug} should cite repo truth`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  test('brand-primary foreground combinations stay WCAG-safe in both themes', () => {
    const tokens = read('./styles/tokens.semantic.css')

    const lightBrandPrimary = tokens.match(/--brand-primary:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const lightBrandPrimaryForeground = tokens.match(/--brand-primary-foreground:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkThemeMatch = tokens.match(/\[data-theme='dark'\]\s*\{([\s\S]+?)\n\}/)
    const darkBrandPrimary = darkThemeMatch?.[1].match(/--brand-primary:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkBrandPrimaryForeground = darkThemeMatch?.[1].match(/--brand-primary-foreground:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const lightBrandAccent = tokens.match(/--brand-accent:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const lightBrandAccentForeground = tokens.match(/--brand-accent-foreground:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const lightCodeBg = tokens.match(/--code-bg:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const lightCodeText = tokens.match(/--code-text:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkBrandAccent = darkThemeMatch?.[1].match(/--brand-accent:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkBrandAccentForeground = darkThemeMatch?.[1].match(/--brand-accent-foreground:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkCodeBg = darkThemeMatch?.[1].match(/--code-bg:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const darkCodeText = darkThemeMatch?.[1].match(/--code-text:\s*(#[0-9a-fA-F]{6});/)?.[1]

    expect(lightBrandPrimary).toBeTruthy()
    expect(lightBrandPrimaryForeground).toBeTruthy()
    expect(darkBrandPrimary).toBeTruthy()
    expect(darkBrandPrimaryForeground).toBeTruthy()
    expect(lightBrandAccent).toBeTruthy()
    expect(lightBrandAccentForeground).toBeTruthy()
    expect(darkBrandAccent).toBeTruthy()
    expect(darkBrandAccentForeground).toBeTruthy()
    expect(lightCodeBg).toBeTruthy()
    expect(lightCodeText).toBeTruthy()
    expect(darkCodeBg).toBeTruthy()
    expect(darkCodeText).toBeTruthy()

    expect(contrastRatio(lightBrandPrimaryForeground!, lightBrandPrimary!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkBrandPrimaryForeground!, darkBrandPrimary!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(lightBrandAccentForeground!, lightBrandAccent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkBrandAccentForeground!, darkBrandAccent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(lightCodeText!, lightCodeBg!)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(darkCodeText!, darkCodeBg!)).toBeGreaterThanOrEqual(7)
  })

  test('shared panel primitives are token-driven instead of hardcoded to ad hoc spacing', () => {
    const primitives = read('./components/site/primitives.tsx')
    const tokens = read('./styles/tokens.source.css')

    expect(tokens).toContain('--panel-padding:')
    expect(tokens).toContain('--panel-gap:')
    expect(tokens).toContain('--docs-rail-width:')
    expect(tokens).toContain('--type-panel-title-card-size:')
    expect(primitives).toContain('var(--panel-padding)')
    expect(primitives).toContain('var(--panel-gap)')
    expect(primitives).toContain('var(--type-panel-title-card-size)')
    expect(primitives).toContain('DocsHero')
    expect(primitives).toContain('DocsModulePanel')
    expect(primitives).toContain('BracketLink')
    expect(primitives).toContain('DocsNoteCard')
    expect(primitives).toContain('DocsCodeBlock')
    expect(primitives).toContain('BracketAnchor')
    expect(primitives).toContain('BracketNavLink')
    expect(primitives).toContain('CommandTerminal')
    expect(primitives).toContain('SurfaceToneContext')
    expect(primitives).toContain('useSurfaceTone')
    expect(primitives).toContain('LandingSection')
    expect(primitives).toContain('LandingSectionIntro')
    expect(primitives).toContain('LandingProofCard')
    expect(primitives).toContain('LandingStatsStrip')
    expect(primitives).toContain('LandingArchitectureCard')
    expect(primitives).toContain('LandingNarrativeStack')
    expect(primitives).toContain('LandingCommercialCard')
  })

  test('storybook covers the public landing primitives as well as the docs shell primitives', () => {
    const stories = read('./components/site/PublicPrimitives.stories.tsx')

    const required = [
      'LandingSection',
      'LandingSectionIntro',
      'LandingProofCard',
      'LandingStatsStrip',
      'LandingArchitectureCard',
      'LandingCommercialCard',
      'commercialTracks',
      'proofPanels',
      'proofStats',
    ]

    for (const symbol of required) {
      expect(stories, `PublicPrimitives stories should cover ${symbol}`).toContain(symbol)
    }
  })

  test('shared docs code wrapper delegates to the site primitive instead of forking another code surface', () => {
    const docsCodeBlock = read('./components/docs/DocsCodeBlock.tsx')
    const terminal = read('./components/ui/CommandTerminal.tsx')

    expect(docsCodeBlock).toContain("import { DocsCodeBlock as SiteDocsCodeBlock } from '@/components/site/primitives'")
    expect(docsCodeBlock).not.toContain("import { CodeBlock }")
    expect(terminal).toContain('copyable?: boolean')
    expect(terminal).toContain('copyable={copyable}')
  })

  test('public docs copy does not leak maintainer-process language into user-facing pages', () => {
    const sources = [
      read('./components/site/DocsSidebar.tsx'),
      read('./pages/docs/DocsOverview.tsx'),
      read('./pages/docs/DocsSectionPage.tsx'),
      read('./data/docs-routes.ts'),
      read('./docs-content/getStarted.ts'),
      read('./docs-content/bestPractices.ts'),
    ].join('\n')

    const forbiddenPhrases = [
      'Read the system',
      'Technical entry points for evaluating the daemon',
      'Use this route when the goal is technical evaluation',
      'Branch by concern',
      'Route focus',
      'Inside this route',
      'generic documentation sprawl',
      'Why this page says this',
      'Evidence in the repo',
      'public install path',
      'Read the protocol. Bring up the daemon. Learn the operating model.',
      'Trust boundary first. Workflows second.',
    ]

    for (const phrase of forbiddenPhrases) {
      expect(sources).not.toContain(phrase)
    }
  })

  test('runtime browser surfaces do not hardcode the daemon tcp url', () => {
    const runtimeFiles = [
      './hooks/useDaemonData.ts',
      './hooks/useActivityStream.ts',
      './hooks/useTimeline.ts',
      './hooks/useDashboardStats.ts',
      './hooks/useOrchestratorRules.ts',
      './components/viz/WorkflowsTable.tsx',
      './components/tube/tube-transport.ts',
      './lib/daemon-client.ts',
      '../public/demos/pd-tube/mission-control.html',
    ]

    for (const file of runtimeFiles) {
      const source = readRuntime(file)
      expect(source, `${file} should resolve the daemon through shared utilities`).not.toMatch(
        /https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}/,
      )
    }

    const daemonUrlSource = readRuntime('./lib/daemon-url.ts')
    expect(daemonUrlSource).not.toContain('PREFERRED_DAEMON_PORT')
    expect(daemonUrlSource).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}/)
  })
})
