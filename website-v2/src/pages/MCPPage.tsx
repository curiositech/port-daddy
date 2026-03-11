import * as React from 'react'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'

/* ─── Data ─────────────────────────────────────────────────────────────────── */

const ESSENTIAL_TOOLS = [
  {
    name: 'begin_session',
    description: 'Register as an agent, start a session, claim files — one call.',
    example: `await begin_session({
  purpose: "Implementing OAuth flow",
  identity: "myapp:api:main",
  files: ["src/auth.ts"]
})`,
  },
  {
    name: 'end_session_full',
    description: 'Close out gracefully: final note, mark session complete, unregister agent.',
    example: `await end_session_full({
  agent_id: agentId,
  closing_note: "Implemented OAuth, all tests pass"
})`,
  },
  {
    name: 'claim_port',
    description: 'Get a deterministic, collision-free port for your service.',
    example: `const { port } = await claim_port({
  id: "myapp:api:main"
})
// → always returns port 3001 for this identity`,
  },
  {
    name: 'acquire_lock',
    description: 'Take a distributed lock before touching shared resources.',
    example: `await acquire_lock({
  name: "db-migration",
  ttl: 60000
})`,
  },
  {
    name: 'add_note',
    description: 'Leave an immutable, timestamped note for other agents.',
    example: `await add_note({
  content: "Auth module refactored — JWT flow simplified",
  type: "progress"
})`,
  },
  {
    name: 'check_salvage',
    description: 'Before starting work, check if a previous agent left tasks unfinished.',
    example: `const { pending } = await check_salvage({
  identity_prefix: "myapp"
})
// Returns work to continue from dead agents`,
  },
  {
    name: 'whoami',
    description: 'Get your current session context: agent ID, active session, recent notes.',
    example: `const ctx = await whoami({ agent_id: agentId })
// → { agent, session, recentNotes, fileClaims }`,
  },
  {
    name: 'pd_discover',
    description: 'Reveal more tools: messaging, locks, DNS, tunnels, webhooks, and 9 more categories.',
    example: `// Call this to unlock advanced tools
await pd_discover()
// Enables: publish_message, dns_register, start_tunnel, ...`,
  },
]

const ALL_CATEGORIES = [
  {
    id: 'session-lifecycle',
    label: 'Session Lifecycle',
    color: 'var(--p-teal-400)',
    bg: 'rgba(58,173,173,0.08)',
    border: 'rgba(58,173,173,0.20)',
    tools: ['begin_session', 'end_session_full', 'whoami'],
    description: 'Start/end sessions, agent registration — the three commands every agent calls.',
  },
  {
    id: 'ports',
    label: 'Ports',
    color: 'var(--p-amber-400)',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.20)',
    tools: ['claim_port', 'release_port', 'list_services', 'get_service', 'health_check', 'list_active_ports', 'list_system_ports', 'cleanup_ports'],
    description: 'Atomic port assignment, health checks, and service listing.',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    color: 'var(--p-teal-300)',
    bg: 'rgba(58,173,173,0.08)',
    border: 'rgba(58,173,173,0.20)',
    tools: ['start_session', 'end_session', 'get_session', 'delete_session', 'list_sessions', 'set_session_phase', 'claim_files', 'release_files', 'list_file_claims', 'who_owns_file'],
    description: 'Detailed session management including phases and advisory file claims.',
  },
  {
    id: 'notes',
    label: 'Notes',
    color: 'var(--p-green-400)',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.20)',
    tools: ['add_note', 'list_notes'],
    description: 'Immutable, append-only audit trail for agent coordination.',
  },
  {
    id: 'locks',
    label: 'Locks',
    color: 'var(--p-amber-300)',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.20)',
    tools: ['acquire_lock', 'release_lock', 'list_locks'],
    description: 'Distributed locks with TTL for safe concurrent file access.',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.20)',
    tools: ['publish_message', 'get_messages', 'list_channels', 'clear_channel'],
    description: 'Pub/sub channels for broadcasting between agents.',
  },
  {
    id: 'agents',
    label: 'Agents',
    color: 'var(--p-teal-300)',
    bg: 'rgba(58,173,173,0.08)',
    border: 'rgba(58,173,173,0.20)',
    tools: ['register_agent', 'agent_heartbeat', 'unregister_agent', 'get_agent', 'list_agents', 'check_salvage', 'claim_salvage', 'salvage_complete', 'salvage_abandon', 'salvage_dismiss'],
    description: 'Agent registry, heartbeats, and the full salvage/resurrection lifecycle.',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    color: 'var(--p-amber-400)',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.20)',
    tools: ['inbox_send', 'inbox_read', 'inbox_stats', 'inbox_mark_read', 'inbox_mark_all_read', 'inbox_clear'],
    description: 'Direct agent-to-agent messaging, like an email inbox for agents.',
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    color: '#f472b6',
    bg: 'rgba(244,114,182,0.08)',
    border: 'rgba(244,114,182,0.20)',
    tools: ['webhook_add', 'webhook_list', 'webhook_events', 'webhook_get', 'webhook_update', 'webhook_remove', 'webhook_test', 'webhook_deliveries'],
    description: 'Register webhooks to get notified when events fire in Port Daddy.',
  },
  {
    id: 'integration',
    label: 'Integration',
    color: 'var(--p-green-400)',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.20)',
    tools: ['integration_ready', 'integration_needs', 'integration_list'],
    description: 'Cross-agent signals: broadcast "auth service is ready" or "frontend needs API".',
  },
  {
    id: 'dns',
    label: 'DNS',
    color: 'var(--p-teal-400)',
    bg: 'rgba(58,173,173,0.08)',
    border: 'rgba(58,173,173,0.20)',
    tools: ['dns_register', 'dns_unregister', 'dns_list', 'dns_lookup', 'dns_cleanup', 'dns_status', 'dns_setup', 'dns_teardown', 'dns_sync'],
    description: 'Register hostnames like myapp-api.local that resolve without /etc/hosts hacks.',
  },
  {
    id: 'briefing',
    label: 'Briefing',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.20)',
    tools: ['briefing_generate', 'briefing_read'],
    description: 'Generate .portdaddy/briefing.md — instant context for any agent joining a project.',
  },
  {
    id: 'tunnels',
    label: 'Tunnels',
    color: 'var(--p-amber-300)',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.20)',
    tools: ['start_tunnel', 'stop_tunnel', 'list_tunnels'],
    description: 'Expose local services over ngrok/cloudflared. Agents can share endpoints with each other.',
  },
  {
    id: 'projects',
    label: 'Projects',
    color: 'var(--p-green-300)',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.20)',
    tools: ['scan_project', 'list_projects', 'get_project', 'delete_project'],
    description: 'Auto-detect and register monorepo projects. Agents can discover the full service mesh.',
  },
  {
    id: 'changelog',
    label: 'Changelog',
    color: '#f472b6',
    bg: 'rgba(244,114,182,0.08)',
    border: 'rgba(244,114,182,0.20)',
    tools: ['changelog_add', 'changelog_list', 'changelog_get', 'changelog_identities', 'changelog_by_session', 'changelog_by_agent'],
    description: 'Per-agent, per-session change history. Rollup to project-level changelog automatically.',
  },
  {
    id: 'activity',
    label: 'Activity',
    color: 'var(--p-teal-300)',
    bg: 'rgba(58,173,173,0.08)',
    border: 'rgba(58,173,173,0.20)',
    tools: ['activity_log', 'activity_summary', 'activity_stats', 'activity_range'],
    description: 'Full audit trail of all port claims, sessions, notes, and coordination events.',
  },
  {
    id: 'system',
    label: 'System',
    color: 'var(--text-muted)',
    bg: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
    tools: ['daemon_status', 'get_version', 'get_metrics', 'get_config', 'wait_for_service', 'get_launch_hints'],
    description: 'Daemon health, version, metrics, config, and context-aware startup hints.',
  },
]

const CONFIG_EXAMPLES = [
  {
    label: 'Claude Code',
    file: '~/.claude/settings.json',
    code: `{
  "mcpServers": {
    "port-daddy": {
      "command": "npx",
      "args": ["port-daddy", "mcp"]
    }
  }
}`,
  },
  {
    label: 'Claude Desktop',
    file: '~/Library/Application Support/Claude/claude_desktop_config.json',
    code: `{
  "mcpServers": {
    "port-daddy": {
      "command": "npx",
      "args": ["port-daddy", "mcp"]
    }
  }
}`,
  },
  {
    label: 'Or use the installer',
    file: 'Terminal',
    code: `# One-command install to Claude Code
pd mcp install

# Scoped to project only
pd mcp install --scope project`,
  },
]

/* ─── Component ─────────────────────────────────────────────────────────────── */

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
      {label && (
        <div className="px-4 py-2" style={{ background: 'var(--codeblock-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</span>
        </div>
      )}
      <pre className="p-4 font-mono text-sm overflow-x-auto leading-relaxed m-0"
        style={{ background: 'var(--codeblock-bg)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {code}
      </pre>
    </div>
  )
}

function InlineCode({ children }: { children: string }) {
  return (
    <code
      className="font-mono text-xs px-1.5 py-0.5 rounded"
      style={{ background: 'var(--bg-overlay)', color: 'var(--text-code)', border: '1px solid var(--border-subtle)' }}
    >
      {children}
    </code>
  )
}

function ToolChip({ name }: { name: string }) {
  return (
    <span
      className="inline-block font-mono text-xs px-2 py-0.5 rounded"
      style={{ background: 'var(--bg-overlay)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
    >
      {name}
    </span>
  )
}

export function MCPPage() {
  const [activeConfig, setActiveConfig] = React.useState(0)
  const [expandedTool, setExpandedTool] = React.useState<string | null>(null)

  const totalTools = ALL_CATEGORIES.reduce((n, c) => n + c.tools.length, 0) + 1 // +1 for pd_discover

  return (
    <div style={{ paddingTop: 'var(--nav-height)', background: 'var(--bg-base)', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <section
        className="relative py-16 px-4 sm:px-6 lg:px-8 overflow-hidden"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(30,107,107,0.18) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-4xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Badge variant="teal" className="mb-4">MCP · Model Context Protocol</Badge>
            <h1
              className="text-4xl sm:text-5xl font-bold mb-4"
              style={{ color: 'var(--text-primary)', lineHeight: 1.1, fontFamily: 'var(--p-font-display)' }}
            >
              Claude Code Integration
            </h1>
            <p className="text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-secondary)' }}>
              {totalTools} tools across 17 categories — port management, agent coordination, distributed
              locks, pub/sub, DNS, tunnels, and more. One install command.
            </p>

            {/* Install command */}
            <div
              className="inline-flex items-center gap-3 rounded-xl px-6 py-4 font-mono text-base mx-auto"
              style={{ background: 'var(--codeblock-bg)', border: '1px solid var(--border-default)' }}
            >
              <span style={{ color: 'var(--code-prompt)' }}>$</span>
              <span style={{ color: 'var(--text-primary)' }}>pd mcp install</span>
              <span
                className="text-xs px-2 py-0.5 rounded-full ml-2"
                style={{ background: 'rgba(58,173,173,0.15)', color: 'var(--p-teal-300)' }}
              >
                one command
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        {/* ── Progressive disclosure ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Progressive disclosure
          </h2>
          <p className="text-base mb-8" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
            Port Daddy exposes <strong style={{ color: 'var(--text-primary)' }}>8 essential tools</strong> by
            default — the ones every agent needs. Call <InlineCode>pd_discover</InlineCode> to unlock the
            remaining categories. This keeps context windows clean and LLM costs low for simple tasks.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { label: 'Default (always available)', tools: ['begin_session', 'end_session_full', 'whoami', 'claim_port', 'acquire_lock', 'add_note', 'check_salvage', 'pd_discover'], color: 'var(--p-teal-400)' },
              { label: 'After pd_discover', tools: ['publish_message', 'dns_register', 'start_tunnel', 'inbox_send', 'integration_ready', 'briefing_generate', 'changelog_add', '+ 40 more...'], color: '#a78bfa' },
            ].map(group => (
              <div
                key={group.label}
                className="rounded-xl p-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="text-xs font-medium uppercase tracking-widest mb-3" style={{ color: group.color }}>
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.tools.map(t => (
                    <ToolChip key={t} name={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── Config ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Configuration
          </h2>
          <p className="text-base mb-6" style={{ color: 'var(--text-secondary)' }}>
            Add Port Daddy to your MCP client. The daemon communicates over stdio — no HTTP, no ports,
            no extra processes.
          </p>

          {/* Tab bar */}
          <div className="flex gap-2 mb-4">
            {CONFIG_EXAMPLES.map((c, i) => (
              <button
                key={c.label}
                onClick={() => setActiveConfig(i)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition-all"
                style={{
                  background: activeConfig === i ? 'var(--bg-overlay)' : 'transparent',
                  color: activeConfig === i ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: activeConfig === i ? 'var(--border-default)' : 'transparent',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <CodeBlock
            code={CONFIG_EXAMPLES[activeConfig].code}
            label={CONFIG_EXAMPLES[activeConfig].file}
          />
        </motion.section>

        {/* ── Essential 8 tools ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Essential tools
          </h2>
          <p className="text-base mb-8" style={{ color: 'var(--text-secondary)' }}>
            These are always available — no <InlineCode>pd_discover</InlineCode> needed.
          </p>

          <div className="flex flex-col gap-3">
            {ESSENTIAL_TOOLS.map((tool, i) => (
              <motion.div
                key={tool.name}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <button
                  onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                  className="w-full text-left rounded-xl p-4 transition-all"
                  style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${expandedTool === tool.name ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <InlineCode>{tool.name}</InlineCode>
                    <span className="text-sm flex-1 text-left" style={{ color: 'var(--text-secondary)' }}>
                      {tool.description}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {expandedTool === tool.name ? '▲' : '▼'}
                    </span>
                  </div>
                </button>

                {expandedTool === tool.name && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mt-1"
                    style={{ border: '1px solid var(--border-default)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}
                  >
                    <pre
                      className="p-4 font-mono text-sm overflow-x-auto leading-relaxed m-0"
                      style={{ background: 'var(--codeblock-bg)', color: 'var(--code-output)', whiteSpace: 'pre', borderTop: '1px solid var(--border-subtle)' }}
                    >
                      {tool.example}
                    </pre>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── All categories ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <div className="flex items-baseline gap-4 mb-2">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              All {totalTools} tools
            </h2>
            <span className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
              17 categories
            </span>
          </div>
          <p className="text-base mb-8" style={{ color: 'var(--text-secondary)' }}>
            Unlock with <InlineCode>pd_discover()</InlineCode> or call directly if you know what you need.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {ALL_CATEGORIES.map((cat, i) => (
              <motion.div
                key={cat.id}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                className="rounded-xl p-4"
                style={{ background: cat.bg, border: `1px solid ${cat.border}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold" style={{ color: cat.color }}>
                    {cat.label}
                  </span>
                  <span className="text-xs font-mono ml-auto" style={{ color: cat.color, opacity: 0.7 }}>
                    {cat.tools.length} tools
                  </span>
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {cat.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {cat.tools.map(t => (
                    <span
                      key={t}
                      className="font-mono text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(0,0,0,0.2)', color: cat.color, opacity: 0.9 }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── How agents use it ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            How agents use it
          </h2>
          <p className="text-base mb-6" style={{ color: 'var(--text-secondary)' }}>
            A typical Claude Code session with Port Daddy installed.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                label: 'Without Port Daddy',
                lines: [
                  { type: 'comment', text: '# Agent starts work — no coordination' },
                  { type: 'comment', text: '# Hardcoded port — hope nothing else uses 3001' },
                  { type: 'prompt', text: 'PORT=3001 node server.js' },
                  { type: 'error', text: 'Error: EADDRINUSE address already in use' },
                  { type: 'comment', text: '# Agent 2 starts — modifying the same files' },
                  { type: 'comment', text: '# Agent 1\'s work gets overwritten' },
                  { type: 'error', text: 'Merge conflict in src/auth.ts' },
                ],
              },
              {
                label: 'With Port Daddy',
                lines: [
                  { type: 'comment', text: '# begin_session — register, claim files, start session' },
                  { type: 'output', text: 'Agent registered: myapp:api:main' },
                  { type: 'output', text: 'Session started: sess_8f2a...' },
                  { type: 'output', text: 'File claimed: src/auth.ts' },
                  { type: 'comment', text: '# claim_port — deterministic, collision-free' },
                  { type: 'output', text: 'Port 3001 assigned (always this port for this identity)' },
                  { type: 'comment', text: '# Agent 2 tries same file — warned instantly' },
                  { type: 'output', text: 'Conflict: Agent myapp:api:feature-x owns src/auth.ts' },
                ],
              },
            ].map(panel => (
              <div key={panel.label} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                <div className="px-4 py-2" style={{ background: 'var(--codeblock-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{panel.label}</span>
                </div>
                <div className="p-4 font-mono text-xs leading-relaxed" style={{ background: 'var(--codeblock-bg)' }}>
                  {panel.lines.map((line, i) => (
                    <div key={i}>
                      {line.type === 'prompt' ? (
                        <span>
                          <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                          <span style={{ color: 'var(--text-primary)' }}>{line.text}</span>
                        </span>
                      ) : line.type === 'comment' ? (
                        <span style={{ color: 'var(--code-comment)' }}>{line.text}</span>
                      ) : line.type === 'error' ? (
                        <span style={{ color: 'var(--p-red-400)' }}>{line.text}</span>
                      ) : (
                        <span style={{ color: 'var(--code-output)' }}>{line.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── Resources ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
            Resources
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { title: 'CLI Reference', body: 'Every pd command with flags, examples, and expected output.', href: '/docs' },
              { title: 'HTTP API', body: 'REST endpoints for every Port Daddy operation. Useful for custom integrations.', href: '/docs' },
              { title: 'Tutorials', body: 'Step-by-step guides: harbors, spawn, watch, multi-agent war rooms.', href: '/tutorials' },
            ].map(r => (
              <a
                key={r.title}
                href={r.href}
                className="block rounded-xl p-5 no-underline group transition-all"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
              >
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  {r.title} →
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {r.body}
                </p>
              </a>
            ))}
          </div>
        </motion.section>

      </div>
    </div>
  )
}
