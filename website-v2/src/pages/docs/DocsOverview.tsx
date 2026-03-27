import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import {
  Terminal, ArrowRight, Shield, Radio,
  Anchor, Code, Cpu, Globe, Layers,
  RefreshCw, Navigation, Network
} from 'lucide-react'

const CONCEPTS = [
  {
    title: 'Ports & Identities',
    description: 'Deterministic port assignment using semantic identities like myapp:api. No more port conflicts between agents.',
    href: '/docs/features/ports',
    icon: Anchor,
  },
  {
    title: 'Sessions & Notes',
    description: 'Structured coordination: agents track what they are working on, leave notes, and claim files to avoid collisions.',
    href: '/docs/features/sessions',
    icon: Layers,
  },
  {
    title: 'Pub/Sub (Swarm Radio)',
    description: 'Real-time messaging between agents via named channels. An agent finishes a build and broadcasts the result to all listeners.',
    href: '/docs/features/radio',
    icon: Radio,
  },
  {
    title: 'Salvage & Recovery',
    description: 'When an agent dies mid-task, its session and notes are preserved in a queue so another agent can pick up where it left off.',
    href: '/docs/features/salvage',
    icon: RefreshCw,
  },
  {
    title: 'Harbors (Security)',
    description: 'Named permission namespaces with signed capability tokens. Restrict what an untrusted agent is allowed to do.',
    href: '/docs/features/harbors',
    icon: Shield,
  },
  {
    title: 'Semantic DNS',
    description: 'Register human-readable names that resolve to ports. Agents discover each other by name, not by number.',
    href: '/docs/features/dns',
    icon: Navigation,
  },
  {
    title: 'Tunnels',
    description: 'Expose a local service to the internet with a single command. The public URL is shared automatically via notes.',
    href: '/docs/features/tunnels',
    icon: Network,
  },
]

const INTERFACES = [
  {
    title: 'CLI Reference',
    description: 'Use this if you are running pd from your terminal.',
    href: '/docs/cli',
    icon: Terminal,
    color: 'var(--brand-primary)',
  },
  {
    title: 'SDK Reference',
    description: 'Use this if you are writing JavaScript/TypeScript that coordinates agents programmatically.',
    href: '/docs/sdk',
    icon: Code,
    color: 'var(--info)',
  },
  {
    title: 'MCP Reference',
    description: 'Use this if your LLM (Claude, Cursor, etc.) needs to coordinate agents directly via tool calls.',
    href: '/docs/mcp',
    icon: Cpu,
    color: 'var(--success)',
  },
  {
    title: 'API Reference',
    description: 'Use this if you want to call the HTTP endpoints directly with curl, fetch, or any language.',
    href: '/docs/api',
    icon: Globe,
    color: 'var(--warning)',
  },
]

export default function DocsOverview() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="space-y-6">
        <Badge variant="teal">Documentation</Badge>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          What is Port Daddy?
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Port Daddy is a <strong className="text-[var(--text-primary)]">local daemon</strong> that
          coordinates multiple AI agents working on the same codebase. It assigns ports, tracks sessions,
          relays messages, and recovers from crashes -- so your agents stay out of each other's way.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          When you run two or more AI agents at the same time -- say, one building an API and another
          building a frontend -- they collide. They grab the same ports. They edit the same files. When
          one crashes, the other has no idea what happened. There is no shared state, no coordination, and
          no recovery.
        </p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy is a single always-on daemon (running on <code className="text-[var(--brand-primary)]">localhost:9876</code>)
          that gives every agent a stable identity, a place to coordinate, and a safety net when things go wrong. Think of
          it as a control plane for your agent swarm.
        </p>
      </div>

      {/* Quick Start CTA */}
      <div className="p-6 rounded-xl bg-gradient-to-br from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <h2 className="font-semibold text-[var(--text-primary)] mb-2">Ready to try it?</h2>
        <p className="text-[var(--text-secondary)] mb-4">
          Install Port Daddy and claim your first port in under two minutes.
        </p>
        <Link
          to="/docs/quickstart"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Quick Start
          <ArrowRight size={16} />
        </Link>
      </div>

      {/* Concepts */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">Core Concepts</h2>
          <p className="text-[var(--text-secondary)]">
            These are the building blocks of Port Daddy. Read them in order to understand what the
            software does before diving into reference material.
          </p>
        </div>
        <div className="grid gap-4">
          {CONCEPTS.map((concept, i) => (
            <Link
              key={concept.title}
              to={concept.href}
              className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--interactive-hover)] flex items-center justify-center shrink-0 group-hover:bg-[var(--interactive-active)] transition-colors">
                  <concept.icon size={20} className="text-[var(--brand-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-mono text-[var(--text-muted)]">{String(i + 1).padStart(2, '0')}</span>
                    <h3 className="font-semibold text-[var(--text-primary)]">{concept.title}</h3>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed">{concept.description}</p>
                </div>
                <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Which interface should I use? */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
            Which reference should I read?
          </h2>
          <p className="text-[var(--text-secondary)]">
            Port Daddy exposes the same features through four interfaces. Pick the one that
            matches how you work -- they all talk to the same daemon.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {INTERFACES.map(iface => (
            <Link
              key={iface.title}
              to={iface.href}
              className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${iface.color}15` }}
                >
                  <iface.icon size={20} style={{ color: iface.color }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">{iface.title}</h3>
                    <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] group-hover:translate-x-1 transition-all" />
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{iface.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
