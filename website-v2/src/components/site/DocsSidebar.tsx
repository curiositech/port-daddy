import { useLocation } from 'react-router-dom'
import { docsLifecycleStages, docsPersonae } from '@/data/docs-personae'
import { docsSidebarFamilies, findDocsRouteByPath } from '@/data/publicSite'
import { findDocsContentSection } from '@/docs-content'
import { BracketLink, BracketNavLink, DocsNoteCard, PanelBody } from './primitives'

export function DocsSidebar() {
  const location = useLocation()
  const activeRoute = findDocsRouteByPath(location.pathname)
  const activeContentSection = activeRoute ? findDocsContentSection(activeRoute.slug) : undefined
  const referenceSurfaces: Array<{
    title: string
    href: string
    description: string
    featured?: Array<{ title: string; href: string }>
  }> = [
    {
      title: 'CLI reference',
      href: '/docs/cli',
      description: '40+ commands for sessions, locks, messaging, harbors, and fleet.',
      featured: [
        { title: 'pd begin', href: '/docs/cli/begin' },
        { title: 'pd done', href: '/docs/cli/done' },
        { title: 'pd spawn', href: '/docs/cli/spawn' },
        { title: 'pd fleet', href: '/docs/cli/fleet' },
      ],
    },
    {
      title: 'SDK reference',
      href: '/docs/sdk',
      description: 'TypeScript SDK for embedding Port Daddy in your own tools.',
      featured: [
        { title: 'Sessions', href: '/docs/sdk/sessions' },
        { title: 'Spawn', href: '/docs/sdk/spawn' },
        { title: 'Subscribe', href: '/docs/sdk/subscribe' },
      ],
    },
    {
      title: 'MCP tools',
      href: '/docs/mcp',
      description: 'Tools an MCP agent (Claude, Cursor, Windsurf) can call directly.',
      featured: [
        { title: 'begin_session', href: '/docs/mcp/begin-session' },
        { title: 'spawn', href: '/docs/mcp/spawn' },
        { title: 'salvage', href: '/docs/mcp/salvage' },
      ],
    },
    {
      title: 'REST API',
      href: '/docs/api',
      description: 'HTTP endpoints for direct integration without a SDK.',
    },
    {
      title: 'Decisions',
      href: '/docs/decisions',
      description: 'ADRs — architectural decisions, why they were made, and what was traded off.',
    },
  ]
  const siteSurfaces = [
    { title: 'Mac Preview', href: '/mac-preview' },
    { title: 'Runnable examples', href: '/examples' },
    { title: 'Templates', href: '/agents/templates' },
    { title: 'Skill + MCP', href: '/mac-preview' },
    { title: 'Agents', href: '/agents' },
  ]
  const taskGroups = [
    { title: 'Install', href: '/docs/get-started' },
    { title: 'Understand primitives', href: '/docs/concepts/primitives' },
    { title: 'Coordinate work', href: '/docs/best-practices/coordination-discipline' },
    { title: 'Choose an architecture', href: '/docs/reference-architectures' },
    { title: 'Integrate SDK/MCP', href: '/docs/reference/mcp-tool-surface' },
    { title: 'Reference', href: '/docs/reference' },
  ]
  const systemMap = [
    {
      title: 'Primitives',
      href: '/docs/concepts/primitives',
      description: 'Name the small runtime facts: identity, ownership, messaging, recovery, verification, and human control.',
    },
    {
      title: 'Reference Architectures',
      href: '/docs/reference-architectures',
      description: 'Arrange those primitives into local control planes, automation loops, and delegation surfaces.',
    },
    {
      title: 'Mac Preview',
      href: '/mac-preview',
      description: 'See FleetBar and Fleet Control Center as the human inspection surface for the same state.',
    },
    {
      title: 'Skill + MCP',
      href: '/mac-preview',
      description: 'Install the agent operating guide and expose the same coordination primitives through MCP tools.',
    },
    {
      title: 'Reference',
      href: '/docs/reference',
      description: 'Jump from the model to exact CLI commands, SDK calls, MCP tools, HTTP routes, and capability scopes.',
    },
  ]

  return (
    <aside className="space-y-[var(--panel-gap)] lg:sticky lg:top-24">
      <DocsNoteCard
        label="Start here"
        title="One canonical first run."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          Install Port Daddy, verify daemon truth, open the app, and create one named session before branching into
          lifecycle, role, or reference docs.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          <BracketLink to="/whitepaper" tone="blue" side="left">
            Whitepaper
          </BracketLink>
          <BracketLink to="/docs/get-started" tone="accent" side="right">
            Get started
          </BracketLink>
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="Common jobs"
        title="Pick the question, then the surface."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <div className="flex flex-col gap-[var(--space-2)]">
          {taskGroups.map((task, index) => (
            <BracketNavLink
              key={task.href}
              to={task.href}
              tone={index % 2 === 0 ? 'blue' : 'accent'}
              side={index % 2 === 0 ? 'left' : 'right'}
            >
              {task.title}
            </BracketNavLink>
          ))}
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="System map"
        title="Model, layout, app, agent, reference."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          Read this path when the new Primitives and Reference Architectures pages need to line up with the Mac app,
          Skill + MCP, and exact reference surfaces.
        </PanelBody>
        <div className="flex flex-col gap-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          {systemMap.map((surface, index) => (
            <div key={surface.title} className="flex flex-col gap-[var(--space-1)]">
              <BracketNavLink
                to={surface.href}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {surface.title}
              </BracketNavLink>
              <p className="px-[var(--space-2)] text-[length:var(--type-meta-size)] leading-snug text-[var(--text-quiet)]">
                {surface.description}
              </p>
            </div>
          ))}
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="Reference"
        title="Jump straight to the exact interface."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          When you know what you want — a command, an SDK method, an MCP tool, or an HTTP endpoint.
        </PanelBody>
        <div className="flex flex-col gap-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          {referenceSurfaces.map((surface, index) => (
            <div key={surface.title} className="flex flex-col gap-[var(--space-1)]">
              <BracketNavLink
                to={surface.href}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {surface.title}
              </BracketNavLink>
              <p className="px-[var(--space-2)] text-[length:var(--type-meta-size)] leading-snug text-[var(--text-quiet)]">
                {surface.description}
              </p>
              {surface.featured ? (
                <ul className="flex flex-wrap gap-[var(--space-2)] px-[var(--space-2)] pt-[var(--space-1)]">
                  {surface.featured.map((item) => (
                    <li key={item.href}>
                      <BracketLink
                        to={item.href}
                        tone={index % 2 === 0 ? 'accent' : 'blue'}
                        side="left"
                      >
                        {item.title}
                      </BracketLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </DocsNoteCard>

      <DocsNoteCard
        label="By role"
        title="Reader lanes"
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          First-timers, CLI operators, SDK/MCP builders, Mac operators, leads, and security owners have different
          first questions.
        </PanelBody>
        <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          {docsPersonae.slice(0, 5).map((persona, index) => (
            <BracketNavLink
              key={persona.slug}
              to="/docs/personae"
              tone={index % 2 === 0 ? 'blue' : 'accent'}
              side={index % 2 === 0 ? 'right' : 'left'}
            >
              {persona.shortName}
            </BracketNavLink>
          ))}
        </div>
      </DocsNoteCard>

      <nav aria-label="Docs sections" className="space-y-[var(--panel-gap)]">
        <DocsNoteCard
          label="Lifecycle"
          title="Move by stage."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            These stages route the main developer lifecycle before the reader dives into exact commands or API calls.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            <BracketNavLink to="/docs" end tone="accent" side="left">
              Overview
            </BracketNavLink>

            {docsLifecycleStages.map((stage, index) => (
              <BracketNavLink
                key={stage.slug}
                to={`/docs/lifecycle/${stage.slug}`}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'right' : 'left'}
              >
                {stage.title}
              </BracketNavLink>
            ))}
          </div>
        </DocsNoteCard>

        <DocsNoteCard
          label="Sections"
          title="Deeper docs families."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Use these when the job lane is clear and you need the system model, practices, tutorials, architectures, or
            exact interfaces.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {docsSidebarFamilies.map((section, index) => (
              <BracketNavLink
                key={section.slug}
                to={section.path}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'right' : 'left'}
              >
                {section.title}
              </BracketNavLink>
            ))}
          </div>
        </DocsNoteCard>

        <DocsNoteCard
          label="Main site"
          title="The rest of the website stays live."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Use the docs shell for deep reading, then jump back to the Mac preview, runnable examples, agent templates,
            Skill + MCP, or agent catalog when the broader public site is the right place.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {siteSurfaces.map((surface, index) => (
              <BracketNavLink
                key={surface.title}
                to={surface.href}
                tone={index % 2 === 0 ? 'accent' : 'blue'}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {surface.title}
              </BracketNavLink>
            ))}
          </div>
        </DocsNoteCard>
      </nav>

      {activeRoute && activeContentSection ? (
        <DocsNoteCard
          label={activeRoute.title}
          title="Pages in this section"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Go straight to the page that matches the question in front of you.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {activeContentSection.pages.map((page, index) => (
              <BracketNavLink
                key={page.slug}
                to={`${activeRoute.path}/${page.slug}`}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'right' : 'left'}
              >
                {page.title}
              </BracketNavLink>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}
    </aside>
  )
}
