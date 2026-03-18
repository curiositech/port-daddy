import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { CLI_COMMANDS, CLI_GROUPS } from '@/data/docs'
import { Copy, Check, Search } from 'lucide-react'

export default function CliOverview() {
  const [copied, setCopied] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const filteredCommands = CLI_COMMANDS.filter(cmd => {
    const matchesSearch = !search || 
      cmd.cmd.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase())
    const matchesGroup = !activeGroup || cmd.group === activeGroup
    return matchesSearch && matchesGroup
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="teal">CLI Reference</Badge>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Command Line Interface
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          Complete reference for the <code className="text-[var(--brand-primary)]">pd</code> CLI. 
          Manage ports, agents, sessions, locks, and more.
        </p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search commands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveGroup(null)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeGroup === null 
                ? 'bg-[var(--brand-primary)] text-[var(--brand-on-primary)]' 
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-default)]'
            }`}
          >
            All
          </button>
          {CLI_GROUPS.map(group => (
            <button
              key={group}
              onClick={() => setActiveGroup(group)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeGroup === group 
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-on-primary)]' 
                  : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-default)]'
              }`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {/* Commands */}
      <div className="space-y-4">
        {filteredCommands.map((cmd, i) => (
          <div 
            key={i}
            className="p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <code className="text-lg font-mono text-[var(--brand-primary)]">{cmd.cmd}</code>
                  {cmd.short && (
                    <code className="text-sm font-mono text-[var(--text-muted)]">({cmd.short})</code>
                  )}
                  <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg-overlay)] text-[var(--text-muted)]">
                    {cmd.group}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleCopy(cmd.example, `cmd-${i}`)}
                className="p-2 rounded-lg hover:bg-[var(--interactive-hover)] text-[var(--text-muted)] transition-colors"
              >
                {copied === `cmd-${i}` ? <Check size={16} className="text-[var(--success)]" /> : <Copy size={16} />}
              </button>
            </div>
            
            <p className="text-[var(--text-secondary)] mb-4 leading-relaxed">{cmd.description}</p>
            
            {/* Example */}
            <div className="mb-4">
              <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Example</div>
              <div className="p-3 rounded-lg bg-[var(--bg-code)] font-mono text-sm overflow-x-auto">
                <code className="text-[var(--text-secondary)]">{cmd.example}</code>
              </div>
            </div>
            
            {/* Flags */}
            {cmd.flags && cmd.flags.length > 0 && (
              <div>
                <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Flags</div>
                <ul className="space-y-1">
                  {cmd.flags.map((flag, j) => (
                    <li key={j} className="text-sm font-mono text-[var(--text-tertiary)]">
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Output */}
            {cmd.output && (
              <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Output</div>
                <pre className="text-sm text-[var(--text-tertiary)] whitespace-pre-wrap font-mono">{cmd.output}</pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Quick Reference Card */}
      <div className="p-6 rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)]">
        <h3 className="font-semibold text-[var(--text-primary)] mb-4">Quick Reference</h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <code className="text-[var(--brand-primary)]">pd claim &lt;identity&gt;</code>
            <p className="text-[var(--text-tertiary)] mt-1">Claim a stable port</p>
          </div>
          <div>
            <code className="text-[var(--brand-primary)]">pd begin</code>
            <p className="text-[var(--text-tertiary)] mt-1">Start agent session</p>
          </div>
          <div>
            <code className="text-[var(--brand-primary)]">pd pub &lt;channel&gt;</code>
            <p className="text-[var(--text-tertiary)] mt-1">Publish message</p>
          </div>
          <div>
            <code className="text-[var(--brand-primary)]">pd harbor create</code>
            <p className="text-[var(--text-tertiary)] mt-1">Create permission namespace</p>
          </div>
        </div>
      </div>
    </div>
  )
}
