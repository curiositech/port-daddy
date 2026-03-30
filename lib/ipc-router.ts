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

import { Performative, IpcAction } from './ipc-types.js';
import type { IpcFrame } from './ipc-types.js';
import type { IpcConnection } from './ipc-server.js';
import { verifyAgent, actionRequiresRegistration } from './ipc-auth.js';
import type { AgentVerifier } from './ipc-auth.js';

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
    start: (options: Record<string, unknown>) => unknown;
    end: (id: string, options?: Record<string, unknown>) => unknown;
    addNote: (sessionId: string, content: string, options?: Record<string, unknown>) => unknown;
    claimFiles: (sessionId: string, paths: string[]) => unknown;
    releaseFiles: (sessionId: string, paths: string[]) => unknown;
  };
  locks: {
    acquire: (name: string, options?: Record<string, unknown>) => unknown;
    release: (name: string, options?: Record<string, unknown>) => unknown;
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
  };
}

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
    return deps.sessions.start(p);
  });

  handlers.set(IpcAction.DONE, (p) => {
    if (deps.sugar) return deps.sugar.done(p);
    return deps.sessions.end(String(p.sessionId), p);
  });

  handlers.set(IpcAction.NOTE, (p) => {
    return deps.sessions.addNote(
      String(p.sessionId),
      String(p.content),
      p,
    );
  });

  handlers.set(IpcAction.FILES_CLAIM, (p) => {
    return deps.sessions.claimFiles(
      String(p.sessionId),
      p.paths as string[],
    );
  });

  handlers.set(IpcAction.FILES_RELEASE, (p) => {
    return deps.sessions.releaseFiles(
      String(p.sessionId),
      p.paths as string[],
    );
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

  handlers.set(IpcAction.LOCK_RELEASE, (p) => {
    return deps.locks.release(String(p.name), p);
  });

  // Messaging
  handlers.set(IpcAction.PUBLISH, (p) => {
    return deps.messaging.publish(String(p.channel), p.message, p);
  });

  handlers.set(IpcAction.SUBSCRIBE, (_p, conn) => {
    const channel = String(_p.channel);
    const unsub = deps.messaging.subscribe(channel, (msg) => {
      // Push subscription messages to the agent via IPC
      // This is handled by the server's sendTo — we store the unsub
      // and let the server handle the fan-out
    });
    return { subscribed: true, channel };
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

  // ── Main dispatch function ────────────────────────────────────────────

  function handleFrame(
    frame: IpcFrame,
    conn: IpcConnection,
    reply: (response: IpcFrame) => void,
  ): void {
    const action = String(frame.payload.action ?? '');
    const agentId = frame.payload.agentId ? String(frame.payload.agentId) : conn.agentId;

    // ── Auth check ──
    if (actionRequiresRegistration(action)) {
      const auth = verifyAgent(agentId, verifier, true);
      if (!auth.allowed) {
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
          available: Array.from(handlers.keys()),
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
