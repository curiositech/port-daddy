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
        title="Read the protocol. Bring up the daemon. Learn the operating model."
        summary="These docs are for engineers evaluating whether Port Daddy can keep real multi-agent repo work legible, governable, and worth trusting."
        paragraphs={[
          'Start with the whitepaper if you need the trust boundary, the governance argument, and the line between cryptographic guarantees and host-level reality.',
          'Move into get started once you want a live daemon on your machine. From there, use concepts and best practices to understand the model and the operator loop, then drop into examples, tutorials, reference architectures, and reference when you need exact workflows or surfaces.',
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
          title="Trust boundary first. Workflows second."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Start with the papers and get started. After that, choose the section that matches the job in front of you
            instead of reading the docs like a linear manual.
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
            Concepts explains the model. Best practices explains the operator discipline. Examples lives at the top
            level because it is runnable code. Tutorials, architectures, and reference stay inside the docs.
          </PanelBody>
        </DocsNoteCard>
      </div>

      <DocsNoteCard
        label="Examples route"
        title="/examples is the runnable path."
        elevation="quiet"
        padding="compact"
      >
        <PanelBody size="compact" className="max-w-none">
          Examples are source-backed working code, so they live outside the docs shell. Use the top-level route for
          swarm coordination, PD Tube tunnel inspection, service discovery, inbox flows, locks, phases, and dev tools
          built on top of the daemon.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          <BracketNavLink to="/examples" tone="accent" side="right">
            Open /examples
          </BracketNavLink>
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="Reference surfaces"
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
