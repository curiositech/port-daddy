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
import {
  resolveWriteIdentity,
  stampIdentityMetadata,
  type IdentityVerifier,
} from './identity-write-boundary.js';
import {
  DurableOwnershipError,
  type DurableOwnershipService,
  type VerifiedOwnershipActor,
} from './durable-ownership.js';
import { resolveSessionWorktreeAdmission } from './worktree-policy.js';
import type { WorktreeInfo } from './worktree.js';

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
  actorSouls?: (IdentityVerifier & { constants?: { defaultHarbor?: string } }) | null;
  durableOwnership?: DurableOwnershipService;
  /** Hermetic-test seam; production re-probes caller-named roots with Git. */
  sessionWorktreeProbe?: (root: string) => WorktreeInfo | null;
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

// ─── Route Handler Type ─────────────────────────────────────────────────────

type RouteHandler = (
  payload: Record<string, unknown>,
  conn: IpcConnection,
) => unknown;

class IpcRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IpcRefusal';
  }
}

const OWNERSHIP_ACTIONS = new Set<string>([
  IpcAction.SESSION_TAKEOVER,
  IpcAction.OWNERSHIP_BOOTSTRAP,
  IpcAction.OWNERSHIP_TAKEOVER_PREPARE,
  IpcAction.OWNERSHIP_GRANT_GET,
]);

// ─── Router Factory ─────────────────────────────────────────────────────────

export function createIpcRouter(deps: IpcRouterDeps) {
  // Build the agent verifier from the agents service
  const verifier: AgentVerifier | null = deps.agents.isRegistered
    ? { isRegistered: (id: string) => deps.agents.isRegistered!(id) }
    : null;

  function requireOwnershipActor(
    payload: Record<string, unknown>,
    conn: IpcConnection,
    action: string,
    harbor: string,
    allowedFields: readonly string[],
  ): VerifiedOwnershipActor {
    const allowed = new Set(['action', 'agentId', 'credential', ...allowedFields]);
    const unknown = Object.keys(payload).find(field => !allowed.has(field));
    if (unknown) {
      throw new IpcRefusal(
        'UNKNOWN_FIELD',
        `${unknown} is not accepted by IPC action ${action}`,
      );
    }
    const assertedAgentId = conn.agentId
      ?? (typeof payload.agentId === 'string' && payload.agentId.trim() ? payload.agentId.trim() : null);
    const verdict = resolveWriteIdentity({
      souls: deps.actorSouls,
      credential: typeof payload.credential === 'string' && payload.credential.trim()
        ? payload.credential.trim()
        : null,
      assertedAgentId,
      route: `IPC ${action}`,
      harbor,
      requireIdentity: true,
    });
    if (!verdict.ok) throw new IpcRefusal(verdict.code, verdict.error);
    if (verdict.kind !== 'verified') {
      throw new IpcRefusal('IDENTITY_CREDENTIAL_REQUIRED', 'ownership IPC action requires a verified actor credential');
    }
    return { actorId: verdict.actorId, soulClass: verdict.soulClass };
  }

  function stampVerifiedSessionStart(
    payload: Record<string, unknown>,
    conn: IpcConnection,
    action: string,
  ): Record<string, unknown> {
    if (Object.prototype.hasOwnProperty.call(payload, 'worktreeId')) {
      throw new IpcRefusal(
        'UNKNOWN_FIELD',
        'worktreeId is daemon-derived; send the complete worktree witness instead',
      );
    }
    const metadata = payload.metadata === undefined || payload.metadata === null
      ? null
      : payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata as Record<string, unknown>
        : (() => { throw new IpcRefusal('VALIDATION_ERROR', 'metadata must be a JSON object'); })();
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, 'identity')) {
      throw new IpcRefusal(
        'CALLER_IDENTITY_FIELD_FORBIDDEN',
        'metadata.identity is daemon-owned and cannot be supplied by an IPC caller',
      );
    }
    const assertedAgentId = conn.agentId
      ?? (typeof payload.agentId === 'string' && payload.agentId.trim() ? payload.agentId.trim() : null);
    const harbor = typeof payload.harbor === 'string' && payload.harbor.trim()
      ? payload.harbor.trim()
      : deps.actorSouls?.constants?.defaultHarbor;
    const verdict = resolveWriteIdentity({
      souls: deps.actorSouls,
      credential: typeof payload.credential === 'string' && payload.credential.trim()
        ? payload.credential.trim()
        : null,
      assertedAgentId,
      route: `IPC ${action}`,
      harbor,
      requireIdentity: true,
    });
    if (!verdict.ok) throw new IpcRefusal(verdict.code, verdict.error);
    if (verdict.kind !== 'verified') {
      throw new IpcRefusal('IDENTITY_CREDENTIAL_REQUIRED', 'session start requires a verified actor credential');
    }
    const worktreeAdmission = resolveSessionWorktreeAdmission({
      worktree: payload.worktree,
      requireLinkedWorktree: payload.requireLinkedWorktree === true,
      allowMainWorktree: payload.allowMainWorktree === true,
      metadata,
    }, { probeWorktree: deps.sessionWorktreeProbe });
    if (!worktreeAdmission.success) {
      throw new IpcRefusal(
        worktreeAdmission.code ?? 'WORKTREE_PROVENANCE_INVALID',
        worktreeAdmission.error ?? 'session worktree admission failed',
      );
    }
    return {
      ...payload,
      agentId: verdict.agentId,
      // An explicit null is an authority fact: the caller had no Git world.
      // sessions.start must not auto-detect the daemon's unrelated cwd.
      worktreeId: worktreeAdmission.worktreeId,
      metadata: stampIdentityMetadata(worktreeAdmission.metadata, verdict),
    };
  }

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
  handlers.set(IpcAction.BEGIN, (p, conn) => {
    const stamped = stampVerifiedSessionStart(p, conn, IpcAction.BEGIN);
    if (deps.sugar) return deps.sugar.begin(stamped);
    return deps.sessions.start(String(stamped.purpose ?? ''), stamped);
  });

  handlers.set(IpcAction.DONE, (p) => {
    if (deps.sugar) return deps.sugar.done(p);
    return deps.sessions.end(String(p.sessionId), p);
  });

  handlers.set(IpcAction.SESSION_START, (p, conn) => {
    const stamped = stampVerifiedSessionStart(p, conn, IpcAction.SESSION_START);
    return deps.sessions.start(String(stamped.purpose ?? ''), stamped);
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
    if (!deps.durableOwnership) {
      throw new IpcRefusal('DURABLE_OWNERSHIP_UNAVAILABLE', 'canonical durable ownership service is unavailable');
    }
    if (typeof p.grantId !== 'string' || !p.grantId.trim() || typeof p.nonce !== 'string' || !p.nonce.trim()) {
      throw new IpcRefusal(
        'RECOVERY_GRANT_REQUIRED',
        'session takeover requires a signed durable-ownership grantId and one-shot nonce',
      );
    }
    const view = deps.durableOwnership.getGrant(p.grantId.trim());
    if (!view) throw new IpcRefusal('GRANT_NOT_FOUND', 'takeover grant not found');
    if (String(p.sessionId ?? '') !== view.grant.sourceSessionId) {
      throw new IpcRefusal('GRANT_BINDING_MISMATCH', 'route session does not match the signed grant');
    }
    const actor = requireOwnershipActor(
      p,
      conn,
      IpcAction.SESSION_TAKEOVER,
      view.grant.harbor,
      ['sessionId', 'grantId', 'nonce'],
    );
    return deps.durableOwnership.acceptTakeover({
      sourceSessionId: String(p.sessionId ?? ''),
      grantId: p.grantId.trim(),
      nonce: p.nonce.trim(),
    }, actor).then(result => ({
      success: true,
      predecessorId: result.grant.sourceSessionId,
      successorId: result.grant.successorSessionId,
      ownership: {
        grantId: result.grant.grantId,
        predecessorAgentNodeId: result.grant.predecessorAgentNodeId,
        successorAgentNodeId: result.grant.successorAgentNodeId,
        successorEpochId: result.epoch.epochId,
        cause: result.epoch.cause,
        contentHash: result.epoch.contentHash,
        signature: result.epoch.signature,
      },
      receipt: result.receipt,
      disposition: result.disposition,
    }));
  });

  handlers.set(IpcAction.OWNERSHIP_BOOTSTRAP, (p, conn) => {
    if (!deps.durableOwnership) {
      throw new IpcRefusal('DURABLE_OWNERSHIP_UNAVAILABLE', 'canonical durable ownership service is unavailable');
    }
    const harbor = typeof p.harbor === 'string' ? p.harbor.trim() : '';
    const actor = requireOwnershipActor(
      p,
      conn,
      IpcAction.OWNERSHIP_BOOTSTRAP,
      harbor,
      ['roadmapSlug', 'harbor', 'sourceSessionId', 'reason'],
    );
    return deps.durableOwnership.bootstrapCanonical({
      roadmapSlug: String(p.roadmapSlug ?? ''),
      harbor,
      sourceSessionId: String(p.sourceSessionId ?? ''),
      reason: String(p.reason ?? ''),
    }, actor).then(result => ({
      success: true,
      idempotent: result.idempotent,
      ownership: {
        epochId: result.epoch.epochId,
        epochNumber: result.epoch.epochNumber,
        ownerAgentNodeId: result.epoch.ownerAgentNodeId,
        claimSetHash: result.epoch.claimSetHash,
        contentHash: result.epoch.contentHash,
        signature: result.epoch.signature,
      },
    }));
  });

  handlers.set(IpcAction.OWNERSHIP_TAKEOVER_PREPARE, (p, conn) => {
    if (!deps.durableOwnership) {
      throw new IpcRefusal('DURABLE_OWNERSHIP_UNAVAILABLE', 'canonical durable ownership service is unavailable');
    }
    const harbor = typeof p.harbor === 'string' ? p.harbor.trim() : '';
    const actor = requireOwnershipActor(
      p,
      conn,
      IpcAction.OWNERSHIP_TAKEOVER_PREPARE,
      harbor,
      [
        'roadmapSlug', 'harbor', 'successorSessionId', 'reason',
        'claimDispositions', 'ttlMs', 'operatorPresenceProof',
      ],
    );
    return deps.durableOwnership.prepareTakeover({
      roadmapSlug: String(p.roadmapSlug ?? ''),
      harbor,
      successorSessionId: String(p.successorSessionId ?? ''),
      reason: String(p.reason ?? ''),
      claimDispositions: p.claimDispositions as Array<{ claimNodeId: string; disposition: 'transfer' | 'release' }>,
      ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      operatorPresenceProof: typeof p.operatorPresenceProof === 'string'
        ? p.operatorPresenceProof
        : undefined,
    }, actor).then(result => ({
      success: true,
      grant: {
        grantId: result.grant.grantId,
        roadmapSlug: result.grant.roadmapSlug,
        harbor: result.grant.harbor,
        predecessorEpochId: result.grant.predecessorEpochId,
        predecessorAgentNodeId: result.grant.predecessorAgentNodeId,
        successorAgentNodeId: result.grant.successorAgentNodeId,
        authorityKind: result.grant.authorityKind,
        operatorPresenceReceipt: result.grant.operatorPresenceReceipt,
        sourceSessionId: result.grant.sourceSessionId,
        successorSessionId: result.grant.successorSessionId,
        claimBindings: result.grant.claimBindings,
        briefing: result.grant.briefing,
        issuedAt: result.grant.issuedAt,
        expiresAt: result.grant.expiresAt,
        contentHash: result.grant.contentHash,
        signature: result.grant.signature,
      },
      nonce: result.nonce,
      receipt: result.receipt,
    }));
  });

  handlers.set(IpcAction.OWNERSHIP_GRANT_GET, (p, conn) => {
    if (!deps.durableOwnership) {
      throw new IpcRefusal('DURABLE_OWNERSHIP_UNAVAILABLE', 'canonical durable ownership service is unavailable');
    }
    const view = deps.durableOwnership.getGrant(String(p.grantId ?? ''));
    if (!view) throw new IpcRefusal('GRANT_NOT_FOUND', 'takeover grant not found');
    if (p.harbor !== undefined && String(p.harbor).trim() !== view.grant.harbor) {
      throw new IpcRefusal('GRANT_BINDING_MISMATCH', 'requested harbor does not match the signed grant');
    }
    const actor = requireOwnershipActor(
      p,
      conn,
      IpcAction.OWNERSHIP_GRANT_GET,
      view.grant.harbor,
      ['grantId', 'harbor'],
    );
    if (actor.actorId !== view.grant.authorizedActorId && actor.actorId !== view.grant.successorActorId) {
      throw new IpcRefusal('AUTHORITY_REQUIRED', 'actor is not a party to this takeover grant');
    }
    return {
      success: true,
      grant: {
        grantId: view.grant.grantId,
        roadmapSlug: view.grant.roadmapSlug,
        harbor: view.grant.harbor,
        sourceSessionId: view.grant.sourceSessionId,
        successorSessionId: view.grant.successorSessionId,
        state: view.state,
        issuedAt: view.grant.issuedAt,
        expiresAt: view.grant.expiresAt,
        consumedAt: view.consumedAt,
        consumedEpochId: view.consumedEpochId,
        receipts: view.receipts.map(receipt => ({
          receiptId: receipt.receiptId,
          kind: receipt.kind,
          at: receipt.at,
          contentHash: receipt.contentHash,
          signature: receipt.signature,
        })),
      },
    };
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
      // IPC does not authenticate a caller-supplied Git path on this action.
      // An exact session id remains authoritative; otherwise scope to the
      // explicit no-world lane instead of borrowing the daemon cwd.
      worktreeId: null,
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
      const auth = verifyAgent(agentId, verifier, true, OWNERSHIP_ACTIONS.has(action));
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
    const replyDone = (result: unknown) => {
      if (frame.convId === 0) return;
      reply({
        type: Performative.INFORM_DONE,
        convId: frame.convId,
        payload: { action, result: result ?? { success: true } },
      });
    };
    const replyError = (error: unknown) => {
      if (frame.convId === 0) return;
      const refusal = error instanceof IpcRefusal
        || (error instanceof DurableOwnershipError && error.statusCode < 500);
      const code = error instanceof IpcRefusal || error instanceof DurableOwnershipError
        ? error.code
        : 'action_failed';
      reply({
        type: refusal ? Performative.REFUSE : Performative.FAILURE,
        convId: frame.convId,
        payload: {
          error: code,
          code,
          action,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    };
    try {
      const result = handler(frame.payload, conn);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).then(replyDone, replyError);
      } else {
        replyDone(result);
      }
    } catch (error) {
      replyError(error);
    }
  }

  return {
    handleFrame,
    /** List all registered action names (for diagnostics) */
    get actions() { return Array.from(handlers.keys()); },
  };
}
