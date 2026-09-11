/**
 * Port Daddy IPC Router
 *
 * Routes decoded IPC frames to existing service handlers.
 * Reuses ALL business logic from lib/*.ts — no duplication.
 *
 * The router is the bridge between the binary IPC protocol and the
 * existing service layer. Every action maps to a service method call.
 *
 * FIPA semantics:
 * - INFORM (fire-and-forget): heartbeat, pheromone.spray, msg.publish
 * - REQUEST (needs response): port.claim, lock.acquire, session.begin, etc.
 * - QUERY_REF (read-only): port.find, salvage.list, pheromone.sniff
 */

import { Performative, IpcAction, FIRE_AND_FORGET } from './ipc-types.js';
import type { IpcFrame } from './ipc-types.js';
import { encodeFrame } from './ipc-frame.js';
import type { IpcConnection } from './ipc-server.js';
import { verifyAgent, actionRequiresRegistration } from './ipc-auth.js';
import type { AgentVerifier } from './ipc-auth.js';
import type { Tuple } from './tuples.js';

// ─── Service Dependencies ───────────────────────────────────────────────────
// These match the objects created in server.ts

export interface IpcRouterDeps {
  services: {
    claim: (id: string, options?: Record<string, unknown>) => unknown;
    release: (id: string, options?: Record<string, unknown>) => unknown;
    find: (pattern?: string, options?: Record<string, unknown>) => unknown;
  };
  agents: {
    register: (id: string, options?: Record<string, unknown>) => unknown;
    heartbeat: (id: string, options?: Record<string, unknown>) => unknown;
    unregister: (id: string) => unknown;
    isRegistered?: (id: string) => { id: string; identity?: string; purpose?: string } | null;
  };
  sessions: {
    start: (purpose: string, options?: Record<string, unknown>) => unknown;
    end: (id: string, options?: Record<string, unknown>) => unknown;
    get?: (id: string) => unknown;
    remove: (id: string) => unknown;
    takeover?: (id: string, options?: Record<string, unknown>) => unknown;
    list: (options?: Record<string, unknown>) => unknown;
    quickNote: (content: string, options?: Record<string, unknown>) => unknown;
    claimFiles: (sessionId: string, paths: string[], options?: Record<string, unknown>) => unknown;
    releaseFiles: (sessionId: string, paths: string[], options?: Record<string, unknown>) => unknown;
  };
  locks: {
    acquire: (name: string, options?: Record<string, unknown>) => unknown;
    check: (name: string) => unknown;
    extend: (name: string, options?: Record<string, unknown>) => unknown;
    list: (options?: Record<string, unknown>) => unknown;
    release: (name: string, options?: Record<string, unknown>) => unknown;
  };
  tuples?: {
    out: (fields: unknown[], options?: Record<string, unknown>) => Tuple;
    rd: (pattern: unknown[], options?: Record<string, unknown>) => Tuple[];
    take: (pattern: unknown[], options?: Record<string, unknown>) => Tuple[];
    scan: (harbor?: string) => Tuple[];
    count: (pattern?: unknown[], harbor?: string) => number;
  };
  messaging: {
    publish: (channel: string, payload: unknown, options?: Record<string, unknown>) => unknown;
    subscribe: (channel: string, callback: (msg: unknown) => void) => (() => void) | null;
  };
  pheromones: {
    spray: (table: string, id: string, key: string, strength: number) => unknown;
    sniff: (table: string, id: string) => unknown;
    list: () => unknown;
  };
  resurrection?: {
    pending: (options?: Record<string, unknown>) => unknown;
    claim: (agentId: string, claimedBy: string) => unknown;
  };
  sugar?: {
    begin: (options: Record<string, unknown>) => unknown;
    done: (options: Record<string, unknown>) => unknown;
    whoami: (options: Record<string, unknown>) => unknown;
  };
  fleet?: {
    promptLine: (project: string, since?: number) => string;
  };
}

// ─── Input Validation ───────────────────────────────────────────────────────

/** Validate and coerce a payload field to string[]. Returns null if invalid. */
function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  if (!val.every(v => typeof v === 'string')) return null;
  return val;
}

function recoverableSessionAction(action: string): boolean {
  return action === IpcAction.DONE ||
    action === IpcAction.NOTE;
}

// Binary IPC does not yet transport or verify daemon-minted actor
// credentials. Destructive lifecycle mutations therefore stay on the HTTP
// stack, where the shared identity-write boundary binds the credential actor
// to the stored session owner. Refuse before handler dispatch so raw IPC
// callers cannot bypass the HTTP authorization gate.
const HTTP_ONLY_CREDENTIAL_MUTATIONS = new Set<string>([
  IpcAction.BEGIN,
  IpcAction.DONE,
  IpcAction.NOTE,
  IpcAction.SESSION_END,
  IpcAction.SESSION_START,
  IpcAction.SESSION_REMOVE,
  IpcAction.SESSION_TAKEOVER,
  IpcAction.FILES_CLAIM,
  IpcAction.FILES_RELEASE,
  IpcAction.LOCK_ACQUIRE,
  IpcAction.LOCK_EXTEND,
  IpcAction.LOCK_RELEASE,
  IpcAction.SALVAGE_CLAIM,
]);

// ─── Route Handler Type ─────────────────────────────────────────────────────

type RouteHandler = (
  payload: Record<string, unknown>,
  conn: IpcConnection,
) => unknown;

// ─── Router Factory ─────────────────────────────────────────────────────────

export function createIpcRouter(deps: IpcRouterDeps) {
  // Build the agent verifier from the agents service
  const verifier: AgentVerifier | null = deps.agents.isRegistered
    ? { isRegistered: (id: string) => deps.agents.isRegistered!(id) }
    : null;

  function resolveRecoverableSessionAgentId(
    action: string,
    payload: Record<string, unknown>,
    requestedAgentId: string | null,
  ): string | null {
    if (!recoverableSessionAction(action) || !deps.sessions.get) return null;

    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!sessionId) return null;

    const sessionInfo = deps.sessions.get(sessionId) as
      | { success?: boolean; session?: Record<string, unknown> | null }
      | null
      | undefined;
    if (!sessionInfo?.success || !sessionInfo.session || typeof sessionInfo.session !== 'object') return null;

    const sessionAgentId = typeof sessionInfo.session.agentId === 'string'
      ? sessionInfo.session.agentId
      : null;
    if (!sessionAgentId) return null;

    if (requestedAgentId && requestedAgentId !== sessionAgentId) return null;
    return sessionAgentId;
  }

  // ── Action → Handler map ──────────────────────────────────────────────

  const handlers = new Map<string, RouteHandler>();

  // Agent lifecycle
  handlers.set(IpcAction.HEARTBEAT, (p) => {
    return deps.agents.heartbeat(String(p.agentId), p);
  });

  handlers.set(IpcAction.REGISTER, (p) => {
    return deps.agents.register(String(p.agentId), p);
  });

  handlers.set(IpcAction.UNREGISTER, (p) => {
    return deps.agents.unregister(String(p.agentId));
  });

  // Sessions
  handlers.set(IpcAction.BEGIN, (p) => {
    if (deps.sugar) return deps.sugar.begin(p);
    return deps.sessions.start(String(p.purpose ?? ''), p);
  });

  handlers.set(IpcAction.DONE, (p) => {
    if (deps.sugar) return deps.sugar.done(p);
    return deps.sessions.end(String(p.sessionId), p);
  });

  handlers.set(IpcAction.SESSION_START, (p) => {
    return deps.sessions.start(String(p.purpose ?? ''), p);
  });

  handlers.set(IpcAction.SESSION_END, (p) => {
    return deps.sessions.end(String(p.sessionId ?? ''), p);
  });

  handlers.set(IpcAction.SESSION_LIST, (p) => {
    return deps.sessions.list(p);
  });

  handlers.set(IpcAction.SESSION_REMOVE, (p) => {
    return deps.sessions.remove(String(p.sessionId ?? ''));
  });

  handlers.set(IpcAction.SESSION_TAKEOVER, (p, conn) => {
    if (!deps.sessions.takeover) return { success: false, error: 'session takeover not available' };
    const agentId = conn.agentId || (typeof p.agentId === 'string' && p.agentId.trim()
      ? p.agentId.trim()
      : null);
    return deps.sessions.takeover(String(p.sessionId ?? ''), {
      ...p,
      agentId,
    });
  });

  handlers.set(IpcAction.WHOAMI, (p) => {
    return deps.sugar?.whoami(p) ?? { success: false, error: 'sugar_not_available' };
  });

  handlers.set(IpcAction.NOTE, (p, conn) => {
    const sessionId = typeof p.sessionId === 'string' && p.sessionId.trim()
      ? p.sessionId.trim()
      : null;
    const agentId = conn.agentId || (typeof p.agentId === 'string' && p.agentId.trim()
      ? p.agentId.trim()
      : null);

    return deps.sessions.quickNote(String(p.content ?? ''), {
      ...p,
      sessionId,
      agentId,
    });
  });

  handlers.set(IpcAction.FILES_CLAIM, (p, conn) => {
    const paths = asStringArray(p.paths);
    if (!paths) return { error: 'paths must be an array of strings' };
    const agentId = conn.agentId || (typeof p.agentId === 'string' && p.agentId.trim()
      ? p.agentId.trim()
      : null);
    return deps.sessions.claimFiles(String(p.sessionId), paths, {
      regions: Array.isArray(p.regions) ? p.regions as unknown[] : undefined,
      force: p.force === true,
      agentId,
    });
  });

  handlers.set(IpcAction.FILES_RELEASE, (p, conn) => {
    const paths = asStringArray(p.paths);
    if (!paths) return { error: 'paths must be an array of strings' };
    const agentId = typeof p.agentId === 'string' && p.agentId.trim()
      ? p.agentId.trim()
      : (conn.agentId || null);
    return deps.sessions.releaseFiles(String(p.sessionId), paths, {
      regions: Array.isArray(p.regions) ? p.regions as unknown[] : undefined,
      agentId,
    });
  });

  // Ports
  handlers.set(IpcAction.CLAIM, (p) => {
    return deps.services.claim(String(p.identity), p);
  });

  handlers.set(IpcAction.RELEASE, (p) => {
    return deps.services.release(String(p.identity), p);
  });

  handlers.set(IpcAction.FIND, (p) => {
    return deps.services.find(String(p.pattern ?? p.identity ?? '*'), p);
  });

  // Locks
  handlers.set(IpcAction.LOCK_ACQUIRE, (p) => {
    return deps.locks.acquire(String(p.name), p);
  });

  handlers.set(IpcAction.LOCK_CHECK, (p) => {
    return deps.locks.check(String(p.name));
  });

  handlers.set(IpcAction.LOCK_EXTEND, (p) => {
    return deps.locks.extend(String(p.name), p);
  });

  handlers.set(IpcAction.LOCK_LIST, (p) => {
    return deps.locks.list(p);
  });

  handlers.set(IpcAction.LOCK_RELEASE, (p) => {
    return deps.locks.release(String(p.name), p);
  });

  // Tuples
  handlers.set(IpcAction.TUPLE_OUT, (p) => {
    if (!Array.isArray(p.fields) || p.fields.length === 0) {
      return { success: false, error: 'fields must be a non-empty array', code: 'VALIDATION_ERROR' };
    }
    const tuple = deps.tuples?.out(
      p.fields,
      {
        harbor: typeof p.harbor === 'string' ? p.harbor : undefined,
        writtenBy: typeof p.writtenBy === 'string' ? p.writtenBy : undefined,
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      },
    );
    return { success: true, tuple };
  });

  handlers.set(IpcAction.TUPLE_RD, (p) => {
    if (!Array.isArray(p.pattern)) {
      return { success: false, error: 'pattern must be a JSON array' };
    }
    const tuples = deps.tuples?.rd(
      p.pattern,
      {
        harbor: typeof p.harbor === 'string' ? p.harbor : undefined,
        limit: typeof p.limit === 'number' ? p.limit : undefined,
      },
    ) ?? [];
    return { success: true, tuples, count: tuples.length };
  });

  handlers.set(IpcAction.TUPLE_IN, (p) => {
    if (!Array.isArray(p.pattern)) {
      return { success: false, error: 'pattern must be a JSON array' };
    }
    const taken = deps.tuples?.take(
      p.pattern,
      {
        harbor: typeof p.harbor === 'string' ? p.harbor : undefined,
        limit: typeof p.limit === 'number' ? p.limit : undefined,
      },
    ) ?? [];
    return { success: true, taken, count: taken.length };
  });

  handlers.set(IpcAction.TUPLE_POLL, (p) => {
    if (!Array.isArray(p.pattern)) {
      return { success: false, error: 'pattern must be a JSON array' };
    }
    const result = (deps.tuples as { poll?: (pattern: unknown[], options?: { harbor?: string; afterId?: number; limit?: number }) => { tuple: Tuple | null; lastId: number } } | undefined)?.poll?.(
      p.pattern,
      {
        harbor: typeof p.harbor === 'string' ? p.harbor : undefined,
        afterId: typeof p.afterId === 'number' ? p.afterId : undefined,
        limit: typeof p.limit === 'number' ? p.limit : undefined,
      },
    ) ?? { tuple: null, lastId: typeof p.afterId === 'number' ? p.afterId : 0 };
    return { success: true, tuple: result.tuple, lastId: result.lastId };
  });

  handlers.set(IpcAction.TUPLE_SCAN, (p) => {
    const harbor = typeof p.harbor === 'string' ? p.harbor : undefined;
    const limit = typeof p.limit === 'number' ? Math.min(Math.max(p.limit, 1), 500) : 200;
    const query = typeof p.query === 'string' ? p.query.trim().toLowerCase() : '';
    const pattern = Array.isArray(p.pattern) ? p.pattern : undefined;

    let tuples = pattern
      ? deps.tuples?.rd(pattern, { harbor, limit }) ?? []
      : deps.tuples?.scan(harbor) ?? [];

    if (query) {
      tuples = tuples.filter((tuple: any) => {
        const haystack = JSON.stringify({
          fields: tuple.fields,
          writtenBy: tuple.writtenBy,
          harbor: tuple.harbor,
        }).toLowerCase();
        return haystack.includes(query);
      });
    }

    const sliced = tuples.slice(0, limit);
    return { success: true, tuples: sliced, count: sliced.length };
  });

  handlers.set(IpcAction.TUPLE_COUNT, (p) => {
    const harbor = typeof p.harbor === 'string' ? p.harbor : undefined;
    return { success: true, count: deps.tuples?.count(undefined, harbor) ?? 0 };
  });

  // Messaging
  handlers.set(IpcAction.PUBLISH, (p) => {
    return deps.messaging.publish(String(p.channel), p.message, p);
  });

  handlers.set(IpcAction.SUBSCRIBE, (_p, conn) => {
    const channel = String(_p.channel);

    // Check if already subscribed on this connection
    if (conn.subscriptions.some(s => s.channel === channel)) {
      return { subscribed: true, channel, existing: true };
    }

    // Guard: subscription limit per connection
    if (conn.subscriptions.length >= 64) {
      return { subscribed: false, channel, error: 'subscription_limit', limit: 64 };
    }

    const unsub = deps.messaging.subscribe(channel, (msg: unknown) => {
      // Push subscription messages to the agent via IPC
      const frame: IpcFrame = {
        type: Performative.INFORM,
        convId: FIRE_AND_FORGET,
        payload: {
          action: 'msg.delivery',
          channel,
          message: msg,
          ts: Date.now(),
        },
      };
      try {
        const encoded = encodeFrame(frame);
        const ok = conn.socket.write(encoded);
        if (!ok) {
          // Backpressured — frame is buffered by Node, but track it
          conn.framesDropped++;
        }
        conn.framesOut++;
        conn.bytesOut += encoded.length;
      } catch {
        // Socket dead — subscription will be cleaned up in onClose
      }
    });

    if (unsub) {
      conn.subscriptions.push({ channel, unsub });
    }

    return { subscribed: !!unsub, channel };
  });

  // Pheromone
  handlers.set(IpcAction.SPRAY, (p) => {
    return deps.pheromones.spray(
      String(p.table),
      String(p.id),
      String(p.key),
      Number(p.strength),
    );
  });

  handlers.set(IpcAction.SNIFF, (p) => {
    return deps.pheromones.sniff(String(p.table), String(p.id));
  });

  // Unsubscribe
  handlers.set(IpcAction.UNSUBSCRIBE, (_p, conn) => {
    const channel = String(_p.channel);
    const idx = conn.subscriptions.findIndex(s => s.channel === channel);
    if (idx === -1) {
      return { unsubscribed: false, channel, reason: 'not_subscribed' };
    }
    const sub = conn.subscriptions[idx];
    try { sub.unsub(); } catch {}
    conn.subscriptions.splice(idx, 1);
    return { unsubscribed: true, channel };
  });

  // Salvage
  handlers.set(IpcAction.SALVAGE_LIST, (p) => {
    return deps.resurrection?.pending(p) ?? { entries: [] };
  });

  handlers.set(IpcAction.SALVAGE_CLAIM, (p) => {
    return deps.resurrection?.claim(
      String(p.deadAgentId),
      String(p.agentId),
    ) ?? { error: 'salvage_not_available' };
  });

  handlers.set(IpcAction.FLEET_PROMPT, (p) => {
    const project = typeof p.project === 'string' ? p.project : '';
    if (!project) return { success: false, error: 'project query param required' };
    const since = typeof p.since === 'number'
      ? p.since
      : typeof p.since === 'string' && p.since !== ''
        ? parseInt(p.since, 10)
        : undefined;
    return {
      success: true,
      line: deps.fleet?.promptLine(project, Number.isFinite(since) ? since : undefined) ?? '',
    };
  });

  // ── Main dispatch function ────────────────────────────────────────────

  function handleFrame(
    frame: IpcFrame,
    conn: IpcConnection,
    reply: (response: IpcFrame) => void,
  ): void {
    const action = String(frame.payload.action ?? '');
    if (HTTP_ONLY_CREDENTIAL_MUTATIONS.has(action)) {
      reply({
        type: Performative.REFUSE,
        convId: frame.convId,
        payload: {
          error: 'actor_credential_transport_required',
          action,
          message: `Action '${action}' requires the credentialed HTTP transport`,
        },
      });
      return;
    }
    const payloadAgentId = typeof frame.payload.agentId === 'string' && frame.payload.agentId.trim()
      ? frame.payload.agentId.trim()
      : null;
    if (conn.agentId && payloadAgentId && payloadAgentId !== conn.agentId) {
      reply({
        type: Performative.REFUSE,
        convId: frame.convId,
        payload: {
          error: 'agent_mismatch',
          action,
          message: `Action '${action}' cannot be sent as '${payloadAgentId}' over a connection bound to '${conn.agentId}'`,
        },
      });
      return;
    }
    const requestedAgentId = payloadAgentId || conn.agentId;
    let agentId = requestedAgentId;

    // ── Auth check ──
    if (actionRequiresRegistration(action)) {
      const auth = verifyAgent(agentId, verifier, true);
      if (!auth.allowed) {
        const recoveredAgentId = resolveRecoverableSessionAgentId(action, frame.payload, requestedAgentId);
        if (recoveredAgentId) {
          agentId = recoveredAgentId;
          if (!frame.payload.agentId) frame.payload.agentId = recoveredAgentId;
          if (!conn.agentId) conn.agentId = recoveredAgentId;
        } else {
          reply({
            type: Performative.REFUSE,
            convId: frame.convId,
            payload: {
              error: auth.reason ?? 'unauthorized',
              action,
              message: `Action '${action}' requires a registered agent`,
            },
          });
          return;
        }
      }
    }

    if (agentId && !frame.payload.agentId) {
      frame.payload.agentId = agentId;
      if (!conn.agentId) conn.agentId = agentId;
    }

    // ── Find handler ──
    const handler = handlers.get(action);
    if (!handler) {
      reply({
        type: Performative.NOT_UNDERSTOOD,
        convId: frame.convId,
        payload: {
          error: 'unknown_action',
          action,
          message: `No handler for action '${action}'`,
        },
      });
      return;
    }

    // ── Execute ──
    try {
      const result = handler(frame.payload, conn);

      // Fire-and-forget: no response needed
      if (frame.convId === 0) return;

      // Request-response: send result
      reply({
        type: Performative.INFORM_DONE,
        convId: frame.convId,
        payload: {
          action,
          result: result ?? { success: true },
        },
      });
    } catch (err) {
      // Handler threw — FAILURE (tried and failed, retry with backoff)
      if (frame.convId !== 0) {
        reply({
          type: Performative.FAILURE,
          convId: frame.convId,
          payload: {
            error: 'action_failed',
            action,
            message: String(err),
          },
        });
      }
    }
  }

  return {
    handleFrame,
    /** List all registered action names (for diagnostics) */
    get actions() { return Array.from(handlers.keys()); },
  };
}
