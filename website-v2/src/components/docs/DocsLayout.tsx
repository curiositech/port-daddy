import * as React from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import {
  Terminal, Code, Cpu, Globe, Zap, BookOpen,
  ChevronRight, Menu, ExternalLink,
  Sparkles, Home, Search
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

// NEW IN 3.7 - at the top
const NEW_COMMANDS: NavItem[] = [
  { label: 'pd spawn', href: '/docs/cli/spawn', badge: 'New' },
  { label: 'pd harbor create', href: '/docs/cli/harbor-create', badge: 'New' },
  { label: 'pd harbor enter', href: '/docs/cli/harbor-enter', badge: 'New' },
  { label: 'pd salvage', href: '/docs/cli/salvage', badge: 'New' },
  { label: 'pd tunnel', href: '/docs/cli/tunnel', badge: 'New' },
  { label: 'pd mcp', href: '/docs/cli/mcp', badge: 'New' },
]

// CLI COMMANDS - organized by category
const CLI_PORTS: NavItem[] = [
  { label: 'pd claim', href: '/docs/cli/claim' },
  { label: 'pd release', href: '/docs/cli/release' },
  { label: 'pd find', href: '/docs/cli/find' },
  { label: 'pd services', href: '/docs/cli/services' },
  { label: 'pd scan', href: '/docs/cli/scan' },
  { label: 'pd up', href: '/docs/cli/up' },
  { label: 'pd down', href: '/docs/cli/down' },
  { label: 'pd status', href: '/docs/cli/status' },
]

const CLI_SESSIONS: NavItem[] = [
  { label: 'pd begin', href: '/docs/cli/begin' },
  { label: 'pd done', href: '/docs/cli/done' },
  { label: 'pd whoami', href: '/docs/cli/whoami' },
  { label: 'pd note', href: '/docs/cli/note' },
  { label: 'pd notes', href: '/docs/cli/notes' },
]

const CLI_LOCKS: NavItem[] = [
  { label: 'pd lock acquire', href: '/docs/cli/lock-acquire' },
  { label: 'pd lock release', href: '/docs/cli/lock-release' },
  { label: 'pd with-lock', href: '/docs/cli/with-lock' },
]

const CLI_MESSAGING: NavItem[] = [
  { label: 'pd msg', href: '/docs/cli/msg' },
  { label: 'pd pub', href: '/docs/cli/pub' },
  { label: 'pd watch', href: '/docs/cli/watch' },
]

const CLI_AGENTS: NavItem[] = [
  { label: 'pd spawn', href: '/docs/cli/spawn', badge: 'New' },
  { label: 'pd spawned', href: '/docs/cli/spawned', badge: 'New' },
  { label: 'pd agent register', href: '/docs/cli/agent-register' },
  { label: 'pd salvage', href: '/docs/cli/salvage', badge: 'New' },
  { label: 'pd salvage claim', href: '/docs/cli/salvage-claim', badge: 'New' },
]

const CLI_DNS: NavItem[] = [
  { label: 'pd dns', href: '/docs/cli/dns' },
]

const CLI_HARBORS: NavItem[] = [
  { label: 'pd harbor create', href: '/docs/cli/harbor-create', badge: 'New' },
  { label: 'pd harbor enter', href: '/docs/cli/harbor-enter', badge: 'New' },
  { label: 'pd harbor leave', href: '/docs/cli/harbor-leave', badge: 'New' },
  { label: 'pd harbors', href: '/docs/cli/harbors', badge: 'New' },
]

const CLI_TUNNELS: NavItem[] = [
  { label: 'pd tunnel', href: '/docs/cli/tunnel', badge: 'New' },
  { label: 'pd tunnel stop', href: '/docs/cli/tunnel-stop', badge: 'New' },
]

// SDK FUNCTIONS - organized by module
const SDK_PORTS: NavItem[] = [
  { label: 'claim()', href: '/docs/sdk/ports' },
  { label: 'release()', href: '/docs/sdk/ports' },
  { label: 'find()', href: '/docs/sdk/ports' },
  { label: 'listServices()', href: '/docs/sdk/ports' },
  { label: 'scanServices()', href: '/docs/sdk/scan-services' },
  { label: 'up()', href: '/docs/sdk/up' },
  { label: 'down()', href: '/docs/sdk/down' },
  { label: 'status()', href: '/docs/sdk/status' },
]

const SDK_SESSIONS: NavItem[] = [
  { label: 'begin()', href: '/docs/sdk/sessions' },
  { label: 'done()', href: '/docs/sdk/done-session' },
  { label: 'whoami()', href: '/docs/sdk/whoami' },
  { label: 'addNote()', href: '/docs/sdk/add-note' },
  { label: 'listNotes()', href: '/docs/sdk/list-notes' },
]

const SDK_LOCKS: NavItem[] = [
  { label: 'acquire()', href: '/docs/sdk/locks' },
  { label: 'release()', href: '/docs/sdk/release-lock' },
  { label: 'withLock()', href: '/docs/sdk/with-lock' },
]

const SDK_MESSAGING: NavItem[] = [
  { label: 'publish()', href: '/docs/sdk/sessions' },
  { label: 'subscribe()', href: '/docs/sdk/subscribe' },
  { label: 'watch()', href: '/docs/sdk/watch' },
]

const SDK_HARBORS: NavItem[] = [
  { label: 'create()', href: '/docs/sdk/harbors' },
  { label: 'enter()', href: '/docs/sdk/harbors' },
  { label: 'leave()', href: '/docs/sdk/leave-harbor' },
  { label: 'list()', href: '/docs/sdk/list-harbors' },
]

const SDK_DNS: NavItem[] = [
  { label: 'register()', href: '/docs/sdk/dns-register' },
  { label: 'resolve()', href: '/docs/sdk/dns-resolve' },
]

const SDK_AGENTS: NavItem[] = [
  { label: 'spawn()', href: '/docs/sdk/spawn', badge: 'New' },
  { label: 'list()', href: '/docs/sdk/list-spawned' },
  { label: 'register()', href: '/docs/sdk/register-agent' },
  { label: 'salvage()', href: '/docs/sdk/salvage' },
  { label: 'salvageClaim()', href: '/docs/sdk/salvage-claim' },
]

const SDK_TUNNELS: NavItem[] = [
  { label: 'tunnel()', href: '/docs/sdk/tunnel' },
  { label: 'tunnelStop()', href: '/docs/sdk/tunnel-stop' },
]

// MCP TOOLS - organized by category
const MCP_PORTS: NavItem[] = [
  { label: 'claim_port', href: '/docs/mcp/claim-port' },
  { label: 'release_port', href: '/docs/mcp/release-port' },
  { label: 'find_port', href: '/docs/mcp/find-port' },
  { label: 'list_services', href: '/docs/mcp/list-services' },
  { label: 'scan_services', href: '/docs/mcp/scan-services' },
  { label: 'up', href: '/docs/mcp/up' },
  { label: 'down', href: '/docs/mcp/down' },
  { label: 'status', href: '/docs/mcp/status' },
]

const MCP_SESSIONS: NavItem[] = [
  { label: 'begin_session', href: '/docs/mcp/begin-session' },
  { label: 'done_session', href: '/docs/mcp/done-session' },
  { label: 'add_note', href: '/docs/mcp/add-note' },
  { label: 'list_notes', href: '/docs/mcp/list-notes' },
]

const MCP_MESSAGING: NavItem[] = [
  { label: 'publish_message', href: '/docs/mcp/publish-message' },
  { label: 'subscribe', href: '/docs/mcp/subscribe' },
  { label: 'watch', href: '/docs/mcp/watch' },
]

const MCP_LOCKS: NavItem[] = [
  { label: 'acquire_lock', href: '/docs/mcp/acquire-lock' },
]

const MCP_HARBORS: NavItem[] = [
  { label: 'create_harbor', href: '/docs/mcp/create-harbor', badge: 'New' },
  { label: 'leave_harbor', href: '/docs/mcp/leave-harbor' },
  { label: 'list_harbors', href: '/docs/mcp/list-harbors' },
]

const MCP_DNS: NavItem[] = [
  { label: 'dns_register', href: '/docs/mcp/dns-register' },
  { label: 'dns_resolve', href: '/docs/mcp/dns-resolve' },
]

const MCP_AGENTS: NavItem[] = [
  { label: 'spawn_agent', href: '/docs/mcp/spawn-agent' },
  { label: 'list_spawned', href: '/docs/mcp/list-spawned' },
  { label: 'salvage', href: '/docs/mcp/salvage' },
  { label: 'salvage_claim', href: '/docs/mcp/salvage-claim' },
]

const MCP_TUNNELS: NavItem[] = [
  { label: 'tunnel', href: '/docs/mcp/tunnel' },
  { label: 'tunnel_stop', href: '/docs/mcp/tunnel-stop' },
]

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Getting Started',
    icon: BookOpen,
    items: [
      { label: 'Introduction', href: '/docs' },
      { label: 'Quick Start', href: '/docs/quickstart' },
      { label: 'Installation', href: '/docs/installation' },
      { label: 'Core Concepts', href: '/docs/concepts' },
    ]
  },
  {
    title: 'New in v3.7',
    icon: Sparkles,
    items: NEW_COMMANDS
  },
  {
    title: 'CLI: Ports',
    icon: Terminal,
    items: CLI_PORTS
  },
  {
    title: 'CLI: Sessions',
    icon: Terminal,
    items: CLI_SESSIONS
  },
  {
    title: 'CLI: Locks',
    icon: Terminal,
    items: CLI_LOCKS
  },
  {
    title: 'CLI: Messaging',
    icon: Terminal,
    items: CLI_MESSAGING
  },
  {
    title: 'CLI: Agents',
    icon: Terminal,
    items: CLI_AGENTS
  },
  {
    title: 'CLI: DNS',
    icon: Terminal,
    items: CLI_DNS
  },
  {
    title: 'CLI: Harbors',
    icon: Terminal,
    items: CLI_HARBORS
  },
  {
    title: 'CLI: Tunnels',
    icon: Terminal,
    items: CLI_TUNNELS
  },
  {
    title: 'SDK: Ports',
    icon: Code,
    items: SDK_PORTS
  },
  {
    title: 'SDK: Sessions',
    icon: Code,
    items: SDK_SESSIONS
  },
  {
    title: 'SDK: Locks',
    icon: Code,
    items: SDK_LOCKS
  },
  {
    title: 'SDK: Messaging',
    icon: Code,
    items: SDK_MESSAGING
  },
  {
    title: 'SDK: Harbors',
    icon: Code,
    items: SDK_HARBORS
  },
  {
    title: 'SDK: DNS',
    icon: Code,
    items: SDK_DNS
  },
  {
    title: 'SDK: Agents',
    icon: Code,
    items: SDK_AGENTS
  },
  {
    title: 'SDK: Tunnels',
    icon: Code,
    items: SDK_TUNNELS
  },
  {
    title: 'MCP: Ports',
    icon: Cpu,
    items: MCP_PORTS
  },
  {
    title: 'MCP: Sessions',
    icon: Cpu,
    items: MCP_SESSIONS
  },
  {
    title: 'MCP: Messaging',
    icon: Cpu,
    items: MCP_MESSAGING
  },
  {
    title: 'MCP: Locks',
    icon: Cpu,
    items: MCP_LOCKS
  },
  {
    title: 'MCP: Harbors',
    icon: Cpu,
    items: MCP_HARBORS
  },
  {
    title: 'MCP: DNS',
    icon: Cpu,
    items: MCP_DNS
  },
  {
    title: 'MCP: Agents',
    icon: Cpu,
    items: MCP_AGENTS
  },
  {
    title: 'MCP: Tunnels',
    icon: Cpu,
    items: MCP_TUNNELS
  },
  {
    title: 'Features',
    icon: Zap,
    items: [
      { label: 'Atomic Ports', href: '/docs/features/ports', badge: 'Core' },
      { label: 'Swarm Radio', href: '/docs/features/radio', badge: 'Core' },
      { label: 'Cryptographic Harbors', href: '/docs/features/harbors', badge: 'New' },
      { label: 'Always-On Avatars', href: '/docs/features/avatars', badge: 'New' },
      { label: 'Self-Healing', href: '/docs/features/salvage', badge: 'New' },
      { label: 'Time-Travel Debug', href: '/docs/features/timeline', badge: 'New' },
      { label: 'Semantic DNS', href: '/docs/features/dns' },
      { label: 'Remote Harbors', href: '/docs/features/remote', badge: 'Preview' },
    ]
  },
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
        <Icon size={16} className="text-[var(--text-tertiary)]" />
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
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
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
      <div className="min-h-screen bg-[var(--bg-base)] flex pt-16">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed lg:sticky top-16 left-0 z-50 h-[calc(100vh-4rem)] w-72 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] overflow-y-auto transition-transform lg:translate-x-0 ${
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
              className="flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)] transition-colors"
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
              className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
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
        <div className="lg:hidden sticky top-16 z-30 bg-[var(--bg-base)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)] px-4 py-3 flex items-center gap-3">
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
        <aside className="hidden xl:block w-64 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)]">
          <div className="p-6">
            <TableOfContents pathname={location.pathname} />
          </div>
        </aside>
      </div>
    </>
  )
}
