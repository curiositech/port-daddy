/**
 * Correlation Context — threads `{ requestId, actorId, tenantId }` through a request's async call
 * tree so every log line, metric, and audit row can be attributed to who caused it.
 *
 * Why this exists:
 *   The absence audit's #1 multi-tenant blocker: `tenantId` appears literally nowhere, and no
 *   request/trace id is threaded through logging. A slow request can't be correlated across its
 *   own log lines, let alone to a tenant for audit or billing. Passing these through every function
 *   signature is infeasible; `AsyncLocalStorage` carries them implicitly and safely across awaits.
 *
 * Usage:
 *   - `runWithContext(ctx, () => handler())` in a Fastify `onRequest` hook establishes the scope.
 *   - `currentContext()` anywhere downstream returns the active `{ requestId, actorId, tenantId }`.
 *   - The governed logger (index.ts) auto-merges this into every line's meta — no call site changes.
 *
 * Multi-tenant note: `tenantId`/`actorId` here are for ATTRIBUTION, not authorization. They are as
 * trustworthy as whatever resolved them (a verified harbor token, say). Never gate access on these
 * without a real auth check — see ADR-0040 on non-forgeable daemon-minted actor identity.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  /** Unique per inbound request; correlates all log lines for one request. */
  requestId?: string;
  /** The acting agent/user, resolved from the request's credential. */
  actorId?: string;
  /** The tenant boundary this request operates within (multi-tenant). */
  tenantId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Run `fn` with `ctx` as the active correlation context for the whole async subtree. */
export function runWithContext<T>(ctx: CorrelationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active context, or an empty object outside any request scope. */
export function currentContext(): CorrelationContext {
  return storage.getStore() ?? {};
}

/** Merge the active correlation fields into a log/metric meta object (present keys only). */
export function withCorrelation(meta?: Record<string, unknown>): Record<string, unknown> {
  const ctx = currentContext();
  const out: Record<string, unknown> = { ...(meta ?? {}) };
  if (ctx.requestId !== undefined) out.request_id = ctx.requestId;
  if (ctx.actorId !== undefined) out.actor_id = ctx.actorId;
  if (ctx.tenantId !== undefined) out.tenant_id = ctx.tenantId;
  return out;
}

/**
 * Monotonic-ish request id without pulling in a uuid dep. Not cryptographic — purely for
 * correlation. `seq` guarantees uniqueness within a process even if two ids share a timestamp.
 */
let seq = 0;
export function newRequestId(now: () => number = Date.now): string {
  seq = (seq + 1) % 1_000_000;
  return `req_${now().toString(36)}_${seq.toString(36)}`;
}
