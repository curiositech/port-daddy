import * as React from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import {
  Terminal, Code, Cpu, Globe, BookOpen,
  ChevronRight, Menu, ExternalLink,
  Home, Search, Layers
} from 'lucide-react'
import { DocsSearch } from './DocsSearch'
import { Nav } from '@/components/landing/Nav'

interface NavItem {
  label: string
  href: string
  badge?: string
}

interface NavSection {
  title: string
  icon: React.ElementType
  items: NavItem[]
}

/* ─────────────────────────────────────────────
 *  Sidebar navigation — ordered by reading path:
 *    1. Overview & Quick Start (what IS this?)
 *    2. Concepts & Features   (what does it DO?)
 *    3. Reference sections     (HOW do I use it?)
 * ───────────────────────────────────────────── */

const NAV_SECTIONS: NavSection[] = [
  // ── 1. Orient the reader ──────────────────
  {
    title: 'Overview',
    icon: BookOpen,
    items: [
      { label: 'What is Port Daddy?', href: '/docs' },
      { label: 'Quick Start', href: '/docs/quickstart' },
    ]
  },

  // ── 2. Concepts & Features ────────────────
  {
    title: 'Concepts',
    icon: Layers,
    items: [
      { label: 'Ports & Identities', href: '/docs/features/ports', badge: 'Core' },
      { label: 'Sessions & Notes', href: '/docs/features/sessions' },
      { label: 'Pub/Sub (Swarm Radio)', href: '/docs/features/radio', badge: 'Core' },
      { label: 'Salvage & Recovery', href: '/docs/features/salvage' },
      { label: 'Harbors (Security)', href: '/docs/features/harbors' },
      { label: 'Semantic DNS', href: '/docs/features/dns' },
      { label: 'Tunnels', href: '/docs/features/tunnels' },
      { label: 'Always-On Avatars', href: '/docs/features/avatars' },
      { label: 'Time-Travel Debug', href: '/docs/features/timeline' },
      { label: 'Remote Harbors', href: '/docs/features/remote', badge: 'Preview' },
      { label: 'Pheromone Trails', href: '/docs/features/pheromone', badge: 'New' },
      { label: 'Fleet Agents', href: '/docs/features/fleet', badge: 'New' },
    ]
  },

  // ── 3. CLI Reference ──────────────────────
  {
    title: 'CLI Reference',
    icon: Terminal,
    items: [
      { label: 'Overview', href: '/docs/cli' },
      // Ports
      { label: 'pd claim', href: '/docs/cli/claim' },
      { label: 'pd release', href: '/docs/cli/release' },
      { label: 'pd find', href: '/docs/cli/find' },
      { label: 'pd services', href: '/docs/cli/services' },
      { label: 'pd scan', href: '/docs/cli/scan' },
      { label: 'pd up', href: '/docs/cli/up' },
      { label: 'pd down', href: '/docs/cli/down' },
      { label: 'pd status', href: '/docs/cli/status' },
      // Sessions
      { label: 'pd begin', href: '/docs/cli/begin' },
      { label: 'pd done', href: '/docs/cli/done' },
      { label: 'pd whoami', href: '/docs/cli/whoami' },
      { label: 'pd note', href: '/docs/cli/note' },
      { label: 'pd notes', href: '/docs/cli/notes' },
      // Locks
      { label: 'pd lock acquire', href: '/docs/cli/lock-acquire' },
      { label: 'pd lock release', href: '/docs/cli/lock-release' },
      { label: 'pd with-lock', href: '/docs/cli/with-lock' },
      // Messaging
      { label: 'pd msg', href: '/docs/cli/msg' },
      { label: 'pd pub', href: '/docs/cli/pub' },
      { label: 'pd watch', href: '/docs/cli/watch' },
      // Agents
      { label: 'pd spawn', href: '/docs/cli/spawn' },
      { label: 'pd spawned', href: '/docs/cli/spawned' },
      { label: 'pd agent register', href: '/docs/cli/agent-register' },
      { label: 'pd salvage', href: '/docs/cli/salvage' },
      { label: 'pd salvage claim', href: '/docs/cli/salvage-claim' },
      // DNS
      { label: 'pd dns', href: '/docs/cli/dns' },
      // Harbors
      { label: 'pd harbor create', href: '/docs/cli/harbor-create' },
      { label: 'pd harbor enter', href: '/docs/cli/harbor-enter' },
      { label: 'pd harbor leave', href: '/docs/cli/harbor-leave' },
      { label: 'pd harbors', href: '/docs/cli/harbors' },
      // Tunnels
      { label: 'pd tunnel', href: '/docs/cli/tunnel' },
      { label: 'pd tunnel stop', href: '/docs/cli/tunnel-stop' },
      // Fleet
      { label: 'pd fleet', href: '/docs/cli/fleet', badge: 'New' },
    ]
  },

  // ── 4. SDK Reference ──────────────────────
  {
    title: 'SDK Reference',
    icon: Code,
    items: [
      { label: 'Overview', href: '/docs/sdk' },
      // Ports
      { label: 'claim()', href: '/docs/sdk/ports' },
      { label: 'release()', href: '/docs/sdk/ports' },
      { label: 'find()', href: '/docs/sdk/ports' },
      { label: 'listServices()', href: '/docs/sdk/ports' },
      { label: 'scanServices()', href: '/docs/sdk/scan-services' },
      { label: 'up()', href: '/docs/sdk/up' },
      { label: 'down()', href: '/docs/sdk/down' },
      { label: 'status()', href: '/docs/sdk/status' },
      // Sessions
      { label: 'begin()', href: '/docs/sdk/sessions' },
      { label: 'done()', href: '/docs/sdk/done-session' },
      { label: 'whoami()', href: '/docs/sdk/whoami' },
      { label: 'addNote()', href: '/docs/sdk/add-note' },
      { label: 'listNotes()', href: '/docs/sdk/list-notes' },
      // Locks
      { label: 'acquire()', href: '/docs/sdk/locks' },
      { label: 'release()', href: '/docs/sdk/release-lock' },
      { label: 'withLock()', href: '/docs/sdk/with-lock' },
      // Messaging
      { label: 'publish()', href: '/docs/sdk/sessions' },
      { label: 'subscribe()', href: '/docs/sdk/subscribe' },
      { label: 'watch()', href: '/docs/sdk/watch' },
      // Harbors
      { label: 'create()', href: '/docs/sdk/harbors' },
      { label: 'enter()', href: '/docs/sdk/harbors' },
      { label: 'leave()', href: '/docs/sdk/leave-harbor' },
      { label: 'list()', href: '/docs/sdk/list-harbors' },
      // DNS
      { label: 'register()', href: '/docs/sdk/dns-register' },
      { label: 'resolve()', href: '/docs/sdk/dns-resolve' },
      // Agents
      { label: 'spawn()', href: '/docs/sdk/spawn' },
      { label: 'listSpawned()', href: '/docs/sdk/list-spawned' },
      { label: 'registerAgent()', href: '/docs/sdk/register-agent' },
      { label: 'salvage()', href: '/docs/sdk/salvage' },
      { label: 'salvageClaim()', href: '/docs/sdk/salvage-claim' },
      // Tunnels
      { label: 'tunnel()', href: '/docs/sdk/tunnel' },
      { label: 'tunnelStop()', href: '/docs/sdk/tunnel-stop' },
    ]
  },

  // ── 5. MCP Reference ─────────────────────
  {
    title: 'MCP Reference',
    icon: Cpu,
    items: [
      { label: 'Overview', href: '/docs/mcp' },
      // Ports
      { label: 'claim_port', href: '/docs/mcp/claim-port' },
      { label: 'release_port', href: '/docs/mcp/release-port' },
      { label: 'find_port', href: '/docs/mcp/find-port' },
      { label: 'list_services', href: '/docs/mcp/list-services' },
      { label: 'scan_services', href: '/docs/mcp/scan-services' },
      { label: 'up', href: '/docs/mcp/up' },
      { label: 'down', href: '/docs/mcp/down' },
      { label: 'status', href: '/docs/mcp/status' },
      // Sessions
      { label: 'begin_session', href: '/docs/mcp/begin-session' },
      { label: 'done_session', href: '/docs/mcp/done-session' },
      { label: 'add_note', href: '/docs/mcp/add-note' },
      { label: 'list_notes', href: '/docs/mcp/list-notes' },
      // Messaging
      { label: 'publish_message', href: '/docs/mcp/publish-message' },
      { label: 'subscribe', href: '/docs/mcp/subscribe' },
      { label: 'watch', href: '/docs/mcp/watch' },
      // Locks
      { label: 'acquire_lock', href: '/docs/mcp/acquire-lock' },
      // Harbors
      { label: 'create_harbor', href: '/docs/mcp/create-harbor' },
      { label: 'leave_harbor', href: '/docs/mcp/leave-harbor' },
      { label: 'list_harbors', href: '/docs/mcp/list-harbors' },
      // DNS
      { label: 'dns_register', href: '/docs/mcp/dns-register' },
      { label: 'dns_resolve', href: '/docs/mcp/dns-resolve' },
      // Agents
      { label: 'spawn_agent', href: '/docs/mcp/spawn-agent' },
      { label: 'list_spawned', href: '/docs/mcp/list-spawned' },
      { label: 'salvage', href: '/docs/mcp/salvage' },
      { label: 'salvage_claim', href: '/docs/mcp/salvage-claim' },
      // Tunnels
      { label: 'tunnel', href: '/docs/mcp/tunnel' },
      { label: 'tunnel_stop', href: '/docs/mcp/tunnel-stop' },
    ]
  },

  // ── 6. API Reference ─────────────────────
  {
    title: 'API Reference',
    icon: Globe,
    items: [
      { label: 'Overview', href: '/docs/api' },
      { label: 'Endpoints', href: '/docs/api/endpoints' },
    ]
  },
]

function SidebarItem({ 
  label, 
  href, 
  badge,
  isActive 
}: { 
  label: string
  href: string
  badge?: string
  isActive: boolean
}) {
  return (
    <Link
      to={href}
      className={`group flex items-center justify-between py-1.5 px-3 rounded-md text-sm transition-colors ${
        isActive 
          ? 'bg-[var(--interactive-active)] text-[var(--brand-primary)] font-medium' 
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)]'
      }`}
    >
      <span className="truncate">{label}</span>
      {badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
          badge === 'New' 
            ? 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)]' 
            : badge === 'Core'
            ? 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
            : 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]'
        }`}>
          {badge}
        </span>
      )}
    </Link>
  )
}

function SidebarSection({ 
  section,
  currentPath
}: { 
  section: NavSection
  currentPath: string
}) {
  const [isOpen, setIsOpen] = React.useState(() => {
    return section.items.some(item => currentPath === item.href || currentPath.startsWith(item.href + '/'))
  })

  const Icon = section.icon

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 py-2 px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--interactive-hover)] rounded-md transition-colors"
      >
        <Icon size={16} className="text-[var(--text-muted)]" />
        <span className="flex-1 text-left">{section.title}</span>
        <ChevronRight 
          size={14} 
          className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      
      {isOpen && (
        <div className="mt-1 ml-2 pl-4 border-l border-[var(--border-subtle)] space-y-0.5 max-h-64 overflow-y-auto">
          {section.items.map(item => (
            <SidebarItem
              key={item.href}
              {...item}
              isActive={currentPath === item.href || currentPath.startsWith(item.href + '/')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface TocHeading {
  id: string
  text: string
  level: number
}

function TableOfContents({ pathname }: { pathname: string }) {
  const [headings, setHeadings] = React.useState<TocHeading[]>([])
  const [activeId, setActiveId] = React.useState<string>('')

  // Extract headings from the rendered page content
  React.useEffect(() => {
    // Small delay to let Outlet content render
    const timer = setTimeout(() => {
      const mainContent = document.getElementById('main-content')
      if (!mainContent) return

      const elements = mainContent.querySelectorAll('h2, h3')
      const extracted: TocHeading[] = []

      elements.forEach((el) => {
        const text = el.textContent?.trim() || ''
        if (!text) return

        // Generate an id if the heading doesn't have one
        if (!el.id) {
          el.id = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
        }

        extracted.push({
          id: el.id,
          text,
          level: el.tagName === 'H2' ? 2 : 3,
        })
      })

      setHeadings(extracted)
    }, 100)

    return () => clearTimeout(timer)
  }, [pathname])

  // Track active heading via IntersectionObserver
  React.useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    headings.forEach((h) => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <>
      <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">
        On this page
      </h4>
      <nav className="space-y-1">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className={`block text-sm py-1 transition-colors ${
              h.level === 3 ? 'pl-4' : ''
            } ${
              activeId === h.id
                ? 'text-[var(--brand-primary)] font-medium'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </>
  )
}

export function DocsLayout() {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const location = useLocation()
  const { theme } = useTheme()

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[var(--surface-base)] flex pt-16">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed lg:sticky top-16 left-0 z-50 h-[calc(100vh-4rem)] w-72 bg-[var(--surface-raised)] border-r border-[var(--border-subtle)] overflow-y-auto transition-transform lg:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
        <div className="p-4">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-4 px-2">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center">
                <img
                  src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                  alt="Port Daddy"
                  className="h-5 w-auto"
                />
              </div>
              <div>
                <span className="font-semibold text-[var(--text-primary)]">Port Daddy</span>
                <span className="block text-[10px] text-[var(--text-muted)]">Documentation</span>
              </div>
            </Link>
          </div>

          {/* Search */}
          <div className="mb-4">
            <DocsSearch />
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            {NAV_SECTIONS.map(section => (
              <SidebarSection 
                key={section.title} 
                section={section}
                currentPath={location.pathname}
              />
            ))}
          </nav>

          {/* Back to Site */}
          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] px-2">
            <Link 
              to="/"
              className="flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
            >
              <Home size={14} />
              Back to Home
            </Link>
          </div>

          {/* Footer Links */}
          <div className="mt-4 px-2 space-y-2">
            <a 
              href="https://github.com/erichowens/port-daddy" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ExternalLink size={14} />
              GitHub
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main id="main-content" className="flex-1 min-w-0">
        {/* Mobile Header */}
        <div className="lg:hidden sticky top-16 z-30 bg-[var(--surface-base)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)] px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-[var(--interactive-hover)]"
          >
            <Menu size={20} className="text-[var(--text-secondary)]" />
          </button>
          <span className="flex-1 font-semibold text-[var(--text-primary)]">Documentation</span>
          <button 
            onClick={() => {
              const searchBtn = document.querySelector('[data-search-trigger]') as HTMLElement
              searchBtn?.click()
            }}
            className="p-2 rounded-lg hover:bg-[var(--interactive-hover)]"
          >
            <Search size={20} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="max-w-4xl mx-auto px-6 py-8 lg:py-12">
          <Outlet />
        </div>
      </main>

        {/* Right Side - Table of Contents (desktop) */}
        <aside className="hidden xl:block w-64 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--surface-base)]">
          <div className="p-6">
            <TableOfContents pathname={location.pathname} />
          </div>
        </aside>
      </div>
    </>
  )
}
