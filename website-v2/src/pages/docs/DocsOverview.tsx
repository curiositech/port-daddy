import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { 
  Terminal, ArrowRight, Zap, Shield, Radio, 
  Anchor, Sparkles, Code, Cpu, Globe
} from 'lucide-react'

const QUICK_LINKS = [
  {
    title: 'Quick Start',
    description: 'Get up and running with Port Daddy in 5 minutes',
    href: '/docs/quickstart',
    icon: Zap,
    color: 'var(--warning)'
  },
  {
    title: 'CLI Reference',
    description: 'Complete enumeration of all pd commands',
    href: '/docs/cli',
    icon: Terminal,
    color: 'var(--brand-primary)'
  },
  {
    title: 'SDKs',
    description: 'TypeScript, Python, Go, and Rust libraries',
    href: '/docs/sdk',
    icon: Code,
    color: 'var(--info)'
  },
  {
    title: 'MCP Server',
    description: 'Connect Port Daddy to Claude, Cursor, and more',
    href: '/docs/mcp',
    icon: Cpu,
    color: 'var(--success)'
  }
]

const CORE_FEATURES = [
  {
    title: 'Atomic Port Assignment',
    description: 'Deterministic hashing ensures semantic identities like myapp:api always map to the same port across restarts and swarms. No more port conflicts.',
    href: '/docs/features/ports',
    icon: Anchor,
    cli: 'pd claim <identity>'
  },
  {
    title: 'Swarm Radio',
    description: 'Low-latency pub/sub messaging for real-time inter-agent signaling. Agents communicate via named channels without hardcoded addresses.',
    href: '/docs/features/radio',
    icon: Radio,
    cli: 'pd pub <channel> <msg>'
  },
  {
    title: 'Cryptographic Harbors',
    description: 'Named permission namespaces with HMAC-signed capability tokens. Enforce security boundaries at the daemon level.',
    href: '/docs/features/harbors',
    icon: Shield,
    cli: 'pd harbor create <name>'
  },
  {
    title: 'Always-On Avatars',
    description: 'Persistent agent processes that live in background harbors, maintaining state and responding to signals 24/7.',
    href: '/docs/features/avatars',
    icon: Sparkles,
    cli: 'pd spawn --avatar'
  },
  {
    title: 'Self-Healing Swarm',
    description: 'Automated health checks and work preservation. Dead agents leave their context in the salvage queue for others to continue.',
    href: '/docs/features/salvage',
    icon: Zap,
    cli: 'pd salvage'
  },
  {
    title: 'Time-Travel Debugging',
    description: 'Unified timeline interleaving infrastructure events, agent notes, and radio traffic for rapid diagnostics.',
    href: '/docs/features/timeline',
    icon: Globe,
    cli: 'pd activity timeline'
  }
]

export default function DocsOverview() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="space-y-6">
        <Badge variant="teal">Documentation</Badge>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Port Daddy Documentation
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-2xl">
          The definitive control plane for multi-agent swarms. Atomic port assignment, 
          semantic DNS, and cryptographic harbors for AI agent coordination.
        </p>
        
        {/* Install Command */}
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm max-w-fit">
          <Terminal size={16} className="text-[var(--text-muted)]" />
          <code className="text-[var(--text-secondary)]">brew install erichowens/port-daddy</code>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid sm:grid-cols-2 gap-4">
        {QUICK_LINKS.map(link => (
          <Link
            key={link.title}
            to={link.href}
            className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
          >
            <div className="flex items-start gap-4">
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${link.color}15` }}
              >
                <link.icon size={20} style={{ color: link.color }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[var(--text-primary)]">{link.title}</h3>
                  <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{link.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Core Features */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Core Features</h2>
        <div className="grid gap-4">
          {CORE_FEATURES.map(feature => (
            <Link
              key={feature.title}
              to={feature.href}
              className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--interactive-hover)] flex items-center justify-center shrink-0 group-hover:bg-[var(--interactive-active)] transition-colors">
                  <feature.icon size={20} className="text-[var(--brand-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[var(--text-primary)] mb-1">{feature.title}</h3>
                  <p className="text-sm text-[var(--text-tertiary)] mb-3 leading-relaxed">{feature.description}</p>
                  <code className="text-xs px-2 py-1 rounded bg-[var(--bg-code)] text-[var(--brand-primary)] font-mono">
                    {feature.cli}
                  </code>
                </div>
                <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* What is Port Daddy? */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">What is Port Daddy?</h2>
        <div className="prose prose-[var(--text-secondary)] max-w-none">
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Port Daddy is a <strong className="text-[var(--text-primary)]">port authority daemon</strong> for AI agent swarms. 
            It solves the fundamental coordination problems that emerge when multiple AI agents work on the same codebase:
          </p>
          <ul className="space-y-2 text-[var(--text-secondary)] mt-4">
            <li><strong className="text-[var(--text-primary)]">Port conflicts</strong> — Agents claiming the same ports for their services</li>
            <li><strong className="text-[var(--text-primary)]">Discovery</strong> — Agents needing to find each other without hardcoded addresses</li>
            <li><strong className="var(--text-primary)">Coordination</strong> — Agents working on the same files without collisions</li>
            <li><strong className="text-[var(--text-primary)]">Security</strong> — Untrusted agents needing restricted access</li>
            <li><strong className="text-[var(--text-primary)]">Resilience</strong> — Dead agents leaving orphaned state and file locks</li>
          </ul>
          <p className="text-[var(--text-secondary)] leading-relaxed mt-4">
            Think of it as <strong className="text-[var(--text-primary)]">Kubernetes for AI agents</strong> — a control plane that manages 
            the lifecycle, networking, and security of your agent swarm.
          </p>
        </div>
      </div>

      {/* Next Steps */}
      <div className="p-6 rounded-xl bg-gradient-to-br from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <h3 className="font-semibold text-[var(--text-primary)] mb-2">Ready to dive in?</h3>
        <p className="text-[var(--text-secondary)] mb-4">
          Follow the quick start guide to get your first agent swarm running in minutes.
        </p>
        <Link 
          to="/docs/quickstart"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-on-primary)] font-medium hover:bg-[var(--brand-primary-hover)] transition-colors"
        >
          Get Started
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
