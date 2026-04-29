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
  ]
  const siteSurfaces = [
    { title: 'Home', href: '/' },
    { title: 'MCP overview', href: '/mcp' },
    { title: 'Fleet tutorial', href: '/tutorials/fleet' },
    { title: 'Roadmap', href: '/roadmap' },
    { title: 'Blog', href: '/blog' },
  ]

  return (
    <aside className="space-y-[var(--panel-gap)] lg:sticky lg:top-24">
      <DocsNoteCard
        label="Start here"
        title="Protocol first."
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          Start with the whitepaper and the trust boundary. Once that frame is clear, install the daemon, verify the
          live runtime, and move into the model, operating practice, and reference material as your questions sharpen.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          <BracketLink to="/whitepaper" tone="blue" side="left">
            Whitepaper
          </BracketLink>
          <BracketLink to="/docs/get-started" tone="lime" side="right">
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
            The docs split by job: protocol and trust boundary, installation, concepts, operator practice, examples,
            tutorials, reference architectures, and exact command or API surfaces.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            <BracketNavLink to="/docs" end tone="lime" side="left">
              Overview
            </BracketNavLink>

            {docsSidebarFamilies.map((section, index) => (
              <BracketNavLink
                key={section.slug}
                to={section.path}
                tone={index % 2 === 0 ? 'blue' : 'lime'}
                side={index % 2 === 0 ? 'right' : 'left'}
              >
                {section.title}
              </BracketNavLink>
            ))}
          </div>
        </DocsNoteCard>

        <DocsNoteCard
          label="Reference surfaces"
          title="Jump straight to the exact interface."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            The newer docs families improve reading order. The existing CLI, SDK, MCP, and API pages still matter when
            you need exact interfaces and the old website surface preserved.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {referenceSurfaces.map((surface, index) => (
              <BracketNavLink
                key={surface.href}
                to={surface.href}
                tone={index % 2 === 0 ? 'blue' : 'lime'}
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
            Use the docs shell for deep reading, then jump back to the homepage, the MCP overview, the fleet tutorial,
            the roadmap, or the blog when the broader public site is the right surface.
        </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {siteSurfaces.map((surface, index) => (
              <BracketNavLink
                key={surface.href}
                to={surface.href}
                tone={index % 2 === 0 ? 'lime' : 'blue'}
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
                tone={index % 2 === 0 ? 'blue' : 'lime'}
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
