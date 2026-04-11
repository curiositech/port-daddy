import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, X, FileText, Terminal, Code, Cpu, ChevronRight } from 'lucide-react'

interface SearchResult {
  title: string
  href: string
  category: string
  description?: string
  icon: typeof FileText
}

// Search index - all documentation pages
const SEARCH_INDEX: SearchResult[] = [
  // Overview
  { title: 'Introduction', href: '/docs', category: 'Getting Started', icon: FileText, description: 'What is Port Daddy and why use it' },
  { title: 'Quick Start', href: '/docs/quickstart', category: 'Getting Started', icon: FileText, description: 'Get up and running in 5 minutes' },
  { title: 'Ports & Identities', href: '/docs/features/ports', category: 'Getting Started', icon: FileText, description: 'Core concept: semantic identities and deterministic ports' },
  
  // CLI - Ports
  { title: 'pd claim', href: '/docs/cli/claim', category: 'CLI', icon: Terminal, description: 'Claim a port for a service' },
  { title: 'pd release', href: '/docs/cli/release', category: 'CLI', icon: Terminal, description: 'Release a port claim' },
  { title: 'pd find', href: '/docs/cli/find', category: 'CLI', icon: Terminal, description: 'Find assigned port' },
  { title: 'pd services', href: '/docs/cli/services', category: 'CLI', icon: Terminal, description: 'List all services' },
  { title: 'pd scan', href: '/docs/cli/scan', category: 'CLI', icon: Terminal, description: 'Scan directory for services' },
  { title: 'pd up', href: '/docs/cli/up', category: 'CLI', icon: Terminal, description: 'Start all services' },
  { title: 'pd down', href: '/docs/cli/down', category: 'CLI', icon: Terminal, description: 'Stop all services' },
  { title: 'pd status', href: '/docs/cli/status', category: 'CLI', icon: Terminal, description: 'Check daemon status' },
  
  // CLI - Sessions
  { title: 'pd begin', href: '/docs/cli/begin', category: 'CLI', icon: Terminal, description: 'Start a new session' },
  { title: 'pd done', href: '/docs/cli/done', category: 'CLI', icon: Terminal, description: 'Complete a session' },
  { title: 'pd whoami', href: '/docs/cli/whoami', category: 'CLI', icon: Terminal, description: 'Show current identity' },
  { title: 'pd note', href: '/docs/cli/note', category: 'CLI', icon: Terminal, description: 'Add a note' },
  { title: 'pd notes', href: '/docs/cli/notes', category: 'CLI', icon: Terminal, description: 'View notes' },
  
  // CLI - Locks
  { title: 'pd lock acquire', href: '/docs/cli/lock-acquire', category: 'CLI', icon: Terminal, description: 'Acquire a distributed lock' },
  { title: 'pd lock release', href: '/docs/cli/lock-release', category: 'CLI', icon: Terminal, description: 'Release a lock' },
  { title: 'pd with-lock', href: '/docs/cli/with-lock', category: 'CLI', icon: Terminal, description: 'Run command with lock' },
  
  // CLI - Messaging
  { title: 'pd msg', href: '/docs/cli/msg', category: 'CLI', icon: Terminal, description: 'Messaging commands' },
  { title: 'pd pub', href: '/docs/cli/pub', category: 'CLI', icon: Terminal, description: 'Publish a message' },
  { title: 'pd watch', href: '/docs/cli/watch', category: 'CLI', icon: Terminal, description: 'Watch a channel' },
  
  // CLI - Agents
  { title: 'pd spawn', href: '/docs/cli/spawn', category: 'CLI', icon: Terminal, description: 'Spawn an AI agent' },
  { title: 'pd spawned', href: '/docs/cli/spawned', category: 'CLI', icon: Terminal, description: 'List spawned agents' },
  { title: 'pd agent register', href: '/docs/cli/agent-register', category: 'CLI', icon: Terminal, description: 'Register an agent' },
  { title: 'pd salvage', href: '/docs/cli/salvage', category: 'CLI', icon: Terminal, description: 'View salvage queue' },
  { title: 'pd salvage claim', href: '/docs/cli/salvage-claim', category: 'CLI', icon: Terminal, description: 'Claim dead agent work' },
  
  // CLI - Harbors
  { title: 'pd harbor create', href: '/docs/cli/harbor-create', category: 'CLI', icon: Terminal, description: 'Create a harbor' },
  { title: 'pd harbor enter', href: '/docs/cli/harbor-enter', category: 'CLI', icon: Terminal, description: 'Enter a harbor' },
  { title: 'pd harbor leave', href: '/docs/cli/harbor-leave', category: 'CLI', icon: Terminal, description: 'Leave a harbor' },
  { title: 'pd harbors', href: '/docs/cli/harbors', category: 'CLI', icon: Terminal, description: 'List harbors' },
  
  // CLI - DNS
  { title: 'pd dns', href: '/docs/cli/dns', category: 'CLI', icon: Terminal, description: 'DNS commands' },
  
  // CLI - Tunnels
  { title: 'pd tunnel', href: '/docs/cli/tunnel', category: 'CLI', icon: Terminal, description: 'Create a tunnel' },
  { title: 'pd tunnel stop', href: '/docs/cli/tunnel-stop', category: 'CLI', icon: Terminal, description: 'Stop a tunnel' },
  
  // SDK
  { title: 'SDK Overview', href: '/docs/sdk', category: 'SDK', icon: Code, description: 'TypeScript SDK introduction' },
  { title: 'Ports Module', href: '/docs/sdk/ports', category: 'SDK', icon: Code, description: 'claim(), release(), find(), etc.' },
  { title: 'Sessions Module', href: '/docs/sdk/sessions', category: 'SDK', icon: Code, description: 'begin(), done(), whoami(), etc.' },
  { title: 'Locks Module', href: '/docs/sdk/locks', category: 'SDK', icon: Code, description: 'acquire(), release(), withLock()' },
  { title: 'Harbors Module', href: '/docs/sdk/harbors', category: 'SDK', icon: Code, description: 'createHarbor(), enterHarbor(), etc.' },
  
  // MCP
  { title: 'MCP Overview', href: '/docs/mcp', category: 'MCP', icon: Cpu, description: 'Model Context Protocol integration' },
  { title: 'claim_port', href: '/docs/mcp/claim-port', category: 'MCP', icon: Cpu, description: 'MCP tool for claiming ports' },
  { title: 'release_port', href: '/docs/mcp/release-port', category: 'MCP', icon: Cpu, description: 'MCP tool for releasing ports' },
  { title: 'find_port', href: '/docs/mcp/find-port', category: 'MCP', icon: Cpu, description: 'MCP tool for finding ports' },
  { title: 'begin_session', href: '/docs/mcp/begin-session', category: 'MCP', icon: Cpu, description: 'MCP tool for starting sessions' },
  
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
  { title: 'Fleet Agents', href: '/docs/features/fleet', category: 'Features', icon: FileText, description: 'Declarative background agents' },
  { title: 'Activity Timeline', href: '/docs/features/timeline', category: 'Features', icon: FileText, description: 'Audit log and replay' },

  // API
  { title: 'REST API Reference', href: '/docs/api', category: 'API', icon: Code, description: '93 endpoints with curl examples' },
]

type DocsSearchVariant = 'full' | 'compact'

interface DocsSearchProps {
  variant?: DocsSearchVariant
  className?: string
}

const OPEN_EVENT = 'pd-docs-search:open'

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
    ).slice(0, 8) // Limit to 8 results
    
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
    window.addEventListener(OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_EVENT, handleOpen)
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
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-overlay)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--interactive-hover)] transition-all text-sm ${variant === 'full' ? 'w-full' : 'w-[min(36vw,280px)]'} ${className ?? ''}`}
      >
        <Search size={16} />
        <span className="flex-1 text-left">{variant === 'full' ? 'Search documentation...' : 'Search docs...'}</span>
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs font-mono bg-[var(--surface-raised)] rounded border border-[var(--border-subtle)]">
          {shortcut}
        </kbd>
      </button>

      {/* Search Modal — portal to body so it escapes sidebar overflow */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh] p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeSearch}
          />
          
          {/* Search Panel */}
          <div className="relative w-full max-w-xl bg-[var(--surface-raised)] rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-hidden">
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
                  className="p-1 rounded hover:bg-[var(--interactive-hover)] text-[var(--text-muted)]"
                >
                  <X size={16} />
                </button>
              )}
              <kbd className="hidden sm:inline-block px-2 py-1 text-xs font-mono bg-[var(--surface-base)] rounded border border-[var(--border-subtle)] text-[var(--text-muted)]">
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
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
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
                            className="flex w-full items-center gap-2 p-2 rounded-lg hover:bg-[var(--interactive-hover)] transition-colors text-left"
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
                      <div className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
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
                            className={`flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                              isSelected 
                                ? 'bg-[var(--interactive-active)]' 
                                : 'hover:bg-[var(--interactive-hover)]'
                            } w-[calc(100%-1rem)] text-left`}
                          >
                            <Icon size={18} className="text-[var(--text-muted)] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[var(--text-primary)]">
                                {item.title}
                              </div>
                              {item.description && (
                                <div className="text-xs text-[var(--text-muted)] truncate">
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
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-[var(--surface-base)] rounded border border-[var(--border-subtle)]">↑↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-[var(--surface-base)] rounded border border-[var(--border-subtle)]">↵</kbd>
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

export function openDocsSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}
