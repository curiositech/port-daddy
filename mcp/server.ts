#!/usr/bin/env node
/**
 * Port Daddy MCP Server
 *
 * Exposes Port Daddy's full API as MCP tools for Claude agents.
 * Communicates with the Port Daddy daemon via HTTP at localhost:9876.
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAEMON_URL = process.env.PORT_DADDY_URL || 'http://localhost:9876';
const REQUEST_TIMEOUT = 10_000;

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
  body?: Record<string, unknown>
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
        timeout: REQUEST_TIMEOUT,
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
const GET = (path: string) => api('GET', path);
const POST = (path: string, body?: Record<string, unknown>) => api('POST', path, body);
const PUT = (path: string, body?: Record<string, unknown>) => api('PUT', path, body);
const DELETE = (path: string, body?: Record<string, unknown>) => api('DELETE', path, body);

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
]);

const TOOL_CATEGORIES: Record<string, { description: string; tools: string[] }> = {
  'session-lifecycle': {
    description: 'Start/end sessions, manage agent registration (sugar commands)',
    tools: ['begin_session', 'end_session_full', 'whoami'],
  },
  'ports': {
    description: 'Claim, release, and list port assignments',
    tools: ['claim_port', 'release_port', 'list_services', 'get_service', 'health_check', 'list_active_ports', 'list_system_ports', 'cleanup_ports'],
  },
  'sessions': {
    description: 'Detailed session management (start, end, phases, file claims)',
    tools: ['start_session', 'end_session', 'get_session', 'delete_session', 'list_sessions', 'set_session_phase', 'claim_files', 'release_files', 'list_file_claims', 'who_owns_file'],
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
    tools: ['publish_message', 'get_messages', 'list_channels', 'clear_channel'],
  },
  'agents': {
    description: 'Agent registry, heartbeats, salvage/resurrection',
    tools: ['register_agent', 'agent_heartbeat', 'unregister_agent', 'get_agent', 'list_agents', 'check_salvage', 'claim_salvage', 'salvage_complete', 'salvage_abandon', 'salvage_dismiss'],
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
  'system': {
    description: 'Daemon status, version, metrics, and config',
    tools: ['daemon_status', 'get_version', 'get_metrics', 'get_config', 'wait_for_service'],
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
      'Usage: begin_session({purpose: "Building auth system", identity: "myapp:api:main"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        purpose: {
          type: 'string',
          description: 'What you are working on (e.g. "Implementing OAuth flow")',
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
      },
      required: ['purpose'],
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
    description: '[Standard] List sessions. Shows active sessions by default, or all sessions with the "all" flag.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        all: {
          type: 'boolean',
          description: 'Show all sessions, not just active ones',
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
    description: '[Standard] List notes for a session, or recent notes across all sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID (omit for recent notes across all sessions)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return',
        },
      },
    },
  },
  {
    name: 'claim_files',
    description:
      '[Standard] Claim files for the active session (advisory locking). ' +
      'Other agents can see which files are claimed to avoid conflicts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to claim (whole file)',
        },
      },
      required: ['session_id', 'paths'],
    },
  },
  {
    name: 'release_files',
    description: '[Standard] Release specific file claims from a session.',
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
      },
      required: ['session_id', 'files'],
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
    description: '[Standard] List all file claims across all active sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'who_owns_file',
    description: '[Standard] Check which session/agent owns a specific file. Optionally filter by line range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path to look up' },
        startLine: { type: 'number', description: 'Optional: start of line range to check (1-indexed)' },
        endLine: { type: 'number', description: 'Optional: end of line range to check (1-indexed)' },
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
    description: '[Standard] Release a distributed lock.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Lock name to release',
        },
        owner: {
          type: 'string',
          description: 'Lock owner (must match the owner who acquired it)',
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
    description: '[Standard] List all active distributed locks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: {
          type: 'string',
          description: 'Filter by lock owner',
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
    description: '[Advanced] Get messages from a pub/sub channel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name to read from',
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
    description: '[Standard] List all registered agents with their status and heartbeat info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Only show active (heartbeating) agents',
        },
      },
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
    description: '[Standard] List all registered projects with their service counts and metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
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

  // ── Meta-Tool (Progressive Disclosure) ─────────────────────────────
  {
    name: 'pd_discover',
    description:
      '[Essential] List available Port Daddy tool categories and their tools. ' +
      'In default mode, only essential tools are loaded. Use this to discover ' +
      'additional tools by category, then call them directly by name. ' +
      'Categories: session-lifecycle, ports, sessions, notes, locks, messaging, agents, inbox, ' +
      'webhooks, integration, dns, briefing, tunnels, projects, changelog, activity, system.',
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
      if (args.identity) body.identity = args.identity;
      if (args.agent_id) body.agentId = args.agent_id;
      if (args.type) body.type = args.type;
      if (args.files) body.files = args.files;
      res = await POST('/sugar/begin', body);
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

      if (args.session_id) {
        res = await POST(`/sessions/${args.session_id}/notes`, body);
      } else {
        // Quick note — server auto-creates session if needed
        res = await POST('/notes', body);
      }
      break;
    }

    case 'list_sessions': {
      const params = new URLSearchParams();
      if (args.all) params.set('status', 'all');
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/sessions${qs}`);
      break;
    }

    case 'list_notes': {
      if (args.session_id) {
        const qs = args.limit ? `?limit=${args.limit}` : '';
        res = await GET(`/sessions/${args.session_id}/notes${qs}`);
      } else {
        const qs = args.limit ? `?limit=${args.limit}` : '';
        res = await GET(`/notes${qs}`);
      }
      break;
    }

    case 'claim_files': {
      res = await POST(`/sessions/${args.session_id}/files`, {
        files: args.paths,
      });
      break;
    }

    case 'release_files': {
      res = await DELETE(`/sessions/${encodeURIComponent(args.session_id as string)}/files`, {
        files: args.files,
      });
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
      res = await GET('/files');
      break;
    }

    case 'who_owns_file': {
      let whoOwnsUrl = `/files/who-owns?path=${encodeURIComponent(args.path as string)}`;
      if (args.startLine) whoOwnsUrl += `&startLine=${args.startLine}`;
      if (args.endLine) whoOwnsUrl += `&endLine=${args.endLine}`;
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
      const qs = args.active_only ? '?active=true' : '';
      res = await GET(`/agents${qs}`);
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
      res = await GET('/projects');
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
      if (args.services && Array.isArray(args.services)) {
        // Wait for multiple services
        const body: Record<string, unknown> = { services: args.services };
        if (args.timeout) body.timeout = args.timeout;
        res = await POST('/wait', body);
      } else if (args.identity) {
        // Wait for a single service
        const qs = args.timeout ? `?timeout=${args.timeout}` : '';
        res = await GET(`/wait/${encodeURIComponent(args.identity as string)}${qs}`);
      } else {
        return JSON.stringify({ success: false, error: 'identity or services is required' });
      }
      break;
    }

    // ── Meta-Tool (Progressive Disclosure) ──────────────────────────────
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
    version: '3.5.0',
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
            hint: 'Check that the Port Daddy daemon is running on localhost:9876. ' + DAEMON_RECOVERY_HINT,
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
