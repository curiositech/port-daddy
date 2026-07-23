#!/usr/bin/env node
/**
 * Port Daddy MCP Server
 *
 * Exposes Port Daddy's full API as MCP tools for Claude agents.
 * Communicates with the live Port Daddy daemon via discovered HTTP URL.
 *
 * Usage:
 *   npx port-daddy mcp          # stdio transport (Claude Code / Desktop)
 *   node mcp/server.js           # direct invocation
 *
 * Claude Code config (~/.claude/settings.json):
 *   "mcpServers": {
 *     "port-daddy": {
 *       "command": "npx",
 *       "args": ["port-daddy", "mcp"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as http from 'node:http';
import * as net from 'node:net';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';
import {
  claimRegionRequest,
  releaseRegionRequest,
  type ClaimRegionArgs,
  type ReleaseRegionArgs,
} from '../lib/editor-claims-mcp.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAEMON_URL = getDaemonTcpUrl(process.env.PORT_DADDY_URL);
// 30s default for most tools; spawn and wait tools override with longer timeouts
const REQUEST_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// HTTP helper — lightweight, no external deps
// ---------------------------------------------------------------------------

interface ApiResponse {
  status: number;
  data: Record<string, unknown>;
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options?: { timeout?: number }
): Promise<ApiResponse> {
  const url = new URL(path, DAEMON_URL);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: options?.timeout ?? REQUEST_TIMEOUT,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw) as Record<string, unknown>;
            resolve({ status: res.statusCode ?? 500, data });
          } catch {
            resolve({ status: res.statusCode ?? 500, data: { raw } });
          }
        });
      }
    );
    req.on('error', (err: Error) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Convenience wrappers */
/** Probe a TCP port — resolves true if something is already listening. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(false));
    sock.connect(port, '127.0.0.1');
  });
}

const GET = (path: string, opts?: { timeout?: number }) => api('GET', path, undefined, opts);
const POST = (path: string, body?: Record<string, unknown>, opts?: { timeout?: number }) => api('POST', path, body, opts);
const PUT = (path: string, body?: Record<string, unknown>, opts?: { timeout?: number }) => api('PUT', path, body, opts);
const DELETE = (path: string, body?: Record<string, unknown>, opts?: { timeout?: number }) => api('DELETE', path, body, opts);

// ---------------------------------------------------------------------------
// Tiered tool loading — reduce context window overhead by 80%
//
// By default, only Essential tools (8) + pd_discover are sent to the agent.
// Full mode (--full flag or PORT_DADDY_MCP_FULL=1) exposes all tools.
// Agents can call pd_discover to learn about additional tools by category,
// then call them directly — handleTool processes ALL tools regardless of tier.
// ---------------------------------------------------------------------------

const FULL_MODE = process.argv.includes('--full') || process.env.PORT_DADDY_MCP_FULL === '1';

const ESSENTIAL_TOOL_NAMES = new Set([
  'begin_session',
  'end_session_full',
  'whoami',
  'claim_port',
  'release_port',
  'add_note',
  'acquire_lock',
  'list_services',
  // Magic tools — high-level composed operations for vibe coders
  'fleet_init',
  'active_agent_roster',
  'swarm_awareness',
  'coordination_preflight',
  'sitrep',
  'catch_me_up',  // DEPRECATED 3.8.4 — alias for sitrep. Kept for back-compat.
  'spawn',
  // Central agentic-feedback primitive — agents drop feedback while
  // they work; cartographer harvests it into the roadmap.
  'drop_feedback',
  // Host-safety posture audit (ADR-0088 Phase A) — read-only; the agent is a
  // first-class consumer of its own safety posture.
  'safe_scan',
]);

const TOOL_CATEGORIES: Record<string, { description: string; tools: string[] }> = {
  'magic': {
    description: 'High-level composed tools: fleet setup, swarm awareness, situation reports, spawning, file heat maps, agent messaging',
    tools: ['fleet_init', 'fleet_status', 'active_agent_roster', 'swarm_awareness', 'sitrep', 'catch_me_up', 'file_heat', 'talk_to_agent', 'spawn'],
  },
  'session-lifecycle': {
    description: 'Start/end sessions, manage agent registration (sugar commands)',
    tools: ['begin_session', 'end_session_full', 'whoami'],
  },
  'trust': {
    description: 'Honest self-report (ADR-0045): verify the daemon actually enforces what it claims before relying on it',
    tools: ['attest'],
  },
  'safety': {
    description: 'Host-safety posture audit (ADR-0088): a read-only scan of what an agent running as the operator could reach right now (secrets at rest, world-readable crown jewels, unsigned binaries, unpinned MCP fetches, egress flows)',
    tools: ['safe_scan'],
  },
  'advisor': {
    description: 'Deterministic coordination preflight: context integrity, claims, symbols, salvage, channels, tuples, and locks',
    tools: ['coordination_preflight'],
  },
  'ports': {
    description: 'Claim, release, and list port assignments',
    tools: ['claim_port', 'release_port', 'list_services', 'get_service', 'health_check', 'list_active_ports', 'list_system_ports', 'cleanup_ports'],
  },
  'sessions': {
    description: 'Detailed session management (start, end, phases, file claims)',
    tools: ['start_session', 'end_session', 'get_session', 'delete_session', 'list_sessions', 'set_session_phase', 'claim_files', 'claim_symbols', 'release_files', 'list_file_claims', 'who_owns_file', 'claim_region', 'release_region'],
  },
  'notes': {
    description: 'Add and list session notes',
    tools: ['add_note', 'list_notes'],
  },
  'locks': {
    description: 'Distributed locks for coordinating file/resource access',
    tools: ['acquire_lock', 'release_lock', 'list_locks'],
  },
  'messaging': {
    description: 'Pub/sub messaging between agents',
    tools: ['publish_message', 'get_messages', 'discourse_lineage', 'list_channels', 'clear_channel'],
  },
  'agents': {
    description: 'Agent registry, heartbeats, salvage/resurrection',
    tools: ['register_agent', 'agent_heartbeat', 'unregister_agent', 'get_agent', 'list_agents', 'check_salvage', 'claim_salvage', 'salvage_complete', 'salvage_abandon', 'salvage_dismiss'],
  },
  'actors': {
    description: 'Durable actor directory and live lease projections',
    tools: ['list_actors', 'get_actor', 'message_actor', 'list_actor_inbox', 'get_actor_inbox_stats'],
  },
  'inbox': {
    description: 'Agent-to-agent direct messaging via inbox',
    tools: ['inbox_send', 'inbox_read', 'inbox_stats', 'inbox_mark_read', 'inbox_mark_all_read', 'inbox_clear'],
  },
  'webhooks': {
    description: 'Register and manage webhooks for Port Daddy event notifications',
    tools: ['webhook_add', 'webhook_list', 'webhook_events', 'webhook_get', 'webhook_update', 'webhook_remove', 'webhook_test', 'webhook_deliveries'],
  },
  'integration': {
    description: 'Cross-agent integration signals (ready/needs)',
    tools: ['integration_ready', 'integration_needs', 'integration_list'],
  },
  'dns': {
    description: 'Local DNS for service discovery',
    tools: ['dns_register', 'dns_unregister', 'dns_list', 'dns_lookup', 'dns_cleanup', 'dns_status', 'dns_setup', 'dns_teardown', 'dns_sync'],
  },
  'briefing': {
    description: 'Generate project briefing files for .portdaddy/',
    tools: ['briefing_generate', 'briefing_read'],
  },
  'tunnels': {
    description: 'Expose local services via tunnels',
    tools: ['start_tunnel', 'stop_tunnel', 'list_tunnels'],
  },
  'projects': {
    description: 'Scan, list, and manage registered projects',
    tools: ['scan_project', 'list_projects', 'get_project', 'delete_project'],
  },
  'changelog': {
    description: 'Track and query changelog entries per agent/session/identity',
    tools: ['changelog_add', 'changelog_list', 'changelog_get', 'changelog_identities', 'changelog_by_session', 'changelog_by_agent'],
  },
  'activity': {
    description: 'Activity log queries and statistics',
    tools: ['activity_log', 'activity_summary', 'activity_stats', 'activity_range'],
  },
  'cockpit': {
    description: 'App-Native Development Cockpit — read roadmap markdown into typed mission cards',
    tools: ['cockpit_missions_list'],
  },
  'system': {
    description: 'Daemon status, version, metrics, config, launch hints, relay, and harbormaster liveness',
    tools: ['daemon_status', 'get_version', 'get_metrics', 'get_config', 'wait_for_service', 'get_launch_hints', 'relay_status', 'harbormaster_status'],
  },
  'tuples': {
    description: 'Shared tuple space for swarm coordination — write, read, take, scan, count',
    tools: ['tuple_out', 'tuple_read', 'tuple_take', 'tuple_scan', 'tuple_count'],
  },
  'fleet-control': {
    description: 'Bond escrow, project wallets, budget pause-and-ask, and fleet panic controls',
    tools: [
      'list_bonds', 'get_bond', 'slash_bond',
      'list_wallets', 'get_wallet', 'top_up_wallet', 'set_wallet_budget',
      'list_budget_pending', 'get_budget_pending', 'resolve_budget_pending',
      'get_panic_status', 'arm_fleet_panic', 'disarm_fleet_panic',
    ],
  },
  'semantic': {
    description: 'Semantic graph and episodic memory inspection — query graph edges, promoted handoffs, and project-level stats',
    tools: ['graph_edges', 'graph_stats', 'memory_episodes', 'memory_stats'],
  },
  'feedback': {
    description: 'Agentic feedback primitive — drop structured findings about the project (or about Port Daddy itself); cartographer harvests them into the roadmap',
    tools: ['drop_feedback', 'submit_visual_task', 'list_feedback', 'feedback_summary'],
  },
  'harbors': {
    description: 'Named permission namespaces — list harbors, inspect membership/envelope, and dry-run a capability decision before you act',
    tools: ['list_harbors', 'get_harbor', 'check_harbor_envelope', 'whois'],
  },
  'signals': {
    description: 'Pheromone trail — leave and read stigmergic signals on entities/files so the swarm coordinates without direct messaging',
    tools: ['spray_pheromone', 'resolve_pheromone', 'pheromone_coverage', 'read_pheromones', 'read_entity_pheromones'],
  },
  'roadmap': {
    description: 'Tuple-backed roadmap of record — read progress/claims (cartographer projection), list/get items, and promote feedback into a roadmap item',
    tools: ['roadmap_progress', 'roadmap_claims', 'roadmap_list', 'roadmap_get', 'roadmap_promote'],
  },
  'commitments': {
    description: 'Durable commitments + obligation monitor (ADR-0041) — make a commitment, list yours, and see what is overdue',
    tools: ['commit', 'list_commitments', 'list_overdue_commitments'],
  },
  'suggestions': {
    description: 'Suggestibility nudges (ADR-0039) — list claim-overlap heads-up nudges and accept/decline them',
    tools: ['list_nudges', 'respond_nudge'],
  },
  'parley': {
    description: 'Forced reconciliation for overlapping agents — summon, inspect, respond to, and resolve bounded parleys',
    tools: ['call_parley', 'list_parleys', 'get_parley', 'respond_parley', 'resolve_parley'],
  },
  'knowledge': {
    description: 'Semantic search + symbol index — search the embedding store, resolve identities, find symbols, and predict file/symbol conflicts before claiming',
    tools: ['semantic_search', 'semantic_resolve', 'find_symbols', 'symbol_stats', 'predict_conflicts', 'blast_radius'],
  },
  'context': {
    description: 'Context economics — per-agent token budget health, swarm COGS overview, and per-spawn task ledger',
    tools: ['get_context_budget', 'get_context_overview', 'get_task_ledger'],
  },
  'harvest': {
    description: 'Session harvest + related work search — promote session notes to durable episodic memory, find similar past work',
    tools: ['harvest_session', 'find_related_work'],
  },
  'custodian': {
    description: 'Knowledge Custodian — daemon-resident compaction loop status, pending HITL approvals, operator permission patterns',
    tools: ['custodian_status', 'list_pending_approvals', 'resolve_approval'],
  },
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  // ── Sugar (Compound Operations) ──────────────────────────────────────
  {
    name: 'begin_session',
    description:
      '[Essential] Register agent + start session in one atomic step. Use this at the start of every ' +
      'coding session instead of calling register_agent and start_session separately. ' +
      'Returns agentId, sessionId, and a salvageHint if dead agents need attention. ' +
      'Rent-at-claim: exactly ONE of roadmap / roadmap_new / sidequest is REQUIRED. ' +
      'Usage: begin_session({purpose: "Building auth system", identity: "myapp:api:main", lifecycle: "ephemeral", roadmap: "adr-0090-database-distribution"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        purpose: {
          type: 'string',
          description: 'What you are working on (e.g. "Implementing OAuth flow")',
        },
        lifecycle: {
          type: 'string',
          enum: ['durable', 'ephemeral'],
          description:
            'Session lifecycle: "ephemeral" for one-off task sessions (most agent work), ' +
            '"durable" for long-lived staff agents that persist across tasks',
        },
        identity: {
          type: 'string',
          description: 'Semantic identity in project:stack:context format (e.g. "myapp:api:main")',
        },
        agent_id: {
          type: 'string',
          description: 'Agent ID (auto-generated if omitted)',
        },
        type: {
          type: 'string',
          description: 'Agent type (default: mcp)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to claim for this session (advisory — shows conflicts to other agents)',
        },
        roadmap: {
          type: 'string',
          description:
            'Rent-at-claim: slug of an EXISTING roadmap item to link this session to. ' +
            'Mutually exclusive with sidequest and roadmap_new.',
        },
        sidequest: {
          type: 'string',
          description:
            'Rent-at-claim opt-out: one-line reason this work is off-roadmap (min 12 chars). ' +
            'Mutually exclusive with roadmap and roadmap_new.',
        },
        roadmap_new: {
          type: 'string',
          description:
            'Rent-at-claim genesis: title for a NEW draft roadmap item to create and link. ' +
            'Mutually exclusive with roadmap and sidequest.',
        },
      },
      required: ['purpose', 'lifecycle'],
    },
  },
  {
    name: 'end_session_full',
    description:
      '[Essential] End session + unregister agent in one step. Use this at the end of every coding ' +
      'session instead of calling end_session and then unregistering the agent separately. ' +
      'Usage: end_session_full({agent_id: "agent-abc123", note: "Auth complete, all tests passing"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Your agent ID (from begin_session response)',
        },
        session_id: {
          type: 'string',
          description: 'Session ID to end (auto-found from agent_id if omitted)',
        },
        note: {
          type: 'string',
          description: 'Final closing note summarizing what was accomplished',
        },
        status: {
          type: 'string',
          enum: ['completed', 'abandoned'],
          description: 'How the session ended (default: completed)',
        },
      },
    },
  },
  {
    name: 'whoami',
    description:
      '[Essential] Show your current agent and session context. Useful for confirming your registration ' +
      'is active and seeing which session, files, and notes are associated with your agent ID. ' +
      'Usage: whoami({agent_id: "agent-abc123"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Your agent ID (from begin_session response)',
        },
      },
    },
  },
  {
    name: 'attest',
    description:
      '[Trust] Honest self-report of the daemon (ADR-0045). Returns each declared ' +
      'invariant with its REAL runtime state (enforced / degraded / stubbed) instead ' +
      'of an aggregate "ok". Call this to verify the daemon is actually doing what it ' +
      'claims before you rely on its coordination. Usage: attest()',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'safe_scan',
    description:
      '[Safety] READ-ONLY host-safety posture audit (ADR-0088 Phase A). Returns a ' +
      '0-100 score, a Safe Room state (green/amber/red), and a blast-radius list: ' +
      'what an agent running as the operator could reach RIGHT NOW (plaintext ' +
      'secrets at rest, world-readable crown jewels, unsigned running binaries, ' +
      'unpinned MCP fetches, live egress flows). green = "cooperative-case sensors ' +
      'clear", NOT a sandbox — the report footer carries the verbatim HONEST_LIMITS. ' +
      'NEVER returns a raw secret: findings carry only path/line/ruleId/last4. ' +
      'Optional `allow`: comma-separated allowlisted egress hosts. Usage: safe_scan()',
    inputSchema: {
      type: 'object' as const,
      properties: {
        allow: {
          type: 'string',
          description:
            'Comma-separated allowlisted egress hosts. A live flow to a host not on ' +
            'this list is a deduction; empty means egress flows are reported as ' +
            'evidence but never deducted.',
        },
      },
    },
  },
  {
    name: 'relay_status',
    description:
      '[System] Relay federation status (ADR-0049). Returns whether this daemon is ' +
      'connected to the cloud relay, its session, last handshake, and which channels ' +
      'are accepted — so an agent can tell if cross-machine pub/sub is live before ' +
      'relying on it. Read-only. Usage: relay_status()',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'harbormaster_status',
    description:
      '[System] Harbormaster actor status (ADR-0037). Returns the read-only merge-owner ' +
      'body liveness, schema readiness, and queue summary from GET /harbormaster/status. ' +
      'Does not start, stop, or merge anything. Usage: harbormaster_status()',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Harbors (permission namespaces) ──────────────────────────────────
  {
    name: 'list_harbors',
    description:
      '[Harbors] List all permission namespaces (harbors). Each harbor scopes what ' +
      'capabilities an agent declares while operating in it. Usage: list_harbors()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_harbor',
    description:
      '[Harbors] Inspect one harbor — its scope, declared capabilities, channels, and ' +
      'current envelope. Pass the harbor name. Usage: get_harbor({ "name": "frontend" })',
    inputSchema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Harbor name' } },
      required: ['name'],
    },
  },
  {
    name: 'check_harbor_envelope',
    description:
      "[Harbors] Dry-run a capability decision against a harbor's envelope BEFORE you act — " +
      'returns the allow/deny verdict (shown-to-user UX, never mutates). ' +
      'Usage: check_harbor_envelope({ "name": "frontend", "agent_id": "agent-1", "action": { "kind": "fs_write", "path": "src/app.tsx" } })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Harbor name' },
        agent_id: { type: 'string', description: 'Agent ID the decision is about' },
        action: {
          type: 'object',
          description: 'EnvelopeAction with a required string `kind` (e.g. fs_write, channel_publish, tool_call, budget_spend)',
        },
      },
      required: ['name', 'agent_id', 'action'],
    },
  },
  {
    name: 'whois',
    description:
      'Skill-routing phonebook: given a capability query, returns ranked agents by semantic match × heartbeat freshness. ' +
      'Usage: whois({ "query": "react server components", "kind": "agent", "limit": 5 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Capability query phrase to route on' },
        kind: { type: 'string', enum: ['agent', 'human', 'any'], description: 'Entity kind filter (default agent)' },
        fresh_min: { type: 'number', description: 'Minimum freshness in seconds; excludes agents whose last heartbeat is older' },
        limit: { type: 'number', description: 'Max ranked hits to return (default 10)' },
      },
      required: ['query'],
    },
  },

  // ── Pheromone signals (stigmergy) ────────────────────────────────────
  {
    name: 'spray_pheromone',
    description:
      '[Signals] Leave a stigmergic signal on an entity so other agents can sense it — ' +
      'the coordinate-without-messaging primitive. Usage: spray_pheromone({table: "sessions", id: "sess-1", key: "needs_review", strength: 0.8})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Entity table the signal attaches to (e.g. sessions, files)' },
        id: { type: 'string', description: 'Entity id' },
        key: { type: 'string', description: 'Signal name' },
        strength: { type: 'number', description: 'Signal strength 0..1 (optional)' },
      },
      required: ['table', 'id', 'key'],
    },
  },
  {
    name: 'read_pheromones',
    description:
      '[Signals] Read the current pheromone trail across the swarm. Usage: read_pheromones()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'read_entity_pheromones',
    description:
      '[Signals] Read the signals on one specific entity. Usage: read_entity_pheromones({table: "sessions", id: "sess-1"}). Pass effective:true to apply anti-inflammatory resolution damping (RCP-7a).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Entity table' },
        id: { type: 'string', description: 'Entity id' },
        effective: { type: 'boolean', description: 'Apply resolution damping (RCP-7a)' },
      },
      required: ['table', 'id'],
    },
  },
  {
    name: 'resolve_pheromone',
    description:
      '[Signals] Deposit a RESOLUTION trace (RCP-7a): mark a signal on an entity as resolved so it is damped on effective reads — stop agents piling onto solved work. Usage: resolve_pheromone({table: "services", id: "svc-1", key: "heat", strength: 1})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Entity table' },
        id: { type: 'string', description: 'Entity id' },
        key: { type: 'string', description: 'Signal key to resolve' },
        strength: { type: 'number', description: 'Resolution strength 0-1 (default 1)' },
      },
      required: ['table', 'id', 'key'],
    },
  },
  {
    name: 'pheromone_coverage',
    description:
      '[Signals] Coverage of a table (RCP-12): the fraction of entities that carry any pheromone ("seen") plus the unseen set — what an innate scan should target so no entity stays invisible. Usage: pheromone_coverage({table: "services"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Entity table (services, projects, sessions, agents)' },
      },
      required: ['table'],
    },
  },

  // ── Roadmap (cartographer projection + items of record) ──────────────
  {
    name: 'roadmap_progress',
    description:
      '[Roadmap] Cartographer projection of roadmap progress — phase/horizon rollups. Usage: roadmap_progress()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'roadmap_claims',
    description:
      '[Roadmap] Which agents currently hold which roadmap items (atomic-claim ledger). Usage: roadmap_claims()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'roadmap_list',
    description:
      '[Roadmap] List roadmap items of record, optionally filtered by status or harbor. ' +
      'Usage: roadmap_list({status: "now"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status (e.g. now, next, later, done)' },
        harbor: { type: 'string', description: 'Filter by harbor' },
      },
    },
  },
  {
    name: 'roadmap_get',
    description:
      '[Roadmap] Fetch one roadmap item by slug. Usage: roadmap_get({slug: "harbor-envelope"})',
    inputSchema: {
      type: 'object' as const,
      properties: { slug: { type: 'string', description: 'Roadmap item slug' } },
      required: ['slug'],
    },
  },
  {
    name: 'roadmap_promote',
    description:
      '[Roadmap] Atomically promote a piece of feedback into a roadmap item of record. ' +
      'Usage: roadmap_promote({slug: "fix-x", summaryMd: "...", feedbackId: "fb-1", promotedBy: "agent-1"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Slug for the new/updated roadmap item' },
        summaryMd: { type: 'string', description: 'Markdown summary of the item' },
        feedbackId: { type: 'string', description: 'Source feedback id being promoted (optional)' },
        status: { type: 'string', description: 'Initial status (optional)' },
        promotedBy: { type: 'string', description: 'Agent id doing the promotion (optional)' },
      },
      required: ['slug'],
    },
  },

  // ── Commitments (ADR-0041 obligations) ───────────────────────────────
  {
    name: 'commit',
    description:
      '[Commitments] Make a durable commitment with success/impossibility/motivation checks ' +
      'that the obligation monitor tracks. Usage: commit({ownerActorId: "agent-1", objectText: "Land PR #265 green", successCheck: "gh pr view 265 --json state == MERGED"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ownerActorId: { type: 'string', description: 'Actor id that owns the commitment' },
        objectText: { type: 'string', description: 'What is being committed to' },
        successCheck: { type: 'string', description: 'How success is verified (optional)' },
        impossibleCheck: { type: 'string', description: 'Condition under which it becomes impossible (optional)' },
        motivationCheck: { type: 'string', description: 'Why it matters (optional)' },
        scope: { type: 'string', description: 'Commitment scope (optional)' },
        commitmentStrategy: { type: 'string', description: 'Commitment strategy (optional)' },
      },
      required: ['ownerActorId', 'objectText'],
    },
  },
  {
    name: 'list_commitments',
    description:
      '[Commitments] List durable commitments and their current obligation state. Usage: list_commitments()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_overdue_commitments',
    description:
      '[Commitments] List commitments whose obligations are overdue. Usage: list_overdue_commitments()',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Suggestibility nudges (ADR-0039) ─────────────────────────────────
  {
    name: 'list_nudges',
    description:
      '[Suggestions] List your pending suggestibility nudges — e.g. claim-overlap heads-up when another live session is on your surface. ' +
      'Usage: list_nudges({agent_id: "my-agent-id"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent whose nudges to list (required — scopes the result to you, never list all)' },
        status: { type: 'string', description: "Filter by status (default 'pending')" },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'respond_nudge',
    description:
      '[Suggestions] Respond to a nudge: accept (you acted on it) or decline (not relevant — primes the cooldown so it stays quiet). ' +
      'Usage: respond_nudge({id: 12, action: "accept"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Nudge id' },
        action: { type: 'string', description: "'accept' or 'decline' (default 'accept')" },
      },
      required: ['id'],
    },
  },

  // ── Parley (ADR-0055 forced reconciliation) ─────────────────────────
  {
    name: 'call_parley',
    description:
      '[Parley] Summon a bounded reconciliation dialogue for overlapping agents. ' +
      'Usage: call_parley({surface: "lib/foo.ts", reason: "overlap", parties: ["agent-a", "agent-b"], calledBy: "agent-a"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        surface: { type: 'string', description: 'Contested path, symbol, or surface' },
        reason: { type: 'string', description: 'Why the parley is being summoned' },
        parties: { type: 'array', items: { type: 'string' }, description: 'Summoned party agent/session ids' },
        calledBy: { type: 'string', description: 'Agent/session id summoning the parley' },
        trigger: { type: 'string', description: 'operator, claim_overlap, detector, or swarm_fit (optional)' },
        harbor: { type: 'string', description: 'Harbor scope (optional)' },
        ttlMs: { type: 'number', description: 'Response TTL in milliseconds (optional)' },
        roundLimit: { type: 'number', description: 'Non-terminal turns per party before escalation (optional)' },
      },
      required: ['surface', 'reason', 'parties', 'calledBy'],
    },
  },
  {
    name: 'list_parleys',
    description:
      '[Parley] List active or historical parleys, optionally filtered by status or harbor. Usage: list_parleys({status: "SUMMONED"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'SUMMONED, CONVENED, COLLAPSED, ESCALATED, or VOIDED (optional)' },
        harbor: { type: 'string', description: 'Harbor scope (optional)' },
        limit: { type: 'number', description: 'Max rows (optional)' },
      },
    },
  },
  {
    name: 'get_parley',
    description:
      '[Parley] Fetch a parley summary, including turns, read receipts, missing parties, and outcome. ' +
      'Pass "as" with your agent id to record your read receipt. Usage: get_parley({id: "...", as: "agent-a"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Parley id' },
        as: { type: 'string', description: 'Your agent/session id — records a read receipt (optional)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'respond_parley',
    description:
      '[Parley] Record a performative turn in a parley. Usage: respond_parley({id: "...", party: "agent-a", performative: "propose", content: "..."})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Parley id' },
        party: { type: 'string', description: 'Summoned party responding' },
        performative: { type: 'string', description: 'propose, critique, revise, agree, refuse, or inform' },
        content: { type: 'string', description: 'Turn content' },
        proposalId: { type: 'string', description: 'Proposal id (optional)' },
        evidenceRefs: { type: 'array', items: { type: 'string' }, description: 'Evidence refs (optional)' },
      },
      required: ['id', 'party', 'performative', 'content'],
    },
  },
  {
    name: 'resolve_parley',
    description:
      '[Parley] Resolve a parley to COLLAPSED, ESCALATED, or VOIDED. Usage: resolve_parley({id: "...", status: "COLLAPSED", resolvedBy: "operator", decision: "..."})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Parley id' },
        status: { type: 'string', description: 'COLLAPSED, ESCALATED, or VOIDED' },
        resolvedBy: { type: 'string', description: 'Agent/operator resolving the parley' },
        decision: { type: 'string', description: 'Decision text, required for COLLAPSED' },
        reason: { type: 'string', description: 'Resolution reason (optional)' },
        dissenters: { type: 'array', items: { type: 'string' }, description: 'Dissenting parties (optional)' },
      },
      required: ['id', 'status', 'resolvedBy'],
    },
  },

  // ── Knowledge (semantic search + symbol index) ───────────────────────
  {
    name: 'semantic_search',
    description:
      '[Knowledge] Semantic search over the embedding store (tasks, notes, docs). ' +
      'Usage: semantic_search({q: "css design tokens", limit: 5})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Natural-language query' },
        limit: { type: 'number', description: 'Max results (optional)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'semantic_resolve',
    description:
      '[Knowledge] Resolve a fuzzy identity/term against the semantic graph for a project. ' +
      'Usage: semantic_resolve({q: "design-system CSS tasks", projectDir: "/path/to/repo"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Term/identity to resolve' },
        projectDir: { type: 'string', description: 'Project directory (optional)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'find_symbols',
    description:
      '[Knowledge] Query the tree-sitter symbol index by name/type/file. ' +
      'Usage: find_symbols({ "name": "createSugar", "exported": true })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Symbol name (optional)' },
        type: { type: 'string', description: 'Symbol type, e.g. function/class (optional)' },
        file: { type: 'string', description: 'Restrict to a file (optional)' },
        exported: { type: 'boolean', description: 'Only exported symbols (optional)' },
      },
    },
  },
  {
    name: 'symbol_stats',
    description:
      '[Knowledge] Summary stats of the symbol index (files parsed, symbols, dependencies). Usage: symbol_stats()',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'predict_conflicts',
    description:
      '[Knowledge] Predict file/symbol conflicts before claiming, given a set of files or a directory. ' +
      'Usage: predict_conflicts({files: ["lib/sugar.ts", "routes/sugar.ts"]})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files to check (provide files OR directory)' },
        directory: { type: 'string', description: 'Directory to scan' },
        glob: { type: 'string', description: 'Glob filter (optional)' },
      },
    },
  },
  {
    name: 'blast_radius',
    description:
      '[Knowledge] Reverse-dependency closure of a symbol — everything that breaks if you change it, ' +
      'plus a ready-to-reserve claim set (modify the target, read everything downstream). ' +
      'Usage: blast_radius({file: "lib/server.ts", symbol: "createRoutes", depth: 3})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'File containing the symbol' },
        symbol: { type: 'string', description: 'Symbol path, e.g. "createRoutes" or "UserService.authenticate"' },
        depth: { type: 'number', description: 'Max dependency hops (1-6, default 3)' },
      },
      required: ['file', 'symbol'],
    },
  },

  {
    name: 'coordination_preflight',
    description:
      '[Essential] Deterministic Compass advice before editing or coordinating. Checks session context, ' +
      'file-claim contention, symbol-index freshness, stale salvage, channel fit, tuple-worthy facts, ' +
      'and true lock candidates. Use this before modifying files or launching work that may overlap others.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_root: {
          type: 'string',
          description: 'Project root directory. Defaults to the daemon process context if omitted.',
        },
        task: {
          type: 'string',
          description: 'Brief description of intended work.',
        },
        session_id: {
          type: 'string',
          description: 'Current Port Daddy session ID, if known.',
        },
        agent_id: {
          type: 'string',
          description: 'Current agent ID, if known.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files the agent expects to inspect or edit.',
        },
        include_channels: {
          type: 'boolean',
          description: 'Force channel suggestions even if task text is ambiguous.',
        },
        include_tuple_hints: {
          type: 'boolean',
          description: 'Force tuple suggestions even if task text is ambiguous.',
        },
      },
    },
  },

  // ── Port Management ──────────────────────────────────────────────────
  {
    name: 'claim_port',
    description:
      '[Essential] Claim a port for your service. Returns a stable, deterministic port based on the ' +
      'identity hash — same identity always gets the same port. If the service was already claimed, ' +
      'returns the existing port. Usage: claim_port({identity: "myapp:api:main"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity in project:stack:context format (e.g. "myapp:api")',
        },
        port: {
          type: 'number',
          description: 'Request a specific port (optional — omit for automatic assignment)',
        },
        range: {
          type: 'string',
          description: 'Acceptable port range as "min-max" (e.g. "3000-4000")',
        },
        expires: {
          type: 'string',
          description: 'Auto-release after duration (e.g. "2h", "30m", "1d")',
        },
      },
      required: ['identity'],
    },
  },
  {
    name: 'release_port',
    description:
      '[Essential] Release a claimed port. Supports wildcards (e.g. "myapp:*" releases all stacks). ' +
      'Pass expired_only: true to only release services that have expired.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity or wildcard pattern to release',
        },
        expired_only: {
          type: 'boolean',
          description: 'Only release services that have expired (default: false)',
        },
      },
      required: ['identity'],
    },
  },
  {
    name: 'list_services',
    description:
      '[Essential] List all claimed services with their ports, status, and metadata. ' +
      'Optionally filter by pattern (e.g. "myapp:*").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Filter by identity pattern (supports wildcards)',
        },
      },
    },
  },
  {
    name: 'get_service',
    description: '[Standard] Get detailed information about a specific service by its identity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity to look up',
        },
      },
      required: ['identity'],
    },
  },
  {
    name: 'health_check',
    description:
      '[Standard] Check health of services. With no ID, checks all services. ' +
      'With an ID, checks only that service.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity to health-check (omit for all)',
        },
      },
    },
  },
  {
    name: 'list_active_ports',
    description: '[Standard] List all active port assignments with project, PID, and age information.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_system_ports',
    description: '[Advanced] List system/well-known ports with info about which ones Port Daddy manages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        range_only: {
          type: 'boolean',
          description: 'Only show ports within the configured Port Daddy range',
        },
        unmanaged_only: {
          type: 'boolean',
          description: 'Only show ports NOT managed by Port Daddy',
        },
      },
    },
  },
  {
    name: 'cleanup_ports',
    description: '[Standard] Release stale port claims that have been inactive.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Sessions & Notes ─────────────────────────────────────────────────
  {
    name: 'start_session',
    description:
      '[Standard] Start a coordination session. Sessions track what an agent is working on, ' +
      'which files it claims, and provide an audit trail via notes. ' +
      'For a single atomic call that also registers your agent, prefer begin_session instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        purpose: {
          type: 'string',
          description: 'What this session is for (e.g. "Building auth system")',
        },
        agent: {
          type: 'string',
          description: 'Agent ID (ties session to a registered agent)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to claim for this session (advisory locking)',
        },
      },
      required: ['purpose'],
    },
  },
  {
    name: 'end_session',
    description:
      '[Standard] End the current active session. Status can be "completed" (success) or "abandoned" ' +
      '(gave up). For a single atomic call that also unregisters your agent, prefer end_session_full instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to end (omit for active session)',
        },
        status: {
          type: 'string',
          enum: ['completed', 'abandoned'],
          description: 'How the session ended (default: completed)',
        },
      },
    },
  },
  {
    name: 'get_session',
    description: '[Standard] Get full details for a session including notes, file claims, and phase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to retrieve',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'delete_session',
    description: '[Advanced] Permanently delete a session and cascade-delete its notes and file claims.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to delete',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'add_note',
    description:
      '[Essential] Add a note to the current session or create a quick standalone note. ' +
      'Notes are immutable — once added, they cannot be edited or deleted. ' +
      'Use liberally: progress updates, decisions made, blockers hit, handoffs to other agents. ' +
      'Usage: add_note({content: "Switched to PKCE flow for SPAs", type: "decision"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'Note content (supports markdown)',
        },
        type: {
          type: 'string',
          enum: ['progress', 'decision', 'blocker', 'question', 'handoff', 'general'],
          description: 'Note type for categorization (default: general)',
        },
        session_id: {
          type: 'string',
          description: 'Session ID to add note to (omit for active session or quick note)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_sessions',
    description: '[Standard] List sessions. Supports wildcard patterns for project, agent, and purpose.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        all: {
          type: 'boolean',
          description: 'Show all sessions, not just active ones',
        },
        project: {
          type: 'string',
          description: 'Filter by project pattern (e.g. "myapp:*")',
        },
        agent: {
          type: 'string',
          description: 'Filter by agent pattern (e.g. "agent-*")',
        },
        purpose: {
          type: 'string',
          description: 'Filter by purpose pattern (e.g. "*bug*")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return',
        },
      },
    },
  },
  {
    name: 'list_notes',
    description: '[Standard] List notes for a session, or recent notes scoped to one project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID (omit for recent notes)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return',
        },
        project: {
          type: 'string',
          description: 'Project slug to isolate recent notes (e.g. "port-daddy" or "workgroup-ai"). Omit only for an intentional global read.',
        },
      },
    },
  },
  {
    name: 'claim_files',
    description:
      '[Standard] Claim whole files or symbol/line regions for the active session (advisory locking). ' +
      'Prefer regions with symbolPath for function-scoped code edits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to claim (whole file)',
        },
        regions: {
          type: 'array',
          description: 'Optional function/line regions to claim instead of whole files',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path for the region' },
              symbolPath: { type: 'string', description: 'Canonical tree-sitter symbol path' },
              startLine: { type: 'number', description: '1-indexed start line fallback' },
              endLine: { type: 'number', description: '1-indexed end line fallback' },
              symbol: { type: 'string', description: 'Human-readable symbol label fallback' },
            },
          },
        },
        force: { type: 'boolean', description: 'Claim despite conflicts' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'claim_symbols',
    description:
      '[Standard] Declare symbol-level claims for the active session. A `modify` claim AUTO-RESERVES its ' +
      'blast radius (read-claims on every downstream caller), so a contract change holds its callers stable. ' +
      'Returns predicted conflicts (direct/dependency/signature/transitive) with other active sessions — advisory, never blocks. ' +
      'Usage: claim_symbols({session_id, claims: [{filePath: "lib/server.ts", symbolPath: "createRoutes", type: "modify"}]})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        claims: {
          type: 'array',
          description: 'Symbol claims to declare',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'File containing the symbol' },
              symbolPath: { type: 'string', description: 'Canonical symbol path, e.g. "UserService.authenticate"' },
              type: { type: 'string', description: "read | modify | add-sibling | add-child | delete | rename (default modify; rename/delete auto-reserve the blast radius)" },
            },
            required: ['filePath', 'symbolPath'],
          },
        },
        auto_derive_radius: { type: 'boolean', description: 'Auto-reserve each modify\'s blast radius (default true)' },
        radius_depth: { type: 'number', description: 'How far the auto-reservation reaches (default 3)' },
      },
      required: ['session_id', 'claims'],
    },
  },
  {
    name: 'release_files',
    description: '[Standard] Release whole-file or symbol/line region claims from a session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to release',
        },
        regions: {
          type: 'array',
          description: 'Optional function/line regions to release',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path for the region' },
              symbolPath: { type: 'string', description: 'Canonical tree-sitter symbol path' },
              startLine: { type: 'number', description: '1-indexed start line fallback' },
              endLine: { type: 'number', description: '1-indexed end line fallback' },
            },
          },
        },
      },
      required: ['session_id'],
    },
  },

  // ── Session Phases ──────────────────────────────────────────────────
  {
    name: 'set_session_phase',
    description:
      '[Standard] Set the lifecycle phase of a session (planning, in_progress, testing, reviewing, completed, abandoned).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        phase: {
          type: 'string',
          enum: ['planning', 'in_progress', 'testing', 'reviewing', 'completed', 'abandoned'],
          description: 'Session phase',
        },
      },
      required: ['session_id', 'phase'],
    },
  },

  // ── File Claims ────────────────────────────────────────────────────
  {
    name: 'list_file_claims',
    description: '[Standard] List all file claims across all active sessions. Supports wildcard patterns for path, symbol, symbolPath, agent, and purpose.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Filter by file path pattern (e.g. "src/*.ts")',
        },
        symbol: {
          type: 'string',
          description: 'Filter by symbol pattern (e.g. "handle*")',
        },
        symbolPath: {
          type: 'string',
          description: 'Filter by canonical symbolPath pattern (e.g. "AuthService.*")',
        },
        agent: {
          type: 'string',
          description: 'Filter by agent ID pattern (e.g. "agent-*")',
        },
        purpose: {
          type: 'string',
          description: 'Filter by session purpose pattern (e.g. "*bug*")',
        },
      },
    },
  },
  {
    name: 'who_owns_file',
    description: '[Standard] Check which session/agent owns a specific file. Optionally filter by line range or symbolPath.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path to look up' },
        startLine: { type: 'number', description: 'Optional: start of line range to check (1-indexed)' },
        endLine: { type: 'number', description: 'Optional: end of line range to check (1-indexed)' },
        symbolPath: { type: 'string', description: 'Optional: canonical tree-sitter symbol path to check' },
      },
      required: ['path'],
    },
  },

  // ── Locks ────────────────────────────────────────────────────────────
  {
    name: 'acquire_lock',
    description:
      '[Essential] Acquire a distributed lock. Use for exclusive access to shared resources ' +
      '(e.g. database migrations, build artifacts). Locks auto-expire after TTL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Lock name (e.g. "db-migrations", "build-output")',
        },
        owner: {
          type: 'string',
          description: 'Lock owner identifier (defaults to PID)',
        },
        ttl: {
          type: 'number',
          description: 'Time-to-live in milliseconds (default: 300000 = 5 minutes)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'release_lock',
    description: '[Standard] Release a distributed lock. Supports wildcard patterns (e.g. "myapp:*").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Lock name to release (supports wildcard patterns)',
        },
        owner: {
          type: 'string',
          description: 'Lock owner (must match the owner who acquired it, unless using force)',
        },
        force: {
          type: 'boolean',
          description: 'Force release regardless of owner (use with caution)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_locks',
    description: '[Standard] List all active distributed locks. Supports wildcard patterns for owner.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: {
          type: 'string',
          description: 'Filter by lock owner pattern (e.g. "agent-*")',
        },
      },
    },
  },

  // ── Messaging ────────────────────────────────────────────────────────
  {
    name: 'publish_message',
    description:
      '[Advanced] Publish a message to a pub/sub channel. Other agents subscribed to the channel ' +
      'will receive it. Use for coordination, build signals, status updates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name (e.g. "build:done", "deploy:staging")',
        },
        payload: {
          type: 'object',
          description: 'Message payload (any JSON object)',
        },
        sender: {
          type: 'string',
          description: 'Sender identifier',
        },
      },
      required: ['channel', 'payload'],
    },
  },
  {
    name: 'get_messages',
    description: '[Advanced] Get messages from a pub/sub channel. Supports wildcard patterns (e.g. "myapp:*:web").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name to read from (supports wildcard patterns)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return',
        },
      },
      required: ['channel'],
    },
  },
  {
    name: 'discourse_lineage',
    description: '[Advanced] Argument graph (RCP-14) over a channel: builds the typed inReplyTo lineage of the conversation and returns a digest (counts by stance/act, participants, and the contradiction edges — flagging which look unresolved) plus an indented tree. Use to see who answered whom and where agents disagree.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name to analyze',
        },
        conversationId: {
          type: 'string',
          description: 'Optional: scope the lineage to a single conversationId',
        },
      },
      required: ['channel'],
    },
  },
  {
    name: 'list_channels',
    description: '[Advanced] List all active pub/sub channels.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'clear_channel',
    description: '[Advanced] Clear all messages from a pub/sub channel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name to clear',
        },
      },
      required: ['channel'],
    },
  },

  // ── Agent Registry ───────────────────────────────────────────────────
  {
    name: 'register_agent',
    description:
      '[Standard] Register as an agent with the Port Daddy daemon. Enables heartbeat monitoring ' +
      'and agent resurrection (salvage) if the agent dies. ' +
      'For a single atomic call that also starts a session, prefer begin_session instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Unique agent identifier',
        },
        identity: {
          type: 'string',
          description: 'Semantic identity in project:stack:context format',
        },
        purpose: {
          type: 'string',
          description: 'What this agent is working on',
        },
        type: {
          type: 'string',
          enum: ['cli', 'sdk', 'mcp'],
          description: 'Agent type (default: mcp)',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'agent_heartbeat',
    description:
      '[Standard] Send a heartbeat to keep the agent alive in the registry. ' +
      'Agents that stop heartbeating are marked stale (10 min) then dead (20 min). ' +
      'Dead agents enter the resurrection/salvage queue.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent identifier to heartbeat',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'unregister_agent',
    description: '[Standard] Unregister an agent from the daemon registry.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to unregister',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent',
    description: '[Standard] Get info for a specific registered agent by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to look up',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'list_agents',
    description: '[Standard] List all registered agents with their status and heartbeat info. Supports wildcard patterns for identity and purpose.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Only show active (heartbeating) agents',
        },
        identity: {
          type: 'string',
          description: 'Filter by identity pattern (e.g. "myapp:*" or "myapp:*:web")',
        },
        purpose: {
          type: 'string',
          description: 'Filter by purpose pattern (e.g. "*bug*" or "*feature*")',
        },
      },
    },
  },
  {
    name: 'list_actors',
    description:
      '[Standard] List canonical actor souls with live bodies, recent sessions, salvage, and inbox targets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Optional logical project filter (for example, "port-daddy").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sessions and salvage records to inspect per projection.',
        },
      },
    },
  },
  {
    name: 'get_actor',
    description:
      '[Standard] Get one canonical actor by id or alias, including live body and recent work signals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actor_id: {
          type: 'string',
          description: 'Actor id or alias, such as "navigator", "cartographer", or "coxswain".',
        },
        project: {
          type: 'string',
          description: 'Optional logical project filter (for example, "port-daddy").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sessions and salvage records to inspect per projection.',
        },
      },
      required: ['actor_id'],
    },
  },
  {
    name: 'message_actor',
    description:
      '[Standard] Queue a message to a durable actor mailbox. Does not grant dormant actors live mutation authority.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actor_id: {
          type: 'string',
          description: 'Actor id or alias, such as "navigator", "cartographer", or "coxswain".',
        },
        content: {
          type: 'string',
          description: 'Message content to queue.',
        },
        from: {
          type: 'string',
          description: 'Sender agent id or operator label.',
        },
        type: {
          type: 'string',
          description: 'Optional message type.',
        },
        wake: {
          type: 'boolean',
          description: 'Try to hail the compatibility fleet body when one exists.',
        },
        project: {
          type: 'string',
          description: 'Optional project hint for wake routing.',
        },
      },
      required: ['actor_id', 'content'],
    },
  },
  {
    name: 'list_actor_inbox',
    description:
      '[Standard] Read recent messages queued to a durable actor mailbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actor_id: {
          type: 'string',
          description: 'Actor id or alias, such as "navigator", "cartographer", or "coxswain".',
        },
        unread_only: {
          type: 'boolean',
          description: 'Only return unread messages.',
        },
        limit: {
          type: 'number',
          description: 'Maximum messages to return.',
        },
        since: {
          type: 'number',
          description: 'Only return messages created after this epoch-millis timestamp.',
        },
      },
      required: ['actor_id'],
    },
  },
  {
    name: 'get_actor_inbox_stats',
    description:
      '[Standard] Read mailbox depth for a durable actor.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actor_id: {
          type: 'string',
          description: 'Actor id or alias, such as "navigator", "cartographer", or "coxswain".',
        },
      },
      required: ['actor_id'],
    },
  },

  // ── Salvage (Agent Resurrection) ─────────────────────────────────────
  {
    name: 'check_salvage',
    description:
      '[Essential] Check the salvage queue for dead agents whose work can be continued. ' +
      'Run this at the start of every session before beginning new work — another agent may have ' +
      'died mid-task with work you should continue. When an agent dies, its session, notes, and ' +
      'file claims are preserved for pickup. ' +
      'Usage: check_salvage({project: "myapp"}) to filter to your project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Filter to agents in this project',
        },
      },
    },
  },
  {
    name: 'claim_salvage',
    description:
      '[Standard] Claim a dead agent from the salvage queue to continue its work. ' +
      'Returns the dead agent\'s session context, notes, and purpose.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dead_agent_id: {
          type: 'string',
          description: 'ID of the dead agent to claim',
        },
        new_agent_id: {
          type: 'string',
          description: 'Your agent ID (the one continuing the work)',
        },
      },
      required: ['dead_agent_id', 'new_agent_id'],
    },
  },
  {
    name: 'salvage_complete',
    description: '[Standard] Mark a resurrection/salvage as complete after finishing the dead agent\'s work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dead_agent_id: {
          type: 'string',
          description: 'ID of the dead agent whose work was completed',
        },
        new_agent_id: {
          type: 'string',
          description: 'Your agent ID (the one who completed the work)',
        },
      },
      required: ['dead_agent_id', 'new_agent_id'],
    },
  },
  {
    name: 'salvage_abandon',
    description: '[Standard] Return a dead agent to the salvage queue (another agent will try).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dead_agent_id: {
          type: 'string',
          description: 'ID of the dead agent to return to queue',
        },
      },
      required: ['dead_agent_id'],
    },
  },
  {
    name: 'salvage_dismiss',
    description: '[Advanced] Permanently dismiss a dead agent from the salvage queue without completing the work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dead_agent_id: {
          type: 'string',
          description: 'ID of the dead agent to dismiss',
        },
      },
      required: ['dead_agent_id'],
    },
  },

  // ── Agent Inbox ───────────────────────────────────────────────────────
  {
    name: 'inbox_send',
    description: '[Advanced] Send a direct message to another agent\'s inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Recipient agent ID',
        },
        content: {
          type: 'string',
          description: 'Message content',
        },
        from: {
          type: 'string',
          description: 'Sender agent ID (optional)',
        },
        type: {
          type: 'string',
          description: 'Message type (default: message)',
        },
      },
      required: ['agent_id', 'content'],
    },
  },
  {
    name: 'inbox_read',
    description: '[Advanced] Read messages from an agent\'s inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID whose inbox to read',
        },
        unread_only: {
          type: 'boolean',
          description: 'Only return unread messages',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'inbox_stats',
    description: '[Advanced] Get inbox statistics (total and unread count) for an agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to get stats for',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'inbox_mark_read',
    description: '[Advanced] Mark a specific inbox message as read.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID',
        },
        message_id: {
          type: 'number',
          description: 'Message ID to mark as read',
        },
      },
      required: ['agent_id', 'message_id'],
    },
  },
  {
    name: 'inbox_mark_all_read',
    description: '[Advanced] Mark all messages in an agent\'s inbox as read.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'inbox_clear',
    description: '[Advanced] Delete all messages from an agent\'s inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID whose inbox to clear',
        },
      },
      required: ['agent_id'],
    },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────
  {
    name: 'webhook_add',
    description: '[Advanced] Register a webhook to receive Port Daddy event notifications. Events are delivered via HTTP POST to the specified URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Webhook URL to deliver events to',
        },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types to subscribe to (e.g. ["service.claim", "agent.register"])',
        },
        secret: {
          type: 'string',
          description: 'Optional HMAC signing secret for payload verification',
        },
        filter_pattern: {
          type: 'string',
          description: 'Optional service identity pattern filter',
        },
      },
      required: ['url', 'events'],
    },
  },
  {
    name: 'webhook_list',
    description: '[Advanced] List all registered webhooks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Only show active webhooks',
        },
      },
    },
  },
  {
    name: 'webhook_events',
    description: '[Advanced] List all available webhook event types that can be subscribed to.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'webhook_get',
    description: '[Advanced] Get details for a specific webhook by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'Webhook ID to retrieve',
        },
      },
      required: ['webhook_id'],
    },
  },
  {
    name: 'webhook_update',
    description: '[Advanced] Update a webhook\'s URL, events, or active status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'Webhook ID to update',
        },
        url: {
          type: 'string',
          description: 'New webhook URL',
        },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'New event types to subscribe to',
        },
        active: {
          type: 'boolean',
          description: 'Enable or disable the webhook',
        },
      },
      required: ['webhook_id'],
    },
  },
  {
    name: 'webhook_remove',
    description: '[Advanced] Remove a webhook registration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'Webhook ID to remove',
        },
      },
      required: ['webhook_id'],
    },
  },
  {
    name: 'webhook_test',
    description: '[Advanced] Send a test delivery to a webhook to verify it is working.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'Webhook ID to test',
        },
      },
      required: ['webhook_id'],
    },
  },
  {
    name: 'webhook_deliveries',
    description: '[Advanced] List delivery history for a webhook.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'Webhook ID to get deliveries for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of deliveries to return (default: 50)',
        },
      },
      required: ['webhook_id'],
    },
  },

  // ── Integration Signals ────────────────────────────────────────────
  {
    name: 'integration_ready',
    description:
      '[Advanced] Signal that your service is ready for integration. Other agents watching for this signal will be notified.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service: { type: 'string', description: 'Service identity that is ready' },
        payload: { type: 'object', description: 'Additional metadata about the ready state' },
      },
      required: ['service'],
    },
  },
  {
    name: 'integration_needs',
    description:
      '[Advanced] Signal that you need another service to be ready before continuing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service: { type: 'string', description: 'Service identity you need' },
        payload: { type: 'object', description: 'Details about what you need' },
      },
      required: ['service'],
    },
  },
  {
    name: 'integration_list',
    description: '[Advanced] List all integration signal channels.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Briefing ───────────────────────────────────────────────────────
  {
    name: 'briefing_generate',
    description:
      '[Advanced] Generate a project briefing for onboarding new agents. Captures current state of services, sessions, agents, and recent activity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_root: { type: 'string', description: 'Project root directory' },
      },
    },
  },
  {
    name: 'briefing_read',
    description: '[Advanced] Read the most recent briefing for a project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_root: { type: 'string', description: 'Project root directory' },
      },
    },
  },

  // ── DNS ────────────────────────────────────────────────────────────
  {
    name: 'dns_register',
    description:
      '[Advanced] Register a local DNS record (.local hostname) for a claimed service.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostname: { type: 'string', description: 'Hostname to register (e.g. "myapp-api")' },
        target: { type: 'string', description: 'Target IP (default: 127.0.0.1)' },
        port: { type: 'number', description: 'Port number' },
        service: { type: 'string', description: 'Associated service identity' },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'dns_unregister',
    description: '[Advanced] Remove a local DNS record.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostname: { type: 'string', description: 'Hostname to unregister' },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'dns_list',
    description: '[Advanced] List all registered local DNS records.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'dns_lookup',
    description: '[Advanced] Look up a specific DNS record by hostname.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostname: { type: 'string', description: 'Hostname to look up' },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'dns_cleanup',
    description: '[Advanced] Clean up stale DNS records for services that no longer exist.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'dns_status',
    description: '[Advanced] Check DNS system status (mDNS/Bonjour availability).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'dns_setup',
    description: '[Advanced] Set up /etc/hosts resolution for Port Daddy DNS records.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'dns_teardown',
    description: '[Advanced] Remove Port Daddy managed section from /etc/hosts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'dns_sync',
    description: '[Advanced] Rebuild /etc/hosts from DNS registry.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Tunnels ──────────────────────────────────────────────────────────
  {
    name: 'start_tunnel',
    description:
      '[Advanced] Start a public tunnel for a claimed service. Makes your local dev server ' +
      'accessible via a public URL. Requires cloudflared, ngrok, or localtunnel installed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity to tunnel',
        },
        provider: {
          type: 'string',
          enum: ['cloudflared', 'ngrok', 'localtunnel'],
          description: 'Tunnel provider (auto-detected if omitted)',
        },
      },
      required: ['identity'],
    },
  },
  {
    name: 'stop_tunnel',
    description: '[Advanced] Stop an active tunnel for a service.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity whose tunnel to stop',
        },
      },
      required: ['identity'],
    },
  },
  {
    name: 'list_tunnels',
    description: '[Advanced] List all active tunnels with their public URLs.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Projects ─────────────────────────────────────────────────────────
  {
    name: 'scan_project',
    description:
      '[Advanced] Deep-scan a directory to detect all services, frameworks, and dependencies. ' +
      'Detects 60+ frameworks (Next.js, Vite, Express, FastAPI, Django, Go, Rust, etc.). ' +
      'Can generate a .portdaddyrc configuration file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to scan (defaults to current working directory)',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview results without saving configuration',
        },
      },
    },
  },
  {
    name: 'list_projects',
    description: '[Standard] List all registered projects with their service counts and metadata. Supports wildcard patterns for IDs and tags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Filter by project ID or tag pattern (e.g. "myapp:*" or "frontend")',
        },
      },
    },
  },
  {
    name: 'get_project',
    description: '[Standard] Get full details for a registered project by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to retrieve',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'delete_project',
    description: '[Advanced] Remove a project from the registry.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to remove',
        },
      },
      required: ['project_id'],
    },
  },

  // ── Changelog ─────────────────────────────────────────────────────────
  {
    name: 'changelog_add',
    description: '[Standard] Add a changelog entry linked to an identity, session, or agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Semantic identity for the changelog entry (e.g. "myapp:api")',
        },
        summary: {
          type: 'string',
          description: 'Short summary of the change',
        },
        type: {
          type: 'string',
          enum: ['feature', 'fix', 'refactor', 'docs', 'chore', 'breaking'],
          description: 'Change type (default: chore)',
        },
        description: {
          type: 'string',
          description: 'Detailed description (optional)',
        },
        session_id: {
          type: 'string',
          description: 'Session ID to associate (optional)',
        },
        agent_id: {
          type: 'string',
          description: 'Agent ID to associate (optional)',
        },
      },
      required: ['identity', 'summary'],
    },
  },
  {
    name: 'changelog_list',
    description: '[Standard] List recent changelog entries, optionally filtered by identity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Filter by identity prefix (e.g. "myapp" or "myapp:api")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 50)',
        },
        since: {
          type: 'number',
          description: 'Return entries since this Unix timestamp (ms)',
        },
      },
    },
  },
  {
    name: 'changelog_get',
    description: '[Standard] Get a single changelog entry by numeric ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'Changelog entry ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'changelog_identities',
    description: '[Standard] List all distinct identities that have changelog entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'changelog_by_session',
    description: '[Standard] List changelog entries associated with a specific session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to filter by',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'changelog_by_agent',
    description: '[Standard] List changelog entries associated with a specific agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to filter by',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 50)',
        },
      },
      required: ['agent_id'],
    },
  },

  // ── Activity ──────────────────────────────────────────────────────────
  {
    name: 'activity_log',
    description: '[Advanced] View recent activity log entries (audit trail).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 20)',
        },
        type: {
          type: 'string',
          description: 'Filter by activity type',
        },
      },
    },
  },
  {
    name: 'activity_summary',
    description: '[Advanced] Get activity summary grouped by type since a given timestamp.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: {
          type: 'number',
          description: 'Unix timestamp (ms) to summarize from (default: beginning)',
        },
      },
    },
  },
  {
    name: 'activity_stats',
    description: '[Advanced] Get overall activity log statistics.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'activity_range',
    description: '[Advanced] Get activity log entries within a time range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start: {
          type: 'number',
          description: 'Start Unix timestamp (ms) — required',
        },
        end: {
          type: 'number',
          description: 'End Unix timestamp (ms) (default: now)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 1000)',
        },
      },
      required: ['start'],
    },
  },

  // ── System ───────────────────────────────────────────────────────────
  {
    name: 'daemon_status',
    description:
      '[Standard] Check Port Daddy daemon status including version, uptime, active ports, and health.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_version',
    description: '[Standard] Get daemon version, code hash, start time, and Node.js info.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_metrics',
    description: '[Standard] Get daemon metrics including active ports, uptime, and error counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_config',
    description: '[Standard] Get the resolved .portdaddyrc configuration for a directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to look for .portdaddyrc (defaults to current working directory)',
        },
      },
    },
  },
  {
    name: 'wait_for_service',
    description: '[Standard] Wait for a service to become healthy (polling until it responds). Useful for startup coordination.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identity: {
          type: 'string',
          description: 'Service identity to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum wait time in milliseconds (default: 60000, max: 300000)',
        },
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple service identities to wait for simultaneously (use instead of identity)',
        },
      },
    },
  },

  // ── FleetControl: Bonds, Wallets, Budgets, Panic ─────────────────────
  {
    name: 'list_bonds',
    description: '[Standard] List bond escrow rows, optionally filtered by project, state, and limit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Optional project filter' },
        state: { type: 'string', description: 'Optional state: escrowed, running, exiting, refunded, slashed' },
        limit: { type: 'number', description: 'Maximum rows (default 200)' },
      },
    },
  },
  {
    name: 'get_bond',
    description: '[Standard] Get one bond escrow row by id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Bond id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'slash_bond',
    description: '[Advanced] Manually slash a bond with an audited reason.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Bond id' },
        portion: { type: 'number', description: 'USD amount to slash' },
        reason: { type: 'string', description: 'Audited slash reason' },
      },
      required: ['id', 'portion', 'reason'],
    },
  },
  {
    name: 'list_wallets',
    description: '[Standard] List project wallets with balances and daily budgets.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_wallet',
    description: '[Standard] Get one project wallet plus conservation totals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name' },
      },
      required: ['project'],
    },
  },
  {
    name: 'top_up_wallet',
    description: '[Advanced] Credit governance-accounting USD to a project wallet.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name' },
        usd: { type: 'number', description: 'Positive USD amount' },
      },
      required: ['project', 'usd'],
    },
  },
  {
    name: 'set_wallet_budget',
    description: '[Advanced] Set or clear the daily budget required before project agent spawns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name' },
        usd_per_day: { type: 'number', description: 'Positive daily USD budget; omit or null to clear' },
      },
      required: ['project'],
    },
  },
  {
    name: 'list_budget_pending',
    description: '[Standard] List pending budget-breach kills during the pause-and-ask grace window.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_budget_pending',
    description: '[Standard] Get one pending budget-breach kill by agent id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent id with pending budget kill' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'resolve_budget_pending',
    description: '[Advanced] Resolve a pending budget kill with raise, kill, or grace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent id with pending budget kill' },
        action: { type: 'string', description: 'raise, kill, or grace' },
        top_up_usd: { type: 'number', description: 'Required for action=raise' },
        new_budget_usd_per_day: { type: 'number', description: 'Optional new daily budget for action=raise' },
        operator: { type: 'string', description: 'Operator/auditor label' },
      },
      required: ['agent_id', 'action'],
    },
  },
  {
    name: 'get_panic_status',
    description: '[Standard] Get fleet panic status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'arm_fleet_panic',
    description: '[Advanced] Arm the two-step fleet panic kill switch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Required panic reason' },
        confirm: { type: 'boolean', description: 'Set true on the second matching call to arm' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'disarm_fleet_panic',
    description: '[Advanced] Clear fleet panic state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Required disarm reason' },
      },
      required: ['reason'],
    },
  },

  // ── Meta-Tool (Progressive Disclosure) ─────────────────────────────
  {
    name: 'get_launch_hints',
    description:
      '[Essential] Get context-aware startup hints for the current project: salvage queue summary ' +
      '(dead agents whose work can be resumed), whether the folder is new to Port Daddy, and ' +
      'ordered onboarding nudges. Call at the start of a session to check for dead agents ' +
      'before starting fresh work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cwd: {
          type: 'string',
          description: 'Current working directory path. Used to filter salvage hints to the current project and detect new folders.',
        },
      },
    },
  },
  // ── Magic Tools (high-level composed operations for vibe coders) ──────
  {
    name: 'fleet_init',
    description:
      '[Magic] Set up a background agent fleet in the current project. Creates pd-fleet.yml ' +
      '(5 agents: QA, documentarian, cartographer, spark, spider), installs a git post-commit hook, ' +
      'and creates output directories. After this, every git commit triggers your fleet automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cwd: { type: 'string', description: 'Project directory to initialize fleet in' },
      },
    },
  },
  {
    name: 'fleet_status',
    description:
      '[Magic] What is the fleet doing right now? Returns all spawned agents, their status, ' +
      'recent fleet channel messages, and the latest output from spark/spider/cartographer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Project slug to isolate fleet notes and agents (e.g. "port-daddy"). Omit only for an intentional global read.',
        },
      },
    },
  },
  {
    name: 'active_agent_roster',
    description:
      '[Magic] Live harness roster for this repo. Lists active agents by harness lane, worktree, task, touched files, ' +
      'and control affordances for stream, interrupt, takeover, and steering.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Filter to a specific project (e.g. "port-daddy"). Omit for all.' },
      },
    },
  },
  {
    name: 'swarm_awareness',
    description:
      '[Magic] Who else is working here? Returns all active agents with their identities, purposes, ' +
      'file claims, session notes, heartbeat freshness, harness lane, and session-control affordances. One call to understand the whole swarm.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Filter to a specific project (e.g. "myapp"). Omit for all.' },
      },
    },
  },
  {
    name: 'sitrep',
    description:
      '[Magic] Situation report — what happened while I was away? Returns a synthesis of: ' +
      'recent activity, session notes from active and completed sessions, dead agents in the ' +
      'salvage queue, and any fleet agent output (spark ideas, spider connections, cartographer ' +
      'status). Maritime voice (fits mayday/pan-pan/securite). CLI: `pd sitrep` or `pd look`.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since_minutes: { type: 'number', description: 'How far back to look (default: 60 minutes)' },
        project: { type: 'string', description: 'Scope salvage queue to a project (optional)' },
        stack: { type: 'string', description: 'Scope salvage queue to a stack (optional)' },
      },
    },
  },
  {
    name: 'catch_me_up',
    description:
      '[DEPRECATED 3.8.4 — use sitrep] Identical to `sitrep`. Kept for back-compat with agents ' +
      'that already call this name. New callers should use `sitrep`.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since_minutes: { type: 'number', description: 'How far back to look (default: 60 minutes)' },
        project: { type: 'string', description: 'Scope notes and salvage queue to a project (optional)' },
        stack: { type: 'string', description: 'Scope salvage queue to a stack (optional)' },
      },
    },
  },
  {
    name: 'file_heat',
    description:
      '[Magic] Which files are agents fighting over? Returns the pheromone file heat map — ' +
      'files ranked by contention, with conflict markers where multiple agents claim the same file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Filter to a directory prefix (e.g. "src/lib/")' },
      },
    },
  },
  {
    name: 'talk_to_agent',
    description:
      '[Magic] Send a message to a specific fleet agent by name. Uses the agent inbox for ' +
      'direct delivery. The agent will see the message on its next run.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent: { type: 'string', description: 'Agent name or identity (e.g. "spider", "myapp:fleet:qa")' },
        message: { type: 'string', description: 'The message to send' },
        type: { type: 'string', description: 'Message type (default: "request")' },
        project: { type: 'string', description: 'Project slug used to resolve short fleet names (e.g. "workgroup-ai" makes "cartographer" target "workgroup-ai:fleet:cartographer").' },
      },
      required: ['agent', 'message'],
    },
  },
  {
    name: 'spawn',
    description:
      '[Magic] Spawn a background AI run with a task. The run gets its own session, ' +
      'heartbeat, and coordination — all automatic. Returns the spawned run metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'What the agent should do' },
        identity: { type: 'string', description: 'Semantic identity (e.g. "myapp:fleet:custom-agent")' },
        budget_usd: { type: 'number', description: 'Required spend ceiling for this launch in USD' },
        backend: { type: 'string', description: 'LLM backend: cloudflare, claude, claude-cli, gemini, codex, cli:claude-code, cli:codex, cli:agy, aider, custom, or another setup-ready backend' },
        model: { type: 'string', description: 'Optional explicit model override' },
        model_tier: { type: 'string', description: 'Optional model tier shortcut: low, mid, or high' },
        purpose: { type: 'string', description: 'Optional short human-readable label for the run' },
        files: { type: 'array', description: 'Optional focused file list, mainly for aider-backed runs', items: { type: 'string' } },
        workdir: { type: 'string', description: 'Optional working directory override' },
        timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
        allowed_tools: { type: 'string', description: 'Comma-separated tool list (e.g. "Read,Grep,Glob,Write")' },
        max_tokens: { type: 'number', description: 'Optional token ceiling for claude or claude-cli launches' },
      },
      required: ['task', 'identity', 'budget_usd'],
    },
  },
  // ── App-Native Development Cockpit ────────────────────────────────────
  {
    name: 'cockpit_missions_list',
    description:
      '[Cockpit] Read the project\'s roadmap into typed mission cards (work-queue intake for ' +
      'the App-Native Development Cockpit). Sources: docs/recovery/CURRENT-WORK.md, ' +
      'docs/recovery/UNIFIED-ROADMAP.md, .cartographer/status.md. Returns mission cards with ' +
      'explicit status (closed/blocked/drifting/stalled/uncommitted/in-flight/etc.), summary, ' +
      'evidence bullets, and the files each mission touches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Project directory to read. Defaults to the daemon\'s repoRoot.' },
        status: {
          type: 'array',
          description: 'Filter to one or more statuses (e.g. ["blocked", "uncommitted"]).',
          items: { type: 'string' },
        },
        limit: { type: 'number', description: 'Optional cap on returned missions.' },
      },
    },
  },
  // ── Tuple Space ──────────────────────────────────────────────────────
  {
    name: 'tuple_out',
    description:
      '[Coordination] Write a typed tuple to the shared space. Other agents can read it by pattern. Scoped to harbors for fleet isolation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fields: { type: 'array', description: 'Tuple fields as a JSON array (e.g. ["connection", "trie+pubsub", "spider", 0.9])' },
        harbor: { type: 'string', description: 'Harbor scope (e.g. "myapp:fleet"). Omit for global.' },
        written_by: { type: 'string', description: 'Agent identity that wrote this tuple' },
        ttl_ms: { type: 'number', description: 'Time-to-live in milliseconds. Tuple auto-expires after this.' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'tuple_read',
    description:
      '[Coordination] Read tuples matching a pattern. Use null in pattern positions as wildcards (e.g. ["connection", null] matches any tuple starting with "connection").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'array', description: 'Pattern to match — use null for wildcard positions (e.g. ["connection", null])' },
        harbor: { type: 'string', description: 'Harbor scope. Omit for global.' },
        limit: { type: 'number', description: 'Maximum number of tuples to return (default: 50)' },
      },
    },
  },
  {
    name: 'tuple_take',
    description:
      '[Coordination] Take (atomically read + remove) tuples matching a pattern. Like tuple_read but removes matched tuples from the space.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'array', description: 'Pattern to match — use null for wildcard positions' },
        harbor: { type: 'string', description: 'Harbor scope. Omit for global.' },
        limit: { type: 'number', description: 'Maximum number of tuples to take (default: 1)' },
      },
    },
  },
  {
    name: 'tuple_scan',
    description:
      '[Coordination] List all tuples in a harbor (or global space). Useful for debugging and visibility.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        harbor: { type: 'string', description: 'Harbor scope. Omit for global.' },
        limit: { type: 'number', description: 'Maximum number of tuples to return (default: 100)' },
      },
    },
  },
  {
    name: 'tuple_count',
    description:
      '[Coordination] Count tuples matching a pattern (or all tuples in a harbor).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'array', description: 'Pattern to match — use null for wildcard positions. Omit to count all.' },
        harbor: { type: 'string', description: 'Harbor scope. Omit for global.' },
      },
    },
  },
  {
    name: 'graph_edges',
    description:
      '[Semantic] List semantic graph edges emitted by symbol indexing and merge orchestration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Optional project directory filter.' },
        scope: { type: 'string', description: 'Optional scope filter such as symbols:file:/abs/path.ts.' },
        source_type: { type: 'string', description: 'Optional source entity type filter.' },
        source_id: { type: 'string', description: 'Optional source entity id filter.' },
        edge_type: { type: 'string', description: 'Optional edge type filter.' },
        target_type: { type: 'string', description: 'Optional target entity type filter.' },
        target_id: { type: 'string', description: 'Optional target entity id filter.' },
        query: { type: 'string', description: 'Optional text search filter.' },
        limit: { type: 'number', description: 'Optional maximum number of edges to return.' },
      },
    },
  },
  {
    name: 'graph_stats',
    description:
      '[Semantic] Summarize graph edge counts for a project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Optional project directory filter.' },
      },
    },
  },
  {
    name: 'memory_episodes',
    description:
      '[Semantic] List episodic memory entries promoted from sessions and spawned runs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Optional project directory filter.' },
        project: { type: 'string', description: 'Optional logical project filter.' },
        harbor: { type: 'string', description: 'Optional harbor filter.' },
        agent_id: { type: 'string', description: 'Optional agent filter.' },
        episode_type: { type: 'string', description: 'Optional episode type filter.' },
        query: { type: 'string', description: 'Optional text search filter.' },
        limit: { type: 'number', description: 'Optional maximum number of episodes to return.' },
      },
    },
  },
  {
    name: 'memory_stats',
    description:
      '[Semantic] Summarize episodic memory counts for a project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Optional project directory filter.' },
        project: { type: 'string', description: 'Optional logical project filter.' },
      },
    },
  },
  {
    name: 'drop_feedback',
    description:
      '[Essential] Drop structured feedback about a Port Daddy primitive ' +
      'or about the project you are working on. Cartographer (or any ' +
      'subscriber) harvests these into the roadmap. Use whenever a ' +
      "primitive surprises you, doesn't behave as expected, or you " +
      'notice a gap. The point: agentic feedback is how the code gets ' +
      'better. Be terse — slug + summary is enough; surface/severity/' +
      'hook/suggested are optional but useful. ' +
      'Usage: drop_feedback({slug: "pd-say-flag-mismatch", summary: ' +
      '"server expects --session/--agent, CLI says --as", surface: ' +
      '"CLI", severity: "high", hook: "pd say --as ada", suggested: ' +
      '"translate flag names server-side"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Short kebab-case identifier (unique-ish)' },
        summary: { type: 'string', description: 'One-line description of the finding' },
        surface: { type: 'string', description: 'Where you hit it: CLI, API, MCP, dashboard, fleet, ...' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Default: medium' },
        hook: { type: 'string', description: 'Concrete reproduction hook (command, payload, log line)' },
        suggested: { type: 'string', description: 'Suggested direction or fix' },
        project: { type: 'string', description: 'Project slug this feedback belongs to' },
        harbor: { type: 'string', description: 'Harbor namespace for scoping. Defaults to <project>:fleet when project is supplied; otherwise legacy fleet.' },
      },
      required: ['slug', 'summary'],
    },
  },
  {
    name: 'submit_visual_task',
    description:
      '[Standard] Submit visual evidence as a Port Daddy work item from any MCP client. ' +
      'Use this when an agent has a screenshot, selected rectangle, DOM hint, or browser ' +
      'context that should become a reviewable issue for a local agent, cloud fleet, or ' +
      'review queue. Mirrors the Chrome extension and FleetBar visual intake route without ' +
      'exposing dispatch/worker internals to the caller.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short issue title. Defaults to description.' },
        description: { type: 'string', description: 'What is wrong or what the agent should do.' },
        kind: { type: 'string', enum: ['fix', 'bug', 'nit', 'feedback', 'question'], description: 'Task flavor. Default: fix.' },
        project: { type: 'string', description: 'Logical project slug.' },
        project_dir: { type: 'string', description: 'Absolute project directory for repo-aware routing.' },
        page_url: { type: 'string', description: 'URL of the page or app where the issue was captured.' },
        target_agent: { type: 'string', description: 'Specific local agent id to receive the task.' },
        assignee: { type: 'string', enum: ['local-agent', 'cloud-fleet', 'review-queue'], description: 'Where to route the work. Default: review-queue unless a target_agent is supplied.' },
        open_issue: { type: 'boolean', description: 'Open a reviewable Port Daddy work item. Default: true.' },
        start_agent: { type: 'boolean', description: 'Ask the daemon to wake/run the assigned agent after routing. Default: false.' },
        image: { type: 'object', description: 'Screenshot evidence, usually {mimeType, dataUrl} or an existing blobId.' },
        region: { type: 'object', description: 'Selected rectangle in image or viewport coordinates.' },
        dom_context: { type: 'object', description: 'DOM decomposition: selectors, XPath, bounds, source hints, and page title.' },
        viewport: { type: 'object', description: 'Viewport metadata such as width, height, and devicePixelRatio.' },
      },
      required: ['description'],
    },
  },
  {
    name: 'list_feedback',
    description:
      '[Standard] List feedback entries. Filter by severity, surface, ' +
      'or status (open/harvested). Returns severity-sorted entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        surface: { type: 'string' },
        status: { type: 'string', enum: ['open', 'harvested', 'wontfix', 'all'] },
        harbor: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'feedback_summary',
    description:
      '[Standard] Summary counts of feedback grouped by severity and ' +
      'surface. Useful for dashboards or for cartographer to decide ' +
      'what to harvest next.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        harbor: { type: 'string' },
      },
    },
  },
  {
    name: 'pd_discover',
    description:
      '[Essential] List available Port Daddy tool categories and their tools. ' +
      'In default mode, only essential tools are loaded. Use this to discover ' +
      'additional tools by category, then call them directly by name. ' +
      'Categories: session-lifecycle, advisor, ports, sessions, notes, locks, messaging, agents, actors, inbox, ' +
      'webhooks, integration, dns, briefing, tunnels, projects, changelog, activity, system, tuples, semantic.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category to get detailed tool info for (e.g. "dns", "agents", "webhooks"). Omit to list all categories.',
        },
      },
    },
  },

  // ── Context Economics ───────────────────────────────────────────────────
  {
    name: 'get_context_budget',
    description:
      '[Context] Get effective context window health for the calling agent. ' +
      'Returns tokensUsed, effectiveMax, usedPct, pressureLevel (ok/warn/critical), and remaining. ' +
      'Call this to check whether you are approaching context pressure before starting expensive work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to check (defaults to calling agent)',
        },
      },
    },
  },
  {
    name: 'get_context_overview',
    description:
      '[Context] Get swarm-wide context health summary. ' +
      'Returns all agents with their context pressure, daily cost, and pending approvals. ' +
      'Includes swarm daily cost and custodian status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_filter: {
          type: 'string',
          description: 'Optional project prefix to filter agents (e.g. "port-daddy")',
        },
      },
    },
  },
  {
    name: 'get_task_ledger',
    description:
      '[Context] Get per-spawn COGS ledger rows for cost attribution. ' +
      'Returns token counts, cost, and landed work (pr/commit/episode) per spawned run. ' +
      'Use for debugging cost overruns or verifying that spawned work landed durable artifacts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Filter to a specific agent ID',
        },
        since: {
          type: 'string',
          description: 'ISO timestamp — only rows after this date',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default 50)',
        },
      },
    },
  },
  {
    name: 'harvest_session',
    description:
      '[Context] Promote all notes from a session into durable episodic memory. ' +
      'Call this before a session ends to ensure notes survive session cleanup. ' +
      'Idempotent — safe to call multiple times. Returns episode IDs created.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to harvest notes from',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'find_related_work',
    description:
      '[Context] Search episodic memory for similar past work by purpose/description. ' +
      'Use before starting a task to avoid duplicating completed work. ' +
      'Returns episode stubs with IDs and retrieval commands.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        purpose: {
          type: 'string',
          description: 'Description of the work you are about to start',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 5)',
        },
      },
      required: ['purpose'],
    },
  },
  {
    name: 'custodian_status',
    description:
      '[Custodian] Get status of the Knowledge Custodian daemon loop — running state, duty timestamps, ' +
      'episodes harvested today, pending HITL approval count.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_pending_approvals',
    description:
      '[Custodian] List operator permission patterns that have been suggested for auto-approval ' +
      '(3+ consecutive approvals of same kind/project). Each item includes a human-readable message ' +
      'for the operator to approve or deny.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'resolve_approval',
    description:
      '[Custodian] Accept or deny a meta-permission candidate. Accepting flips the policy to "auto" ' +
      'so future operations of that kind are approved without asking.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern_id: {
          type: 'number',
          description: 'ID of the permission pattern to resolve',
        },
        decision: {
          type: 'string',
          enum: ['approved', 'denied'],
          description: '"approved" to flip policy to auto, "denied" to reset and keep asking',
        },
      },
      required: ['pattern_id', 'decision'],
    },
  },

  // ── Harbor Editor region claims (P3 slice 3) — agent-neutral, on the same surface ──
  {
    name: 'claim_region',
    description:
      '[Standard] Claim a REGION (a 1-based inclusive line span) of one file for the active session — ' +
      'the editor-coordination primitive. Region-scoped, never a whole-file lock: two actors edit adjacent ' +
      'regions of one file concurrently. First-class for every backend (agent-neutral). On contention the ' +
      'first-granted live claim wins; a contender is refused with a typed note offering handoff / parley / ' +
      'another region — never a bypass.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        agent_id: { type: 'string', description: 'Acting agent identity (required — the daemon authorizes the claim on it)' },
        path: { type: 'string', description: 'File path the region lives in' },
        start_line: { type: 'number', description: 'First claimed line, 1-based inclusive' },
        end_line: { type: 'number', description: 'Last claimed line, 1-based inclusive' },
        symbol: { type: 'string', description: 'The work symbol/label for this region (e.g. "parse_header")' },
        symbol_path: { type: 'string', description: 'Optional canonical tree-sitter symbol path' },
      },
      required: ['session_id', 'agent_id', 'path', 'start_line', 'end_line', 'symbol'],
    },
  },
  {
    name: 'release_region',
    description:
      '[Standard] Release a previously claimed region of a file for the active session. Agent-neutral; ' +
      'releasing frees the span for any actor to claim next.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        agent_id: { type: 'string', description: 'Acting agent identity (required — the daemon authorizes the release on it)' },
        path: { type: 'string', description: 'File path the region lives in' },
        start_line: { type: 'number', description: 'First claimed line, 1-based inclusive' },
        end_line: { type: 'number', description: 'Last claimed line, 1-based inclusive' },
        symbol_path: { type: 'string', description: 'Optional canonical tree-sitter symbol path' },
      },
      required: ['session_id', 'agent_id', 'path', 'start_line', 'end_line'],
    },
  },
];

// ---------------------------------------------------------------------------
// Daemon recovery hint — consistent message for sugar command failures
// ---------------------------------------------------------------------------

const DAEMON_RECOVERY_HINT =
  'Daemon not reachable. Start it with: pd (the daemon auto-starts on first command)';

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  let res: ApiResponse;

  switch (name) {
    // ── Sugar (Compound Operations) ────────────────────────────────────
    case 'begin_session': {
      const body: Record<string, unknown> = { purpose: args.purpose };
      // Forward unconditionally: an empty/malformed value must reach the daemon
      // so its SESSION_LIFECYCLE_REQUIRED error names the real problem instead
      // of being dropped here and failing identically but opaquely.
      body.lifecycle = args.lifecycle;
      if (args.identity) body.identity = args.identity;
      if (args.agent_id) body.agentId = args.agent_id;
      if (args.type) body.type = args.type;
      if (args.files) body.files = args.files;
      // Rent-at-claim (S3): the gate is enforced HERE, at the MCP boundary,
      // with the same semantics as the pd CLI — agents are the dominant
      // programmatic caller and must pay roadmap rent too. Only the daemon's
      // raw HTTP surface stays lenient in v1 (documented in lib/sugar.ts).
      if (args.roadmap) body.roadmapLink = args.roadmap;
      if (args.sidequest) body.sidequestReason = args.sidequest;
      if (args.roadmap_new) body.roadmapNewTitle = args.roadmap_new;
      if (!body.roadmapLink && !body.sidequestReason && !body.roadmapNewTitle) {
        // Bounded env exemption (server-side env, operator-controlled) —
        // mirrors cli/commands/sugar.ts resolveBeginRent.
        const exempt = typeof process.env.PD_RENT_EXEMPT === 'string'
          ? process.env.PD_RENT_EXEMPT.trim().toLowerCase()
          : '';
        if (exempt === 'hotfix' || exempt === 'chore') {
          body.sidequestReason = `PD_RENT_EXEMPT: ${exempt}`;
        } else {
          return JSON.stringify({
            success: false,
            error:
              'begin_session needs a roadmap link or an explicit opt-out. Pass exactly one:\n' +
              '  roadmap: "<slug>"        link this session to an existing roadmap item\n' +
              '  roadmap_new: "<title>"   create a draft roadmap item and link it\n' +
              '  sidequest: "<reason>"    opt out with a one-line reason (min 12 chars)',
            code: 'ROADMAP_RENT_REQUIRED',
          }, null, 2);
        }
      }
      res = await POST('/sugar/begin', body);

      // Attach salvage context — check if any dead agents share this project
      if (res.status >= 200 && res.status < 300 && res.data && typeof res.data === 'object') {
        try {
          const identity = args.identity as string | undefined;
          const project = identity?.split(':')?.[0];
          const qs = project ? `?project=${encodeURIComponent(project)}` : '';
          const salvageRes = await GET(`/salvage/pending${qs}`);
          if (salvageRes.status >= 200 && salvageRes.status < 300 && salvageRes.data) {
            const sd = salvageRes.data as { count?: number; agents?: Array<Record<string, unknown>> };
            if ((sd.count ?? 0) > 0) {
              const agents = (sd.agents ?? []).slice(0, 3).map(a => ({
                id: a.id,
                purpose: a.purpose ?? null,
                identity: [a.identityProject, a.identityStack, a.identityContext].filter(Boolean).join(':') || null,
              }));
              (res.data as Record<string, unknown>).salvage_context = {
                count: sd.count,
                agents,
                recommendation: `${sd.count} dead agent${(sd.count ?? 0) > 1 ? 's' : ''} from this project ${(sd.count ?? 0) > 1 ? 'are' : 'is'} in the salvage queue. Run pd_discover or use list_salvage_queue before starting fresh — you may be able to resume their work.`,
              };
            }
          }
        } catch {
          // salvage context is best-effort — never fail begin_session over it
        }
      }
      break;
    }

    case 'end_session_full': {
      const body: Record<string, unknown> = {};
      if (args.agent_id) body.agentId = args.agent_id;
      if (args.session_id) body.sessionId = args.session_id;
      if (args.note) body.note = args.note;
      if (args.status) body.status = args.status;
      res = await POST('/sugar/done', body);
      break;
    }

    case 'whoami': {
      const qs = args.agent_id ? `?agentId=${encodeURIComponent(args.agent_id as string)}` : '';
      res = await GET(`/sugar/whoami${qs}`);
      break;
    }

    case 'attest': {
      res = await GET('/attest');
      break;
    }

    case 'safe_scan': {
      // READ-ONLY host-safety posture audit (ADR-0088 Phase A, A10). The daemon
      // runs the sensors + records the A5 ledger; the report it returns carries
      // findings with last4 only — NEVER a raw secret value.
      const allow = typeof args.allow === 'string' && args.allow.length > 0
        ? `?allow=${encodeURIComponent(args.allow as string)}`
        : '';
      res = await GET(`/safe/scan${allow}`);
      break;
    }

    case 'relay_status': {
      res = await GET('/relay/status');
      break;
    }

    case 'harbormaster_status': {
      res = await GET('/harbormaster/status');
      break;
    }

    // ── Harbors ─────────────────────────────────────────────────────
    case 'list_harbors': {
      res = await GET('/harbors');
      break;
    }

    case 'get_harbor': {
      res = await GET(`/harbors/${encodeURIComponent(args.name as string)}`);
      break;
    }

    case 'check_harbor_envelope': {
      res = await POST(`/harbors/${encodeURIComponent(args.name as string)}/check`, {
        agentId: args.agent_id,
        action: args.action,
      });
      break;
    }

    case 'whois': {
      const params = new URLSearchParams();
      params.set('q', String(args.query));
      if (args.kind) params.set('kind', String(args.kind));
      if (args.fresh_min !== undefined) params.set('fresh_min', String(args.fresh_min));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      res = await GET(`/whois?${params.toString()}`);
      break;
    }

    // ── Pheromone signals ───────────────────────────────────────────
    case 'spray_pheromone': {
      const body: Record<string, unknown> = {
        table: args.table,
        id: args.id,
        key: args.key,
      };
      if (args.strength !== undefined) body.strength = args.strength;
      res = await POST('/pheromone/spray', body);
      break;
    }

    case 'read_pheromones': {
      res = await GET('/pheromone');
      break;
    }

    case 'read_entity_pheromones': {
      const eff = args.effective ? '?effective=1' : '';
      res = await GET(
        `/pheromone/${encodeURIComponent(args.table as string)}/${encodeURIComponent(args.id as string)}${eff}`,
      );
      break;
    }

    case 'resolve_pheromone': {
      const body: Record<string, unknown> = { table: args.table, id: args.id, key: args.key };
      if (args.strength !== undefined) body.strength = args.strength;
      res = await POST('/pheromone/resolve', body);
      break;
    }

    case 'pheromone_coverage': {
      res = await GET(`/pheromone/coverage/${encodeURIComponent(args.table as string)}`);
      break;
    }

    // ── Roadmap (cartographer projection + items of record) ──────────
    case 'roadmap_progress': {
      res = await GET('/cartographer/roadmap-progress');
      break;
    }

    case 'roadmap_claims': {
      res = await GET('/cartographer/roadmap-claims');
      break;
    }

    case 'roadmap_list': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', args.status as string);
      if (args.harbor) params.set('harbor', args.harbor as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/roadmap/items${qs}`);
      break;
    }

    case 'roadmap_get': {
      res = await GET(`/roadmap/items/${encodeURIComponent(args.slug as string)}`);
      break;
    }

    case 'roadmap_promote': {
      const body: Record<string, unknown> = { slug: args.slug };
      if (args.summaryMd !== undefined) body.summaryMd = args.summaryMd;
      if (args.feedbackId !== undefined) body.feedbackId = args.feedbackId;
      if (args.status !== undefined) body.status = args.status;
      if (args.promotedBy !== undefined) body.promotedBy = args.promotedBy;
      res = await POST('/roadmap/promote', body);
      break;
    }

    // ── Commitments (ADR-0041) ──────────────────────────────────────
    case 'commit': {
      const body: Record<string, unknown> = {
        ownerActorId: args.ownerActorId,
        objectText: args.objectText,
      };
      if (args.successCheck !== undefined) body.successCheck = args.successCheck;
      if (args.impossibleCheck !== undefined) body.impossibleCheck = args.impossibleCheck;
      if (args.motivationCheck !== undefined) body.motivationCheck = args.motivationCheck;
      if (args.scope !== undefined) body.scope = args.scope;
      if (args.commitmentStrategy !== undefined) body.commitmentStrategy = args.commitmentStrategy;
      res = await POST('/commitments', body);
      break;
    }

    case 'list_commitments': {
      res = await GET('/commitments');
      break;
    }

    case 'list_nudges': {
      // agent_id is required by the tool schema — always scope to the caller so an
      // agent can never enumerate every agent's nudges via an unfiltered list.
      const params = new URLSearchParams();
      params.set('agentId', args.agent_id as string);
      params.set('status', (args.status as string) || 'pending');
      res = await GET(`/suggestions?${params.toString()}`);
      break;
    }

    case 'respond_nudge': {
      const action = args.action === 'decline' ? 'decline' : 'accept';
      res = await POST(`/suggestions/${args.id}/${action}`, {});
      break;
    }

    // ── Parley (ADR-0055 forced reconciliation) ─────────────────────
    case 'call_parley': {
      const body: Record<string, unknown> = {
        surface: args.surface,
        reason: args.reason,
        parties: args.parties,
        calledBy: args.calledBy,
      };
      if (args.trigger !== undefined) body.trigger = args.trigger;
      if (args.harbor !== undefined) body.harbor = args.harbor;
      if (args.ttlMs !== undefined) body.ttlMs = args.ttlMs;
      if (args.roundLimit !== undefined) body.roundLimit = args.roundLimit;
      res = await POST('/parley/call', body);
      break;
    }

    case 'list_parleys': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', args.status as string);
      if (args.harbor) params.set('harbor', args.harbor as string);
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/parley${qs}`);
      break;
    }

    case 'get_parley': {
      const as = typeof args.as === 'string' && args.as.trim() ? `?as=${encodeURIComponent(args.as.trim())}` : '';
      res = await GET(`/parley/${encodeURIComponent(args.id as string)}${as}`);
      break;
    }

    case 'respond_parley': {
      const body: Record<string, unknown> = {
        parleyId: args.id,
        party: args.party,
        performative: args.performative,
        content: args.content,
      };
      if (args.proposalId !== undefined) body.proposalId = args.proposalId;
      if (args.evidenceRefs !== undefined) body.evidenceRefs = args.evidenceRefs;
      res = await POST('/parley/respond', body);
      break;
    }

    case 'resolve_parley': {
      const body: Record<string, unknown> = {
        parleyId: args.id,
        status: args.status,
        resolvedBy: args.resolvedBy,
      };
      if (args.decision !== undefined) body.decision = args.decision;
      if (args.reason !== undefined) body.reason = args.reason;
      if (args.dissenters !== undefined) body.dissenters = args.dissenters;
      res = await POST('/parley/resolve', body);
      break;
    }

    case 'list_overdue_commitments': {
      res = await GET('/commitments/overdue');
      break;
    }

    // ── Knowledge (semantic search + symbol index) ──────────────────
    case 'semantic_search': {
      const params = new URLSearchParams();
      params.set('q', args.q as string);
      if (args.limit) params.set('limit', String(args.limit));
      res = await GET(`/semantic/search?${params.toString()}`);
      break;
    }

    case 'semantic_resolve': {
      const params = new URLSearchParams();
      params.set('q', args.q as string);
      if (args.projectDir) params.set('projectDir', args.projectDir as string);
      res = await GET(`/semantic/resolve?${params.toString()}`);
      break;
    }

    case 'find_symbols': {
      const params = new URLSearchParams();
      if (args.name) params.set('name', args.name as string);
      if (args.type) params.set('type', args.type as string);
      if (args.file) params.set('file', args.file as string);
      if (args.exported !== undefined) params.set('exported', String(args.exported));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/symbols${qs}`);
      break;
    }

    case 'symbol_stats': {
      res = await GET('/symbols/stats');
      break;
    }

    case 'blast_radius': {
      const params = new URLSearchParams();
      params.set('file', args.file as string);
      params.set('symbol', args.symbol as string);
      if (args.depth != null) params.set('depth', String(args.depth));
      res = await GET(`/symbols/blast-radius?${params.toString()}`);
      break;
    }

    case 'predict_conflicts': {
      const body: Record<string, unknown> = {};
      if (args.files !== undefined) body.files = args.files;
      if (args.directory !== undefined) body.directory = args.directory;
      if (args.glob !== undefined) body.glob = args.glob;
      res = await POST('/conflicts/predict', body);
      break;
    }

    case 'coordination_preflight': {
      const body: Record<string, unknown> = {};
      if (args.project_root) body.projectRoot = args.project_root;
      if (args.task) body.task = args.task;
      if (args.session_id) body.sessionId = args.session_id;
      if (args.agent_id) body.agentId = args.agent_id;
      if (args.files) body.files = args.files;
      if (args.include_channels) body.includeChannels = true;
      if (args.include_tuple_hints) body.includeTupleHints = true;
      res = await POST('/advisor', body);
      break;
    }

    // ── Port Management ────────────────────────────────────────────────
    case 'claim_port': {
      const body: Record<string, unknown> = { id: args.identity };
      if (args.port) body.port = args.port;
      if (args.range) {
        const [min, max] = (args.range as string).split('-').map(Number);
        body.range = [min, max];
      }
      if (args.expires) body.expires = args.expires;
      res = await POST('/claim', body);
      // Augment successful claim responses
      if (res.status >= 200 && res.status < 300 && res.data && typeof res.data === 'object') {
        const data = res.data as Record<string, unknown>;
        const assignedPort = data.port as number | undefined;
        if (assignedPort) {
          // Warn if the port is already occupied by another process
          const occupied = await isPortInUse(assignedPort);
          if (occupied) {
            data.warning = `⚠️  Port ${assignedPort} is already in use by another process. Stop that process before starting your service, or release this port and claim a different one.`;
          }
        }
        // Nudge toward begin_session — makes this work recoverable via the salvage queue
        const identity = (args.identity as string) || '';
        data.session_nudge = `Port claimed. Start a session to make your work recoverable:\n  begin_session({ identity: '${identity}', purpose: 'Brief description of what you are building' })\nIf you are interrupted or crash, the next agent can resume from the salvage queue.`;
      }
      break;
    }

    case 'release_port': {
      const body: Record<string, unknown> = { id: args.identity };
      if (args.expired_only) body.expiredOnly = true;
      res = await DELETE('/release', body);
      break;
    }

    case 'list_services': {
      const qs = args.pattern ? `?pattern=${encodeURIComponent(args.pattern as string)}` : '';
      res = await GET(`/services${qs}`);
      break;
    }

    case 'get_service': {
      res = await GET(`/services/${encodeURIComponent(args.identity as string)}`);
      break;
    }

    case 'health_check': {
      const path = args.identity
        ? `/services/health/${encodeURIComponent(args.identity as string)}`
        : '/services/health';
      res = await GET(path);
      break;
    }

    case 'list_active_ports': {
      res = await GET('/ports/active');
      break;
    }

    case 'list_system_ports': {
      const params = new URLSearchParams();
      if (args.range_only) params.set('range_only', 'true');
      if (args.unmanaged_only) params.set('unmanaged_only', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/ports/system${qs}`);
      break;
    }

    case 'cleanup_ports': {
      res = await POST('/ports/cleanup');
      break;
    }

    // ── Sessions & Notes ───────────────────────────────────────────────
    case 'start_session': {
      const body: Record<string, unknown> = { purpose: args.purpose };
      if (args.agent) body.agentId = args.agent;
      if (args.files) body.files = args.files;
      res = await POST('/sessions', body);
      break;
    }

    case 'end_session': {
      if (args.session_id) {
        res = await PUT(`/sessions/${args.session_id}`, {
          status: args.status || 'completed',
        });
      } else {
        // Find active session and end it
        const sessions = await GET('/sessions?status=active');
        const active = (sessions.data.sessions as Array<Record<string, unknown>>)?.[0];
        if (!active) {
          return JSON.stringify({ success: false, message: 'No active session found' });
        }
        res = await PUT(`/sessions/${active.id}`, {
          status: args.status || 'completed',
        });
      }
      break;
    }

    case 'get_session': {
      res = await GET(`/sessions/${encodeURIComponent(args.session_id as string)}`);
      break;
    }

    case 'delete_session': {
      res = await DELETE(`/sessions/${encodeURIComponent(args.session_id as string)}`);
      break;
    }

    case 'add_note': {
      const body: Record<string, unknown> = { content: args.content };
      if (args.type) body.type = args.type;
      if (args.session_id) body.sessionId = args.session_id;

      res = await POST('/notes', body);
      break;
    }

    case 'list_sessions': {
      const params = new URLSearchParams();
      if (args.all) params.set('status', 'all');
      if (args.project) params.set('project', args.project as string);
      if (args.agent) params.set('agent', args.agent as string);
      if (args.purpose) params.set('purpose', args.purpose as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/sessions${qs}`);
      break;
    }

    case 'list_notes': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      if (args.project) params.set('project', args.project as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      if (args.session_id) {
        res = await GET(`/sessions/${args.session_id}/notes${qs}`);
      } else {
        res = await GET(`/notes${qs}`);
      }
      break;
    }

    case 'claim_files': {
      res = await POST(`/sessions/${args.session_id}/files`, {
        files: args.paths ?? [],
        regions: args.regions,
        force: args.force,
      });
      break;
    }

    case 'claim_symbols': {
      res = await POST(`/sessions/${args.session_id}/symbols`, {
        claims: args.claims ?? [],
        autoDeriveRadius: args.auto_derive_radius,
        radiusDepth: args.radius_depth,
      });
      break;
    }

    case 'release_files': {
      res = await DELETE(`/sessions/${encodeURIComponent(args.session_id as string)}/files`, {
        files: args.files ?? [],
        regions: args.regions,
      });
      break;
    }

    // ── Harbor Editor region claims (P3 slice 3) — agent-neutral ─────
    case 'claim_region': {
      const { sessionId, body } = claimRegionRequest(args as unknown as ClaimRegionArgs);
      res = await POST(`/sessions/${encodeURIComponent(sessionId)}/files`, body);
      break;
    }

    case 'release_region': {
      const { sessionId, body } = releaseRegionRequest(args as unknown as ReleaseRegionArgs);
      res = await DELETE(`/sessions/${encodeURIComponent(sessionId)}/files`, body);
      break;
    }

    // ── Session Phases ──────────────────────────────────────────────
    case 'set_session_phase': {
      res = await PUT(`/sessions/${encodeURIComponent(args.session_id as string)}/phase`, {
        phase: args.phase,
      });
      break;
    }

    // ── File Claims ─────────────────────────────────────────────────
    case 'list_file_claims': {
      const params = new URLSearchParams();
      if (args.path) params.set('path', args.path as string);
      if (args.symbol) params.set('symbol', args.symbol as string);
      if (args.symbolPath) params.set('symbolPath', args.symbolPath as string);
      if (args.agent) params.set('agent', args.agent as string);
      if (args.purpose) params.set('purpose', args.purpose as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/files${qs}`);
      break;
    }

    case 'who_owns_file': {
      let whoOwnsUrl = `/files/who-owns?path=${encodeURIComponent(args.path as string)}`;
      if (args.startLine) whoOwnsUrl += `&startLine=${args.startLine}`;
      if (args.endLine) whoOwnsUrl += `&endLine=${args.endLine}`;
      if (args.symbolPath) whoOwnsUrl += `&symbolPath=${encodeURIComponent(args.symbolPath as string)}`;
      res = await GET(whoOwnsUrl);
      break;
    }

    // ── Locks ──────────────────────────────────────────────────────────
    case 'acquire_lock': {
      const body: Record<string, unknown> = {};
      if (args.owner) body.owner = args.owner;
      if (args.ttl) body.ttl = args.ttl;
      res = await POST(`/locks/${encodeURIComponent(args.name as string)}`, body);
      break;
    }

    case 'release_lock': {
      const body: Record<string, unknown> = {};
      if (args.owner) body.owner = args.owner;
      if (args.force) body.force = true;
      res = await DELETE(`/locks/${encodeURIComponent(args.name as string)}`, body);
      break;
    }

    case 'list_locks': {
      const qs = args.owner ? `?owner=${encodeURIComponent(args.owner as string)}` : '';
      res = await GET(`/locks${qs}`);
      break;
    }

    // ── Messaging ──────────────────────────────────────────────────────
    case 'publish_message': {
      const body: Record<string, unknown> = { payload: args.payload };
      if (args.sender) body.sender = args.sender;
      res = await POST(`/msg/${encodeURIComponent(args.channel as string)}`, body);
      break;
    }

    case 'get_messages': {
      const qs = args.limit ? `?limit=${args.limit}` : '';
      res = await GET(`/msg/${encodeURIComponent(args.channel as string)}${qs}`);
      break;
    }

    case 'discourse_lineage': {
      const params = new URLSearchParams();
      if (args.conversationId) params.set('conversationId', args.conversationId as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/msg/${encodeURIComponent(args.channel as string)}/lineage${qs}`);
      break;
    }

    case 'list_channels': {
      res = await GET('/channels');
      break;
    }

    case 'clear_channel': {
      res = await DELETE(`/msg/${encodeURIComponent(args.channel as string)}`);
      break;
    }

    // ── Agents ─────────────────────────────────────────────────────────
    case 'register_agent': {
      const body: Record<string, unknown> = {
        id: args.agent_id,
        type: (args.type as string) || 'mcp',
      };
      if (args.identity) body.identity = args.identity;
      if (args.purpose) body.purpose = args.purpose;
      res = await POST('/agents', body);
      break;
    }

    case 'agent_heartbeat': {
      res = await POST(`/agents/${encodeURIComponent(args.agent_id as string)}/heartbeat`);
      break;
    }

    case 'unregister_agent': {
      res = await DELETE(`/agents/${encodeURIComponent(args.agent_id as string)}`);
      break;
    }

    case 'get_agent': {
      res = await GET(`/agents/${encodeURIComponent(args.agent_id as string)}`);
      break;
    }

    case 'list_agents': {
      const params = new URLSearchParams();
      if (args.active_only) params.set('active', 'true');
      if (args.identity) params.set('identity', args.identity as string);
      if (args.purpose) params.set('purpose', args.purpose as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/agents${qs}`);
      break;
    }

    case 'list_actors': {
      const params = new URLSearchParams();
      if (args.project) params.set('project', args.project as string);
      if (typeof args.limit === 'number') params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/actors${qs}`);
      break;
    }

    case 'get_actor': {
      const params = new URLSearchParams();
      if (args.project) params.set('project', args.project as string);
      if (typeof args.limit === 'number') params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/actors/${encodeURIComponent(args.actor_id as string)}${qs}`);
      break;
    }

    case 'message_actor': {
      const body: Record<string, unknown> = {
        content: args.content,
      };
      if (args.from) body.from = args.from;
      if (args.type) body.type = args.type;
      if (typeof args.wake === 'boolean') body.wake = args.wake;
      if (args.project) body.project = args.project;
      res = await POST(`/actors/${encodeURIComponent(args.actor_id as string)}/message`, body);
      break;
    }

    case 'list_actor_inbox': {
      const params = new URLSearchParams();
      if (args.unread_only) params.set('unread', 'true');
      if (typeof args.limit === 'number') params.set('limit', String(args.limit));
      if (typeof args.since === 'number') params.set('since', String(args.since));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/actors/${encodeURIComponent(args.actor_id as string)}/inbox${qs}`);
      break;
    }

    case 'get_actor_inbox_stats': {
      res = await GET(`/actors/${encodeURIComponent(args.actor_id as string)}/inbox/stats`);
      break;
    }

    // ── Salvage ────────────────────────────────────────────────────────
    case 'check_salvage': {
      const qs = args.project ? `?project=${encodeURIComponent(args.project as string)}` : '';
      res = await GET(`/resurrection/pending${qs}`);
      break;
    }

    case 'claim_salvage': {
      res = await POST(`/resurrection/claim/${encodeURIComponent(args.dead_agent_id as string)}`, {
        newAgentId: args.new_agent_id,
      });
      break;
    }

    case 'salvage_complete': {
      res = await POST(`/resurrection/complete/${encodeURIComponent(args.dead_agent_id as string)}`, {
        newAgentId: args.new_agent_id,
      });
      break;
    }

    case 'salvage_abandon': {
      res = await POST(`/resurrection/abandon/${encodeURIComponent(args.dead_agent_id as string)}`);
      break;
    }

    case 'salvage_dismiss': {
      res = await DELETE(`/resurrection/${encodeURIComponent(args.dead_agent_id as string)}`);
      break;
    }

    // ── Agent Inbox ─────────────────────────────────────────────────────
    case 'inbox_send': {
      const body: Record<string, unknown> = { content: args.content };
      if (args.from) body.from = args.from;
      if (args.type) body.type = args.type;
      res = await POST(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox`, body);
      break;
    }

    case 'inbox_read': {
      const params = new URLSearchParams();
      if (args.unread_only) params.set('unread', 'true');
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox${qs}`);
      break;
    }

    case 'inbox_stats': {
      res = await GET(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox/stats`);
      break;
    }

    case 'inbox_mark_read': {
      res = await PUT(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox/${args.message_id}/read`);
      break;
    }

    case 'inbox_mark_all_read': {
      res = await PUT(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox/read-all`);
      break;
    }

    case 'inbox_clear': {
      res = await DELETE(`/agents/${encodeURIComponent(args.agent_id as string)}/inbox`);
      break;
    }

    // ── Webhooks ────────────────────────────────────────────────────────
    case 'webhook_add': {
      const body: Record<string, unknown> = {
        url: args.url,
        events: args.events,
      };
      if (args.secret) body.secret = args.secret;
      if (args.filter_pattern) body.filterPattern = args.filter_pattern;
      res = await POST('/webhooks', body);
      break;
    }

    case 'webhook_list': {
      const qs = args.active_only ? '?active=true' : '';
      res = await GET(`/webhooks${qs}`);
      break;
    }

    case 'webhook_events': {
      res = await GET('/webhooks/events');
      break;
    }

    case 'webhook_get': {
      res = await GET(`/webhooks/${encodeURIComponent(args.webhook_id as string)}`);
      break;
    }

    case 'webhook_update': {
      const body: Record<string, unknown> = {};
      if (args.url) body.url = args.url;
      if (args.events) body.events = args.events;
      if (args.active !== undefined) body.active = args.active;
      res = await PUT(`/webhooks/${encodeURIComponent(args.webhook_id as string)}`, body);
      break;
    }

    case 'webhook_remove': {
      res = await DELETE(`/webhooks/${encodeURIComponent(args.webhook_id as string)}`);
      break;
    }

    case 'webhook_test': {
      res = await POST(`/webhooks/${encodeURIComponent(args.webhook_id as string)}/test`);
      break;
    }

    case 'webhook_deliveries': {
      const qs = args.limit ? `?limit=${args.limit}` : '';
      res = await GET(`/webhooks/${encodeURIComponent(args.webhook_id as string)}/deliveries${qs}`);
      break;
    }

    // ── Integration Signals ─────────────────────────────────────────
    case 'integration_ready': {
      const channel = `integration:ready:${args.service}`;
      const body: Record<string, unknown> = { payload: args.payload || {} };
      res = await POST(`/msg/${encodeURIComponent(channel)}`, body);
      break;
    }

    case 'integration_needs': {
      const channel = `integration:needs:${args.service}`;
      const body: Record<string, unknown> = { payload: args.payload || {} };
      res = await POST(`/msg/${encodeURIComponent(channel)}`, body);
      break;
    }

    case 'integration_list': {
      res = await GET('/channels');
      break;
    }

    // ── Briefing ────────────────────────────────────────────────────
    case 'briefing_generate': {
      const body: Record<string, unknown> = {};
      if (args.project_root) body.projectRoot = args.project_root;
      res = await POST('/briefing', body);
      break;
    }

    case 'briefing_read': {
      const root = args.project_root ? encodeURIComponent(args.project_root as string) : '';
      res = await GET(`/briefing/${root}`);
      break;
    }

    // ── DNS ─────────────────────────────────────────────────────────
    case 'dns_register': {
      const body: Record<string, unknown> = {};
      if (args.target) body.target = args.target;
      if (args.port) body.port = args.port;
      if (args.service) body.service = args.service;
      res = await POST(`/dns/${encodeURIComponent(args.hostname as string)}`, body);
      break;
    }

    case 'dns_unregister': {
      res = await DELETE(`/dns/${encodeURIComponent(args.hostname as string)}`);
      break;
    }

    case 'dns_list': {
      res = await GET('/dns');
      break;
    }

    case 'dns_lookup': {
      res = await GET(`/dns/${encodeURIComponent(args.hostname as string)}`);
      break;
    }

    case 'dns_cleanup': {
      res = await POST('/dns/cleanup');
      break;
    }

    case 'dns_status': {
      res = await GET('/dns/status');
      break;
    }

    case 'dns_setup': {
      res = await POST('/dns/setup');
      break;
    }

    case 'dns_teardown': {
      res = await POST('/dns/teardown');
      break;
    }

    case 'dns_sync': {
      res = await POST('/dns/sync');
      break;
    }

    // ── Tunnels ────────────────────────────────────────────────────────
    case 'start_tunnel': {
      const body: Record<string, unknown> = {};
      if (args.provider) body.provider = args.provider;
      res = await POST(`/tunnel/${encodeURIComponent(args.identity as string)}`, body);
      break;
    }

    case 'stop_tunnel': {
      res = await DELETE(`/tunnel/${encodeURIComponent(args.identity as string)}`);
      break;
    }

    case 'list_tunnels': {
      res = await GET('/tunnels');
      break;
    }

    // ── Projects ───────────────────────────────────────────────────────
    case 'scan_project': {
      const body: Record<string, unknown> = {};
      if (args.directory) body.dir = args.directory;
      if (args.dry_run) body.dryRun = true;
      res = await POST('/scan', body);
      break;
    }

    case 'list_projects': {
      const qs = args.pattern ? `?pattern=${encodeURIComponent(args.pattern as string)}` : '';
      res = await GET(`/projects${qs}`);
      break;
    }

    case 'get_project': {
      res = await GET(`/projects/${encodeURIComponent(args.project_id as string)}`);
      break;
    }

    case 'delete_project': {
      res = await DELETE(`/projects/${encodeURIComponent(args.project_id as string)}`);
      break;
    }

    // ── Changelog ──────────────────────────────────────────────────────
    case 'changelog_add': {
      const body: Record<string, unknown> = {
        identity: args.identity,
        summary: args.summary,
      };
      if (args.type) body.type = args.type;
      if (args.description) body.description = args.description;
      if (args.session_id) body.sessionId = args.session_id;
      if (args.agent_id) body.agentId = args.agent_id;
      res = await POST('/changelog', body);
      break;
    }

    case 'changelog_list': {
      if (args.identity) {
        const params = new URLSearchParams();
        if (args.limit) params.set('limit', String(args.limit));
        const qs = params.toString() ? `?${params.toString()}` : '';
        res = await GET(`/changelog/${encodeURIComponent(args.identity as string)}${qs}`);
      } else {
        const params = new URLSearchParams();
        if (args.limit) params.set('limit', String(args.limit));
        if (args.since) params.set('since', String(args.since));
        const qs = params.toString() ? `?${params.toString()}` : '';
        res = await GET(`/changelog${qs}`);
      }
      break;
    }

    case 'changelog_get': {
      res = await GET(`/changelog/${args.id}`);
      break;
    }

    case 'changelog_identities': {
      res = await GET('/changelog/identities');
      break;
    }

    case 'changelog_by_session': {
      res = await GET(`/changelog/session/${encodeURIComponent(args.session_id as string)}`);
      break;
    }

    case 'changelog_by_agent': {
      const qs = args.limit ? `?limit=${args.limit}` : '';
      res = await GET(`/changelog/agent/${encodeURIComponent(args.agent_id as string)}${qs}`);
      break;
    }

    // ── Activity ───────────────────────────────────────────────────────
    case 'activity_log': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      if (args.type) params.set('type', args.type as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/activity${qs}`);
      break;
    }

    case 'activity_summary': {
      const qs = args.since ? `?since=${args.since}` : '';
      res = await GET(`/activity/summary${qs}`);
      break;
    }

    case 'activity_stats': {
      res = await GET('/activity/stats');
      break;
    }

    case 'activity_range': {
      const params = new URLSearchParams();
      params.set('start', String(args.start));
      if (args.end) params.set('end', String(args.end));
      if (args.limit) params.set('limit', String(args.limit));
      res = await GET(`/activity/range?${params.toString()}`);
      break;
    }

    // ── System ─────────────────────────────────────────────────────────
    case 'daemon_status': {
      const [health, version, metrics] = await Promise.all([
        GET('/health'),
        GET('/version'),
        GET('/metrics'),
      ]);
      return JSON.stringify(
        {
          health: health.data,
          version: version.data,
          metrics: metrics.data,
        },
        null,
        2
      );
    }

    case 'get_version': {
      res = await GET('/version');
      break;
    }

    case 'get_metrics': {
      res = await GET('/metrics');
      break;
    }

    case 'get_config': {
      const qs = args.directory ? `?dir=${encodeURIComponent(args.directory as string)}` : '';
      res = await GET(`/config${qs}`);
      break;
    }

    case 'wait_for_service': {
      // Wait tools can block for up to 5 minutes — use a longer HTTP timeout
      const waitTimeout = Math.min(((args.timeout as number) || 60000) + 5000, 305000);
      if (args.services && Array.isArray(args.services)) {
        // Wait for multiple services
        const body: Record<string, unknown> = { services: args.services };
        if (args.timeout) body.timeout = args.timeout;
        res = await POST('/wait', body, { timeout: waitTimeout });
      } else if (args.identity) {
        // Wait for a single service
        const qs = args.timeout ? `?timeout=${args.timeout}` : '';
        res = await GET(`/wait/${encodeURIComponent(args.identity as string)}${qs}`, { timeout: waitTimeout });
      } else {
        return JSON.stringify({ success: false, error: 'identity or services is required' });
      }
      break;
    }

    // ── FleetControl: Bonds, Wallets, Budgets, Panic ───────────────────
    case 'list_bonds': {
      const params = new URLSearchParams();
      if (args.project) params.set('project', args.project as string);
      if (args.state) params.set('state', args.state as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/bonds${qs}`);
      break;
    }

    case 'get_bond': {
      res = await GET(`/bonds/${encodeURIComponent(String(args.id))}`);
      break;
    }

    case 'slash_bond': {
      res = await POST(`/bonds/${encodeURIComponent(String(args.id))}/slash`, {
        portion: args.portion,
        reason: args.reason,
      });
      break;
    }

    case 'list_wallets': {
      res = await GET('/wallets');
      break;
    }

    case 'get_wallet': {
      res = await GET(`/wallets/${encodeURIComponent(args.project as string)}`);
      break;
    }

    case 'top_up_wallet': {
      res = await POST(`/wallets/${encodeURIComponent(args.project as string)}/top-up`, {
        usd: args.usd,
      });
      break;
    }

    case 'set_wallet_budget': {
      const body: Record<string, unknown> = {
        usdPerDay: args.usd_per_day == null ? null : args.usd_per_day,
      };
      res = await POST(`/wallets/${encodeURIComponent(args.project as string)}/budget`, body);
      break;
    }

    case 'list_budget_pending': {
      res = await GET('/budget/pending');
      break;
    }

    case 'get_budget_pending': {
      res = await GET(`/budget/pending/${encodeURIComponent(args.agent_id as string)}`);
      break;
    }

    case 'resolve_budget_pending': {
      const body: Record<string, unknown> = { action: args.action };
      if (args.top_up_usd != null) body.topUpUsd = args.top_up_usd;
      if (args.new_budget_usd_per_day != null) body.newBudgetUsdPerDay = args.new_budget_usd_per_day;
      if (args.operator) body.operator = args.operator;
      res = await POST(`/budget/pending/${encodeURIComponent(args.agent_id as string)}/resolve`, body);
      break;
    }

    case 'get_panic_status': {
      res = await GET('/fleet/panic');
      break;
    }

    case 'arm_fleet_panic': {
      const body: Record<string, unknown> = { reason: args.reason };
      if (args.confirm != null) body.confirm = args.confirm;
      res = await POST('/fleet/panic', body);
      break;
    }

    case 'disarm_fleet_panic': {
      res = await POST('/fleet/unpanic', { reason: args.reason });
      break;
    }

    // ── Meta-Tool (Progressive Disclosure) ──────────────────────────────
    case 'get_launch_hints': {
      const cwd = args.cwd as string | undefined;
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      res = await GET(`/launch-hints${qs}`);
      break;
    }

    // ── Magic Tools (composed high-level operations) ───────────────────

    case 'fleet_init': {
      const cwd = (args.cwd as string) || process.cwd();
      const { execFileSync } = await import('node:child_process');
      try {
        const output = execFileSync('pd', ['fleet', 'init'], { cwd, encoding: 'utf-8', timeout: 30000 });
        return JSON.stringify({ success: true, output: output.trim(), next_step: 'Run pd fleet up to start the agents, or commit something to trigger them.' });
      } catch (e) {
        return JSON.stringify({ success: false, error: (e as Error).message });
      }
    }

    case 'fleet_status': {
      const project = args.project as string | undefined;
      const agentQs = project ? `?identityPrefix=${encodeURIComponent(project)}` : '';
      const noteQs = new URLSearchParams({ limit: '10' });
      if (project) noteQs.set('project', project);
      const [spawned, channels, notes] = await Promise.all([
        GET(`/spawn${agentQs}`),
        GET('/msg'),
        GET(`/notes?${noteQs}`),
      ]);
      const agents = (spawned.data as Record<string, unknown>)?.agents ?? [];
      const msgs = (channels.data as Record<string, unknown>)?.channels ?? [];
      const recentNotes = (notes.data as Record<string, unknown>)?.notes ?? [];
      return JSON.stringify({ agents, channels: msgs, recent_notes: recentNotes }, null, 2);
    }

    case 'active_agent_roster':
    case 'swarm_awareness': {
      const project = args.project as string | undefined;
      const rosterQs = new URLSearchParams({ limit: '50' });
      if (project) rosterQs.set('project', project);
      const rosterRes = await GET(`/agent-roster?${rosterQs}`);
      if (rosterRes.status >= 200 && rosterRes.status < 300 && rosterRes.data && rosterRes.data.success !== false) {
        return JSON.stringify(rosterRes.data, null, 2);
      }

      const qs = project ? `?identityPrefix=${encodeURIComponent(project)}` : '';
      const sessionQs = new URLSearchParams({ limit: '20' });
      if (project) sessionQs.set('project', project);
      const [agentsRes, sessionsRes, filesRes, salvageRes] = await Promise.all([
        GET(`/agents${qs}`),
        GET(`/sessions?${sessionQs}`),
        GET('/files'),
        GET(`/salvage/pending${project ? '?project=' + encodeURIComponent(project) : ''}`),
      ]);
      return JSON.stringify({
        active_agents: (agentsRes.data as Record<string, unknown>)?.agents ?? [],
        sessions: (sessionsRes.data as Record<string, unknown>)?.sessions ?? [],
        file_claims: (filesRes.data as Record<string, unknown>)?.claims ?? (filesRes.data as Record<string, unknown>)?.files ?? [],
        dead_agents: (salvageRes.data as Record<string, unknown>)?.agents ?? [],
      }, null, 2);
    }

    case 'sitrep':
    case 'catch_me_up': {
      // 3.8.4: both names dispatch to the new /sitrep HTTP endpoint which
      // does the fan-out server-side. Pre-3.8.4 daemons don't have /sitrep;
      // we fall back to the legacy four-call pattern on 404.
      const mins = (args.since_minutes as number) || 60;
      const project = args.project as string | undefined;
      const stack = args.stack as string | undefined;

      const params = new URLSearchParams();
      params.set('since_minutes', String(mins));
      if (project) params.set('project', project);
      if (stack) params.set('stack', stack);

      const sitrepRes = await GET(`/sitrep?${params}`);
      if (sitrepRes.status !== 404) {
        return JSON.stringify(sitrepRes.data, null, 2);
      }

      // Legacy fallback for daemons older than 3.8.4.
      const since = Date.now() - mins * 60 * 1000;
      const notesQs = new URLSearchParams({ limit: '20' });
      if (project) notesQs.set('project', project);
      const salvageQs = new URLSearchParams();
      if (project) salvageQs.set('project', project);
      if (stack) salvageQs.set('stack', stack);
      const [actRes, notesRes, salvageRes, spawnRes] = await Promise.all([
        GET(`/activity?limit=30&since=${since}`),
        GET(`/notes?${notesQs}`),
        GET(`/salvage/pending${salvageQs.toString() ? `?${salvageQs}` : ''}`),
        GET('/spawn'),
      ]);
      const activity = (actRes.data as Record<string, unknown>)?.entries ?? (actRes.data as Record<string, unknown>)?.activity ?? [];
      const allNotes = (notesRes.data as Record<string, unknown>)?.notes ?? [];
      const salvage = (salvageRes.data as Record<string, unknown>)?.agents ?? [];
      const spawned = (spawnRes.data as Record<string, unknown>)?.agents ?? [];
      return JSON.stringify({
        summary: `Last ${mins} minutes: ${(activity as unknown[]).length} events, ${(allNotes as unknown[]).length} notes, ${(salvage as unknown[]).length} dead agents, ${(spawned as unknown[]).length} spawned agents`,
        activity, notes: allNotes, salvage_queue: salvage, spawned_agents: spawned,
      }, null, 2);
    }

    case 'file_heat': {
      const path = args.path as string | undefined;
      const qs = path ? `?path=${encodeURIComponent(path)}&depth=2` : '?depth=2';
      res = await GET(`/pheromone/files${qs}`);
      break;
    }

    case 'talk_to_agent': {
      const agent = args.agent as string;
      const message = args.message as string;
      const type = (args.type as string) || 'request';
      const project = args.project as string | undefined;
      const candidates = agent.includes(':')
        ? [agent]
        : [
            ...(project ? [`${project}:fleet:${agent}`] : []),
            `fleet:${agent}`,
            agent,
          ];
      for (const target of candidates) {
        try {
          const r = await POST(`/agents/${encodeURIComponent(target)}/inbox`, {
            type, content: message, from: 'mcp-user',
          });
          if (r.status >= 200 && r.status < 300) {
            return JSON.stringify({ success: true, delivered_to: target, type, message });
          }
        } catch { /* try next candidate */ }
      }
      await POST(`/msg/${encodeURIComponent(agent)}`, { payload: { type, message, from: 'mcp-user' } });
      return JSON.stringify({ success: true, delivered_via: 'channel', channel: agent, message });
    }

    case 'spawn': {
      const task = args.task as string;
      const identity = args.identity as string | undefined;
      const budgetUsd = args.budget_usd as number | undefined;
      const backend = (args.backend as string) || 'ollama';
      const model = args.model as string | undefined;
      const modelTier = args.model_tier as string | undefined;
      const purpose = args.purpose as string | undefined;
      const files = Array.isArray(args.files) ? args.files as string[] : undefined;
      const workdir = args.workdir as string | undefined;
      // workdir flows into the Coast Guard OS-sandbox profile as a `(subpath
      // "<workdir>")` literal (lib/coast-guard.ts). A quote/backslash/newline/NUL
      // is an SBPL-injection vector (#339); a relative path is ambiguous against
      // the daemon cwd. Reject here too (defense-in-depth with routes/spawn.ts).
      if (workdir !== undefined && workdir !== null) {
        if (typeof workdir !== 'string' || !workdir.trim()) {
          throw new Error('spawn: workdir must be a non-empty string');
        }
        if (/["\\\n\r\0]/.test(workdir)) {
          throw new Error('spawn: workdir contains an illegal character (quote, backslash, newline, or NUL). Provide a plain absolute path.');
        }
        if (!workdir.startsWith('/')) {
          throw new Error('spawn: workdir must be an absolute path (start with "/").');
        }
      }
      const timeout = args.timeout as number | undefined;
      const allowedTools = args.allowed_tools as string | undefined;
      const body: Record<string, unknown> = { backend, task, budgetUsd };
      if (identity) body.identity = identity;
      if (model) body.model = model;
      if (modelTier) body.modelTier = modelTier;
      if (purpose) body.purpose = purpose;
      else body.purpose = task.slice(0, 80);
      if (files) body.files = files;
      if (workdir) body.workdir = workdir;
      if (timeout) body.timeout = timeout;
      if (allowedTools) body.allowedTools = allowedTools;
      if (typeof args.max_tokens === 'number') body.maxTokens = args.max_tokens;
      res = await POST('/spawn', body);
      break;
    }

    case 'cockpit_missions_list': {
      const qs = new URLSearchParams();
      if (args.project_dir) qs.set('projectDir', args.project_dir as string);
      if (Array.isArray(args.status) && args.status.length > 0) {
        qs.set('status', (args.status as unknown[]).map((s) => String(s)).join(','));
      }
      if (typeof args.limit === 'number') qs.set('limit', String(args.limit));
      res = await GET(qs.toString() ? `/cockpit/missions?${qs.toString()}` : '/cockpit/missions');
      break;
    }

    // ── Tuple Space ──────────────────────────────────────────────────
    case 'tuple_out': {
      res = await POST('/tuples', {
        fields: args.fields,
        harbor: args.harbor,
        writtenBy: args.written_by,
        ttlMs: args.ttl_ms,
      });
      break;
    }
    case 'tuple_read': {
      const qs = new URLSearchParams();
      if (args.pattern) qs.set('pattern', JSON.stringify(args.pattern));
      if (args.harbor) qs.set('harbor', args.harbor as string);
      if (args.limit) qs.set('limit', String(args.limit));
      res = await GET('/tuples?' + qs.toString());
      break;
    }
    case 'tuple_take': {
      res = await DELETE('/tuples', {
        pattern: args.pattern,
        harbor: args.harbor,
        limit: args.limit,
      });
      break;
    }
    case 'tuple_scan': {
      const qs = new URLSearchParams();
      if (args.harbor) qs.set('harbor', args.harbor as string);
      if (args.limit) qs.set('limit', String(args.limit));
      res = await GET('/tuples/scan?' + qs.toString());
      break;
    }
    case 'tuple_count': {
      const qs = new URLSearchParams();
      if (args.pattern) qs.set('pattern', JSON.stringify(args.pattern));
      if (args.harbor) qs.set('harbor', args.harbor as string);
      res = await GET('/tuples/count?' + qs.toString());
      break;
    }

    case 'graph_edges': {
      const qs = new URLSearchParams();
      if (args.project_dir) qs.set('projectDir', args.project_dir as string);
      if (args.scope) qs.set('scope', args.scope as string);
      if (args.source_type) qs.set('sourceType', args.source_type as string);
      if (args.source_id) qs.set('sourceId', args.source_id as string);
      if (args.edge_type) qs.set('edgeType', args.edge_type as string);
      if (args.target_type) qs.set('targetType', args.target_type as string);
      if (args.target_id) qs.set('targetId', args.target_id as string);
      if (args.query) qs.set('query', args.query as string);
      if (typeof args.limit === 'number') qs.set('limit', String(args.limit));
      res = await GET(qs.toString() ? `/graph/edges?${qs.toString()}` : '/graph/edges');
      break;
    }

    case 'graph_stats': {
      const qs = new URLSearchParams();
      if (args.project_dir) qs.set('projectDir', args.project_dir as string);
      res = await GET(qs.toString() ? `/graph/stats?${qs.toString()}` : '/graph/stats');
      break;
    }

    case 'memory_episodes': {
      const qs = new URLSearchParams();
      if (args.project_dir) qs.set('projectDir', args.project_dir as string);
      if (args.project) qs.set('project', args.project as string);
      if (args.harbor) qs.set('harbor', args.harbor as string);
      if (args.agent_id) qs.set('agentId', args.agent_id as string);
      if (args.episode_type) qs.set('episodeType', args.episode_type as string);
      if (args.query) qs.set('query', args.query as string);
      if (typeof args.limit === 'number') qs.set('limit', String(args.limit));
      res = await GET(qs.toString() ? `/memory/episodes?${qs.toString()}` : '/memory/episodes');
      break;
    }

    case 'memory_stats': {
      const qs = new URLSearchParams();
      if (args.project_dir) qs.set('projectDir', args.project_dir as string);
      if (args.project) qs.set('project', args.project as string);
      res = await GET(qs.toString() ? `/memory/stats?${qs.toString()}` : '/memory/stats');
      break;
    }

    // ── Feedback (central agentic-feedback primitive) ──────────────
    case 'drop_feedback': {
      // The agent itself is the source unless the caller overrides it.
      const body: Record<string, unknown> = {
        slug: args.slug,
        summary: args.summary,
        droppedBy: (args.droppedBy as string) || (args.agent as string) || 'mcp',
        source: 'mcp',
      };
      if (args.surface) body.surface = args.surface;
      if (args.severity) body.severity = args.severity;
      if (args.hook) body.hook = args.hook;
      if (args.suggested) body.suggested = args.suggested;
      if (args.project) body.project = args.project;
      if (args.harbor) body.harbor = args.harbor;
      res = await POST('/feedback', body);
      break;
    }

    case 'submit_visual_task': {
      const targetAgent = (args.target_agent as string | undefined) || (args.targetAgent as string | undefined);
      const assignee = (args.assignee as string | undefined) || (targetAgent ? 'local-agent' : 'review-queue');
      const body: Record<string, unknown> = {
        schemaVersion: 1,
        type: 'visual-task',
        source: 'api',
        title: (args.title as string | undefined) || (args.description as string | undefined) || 'Visual task',
        description: (args.description as string | undefined) || (args.title as string | undefined) || '',
        kind: (args.kind as string | undefined) || 'fix',
        createdAt: new Date().toISOString(),
        routing: {
          assignee,
          targetAgent,
          openIssue: args.open_issue !== false && args.openIssue !== false,
          startAgent: args.start_agent === true || args.startAgent === true,
        },
      };
      if (args.project) body.project = args.project;
      if (args.project_dir || args.projectDir) body.projectDir = args.project_dir || args.projectDir;
      if (targetAgent) body.targetAgent = targetAgent;
      if (args.page_url || args.pageUrl) body.pageUrl = args.page_url || args.pageUrl;
      if (args.image) body.image = args.image;
      if (args.region) body.region = args.region;
      if (args.dom_context || args.domContext) body.domContext = args.dom_context || args.domContext;
      if (args.viewport) body.viewport = args.viewport;
      res = await POST('/visual-tasks', body);
      break;
    }

    case 'list_feedback': {
      const qs = new URLSearchParams();
      if (args.severity) qs.set('severity', args.severity as string);
      if (args.surface) qs.set('surface', args.surface as string);
      if (args.status) qs.set('status', args.status as string);
      if (args.harbor) qs.set('harbor', args.harbor as string);
      if (args.limit) qs.set('limit', String(args.limit));
      res = await GET(qs.toString() ? `/feedback?${qs.toString()}` : '/feedback');
      break;
    }

    case 'feedback_summary': {
      const qs = new URLSearchParams();
      if (args.harbor) qs.set('harbor', args.harbor as string);
      res = await GET(qs.toString() ? `/feedback/summary?${qs.toString()}` : '/feedback/summary');
      break;
    }

    case 'pd_discover': {
      const category = args.category as string | undefined;
      if (category) {
        const cat = TOOL_CATEGORIES[category];
        if (!cat) {
          return JSON.stringify({
            error: `Unknown category: ${category}`,
            available: Object.keys(TOOL_CATEGORIES),
          }, null, 2);
        }
        // Return full tool schemas for the requested category
        const categoryTools = TOOLS.filter(t => cat.tools.includes(t.name));
        return JSON.stringify({
          category,
          description: cat.description,
          tools: categoryTools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema.properties,
            required: ('required' in t.inputSchema) ? t.inputSchema.required : [],
          })),
          hint: 'You can now call these tools directly by name.',
        }, null, 2);
      }
      // List all categories with tool counts
      return JSON.stringify({
        mode: FULL_MODE ? 'full (all tools exposed)' : 'tiered (essential + discover)',
        categories: Object.entries(TOOL_CATEGORIES).map(([catName, cat]) => ({
          name: catName,
          description: cat.description,
          toolCount: cat.tools.length,
          tools: cat.tools,
        })),
        hint: 'Call pd_discover with a category name to get full tool schemas.',
      }, null, 2);
    }

    case 'harvest_session': {
      res = await POST(`/harvest/session/${encodeURIComponent(args.session_id as string)}`, {});
      break;
    }

    case 'find_related_work': {
      const params = new URLSearchParams({ purpose: args.purpose as string });
      if (typeof args.limit === 'number') params.set('limit', String(args.limit));
      res = await GET(`/harvest/related?${params.toString()}`);
      break;
    }

    case 'get_context_budget': {
      const agentId = args.agent_id as string | undefined;
      res = await GET(`/context/overview`);
      if (!agentId) {
        // No agent_id: return swarm summary (all agents)
        break;
      }
      if (res.data?.agents) {
        const agent = (res.data.agents as Array<Record<string, unknown>>).find(a => a.agentId === agentId);
        if (!agent) {
          res = { status: 404, data: { error: 'No context health data for this agent. Send context_window_used_pct on heartbeat to populate.' } };
        } else {
          res = { status: 200, data: agent.contextHealth as Record<string, unknown> };
        }
      }
      break;
    }

    case 'get_context_overview': {
      const projectFilter = args.project_filter as string | undefined;
      const projectQs = projectFilter ? '?project=' + encodeURIComponent(projectFilter) : '';
      res = await GET('/context/overview' + projectQs);
      break;
    }

    case 'get_task_ledger': {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agentId', args.agent_id as string);
      if (args.since) params.set('since', args.since as string);
      if (typeof args.limit === 'number') params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/context/task-ledger${qs}`);
      break;
    }

    case 'custodian_status': {
      res = await GET('/custodian/status');
      break;
    }

    case 'list_pending_approvals': {
      res = await GET('/custodian/approvals');
      break;
    }

    case 'resolve_approval': {
      const patternId = args.pattern_id as number;
      const decision = args.decision as 'approved' | 'denied';
      res = await POST(`/custodian/approvals/${patternId}`, { decision });
      break;
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  return JSON.stringify(res.data, null, 2);
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'port-daddy',
    version: '3.26.4',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions: [
      'Port Daddy is the authoritative port manager for multi-agent development.',
      'Services use semantic identities in project:stack:context format (e.g. "myapp:api:main").',
      'Same identity always maps to the same port -- deterministic hashing.',
      'Start every session with begin_session, end with end_session_full.',
      'Run coordination_preflight before editing files or coordinating work with possible overlap.',
      'Check check_salvage before starting new work -- another agent may have died mid-task.',
      'Use pd_discover to find additional tools (DNS, locks, pub/sub, tunnels, webhooks, inbox, etc.).',
      'File claims are advisory -- they announce intent, not enforce locks.',
      'Notes are immutable -- once written, they cannot be edited or deleted.',
    ].join(' '),
  }
);

// List tools — tiered by default, full with --full flag
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: FULL_MODE
    ? TOOLS
    : TOOLS.filter(t => ESSENTIAL_TOOL_NAMES.has(t.name) || t.name === 'pd_discover'),
}));

// Execute tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: result }],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;

    const err = error as Error;

    // Connection refused = daemon not running
    if (err.message.includes('ECONNREFUSED')) {
      const sugarTools = new Set(['begin_session', 'end_session_full', 'whoami']);
      const isSugarTool = sugarTools.has(name);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Port Daddy daemon is not running',
              hint: isSugarTool
                ? DAEMON_RECOVERY_HINT
                : 'Daemon not reachable. Start it with: pd (the daemon auto-starts on first command)',
              details: err.message,
            }),
          },
        ],
        isError: true,
      };
    }

    // Timeout or other network error
    if (err.message.includes('timed out') || err.message.includes('ECONNRESET')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Port Daddy daemon did not respond',
              hint: DAEMON_RECOVERY_HINT,
              details: err.message,
            }),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: err.message,
            hint: `Check that the Port Daddy daemon is running at ${DAEMON_URL}. ` + DAEMON_RECOVERY_HINT,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Resources — expose services and sessions as readable resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'port-daddy://skill',
      name: 'Port Daddy Agent Skill',
      description: 'Complete guide for AI agents on how to use Port Daddy — read this to understand available tools, patterns, and best practices',
      mimeType: 'text/markdown',
    },
    {
      uri: 'port-daddy://services',
      name: 'Active Services',
      description: 'All currently claimed services with their ports',
      mimeType: 'application/json',
    },
    {
      uri: 'port-daddy://sessions',
      name: 'Active Sessions',
      description: 'All active coordination sessions',
      mimeType: 'application/json',
    },
    {
      uri: 'port-daddy://agents',
      name: 'Registered Agents',
      description: 'All registered agents with heartbeat status',
      mimeType: 'application/json',
    },
    {
      uri: 'port-daddy://locks',
      name: 'Active Locks',
      description: 'All active distributed locks',
      mimeType: 'application/json',
    },
    {
      uri: 'port-daddy://tunnels',
      name: 'Active Tunnels',
      description: 'All active public tunnels',
      mimeType: 'application/json',
    },
  ],
}));

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  let res: ApiResponse;

  // Skill resource — serve SKILL.md directly (no daemon call needed)
  if (uri === 'port-daddy://skill') {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const mcpDir = dirname(fileURLToPath(import.meta.url));

    // Search for skill in multiple locations. Order matters: prefer the
    // canonical deep skill (port-daddy-agent-skill), then legacy alias/install
    // locations, then the brew-installed share dir.
    const home = process.env.HOME || '';
    const candidates = [
      join(mcpDir, '..', 'skills', 'port-daddy-agent-skill', 'SKILL.md'),
      join(mcpDir, '..', 'skills', 'port-daddy', 'SKILL.md'),
      join(home, '.claude', 'skills', 'port-daddy', 'SKILL.md'),
      join('/opt/homebrew/share/port-daddy/skills/port-daddy', 'SKILL.md'),
      join('/usr/local/share/port-daddy/skills/port-daddy', 'SKILL.md'),
      join(home, '.port-daddy', 'skills', 'SKILL.md'),
    ];
    const skillPath = candidates.find(p => existsSync(p));
    const skillContent = skillPath
      ? readFileSync(skillPath, 'utf-8')
      : '# Port Daddy\n\nSkill document not found. Run `pd mcp install` to install.';

    return {
      contents: [{ uri, mimeType: 'text/markdown', text: skillContent }],
    };
  }

  switch (uri) {
    case 'port-daddy://services':
      res = await GET('/services');
      break;
    case 'port-daddy://sessions':
      res = await GET('/sessions');
      break;
    case 'port-daddy://agents':
      res = await GET('/agents');
      break;
    case 'port-daddy://locks':
      res = await GET('/locks');
      break;
    case 'port-daddy://tunnels':
      res = await GET('/tunnels');
      break;
    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(res.data, null, 2),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
