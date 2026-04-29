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
    { title: 'Mac Preview', href: '/mac-preview' },
    { title: 'Runnable examples', href: '/examples' },
    { title: 'Templates', href: '/templates' },
    { title: 'MCP overview', href: '/mcp' },
    { title: 'Agents', href: '/agents' },
  ]

  return (
    <aside className="space-y-[var(--panel-gap)] lg:sticky lg:top-24">
      <DocsNoteCard
        label="Start here"
        title="New to Port Daddy?"
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <PanelBody size="compact" className="max-w-none">
          Start with Get started. It shows how to install the app, start the daemon, open the dashboard, and run the
          first coordinated task on your machine.
        </PanelBody>
        <div className="flex flex-wrap gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
          <BracketLink to="/docs/get-started" tone="accent" side="left">
            Get started
          </BracketLink>
          <BracketLink to="/docs/examples" tone="blue" side="right">
            Examples
          </BracketLink>
          <BracketLink to="/whitepaper" tone="blue" side="left">
            Whitepaper
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
            The docs split by job: install the app, see it work, learn the model, improve your workflow, or look up an
            exact command, API, or configuration field.
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
          label="Proof path"
          title="From explanation to evidence."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            Read why a pattern exists, then open the runnable code that proves it against the local daemon.
          </PanelBody>
          <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
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
          title="Jump straight to the exact interface."
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelBody size="compact" className="max-w-none">
            When you are ready to build, jump to the contract: CLI commands, SDK calls, MCP tools, and REST endpoints.
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
            Use the docs shell for deep reading, then jump back to the Mac preview, runnable examples, templates, MCP
            overview, or agent catalog when the broader public site is the right surface.
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
