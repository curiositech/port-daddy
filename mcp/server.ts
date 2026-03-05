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
      '[Standard] List all claimed services with their ports, status, and metadata. ' +
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
          description: 'File paths to claim',
        },
      },
      required: ['session_id', 'paths'],
    },
  },

  // ── Locks ────────────────────────────────────────────────────────────
  {
    name: 'acquire_lock',
    description:
      '[Standard] Acquire a distributed lock. Use for exclusive access to shared resources ' +
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

  // ── Project Scanning ─────────────────────────────────────────────────
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
];

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
        paths: args.paths,
      });
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

    // ── Agents ─────────────────────────────────────────────────────────
    case 'register_agent': {
      const body: Record<string, unknown> = {
        type: (args.type as string) || 'mcp',
      };
      if (args.identity) body.identity = args.identity;
      if (args.purpose) body.purpose = args.purpose;
      res = await POST(`/agents/${encodeURIComponent(args.agent_id as string)}`, body);
      break;
    }

    case 'agent_heartbeat': {
      res = await PUT(`/agents/${encodeURIComponent(args.agent_id as string)}/heartbeat`);
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
      res = await GET(`/salvage${qs}`);
      break;
    }

    case 'claim_salvage': {
      res = await POST('/salvage', {
        deadAgentId: args.dead_agent_id,
        newAgentId: args.new_agent_id,
      });
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

    // ── Project Scanning ───────────────────────────────────────────────
    case 'scan_project': {
      const body: Record<string, unknown> = {};
      if (args.directory) body.directory = args.directory;
      if (args.dry_run) body.dryRun = true;
      res = await POST('/scan', body);
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

    case 'activity_log': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      if (args.type) params.set('type', args.type as string);
      const qs = params.toString() ? `?${params.toString()}` : '';
      res = await GET(`/activity${qs}`);
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
  { name: 'port-daddy', version: '3.3.0' },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
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
                ? `Daemon may be offline. Start it with: pd daemon start (or npm run dev in the port-daddy directory)`
                : 'Start the daemon with: pd daemon start (or: npx port-daddy start)',
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
            hint: 'Check that the Port Daddy daemon is running on localhost:9876',
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
