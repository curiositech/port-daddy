export interface McpTool {
  name: string
  description: string
  example: string
}

export interface McpCategory {
  id: string
  label: string
  color: string
  darkColor: string
  bg: string
  border: string
  tools: string[]
  description: string
}

export const MCP_TOOL_TOTAL = 136
export const MCP_DEFAULT_TOOL_TOTAL = 17

export const ESSENTIAL_TOOLS: McpTool[] = [
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

export const ALL_CATEGORIES: McpCategory[] = [
  {
    id: 'magic',
    label: 'Magic',
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['fleet_init', 'fleet_status', 'swarm_awareness', 'sitrep', 'catch_me_up', 'file_heat', 'talk_to_agent', 'spawn'],
    description: 'High-level composed tools for fleet setup, swarm awareness, situation reports, spawning, file heat maps, and agent messaging.',
  },
  {
    id: 'session-lifecycle',
    label: 'Session Lifecycle',
    color: 'var(--p-teal-600)',
    darkColor: 'var(--p-teal-400)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['begin_session', 'end_session_full', 'whoami'],
    description: 'Start/end sessions, agent registration — the three commands every agent calls.',
  },
  {
    id: 'advisor',
    label: 'Advisor',
    color: 'var(--p-amber-700)',
    darkColor: 'var(--p-amber-300)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['coordination_preflight'],
    description: 'Deterministic coordination preflight for context integrity, claims, symbols, salvage, channels, tuples, and lock candidates.',
  },
  {
    id: 'discovery',
    label: 'Discovery',
    color: 'var(--p-teal-600)',
    darkColor: 'var(--p-teal-400)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['pd_discover'],
    description: 'Lists MCP categories, counts, function names, and full schemas so clients can unlock the specialized surface on demand.',
  },
  {
    id: 'ports',
    label: 'Ports',
    color: 'var(--p-amber-600)',
    darkColor: 'var(--brand-accent)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['claim_port', 'release_port', 'list_services', 'get_service', 'health_check', 'list_active_ports', 'list_system_ports', 'cleanup_ports'],
    description: 'Atomic port assignment, health checks, and service listing.',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['start_session', 'get_session', 'delete_session', 'list_sessions', 'set_session_phase', 'claim_files', 'release_files', 'list_file_claims', 'who_owns_file'],
    description: 'Detailed session management including phases and advisory file claims.',
  },
  {
    id: 'notes',
    label: 'Notes',
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-400)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
    tools: ['add_note', 'list_notes'],
    description: 'Immutable, append-only audit trail for agent coordination.',
  },
  {
    id: 'locks',
    label: 'Locks',
    color: 'var(--p-amber-700)',
    darkColor: 'var(--p-amber-300)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['acquire_lock', 'release_lock', 'list_locks'],
    description: 'Distributed locks with TTL for safe concurrent file access.',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    color: '#7c3aed',
    darkColor: '#a78bfa',
    bg: 'rgba(139, 92, 246, 0.1)',
    border: 'rgba(139, 92, 246, 0.2)',
    tools: ['publish_message', 'get_messages', 'list_channels', 'clear_channel'],
    description: 'Pub/sub channels for broadcasting between agents.',
  },
  {
    id: 'agents',
    label: 'Agents',
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['register_agent', 'agent_heartbeat', 'unregister_agent', 'get_agent', 'list_agents', 'check_salvage', 'claim_salvage', 'salvage_complete', 'salvage_abandon', 'salvage_dismiss'],
    description: 'Agent registry, heartbeats, and the full salvage/resurrection lifecycle.',
  },
  {
    id: 'actors',
    label: 'Actors',
    color: 'var(--p-teal-600)',
    darkColor: 'var(--p-teal-400)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['list_actors', 'get_actor', 'message_actor', 'list_actor_inbox', 'get_actor_inbox_stats'],
    description: 'Durable actor directory, direct actor messages, inbox inspection, and live lease projections.',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    color: 'var(--p-amber-700)',
    darkColor: 'var(--brand-accent)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['inbox_send', 'inbox_read', 'inbox_stats', 'inbox_mark_read', 'inbox_mark_all_read'],
    description: 'Direct agent-to-agent messaging, like an email inbox for agents.',
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    color: '#db2777',
    darkColor: '#f472b6',
    bg: 'rgba(236, 72, 153, 0.1)',
    border: 'rgba(236, 72, 153, 0.2)',
    tools: ['webhook_add', 'webhook_list', 'webhook_events', 'webhook_get', 'webhook_update', 'webhook_remove', 'webhook_test', 'webhook_deliveries'],
    description: 'Register webhooks to get notified when events fire in Port Daddy.',
  },
  {
    id: 'integration',
    label: 'Integration',
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-400)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
    tools: ['integration_ready', 'integration_needs', 'integration_list'],
    description: 'Cross-agent signals: broadcast "auth service is ready" or "frontend needs API".',
  },
  {
    id: 'dns',
    label: 'DNS',
    color: 'var(--p-teal-600)',
    darkColor: 'var(--p-teal-400)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['dns_register', 'dns_unregister', 'dns_list', 'dns_lookup', 'dns_cleanup', 'dns_status', 'dns_setup', 'dns_teardown', 'dns_sync'],
    description: 'Register hostnames like myapp-api.local that resolve without /etc/hosts hacks.',
  },
  {
    id: 'briefing',
    label: 'Briefing',
    color: '#7c3aed',
    darkColor: '#a78bfa',
    bg: 'rgba(139, 92, 246, 0.1)',
    border: 'rgba(139, 92, 246, 0.2)',
    tools: ['briefing_generate', 'briefing_read'],
    description: 'Generate .portdaddy/briefing.md — instant context for any agent joining a project.',
  },
  {
    id: 'tunnels',
    label: 'Tunnels',
    color: 'var(--p-amber-700)',
    darkColor: 'var(--p-amber-300)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['start_tunnel', 'stop_tunnel', 'list_tunnels'],
    description: 'Expose local services over ngrok/cloudflared. Agents can share endpoints with each other.',
  },
  {
    id: 'projects',
    label: 'Projects',
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-300)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
    tools: ['scan_project', 'list_projects', 'get_project', 'delete_project'],
    description: 'Auto-detect and register monorepo projects. Agents can discover the full service mesh.',
  },
  {
    id: 'changelog',
    label: 'Changelog',
    color: '#db2777',
    darkColor: '#f472b6',
    bg: 'rgba(236, 72, 153, 0.1)',
    border: 'rgba(236, 72, 153, 0.2)',
    tools: ['changelog_add', 'changelog_list', 'changelog_get', 'changelog_identities', 'changelog_by_session', 'changelog_by_agent'],
    description: 'Per-agent, per-session change history. Rollup to project-level changelog automatically.',
  },
  {
    id: 'activity',
    label: 'Activity',
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['activity_log', 'activity_summary', 'activity_stats', 'activity_range'],
    description: 'Full audit trail of all port claims, sessions, notes, and coordination events.',
  },
  {
    id: 'system',
    label: 'System',
    color: 'var(--p-navy-700)',
    darkColor: 'var(--p-navy-300)',
    bg: 'rgba(112, 144, 204, 0.1)',
    border: 'rgba(112, 144, 204, 0.2)',
    tools: ['daemon_status', 'get_version', 'get_metrics', 'get_config', 'wait_for_service', 'get_launch_hints'],
    description: 'Daemon health, version, metrics, config, and context-aware startup hints.',
  },
  {
    id: 'tuples',
    label: 'Tuples',
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-400)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
    tools: ['tuple_out', 'tuple_read', 'tuple_take', 'tuple_scan', 'tuple_count'],
    description: 'Shared tuple space for swarm coordination: write, read, take, scan, and count structured facts.',
  },
  {
    id: 'fleet-control',
    label: 'Fleet Control',
    color: 'var(--p-amber-700)',
    darkColor: 'var(--brand-accent)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
    tools: ['list_bonds', 'get_bond', 'slash_bond', 'list_wallets', 'get_wallet', 'top_up_wallet', 'set_wallet_budget', 'list_budget_pending', 'get_budget_pending', 'resolve_budget_pending', 'get_panic_status', 'arm_fleet_panic', 'disarm_fleet_panic'],
    description: 'Bond escrow, project wallets, budget pause-and-ask, and fleet panic controls.',
  },
  {
    id: 'semantic',
    label: 'Semantic',
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
    tools: ['graph_edges', 'graph_stats', 'memory_episodes', 'memory_stats'],
    description: 'Semantic graph and episodic memory inspection for graph edges, promoted handoffs, and project-level stats.',
  },
  {
    id: 'feedback',
    label: 'Feedback',
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-400)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
    tools: ['drop_feedback', 'submit_visual_task', 'list_feedback', 'feedback_summary'],
    description: 'Agentic feedback and visual task primitives for structured findings that Cartographer or the fleet can harvest into work.',
  },
]

export const CONFIG_EXAMPLES = [
  {
    label: 'Gemini CLI',
    file: '.gemini/extensions/port-daddy/GEMINI.md',
    code: `brew install curiositech/tap/port-daddy\npd setup\n\nIf you are wiring Gemini by hand:\n- MCP Server: "pd mcp"\n- Skill: "port-daddy"`,
  },
  {
    label: 'Claude Code',
    file: '~/.claude/settings.json',
    code: `{
  "mcpServers": {
    "port-daddy": {
      "command": "pd",
      "args": ["mcp"]
    }
  }
}`,
  },
  {
    label: 'Cursor',
    file: '.cursor/mcp.json',
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
    label: 'Aider',
    file: 'Terminal',
    code: `# Launch aider with Port Daddy MCP server
aider --mcp-server "npx port-daddy mcp"`,
  },
  {
    label: 'Agent Skill',
    file: 'Agent Configuration',
    code: `# If your agent framework supports skills, load Port Daddy:
import { PortDaddySkill } from 'port-daddy/skills'
agent.addSkill(new PortDaddySkill())`,
  },
]
