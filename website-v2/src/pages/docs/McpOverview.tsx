import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Link } from 'react-router-dom'
import { ArrowRight, Cpu, Terminal, Code, ExternalLink, Check } from 'lucide-react'
import { ALL_CATEGORIES, MCP_DEFAULT_TOOL_TOTAL, MCP_TOOL_TOTAL } from '@/data/mcp'

const DOCTRINE_TOOL_ROUTES: Record<string, string> = {
  doctrine_list: '/docs/mcp/doctrine-list',
  doctrine_get: '/docs/mcp/doctrine-get',
  record_doctrine_episode: '/docs/mcp/record-doctrine-episode',
  propose_doctrine_candidate: '/docs/mcp/propose-doctrine-candidate',
  preregister_doctrine_experiment: '/docs/mcp/preregister-doctrine-experiment',
  record_doctrine_treatment_run: '/docs/mcp/record-doctrine-treatment-run',
  admit_doctrine_candidate: '/docs/mcp/admit-doctrine-candidate',
  doctrine_orders: '/docs/mcp/doctrine-orders',
  record_doctrine_application: '/docs/mcp/record-doctrine-application',
  record_doctrine_outcome: '/docs/mcp/record-doctrine-outcome',
  contest_doctrine: '/docs/mcp/contest-doctrine',
}

const MCP_SERVERS = [
  {
    name: 'Claude Code',
    description: 'Native integration with the Claude Code CLI using ~/.claude/settings.json.',
    href: '/docs/mcp/claude',
    icon: Terminal,
    setup: 'pd mcp install',
    features: ['Tool discovery', 'Session management', 'Skill install']
  },
  {
    name: 'Claude Desktop',
    description: 'Desktop Claude config using claude_desktop_config.json.',
    href: '/docs/mcp/claude',
    icon: Terminal,
    setup: 'pd mcp install',
    features: ['Desktop app config', 'stdio transport', 'Shared daemon']
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
    setup: 'pd mcp install --windsurf',
    features: ['MCP config file', 'Multi-agent support', 'State persistence']
  },
  {
    name: 'VS Code',
    description: 'VS Code/Copilot MCP config using the servers key and stdio transport.',
    href: '/docs/mcp/custom',
    icon: Code,
    setup: 'pd mcp install --vscode',
    features: ['Explicit stdio type', 'Editor integration', 'Shared daemon']
  },
  {
    name: 'Continue.dev',
    description: 'Continue config with Port Daddy as a local MCP server.',
    href: '/docs/mcp/custom',
    icon: Code,
    setup: 'pd mcp install --continue',
    features: ['Agent tooling', 'Local daemon', 'Tool discovery']
  },
  {
    name: 'Cline',
    description: 'Cline MCP settings for VS Code based agent workflows.',
    href: '/docs/mcp/custom',
    icon: Cpu,
    setup: 'pd mcp install --cline',
    features: ['Cline settings', 'Agent coordination', 'Shared context']
  }
]

export default function McpOverview() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="teal">Integration</Badge>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Model Context Protocol
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Connect Port Daddy to any AI tool through the Model Context Protocol (MCP).
          Your agents call Port Daddy directly, as tools, instead of parsing terminal output.
        </p>
        <p className="text-[length:var(--text-base)] text-[var(--text-muted)] p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] max-w-xl">
          Use this reference if your LLM (Claude, Cursor, Windsurf, etc.) needs to coordinate
          agents directly via tool calls. For terminal usage see the{' '}
          <a href="/docs/cli" className="text-[var(--brand-primary)] hover:underline">CLI reference</a>, or
          for programmatic access see the{' '}
          <a href="/docs/sdk" className="text-[var(--brand-primary)] hover:underline">SDK reference</a>.
        </p>
        <p className="text-[length:var(--text-base)] text-[var(--text-muted)] max-w-3xl">
          Audited from <code className="font-mono">mcp/server.ts</code>: default mode exposes {MCP_DEFAULT_TOOL_TOTAL} tools
          including <code className="font-mono">pd_discover</code>, and full mode covers {MCP_TOOL_TOTAL} unique registered functions.
        </p>
      </div>

      {/* What is MCP? */}
      <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">What is MCP?</h2>
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
          The fastest way to get started is the installer, which auto-detects supported clients:
        </p>
        <CodeBlock language="bash">{`$ pd mcp install
✓ Port Daddy MCP configured for detected clients
✓ Port Daddy agent skill installed
✓ Port Daddy Pilot definitions installed
✓ Optional shell hook configured`}</CodeBlock>
      </div>

      {/* Supported Platforms */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Supported Platforms</h2>
        <div className="grid gap-4">
          {MCP_SERVERS.map(server => (
            <Link
              key={server.name}
              to={server.href}
              className="group p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
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
                  <p className="text-[length:var(--text-base)] text-[var(--text-muted)] mb-3">{server.description}</p>
                  <code className="text-[length:var(--type-meta-size)] px-2 py-1 rounded bg-[var(--code-bg)] text-[var(--brand-primary)] font-mono">
                    {server.setup}
                  </code>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Available Tools */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Available Tools</h2>
        <p className="text-[var(--text-secondary)]">
          These tools are exposed to any MCP-compatible client:
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          Default mode exposes {MCP_DEFAULT_TOOL_TOTAL} functions: the essential set plus <code className="font-mono">pd_discover</code>. Full mode and <code className="font-mono">pd_discover</code> cover all {MCP_TOOL_TOTAL} unique registered functions below.
        </p>
        <div className="grid gap-4">
          {ALL_CATEGORIES.map(category => (
            <div 
              key={category.id}
              className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-[var(--text-primary)]">{category.label}</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{category.description}</p>
                </div>
                <Badge variant="teal">{category.tools.length} tools</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {category.tools.map(tool => {
                  const detailRoute = DOCTRINE_TOOL_ROUTES[tool]
                  const className = 'scroll-mt-24 text-[length:var(--type-meta-size)] px-2 py-1 rounded bg-[var(--code-bg)] text-[var(--text-muted)] font-mono'
                  return detailRoute ? (
                    <Link id={tool} key={tool} to={detailRoute} className={`${className} hover:text-[var(--brand-primary)] hover:underline`}>
                      {tool}
                    </Link>
                  ) : (
                    <code id={tool} key={tool} className={className}>
                      {tool}
                    </code>
                  )
                })}
              </div>
              {category.id === 'doctrine' ? (
                <p className="mt-4 text-sm text-[var(--text-muted)]">
                  Doctrine tools preserve the whole cited, advisory loop: record an episode, propose and
                  preregister a candidate, retain factual treatment runs, admit only matched evidence,
                  retrieve an exact decision-class match, and preserve the agent response, outcome, or
                  contest. They do not authorize a merge, block a change, or claim that one transcript
                  trained the fleet.
                </p>
              ) : null}
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
        <CodeBlock language="bash">{`# ~/.portdaddy/mcp.json
{
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
}`}</CodeBlock>
      </div>

      {/* Example Usage */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Example Usage</h2>
        <p className="text-[var(--text-secondary)]">
          Once configured, simply ask your AI agent to use Port Daddy:
        </p>
        <div className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
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
      <div className="flex items-center justify-between p-5 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
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
