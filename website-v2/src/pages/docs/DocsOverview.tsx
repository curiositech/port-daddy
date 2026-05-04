import {
  BracketLink,
  BracketNavLink,
  CommandBlock,
  DocsCard,
  DocsHero,
  PanelBody,
  DocsNoteCard,
} from '@/components/site/primitives'
import { docsHomepageFamilies, findDocsFamily, heroInstall } from '@/data/publicSite'

const overviewOrder = [
  'get-started',
  'concepts',
  'best-practices',
  'tutorials',
  'reference-architectures',
  'reference',
] as const

const cardSpanClass: Record<(typeof overviewOrder)[number], string> = {
  'get-started': 'xl:col-span-6',
  concepts: 'xl:col-span-4',
  'best-practices': 'xl:col-span-4',
  tutorials: 'xl:col-span-4',
  'reference-architectures': 'xl:col-span-4',
  reference: 'xl:col-span-4',
}

export default function DocsOverview() {
  const orderedSections = overviewOrder
    .map((slug) => findDocsFamily(slug))
    .filter((section): section is NonNullable<typeof section> => Boolean(section))

  const readingPath = [
    { title: 'Whitepaper', href: '/whitepaper', tone: 'blue' as const },
    { title: 'Get started', href: '/docs/get-started', tone: 'accent' as const },
    { title: 'Concepts', href: '/docs/concepts', tone: 'blue' as const },
    { title: 'Best practices', href: '/docs/best-practices', tone: 'accent' as const },
    { title: 'Examples', href: '/examples', tone: 'blue' as const },
    { title: 'Tutorials', href: '/docs/tutorials', tone: 'accent' as const },
    { title: 'Reference', href: '/docs/reference', tone: 'blue' as const },
  ]
  const referenceSurfaces = [
    { title: 'CLI reference', href: '/docs/cli' },
    { title: 'SDK reference', href: '/docs/sdk' },
    { title: 'MCP tools', href: '/docs/mcp' },
    { title: 'REST API', href: '/docs/api' },
    { title: 'Decisions', href: '/docs/decisions' },
  ]
  const siteSurfaces = [
    { title: 'Mac Preview', href: '/mac-preview' },
    { title: 'Runnable examples', href: '/examples' },
    { title: 'Templates', href: '/agents/templates' },
    { title: 'Skill + MCP', href: '/mcp' },
    { title: 'Agents', href: '/agents' },
  ]

  return (
    <div className="space-y-[var(--space-6)]">
      <DocsHero
        eyebrow="Documentation"
        title="What Port Daddy Is And How To Use It"
        summary="Port Daddy is a local app and background service for AI coding agents. It helps agents share context, avoid collisions, recover interrupted work, and show what is happening on your machine."
        paragraphs={[
          'Start with Get Started if you are installing Port Daddy for the first time. It walks through setup, status checks, and the first session loop.',
          'Use Concepts and Best Practices when you want the mental model. Use Examples and Tutorials when you want to run something. Use Reference when you need exact commands, routes, SDK calls, or MCP tools.',
        ]}
      />

      <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)]">
        <CommandBlock
          title="Install Port Daddy"
          command={heroInstall.command}
          elevation="quiet"
          description="Install Port Daddy, start the local service, and open the dashboard on your machine."
        />

        <DocsNoteCard
          label="Reading path"
          title="Start here. Read deeper when you need it."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Start with Get Started and the sections that match the job in front of you. The whitepaper is there when
            you need the deeper security and design background.
          </PanelBody>
          <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {readingPath.map((item, index) => (
              <BracketLink
                key={item.href}
                to={item.href}
                tone={item.tone}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {item.title}
              </BracketLink>
            ))}
          </div>
          <PanelBody size="compact" className="max-w-none">
            Concepts explains the model. Best practices explains the habits. Examples lives at the top level because
            it is runnable code. Tutorials, architectures, and reference stay inside the docs.
          </PanelBody>
        </DocsNoteCard>
      </div>

      <DocsNoteCard
        label="Reference pages"
        title="Keep the exact interfaces one click away."
        elevation="quiet"
        padding="compact"
      >
        <PanelBody size="compact" className="max-w-none">
          The family-based docs improve reading order, but the existing CLI, SDK, MCP, and API references are still
          part of the working site and should stay easy to reach while the docs shell gets better.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          {referenceSurfaces.map((surface, index) => (
            <BracketNavLink
              key={surface.href}
              to={surface.href}
              tone={index % 2 === 0 ? 'blue' : 'accent'}
              side={index % 2 === 0 ? 'left' : 'right'}
            >
              {surface.title}
            </BracketNavLink>
          ))}
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="Broader site"
        title="Keep the rest of the site in play."
        elevation="quiet"
        padding="compact"
      >
        <PanelBody size="compact" className="max-w-none">
          The docs shell is for sustained reading. The Mac preview, runnable examples, agent templates, Skill + MCP,
          and agent catalog still matter when you are navigating the product rather than a linear documentation path.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          {siteSurfaces.map((surface, index) => (
            <BracketNavLink
              key={surface.href}
              to={surface.href}
              tone={index % 2 === 0 ? 'accent' : 'blue'}
              side={index % 2 === 0 ? 'left' : 'right'}
            >
              {surface.title}
            </BracketNavLink>
          ))}
        </div>
      </DocsNoteCard>

      <div className="grid gap-[var(--panel-gap)] md:grid-cols-2 xl:grid-cols-12">
        {(orderedSections.length ? orderedSections : docsHomepageFamilies).map((section, index) => (
          <DocsCard
            key={section.slug}
            kicker={String(index + 1).padStart(2, '0')}
            title={section.title}
            summary={section.summary}
            href={section.path}
            tone={section.tone}
            className={cardSpanClass[section.slug as keyof typeof cardSpanClass]}
          />
        ))}
      </div>
    </div>
  )
}
