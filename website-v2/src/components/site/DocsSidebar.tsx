import { useLocation } from 'react-router-dom'
import { docsSidebarFamilies, findDocsRouteByPath } from '@/data/publicSite'
import { findDocsContentSection } from '@/docs-content'
import { BracketLink, BracketNavLink, DocsNoteCard, PanelBody } from './primitives'

export function DocsSidebar() {
  const location = useLocation()
  const activeRoute = findDocsRouteByPath(location.pathname)
  const activeContentSection = activeRoute ? findDocsContentSection(activeRoute.slug) : undefined
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
    <aside className="space-y-[var(--panel-gap)] lg:sticky lg:top-24">
      <DocsNoteCard
        label="Start here"
        title="Start with the basics."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          Install Port Daddy, check that it is running, and try the first session loop. The whitepaper is available
          when you want the deeper security and design background.
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

      <nav aria-label="Docs sections" className="space-y-[var(--panel-gap)]">
        <DocsNoteCard
          label="Sections"
          title="Choose the part of the system you need."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            The docs split by job: installation, concepts, daily habits, tutorials, reference architectures, and exact
            command or API pages. Runnable examples live at /examples.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            <BracketNavLink to="/docs" end tone="accent" side="left">
              Overview
            </BracketNavLink>

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
          label="Reference pages"
          title="Jump straight to the exact interface."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            The newer docs families improve reading order. The existing CLI, SDK, MCP, and API pages still matter when
            you need exact interfaces and older reference pages preserved.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
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
