import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

const GROUPS = [
  {
    title: 'Ports',
    description: 'Claim, release, and discover stable ports for your services.',
    commands: [
      { name: 'pd claim', short: 'c', href: '/docs/cli/claim', description: 'Claim a port for a service' },
      { name: 'pd release', short: 'r', href: '/docs/cli/release', description: 'Release a port claim' },
      { name: 'pd find', short: 'f', href: '/docs/cli/find', description: 'Find an assigned port' },
      { name: 'pd services', short: 'ps', href: '/docs/cli/services', description: 'List all services' },
      { name: 'pd scan', href: '/docs/cli/scan', description: 'Scan directory for services' },
      { name: 'pd up', short: 'u', href: '/docs/cli/up', description: 'Start orchestrated services' },
      { name: 'pd down', short: 'd', href: '/docs/cli/down', description: 'Stop all services' },
      { name: 'pd status', href: '/docs/cli/status', description: 'Check daemon status' },
    ]
  },
  {
    title: 'Sessions',
    description: 'Manage agent sessions, notes, and file claims.',
    commands: [
      { name: 'pd begin', href: '/docs/cli/begin', description: 'Start a new agent session' },
      { name: 'pd done', href: '/docs/cli/done', description: 'Complete the active session' },
      { name: 'pd whoami', href: '/docs/cli/whoami', description: 'Show current agent context' },
      { name: 'pd note', short: 'n', href: '/docs/cli/note', description: 'Add a session note' },
      { name: 'pd notes', href: '/docs/cli/notes', description: 'View recent notes' },
    ]
  },
  {
    title: 'Locks',
    description: 'Distributed locks for exclusive resource access.',
    commands: [
      { name: 'pd lock acquire', href: '/docs/cli/lock-acquire', description: 'Acquire a distributed lock' },
      { name: 'pd lock release', href: '/docs/cli/lock-release', description: 'Release a lock' },
      { name: 'pd with-lock', href: '/docs/cli/with-lock', description: 'Run a command while holding a lock' },
    ]
  },
  {
    title: 'Messaging',
    description: 'Pub/sub channels for inter-agent communication.',
    commands: [
      { name: 'pd pub', href: '/docs/cli/pub', description: 'Publish a message to a channel' },
      { name: 'pd msg', href: '/docs/cli/msg', description: 'Messaging commands' },
      { name: 'pd watch', href: '/docs/cli/watch', description: 'Watch a channel with --exec' },
    ]
  },
  {
    title: 'Agents',
    description: 'Spawn AI agents and manage the salvage queue.',
    commands: [
      { name: 'pd spawn', href: '/docs/cli/spawn', description: 'Launch an AI agent' },
      { name: 'pd spawned', href: '/docs/cli/spawned', description: 'List running agents' },
      { name: 'pd agent register', href: '/docs/cli/agent-register', description: 'Register as an agent' },
      { name: 'pd salvage', href: '/docs/cli/salvage', description: 'View the salvage queue' },
      { name: 'pd salvage claim', href: '/docs/cli/salvage-claim', description: 'Claim a dead agent\'s work' },
    ]
  },
  {
    title: 'Harbors',
    description: 'Permission namespaces with capability tokens.',
    commands: [
      { name: 'pd harbor create', href: '/docs/cli/harbor-create', description: 'Create a harbor' },
      { name: 'pd harbor enter', href: '/docs/cli/harbor-enter', description: 'Enter a harbor' },
      { name: 'pd harbor leave', href: '/docs/cli/harbor-leave', description: 'Leave a harbor' },
      { name: 'pd harbors', href: '/docs/cli/harbors', description: 'List all harbors' },
    ]
  },
  {
    title: 'DNS & Tunnels',
    description: 'Local DNS records and public tunnel exposure.',
    commands: [
      { name: 'pd dns', href: '/docs/cli/dns', description: 'DNS management commands' },
      { name: 'pd tunnel', href: '/docs/cli/tunnel', description: 'Create a public tunnel' },
      { name: 'pd tunnel stop', href: '/docs/cli/tunnel-stop', description: 'Stop a tunnel' },
    ]
  },
]

export default function CliOverview() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant="teal">CLI</Badge>
          <Badge variant="default">v3.8.0</Badge>
        </div>
        <h1 className="text-4xl font-display font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Command Line Interface
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Complete reference for the <code>pd</code> CLI.
        </p>
      </div>

      {/* Command Groups */}
      {GROUPS.map(group => (
        <section key={group.title} className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{group.title}</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{group.description}</p>
          </div>

          <div className="space-y-2">
            {group.commands.map(cmd => (
              <Link key={cmd.href} to={cmd.href} className="block group">
                <Surface depth="flat" radius="lg" padding="none" className="flex items-center gap-4 px-4 py-3 transition-all group-hover:shadow-[var(--shadow-sm)]">
                  <code className="text-sm font-mono font-semibold shrink-0" style={{ color: 'var(--brand-primary)' }}>
                    {cmd.name}
                  </code>
                  {cmd.short && (
                    <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>({cmd.short})</code>
                  )}
                  <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                    {cmd.description}
                  </span>
                  <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} />
                </Surface>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
