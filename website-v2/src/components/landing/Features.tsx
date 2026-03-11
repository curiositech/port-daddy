import * as React from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/Card'

interface Feature {
  icon: React.ReactNode
  title: string
  description: string
  code?: string
  badge?: string
}

// Lucide-style SVG icons (inline, no emoji)
function PortIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  )
}

function SessionIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function SalvageIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function HarborIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function DnsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

const FEATURES: Feature[] = [
  {
    icon: <PortIcon />,
    title: 'Atomic Port Assignment',
    description: 'Zero race conditions. Semantic identities like myapp:api:main always map to the same port via deterministic hashing. SQLite-backed, survives restarts.',
    code: 'pd claim myapp:api',
  },
  {
    icon: <SessionIcon />,
    title: 'Sessions & Notes',
    description: 'Structured multi-agent coordination with immutable audit trails. pd begin / pd done wraps your work. Notes are append-only — no accidental overwrites.',
    code: 'pd begin --identity myapp:coder',
  },
  {
    icon: <LockIcon />,
    title: 'Distributed Locks',
    description: 'Named locks with TTLs, automatic expiry, and advisory enforcement. Use pd with-lock to wrap any command — the lock releases even if the command crashes.',
    code: 'pd with-lock db-migrate npm run migrate',
  },
  {
    icon: <BellIcon />,
    title: 'Pub/Sub Messaging',
    description: 'Real-time SSE subscriptions and message queues. Agents publish events, subscribers react. Built-in channel management with message persistence.',
    code: 'pd msg myapp:events publish "build done"',
  },
  {
    icon: <SalvageIcon />,
    title: 'Agent Salvage',
    description: 'When an agent dies mid-task, Port Daddy preserves its work. Another agent runs pd salvage, claims the context, and continues exactly where it left off.',
    code: 'pd salvage --project myapp',
    badge: 'Resurrection Queue',
  },
  {
    icon: <HarborIcon />,
    title: 'Harbor Tokens',
    description: 'JWT capability tokens for agents entering named permission namespaces. HS256-pinned, JTI-first audit trail, automatic zombie detection via heartbeat claims.',
    code: 'pd harbor enter auth --cap "code:write"',
    badge: 'New in v3.5',
  },
  {
    icon: <DnsIcon />,
    title: 'Service DNS',
    description: 'Register human-readable names for services. Agents resolve myapp-api to localhost:3001 automatically. No more hardcoding ports in every config file.',
    code: 'pd dns register myapp-api 3001',
  },
  {
    icon: <PortIcon />,
    title: 'MCP Server',
    description: 'Native Model Context Protocol integration. pd mcp install adds Port Daddy to Claude Code — agents use coordination tools directly from the conversation.',
    code: 'pd mcp install',
  },
]

export function Features() {
  return (
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Everything agents need to coordinate
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy is the glue between AI agents. One daemon, all the coordination primitives.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <Card
                variant="default"
                className="h-full flex flex-col hover:border-[var(--border-strong)] transition-colors group"
              >
                <CardContent className="flex flex-col gap-3 h-full">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors group-hover:bg-[var(--bg-glass-teal)]"
                    style={{
                      background: 'var(--bg-overlay)',
                      color: 'var(--brand-primary)',
                    }}
                  >
                    {feature.icon}
                  </div>

                  <div className="flex items-start gap-2 flex-wrap">
                    <h3
                      className="text-base font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {feature.title}
                    </h3>
                    {feature.badge && (
                      <span
                        className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          background: 'var(--badge-teal-bg)',
                          color: 'var(--badge-teal-text)',
                          border: '1px solid var(--badge-teal-border)',
                        }}
                      >
                        {feature.badge}
                      </span>
                    )}
                  </div>

                  <p
                    className="text-sm flex-1"
                    style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
                  >
                    {feature.description}
                  </p>

                  {feature.code && (
                    <div
                      className="font-mono text-xs px-3 py-2 rounded-lg mt-auto"
                      style={{
                        background: 'var(--code-bg)',
                        color: 'var(--code-output)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                      {feature.code}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
