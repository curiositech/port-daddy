import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, X, FileText, Terminal, Code, Cpu, ChevronRight } from 'lucide-react'
import { ALL_CATEGORIES } from '@/data/mcp'
import { CLI_REFERENCE_ITEMS, SDK_REFERENCE_GROUPS, cliCommandHref, referenceAnchor } from '@/data/referenceCatalog'
import { OPEN_DOCS_SEARCH_EVENT } from './docsSearchEvents'

interface SearchResult {
  title: string
  href: string
  category: string
  description?: string
  icon: typeof FileText
}

const seenMcpTools = new Set<string>()
const MCP_TOOL_SEARCH_RESULTS: SearchResult[] = ALL_CATEGORIES.flatMap((category) => {
  const results: SearchResult[] = []

  for (const tool of category.tools) {
    if (seenMcpTools.has(tool)) continue
    seenMcpTools.add(tool)

    results.push({
      title: tool,
      href: `/docs/mcp#${tool}`,
      category: `MCP: ${category.label}`,
      icon: Cpu,
      description: `${category.description} Function in the ${category.label} MCP category.`,
    })
  }

  return results
})

const CLI_COMMAND_SEARCH_RESULTS: SearchResult[] = CLI_REFERENCE_ITEMS.flatMap((command) => [
  {
    title: command.name,
    href: cliCommandHref(command),
    category: `CLI: ${command.groupTitle}`,
    icon: Terminal,
    description: [
      command.description,
      command.aliases?.length ? `Aliases: ${command.aliases.join(', ')}` : '',
      command.flags?.length ? `Flags: ${command.flags.join(', ')}` : '',
    ].filter(Boolean).join(' '),
  },
  ...command.aliasRoutes.map((alias) => ({
    title: alias.name,
    href: alias.href,
    category: `CLI alias: ${command.groupTitle}`,
    icon: Terminal,
    description: `${alias.name} is an alias for ${command.name}. ${command.description}`,
  })),
])

const SDK_GROUP_SEARCH_RESULTS: SearchResult[] = SDK_REFERENCE_GROUPS.map((group) => ({
  title: `${group.title} SDK Methods`,
  href: group.href ?? `/docs/sdk#${referenceAnchor(group.title)}`,
  category: 'SDK',
  icon: Code,
  description: `${group.description} ${group.items.map((item) => `${item.name}()`).join(', ')}`,
}))

const SDK_METHOD_SEARCH_RESULTS: SearchResult[] = SDK_REFERENCE_GROUPS.flatMap((group) =>
  group.items.map((method) => ({
    title: `${method.name}()`,
    href: `/docs/sdk#${referenceAnchor(method.name)}`,
    category: `SDK: ${group.title}`,
    icon: Code,
    description: method.description,
  })),
)

// Search index - all documentation pages
const SEARCH_INDEX: SearchResult[] = [
  // Overview
  { title: 'Introduction', href: '/docs', category: 'Getting Started', icon: FileText, description: 'What is Port Daddy and why use it' },
  { title: 'Quick Start', href: '/docs/quickstart', category: 'Getting Started', icon: FileText, description: 'Get up and running in 5 minutes' },
  { title: 'Ports & Identities', href: '/docs/features/ports', category: 'Getting Started', icon: FileText, description: 'Core concept: semantic identities and deterministic ports' },
  
  // CLI
  ...CLI_COMMAND_SEARCH_RESULTS,

  // SDK
  { title: 'SDK Overview', href: '/docs/sdk', category: 'SDK', icon: Code, description: 'TypeScript SDK introduction' },
  ...SDK_GROUP_SEARCH_RESULTS,
  ...SDK_METHOD_SEARCH_RESULTS,
  
  // MCP
  { title: 'MCP Overview', href: '/docs/mcp', category: 'MCP', icon: Cpu, description: 'Model Context Protocol integration' },
  ...MCP_TOOL_SEARCH_RESULTS,
  
  // Features
  { title: 'Atomic Ports', href: '/docs/features/ports', category: 'Features', icon: FileText, description: 'Port management system' },
  { title: 'Sessions & Notes', href: '/docs/features/sessions', category: 'Features', icon: FileText, description: 'Agent session lifecycle' },
  { title: 'Swarm Radio', href: '/docs/features/radio', category: 'Features', icon: FileText, description: 'Pub/sub messaging' },
  { title: 'Cryptographic Harbors', href: '/docs/features/harbors', category: 'Features', icon: FileText, description: 'Permission namespaces' },
  { title: 'Semantic DNS', href: '/docs/features/dns', category: 'Features', icon: FileText, description: 'Local DNS resolution' },
  { title: 'Tunnels', href: '/docs/features/tunnels', category: 'Features', icon: FileText, description: 'Public URL exposure' },
  { title: 'Always-On Avatars', href: '/docs/features/avatars', category: 'Features', icon: FileText, description: 'Background agents' },
  { title: 'Self-Healing', href: '/docs/features/salvage', category: 'Features', icon: FileText, description: 'Automatic recovery' },
  { title: 'Pheromone Trails', href: '/docs/features/pheromone', category: 'Features', icon: FileText, description: 'Stigmergic signaling' },
  { title: 'Fleet & GitHub App', href: '/docs/features/fleet', category: 'Features', icon: FileText, description: 'Declarative agents + cloud PR fleet' },
  { title: 'Activity Timeline', href: '/docs/features/timeline', category: 'Features', icon: FileText, description: 'Audit log and replay' },

  // API
  { title: 'REST API Reference', href: '/docs/api', category: 'API', icon: Code, description: '93 endpoints with curl examples' },
]

type DocsSearchVariant = 'full' | 'compact'

interface DocsSearchProps {
  variant?: DocsSearchVariant
  className?: string
}

export function DocsSearch({ variant = 'full', className }: DocsSearchProps) {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl K'

  const openSearch = React.useCallback(() => {
    setIsOpen(true)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const closeSearch = React.useCallback(() => {
    setIsOpen(false)
    setQuery('')
  }, [])

  // Filter results based on query
  React.useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    
    const lowerQuery = query.toLowerCase()
    const filtered = SEARCH_INDEX.filter(item => 
      item.title.toLowerCase().includes(lowerQuery) ||
      item.description?.toLowerCase().includes(lowerQuery) ||
      item.category.toLowerCase().includes(lowerQuery)
    ).slice(0, lowerQuery.includes('mcp') ? 160 : 24)
    
    setResults(filtered)
    setSelectedIndex(0)
  }, [query])

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openSearch()
      }
      
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        closeSearch()
      }
      
      // Arrow navigation
      if (isOpen && results.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % results.length)
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + results.length) % results.length)
        }
        if (e.key === 'Enter' && results[selectedIndex]) {
          navigate(results[selectedIndex].href)
          closeSearch()
        }
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeSearch, isOpen, navigate, openSearch, results, selectedIndex])

  React.useEffect(() => {
    const handleOpen = () => openSearch()
    window.addEventListener(OPEN_DOCS_SEARCH_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_DOCS_SEARCH_EVENT, handleOpen)
  }, [openSearch])

  // Group results by category
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.category]) acc[result.category] = []
    acc[result.category].push(result)
    return acc
  }, {} as Record<string, SearchResult[]>)

  return (
    <>
      {/* Search Trigger Button */}
      <button
        data-search-trigger
        onClick={openSearch}
        className={`flex items-center gap-2 border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] ${variant === 'full' ? 'w-full' : 'w-full min-w-0'} ${className ?? ''}`}
      >
        <Search size={16} />
        <span className="flex-1 truncate whitespace-nowrap text-left">{variant === 'full' ? 'Search documentation...' : 'Search docs...'}</span>
        <kbd className="hidden border border-[var(--border-default)] bg-[var(--surface-base)] px-1.5 py-0.5 font-mono text-[length:var(--type-meta-size)] sm:inline-block">
          {shortcut}
        </kbd>
      </button>

      {/* Search Modal — portal to body so it escapes sidebar overflow */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh] p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-bg-scrim"
            onClick={closeSearch}
          />
          
          {/* Search Panel */}
          <div className="relative w-full max-w-xl overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
              <Search size={20} className="text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search docs, commands, or concepts..."
                className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none text-base"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus()
                  }}
                  className="border border-transparent p-1 text-[var(--text-muted)] hover:border-[var(--border-default)]"
                >
                  <X size={16} />
                </button>
              )}
              <kbd className="hidden border border-[var(--border-default)] bg-[var(--surface-base)] px-2 py-1 font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)] sm:inline-block">
                ESC
              </kbd>
            </div>
            
            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto">
              {results.length === 0 ? (
                query ? (
                  <div className="px-4 py-8 text-center text-[var(--text-muted)]">
                    No results found for "{query}"
                  </div>
                ) : (
                  <div className="px-4 py-6">
                    <p className="text-[length:var(--type-meta-size)] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                      Quick Links
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {SEARCH_INDEX.slice(0, 6).map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.href}
                            onClick={() => {
                              navigate(item.href)
                              closeSearch()
                            }}
                            className="flex w-full items-center gap-2 border border-transparent p-2 text-left transition-colors hover:border-[var(--border-default)]"
                          >
                            <Icon size={16} className="text-[var(--text-muted)]" />
                            <span className="text-sm text-[var(--text-secondary)] truncate">{item.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              ) : (
                <div className="py-2">
                  {Object.entries(groupedResults).map(([category, items]) => (
                    <div key={category}>
                      <div className="px-4 py-2 text-[length:var(--type-meta-size)] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                        {category}
                      </div>
                      {items.map((item) => {
                        const Icon = item.icon
                        const globalIdx = results.indexOf(item)
                        const isSelected = globalIdx === selectedIndex
                        
                        return (
                          <button
                            key={item.href}
                            onClick={() => {
                              navigate(item.href)
                              closeSearch()
                            }}
                            className={`mx-2 flex items-center gap-3 border px-4 py-3 transition-colors ${
                              isSelected 
                                ? 'border-[var(--border-strong)] bg-[var(--interactive-active)]'
                                : 'border-transparent hover:border-[var(--border-default)] hover:bg-[var(--interactive-hover)]'
                            } w-[calc(100%-1rem)] text-left`}
                          >
                            <Icon size={18} className="text-[var(--text-muted)] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[var(--text-primary)]">
                                {item.title}
                              </div>
                              {item.description && (
                                <div className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] truncate">
                                  {item.description}
                                </div>
                              )}
                            </div>
                            <ChevronRight size={16} className="text-[var(--text-muted)]" />
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="border border-[var(--border-default)] bg-[var(--surface-base)] px-1.5 py-0.5">↑↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="border border-[var(--border-default)] bg-[var(--surface-base)] px-1.5 py-0.5">↵</kbd>
                  to select
                </span>
              </div>
              <span>{results.length} results</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
