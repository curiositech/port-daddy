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
  'examples',
  'tutorials',
  'reference-architectures',
  'reference',
] as const

const cardSpanClass: Record<(typeof overviewOrder)[number], string> = {
  'get-started': 'xl:col-span-6',
  concepts: 'xl:col-span-4',
  'best-practices': 'xl:col-span-4',
  examples: 'xl:col-span-4',
  tutorials: 'xl:col-span-4',
  'reference-architectures': 'xl:col-span-4',
  reference: 'xl:col-span-4',
}

export default function DocsOverview() {
  const orderedSections = overviewOrder
    .map((slug) => findDocsFamily(slug))
    .filter((section): section is NonNullable<typeof section> => Boolean(section))

  const readingPath = [
    { title: 'Get started', href: '/docs/get-started', tone: 'accent' as const },
    { title: 'Examples', href: '/docs/examples', tone: 'blue' as const },
    { title: 'Tutorials', href: '/docs/tutorials', tone: 'accent' as const },
    { title: 'Concepts', href: '/docs/concepts', tone: 'blue' as const },
    { title: 'Best practices', href: '/docs/best-practices', tone: 'accent' as const },
    { title: 'Reference', href: '/docs/reference', tone: 'blue' as const },
    { title: 'Whitepaper', href: '/whitepaper', tone: 'blue' as const },
  ]
  const referenceSurfaces = [
    { title: 'CLI reference', href: '/docs/cli' },
    { title: 'SDK reference', href: '/docs/sdk' },
    { title: 'MCP tools', href: '/docs/mcp' },
    { title: 'REST API', href: '/docs/api' },
  ]
  const siteSurfaces = [
    { title: 'Mac Preview', href: '/mac-preview' },
    { title: 'Runnable examples', href: '/examples' },
    { title: 'Templates', href: '/templates' },
    { title: 'MCP overview', href: '/mcp' },
    { title: 'Agents', href: '/agents' },
  ]

  return (
    <div className="space-y-[var(--space-6)]">
      <DocsHero
        eyebrow="Documentation"
        title="What Port Daddy is and how to use it."
        summary="Port Daddy is a local app for coordinating AI coding agents. It shows who is working, what files and ports they own, what happened recently, and how to recover work when a run stops."
        paragraphs={[
          'These pages explain the basics first: install the app, start the daemon, open the dashboard, and run your first coordinated task.',
          'After that, use Examples and Tutorials for runnable walkthroughs, Best practices for day-to-day habits, Concepts for the model, and Reference for exact commands, APIs, and configuration.',
        ]}
      />

      <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)]">
        <CommandBlock
          title="Install Port Daddy"
          command={heroInstall.command}
          elevation="quiet"
          description="Install the daemon, provision the control plane, and verify the live runtime on your machine."
        />

        <DocsNoteCard
          label="Reading path"
          title="Start here, then jump to what you need."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            New to Port Daddy? Start with Get started. It walks through installation, runtime checks, and the first
            coordination loop on your machine.
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
            Use Examples and Tutorials when you want to see it work. Use Concepts and Best practices when you need the
            why. Use Reference when you need the exact command, API, or configuration field.
          </PanelBody>
        </DocsNoteCard>
      </div>

      <DocsNoteCard
        label="Proof path"
        title="Read the pattern. Run the code. See the daemon state."
        elevation="quiet"
        padding="compact"
      >
        <PanelBody size="compact" className="max-w-none">
          Want to see Port Daddy doing real work? The examples cover agent handoffs, file claims, tunnel sharing,
          service discovery, inbox workflows, locks, phases, and small tools built on top of the local control plane.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          <BracketNavLink to="/docs/examples" tone="blue" side="left">
            Understand the patterns
          </BracketNavLink>
          <BracketNavLink to="/examples" tone="accent" side="right">
            Inspect runnable code
          </BracketNavLink>
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="Reference surfaces"
        title="Need the API? Jump straight to it."
        elevation="quiet"
        padding="compact"
      >
        <PanelBody size="compact" className="max-w-none">
          Once the concept is clear, serious users need the contract: CLI commands, SDK calls, MCP tools, and REST
          endpoints. These references stay close because Port Daddy should be usable from a terminal, an app, an agent,
          or another local developer tool.
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
          The docs shell is for sustained reading. The Mac preview, runnable examples, templates, MCP overview, and
          agent catalog still matter when you are navigating the working product rather than a linear documentation path.
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
