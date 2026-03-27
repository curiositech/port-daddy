import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, Cpu, Terminal, Code, ExternalLink, Check } from 'lucide-react'

const MCP_SERVERS = [
  {
    name: 'Claude Code',
    description: 'Native integration with Claude Code CLI. Install and use Port Daddy tools directly in your Claude sessions.',
    href: '/docs/mcp/claude',
    icon: Terminal,
    setup: 'npx -y firecrawl-cli@latest init --all --browser',
    features: ['Tool discovery', 'Automatic context', 'Session management']
  },
  {
    name: 'Cursor',
    description: 'Connect Port Daddy to Cursor IDE for agent coordination within your editor.',
    href: '/docs/mcp/cursor',
    icon: Code,
    setup: 'Add to .cursor/mcp.json',
    features: ['IDE integration', 'Real-time sync', 'File watching']
  },
  {
    name: 'Windsurf',
    description: 'Use Port Daddy with Windsurf for collaborative AI coding.',
    href: '/docs/mcp/windsurf',
    icon: Cpu,
    setup: 'Configure in Windsurf settings',
    features: ['Cascade integration', 'Multi-agent support', 'State persistence']
  }
]

const TOOLS = [
  {
    name: 'claim_port',
    description: 'Claim a stable port for a service identity',
    parameters: ['identity: string', 'project?: string', 'stack?: string']
  },
  {
    name: 'release_port',
    description: 'Release a previously claimed port',
    parameters: ['identity: string']
  },
  {
    name: 'find_port',
    description: 'Find the port assigned to an identity',
    parameters: ['identity: string']
  },
  {
    name: 'list_services',
    description: 'List all active service claims',
    parameters: ['project?: string']
  },
  {
    name: 'begin_session',
    description: 'Start a new agent session',
    parameters: ['identity: string', 'purpose?: string']
  },
  {
    name: 'publish_message',
    description: 'Publish a message to a Swarm Radio channel',
    parameters: ['channel: string', 'message: string']
  },
  {
    name: 'acquire_lock',
    description: 'Acquire a distributed lock',
    parameters: ['name: string', 'ttl?: number']
  },
  {
    name: 'create_harbor',
    description: 'Create a permission namespace',
    parameters: ['name: string', 'capabilities?: string[]']
  }
]

export default function McpOverview() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Integration</Badge>
          <Badge variant="gold">New in v3.7</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Model Context Protocol
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Connect Port Daddy to any AI tool via the Model Context Protocol (MCP).
          Give your agents native access to port management, swarm coordination, and more.
        </p>
        <p className="text-sm text-[var(--text-muted)] p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-xl">
          Use this reference if your LLM (Claude, Cursor, Windsurf, etc.) needs to coordinate
          agents directly via tool calls. For terminal usage see the{' '}
          <a href="/docs/cli" className="text-[var(--brand-primary)] hover:underline">CLI reference</a>, or
          for programmatic access see the{' '}
          <a href="/docs/sdk" className="text-[var(--brand-primary)] hover:underline">SDK reference</a>.
        </p>
      </div>

      {/* What is MCP? */}
      <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">What is MCP?</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The Model Context Protocol is an open standard that allows AI tools to discover and use 
          external capabilities. With Port Daddy's MCP server, your agents can:
        </p>
        <ul className="mt-4 space-y-2">
          <li className="flex items-start gap-2 text-[var(--text-secondary)]">
            <Check size={16} className="text-[var(--success)] mt-1 shrink-0" />
            <span>Claim and manage ports without hardcoded values</span>
          </li>
          <li className="flex items-start gap-2 text-[var(--text-secondary)]">
            <Check size={16} className="text-[var(--success)] mt-1 shrink-0" />
            <span>Coordinate with other agents via Swarm Radio</span>
          </li>
          <li className="flex items-start gap-2 text-[var(--text-secondary)]">
            <Check size={16} className="text-[var(--success)] mt-1 shrink-0" />
            <span>Enter cryptographic harbors for secure operations</span>
          </li>
          <li className="flex items-start gap-2 text-[var(--text-secondary)]">
            <Check size={16} className="text-[var(--success)] mt-1 shrink-0" />
            <span>Acquire locks to prevent file collisions</span>
          </li>
        </ul>
      </div>

      {/* Quick Setup */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Quick Setup</h2>
        <p className="text-[var(--text-secondary)]">
          The fastest way to get started is using the init command:
        </p>
        <div className="p-4 rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm">
          <div className="text-[var(--text-muted)] mb-2"># Install the MCP server globally</div>
          <div className="text-[var(--brand-primary)]">$ pd mcp install --global</div>
          <div className="text-[var(--text-secondary)] mt-2">✓ MCP server installed</div>
          <div className="text-[var(--text-secondary)]">✓ Claude Code configured</div>
          <div className="text-[var(--text-secondary)]">✓ Cursor settings updated</div>
        </div>
      </div>

      {/* Supported Platforms */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Supported Platforms</h2>
        <div className="grid gap-4">
          {MCP_SERVERS.map(server => (
            <Link
              key={server.name}
              to={server.href}
              className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[var(--interactive-hover)] flex items-center justify-center shrink-0 group-hover:bg-[var(--interactive-active)] transition-colors">
                  <server.icon size={24} className="text-[var(--brand-primary)]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-[var(--text-primary)]">{server.name}</h3>
                    <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] group-hover:translate-x-1 transition-all" />
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mb-3">{server.description}</p>
                  <code className="text-xs px-2 py-1 rounded bg-[var(--bg-code)] text-[var(--brand-primary)] font-mono">
                    {server.setup}
                  </code>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {server.features.map(feature => (
                      <span key={feature} className="text-xs px-2 py-1 rounded-full bg-[var(--bg-overlay)] text-[var(--text-muted)]">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Available Tools */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Available Tools</h2>
        <p className="text-[var(--text-secondary)]">
          These tools are exposed to any MCP-compatible client:
        </p>
        <div className="grid gap-3">
          {TOOLS.map(tool => (
            <div 
              key={tool.name}
              className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <code className="text-[var(--brand-primary)] font-mono font-medium">{tool.name}</code>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{tool.description}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {tool.parameters.map(param => (
                  <code key={param} className="text-xs px-2 py-1 rounded bg-[var(--bg-code)] text-[var(--text-muted)] font-mono">
                    {param}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Configuration</h2>
        <p className="text-[var(--text-secondary)]">
          The MCP server can be configured via environment variables or a config file:
        </p>
        <div className="p-4 rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm">
          <div className="text-[var(--text-muted)]"># ~/.portdaddy/mcp.json</div>
          <pre className="text-[var(--text-secondary)] mt-2">{`{
  "daemon": {
    "socket": "/tmp/port-daddy.sock",
    "timeout": 30000
  },
  "tools": {
    "enabled": ["claim_port", "release_port", "list_services"],
    "defaultProject": "myapp"
  },
  "logging": {
    "level": "info",
    "file": "~/.portdaddy/mcp.log"
  }
}`}</pre>
        </div>
      </div>

      {/* Example Usage */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Example Usage</h2>
        <p className="text-[var(--text-secondary)]">
          Once configured, simply ask your AI agent to use Port Daddy:
        </p>
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <div className="text-sm text-[var(--text-muted)] mb-2">Example prompts:</div>
          <ul className="space-y-2 text-[var(--text-secondary)]">
            <li>"Claim a port for the API service"</li>
            <li>"Start a new session for the auth refactor"</li>
            <li>"Publish a message to the build channel"</li>
            <li>"List all running services in this project"</li>
          </ul>
        </div>
      </div>

      {/* Learn More */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Learn More</div>
          <div className="font-semibold text-[var(--text-primary)]">MCP Specification</div>
          <div className="text-sm text-[var(--text-muted)]">Official Model Context Protocol docs</div>
        </div>
        <a 
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          View Spec
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  )
}
