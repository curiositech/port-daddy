/**
 * HTTP trust boundary for durable actor inboxes.
 *
 * The inbox store remains a trusted in-process primitive. Public transports
 * must enter through this module so request paths, aliases, loopback origin,
 * Host/XFF headers, and caller-authored provenance never become authority.
 */

import type { LiveActorInboxResolution } from './agents.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type BoundaryLogger,
  type IdentityVerifier,
} from './identity-write-boundary.js';

export const MAX_EXTERNAL_INBOX_CONTENT_BYTES = 64 * 1024;

export interface InboxActorSouls extends IdentityVerifier {
  constants?: { defaultHarbor?: string };
}

export interface LiveInboxResolver {
  resolveLiveActorInbox(actorId: string, harbor: string): LiveActorInboxResolution;
}

export interface InboxBoundaryFailure {
  ok: false;
  httpStatus: 400 | 401 | 403 | 409 | 413 | 429 | 503;
  code: string;
  error: string;
}

export interface CanonicalInboxBinding {
  ok: true;
  actorId: string;
  harbor: string;
  inboxTarget: string;
}

export interface ExternalInboxProvenance {
  kind: 'anonymous-external' | 'authenticated-external';
  actorId: string | null;
  harbor: string;
}

export interface ExternalInboxSender {
  ok: true;
  from: string;
  messageType: 'external.anonymous' | 'external.authenticated';
  provenance: ExternalInboxProvenance;
}

export interface ExternalInboxContent {
  ok: true;
  content: unknown;
  contentType: 'text' | 'json';
  bytes: number;
}

function failure(
  httpStatus: InboxBoundaryFailure['httpStatus'],
  code: string,
  error: string,
): InboxBoundaryFailure {
  return { ok: false, httpStatus, code, error };
}

export function canonicalInboxHarbor(souls?: InboxActorSouls | null): string | InboxBoundaryFailure {
  const raw = souls?.constants?.defaultHarbor;
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim()) {
    return failure(
      503,
      'IDENTITY_SCOPE_UNAVAILABLE',
      'the daemon has no verified inbox tenant scope; refusing caller-selected scope',
    );
  }
  return raw;
}

function exactLiveBinding(
  resolver: LiveInboxResolver | null | undefined,
  actorId: string,
  harbor: string,
): CanonicalInboxBinding | InboxBoundaryFailure {
  if (!resolver) {
    return failure(
      503,
      'ACTOR_INBOX_REGISTRY_UNAVAILABLE',
      'the verified actor inbox registry is unavailable',
    );
  }
  const resolved = resolver.resolveLiveActorInbox(actorId, harbor);
  if (!resolved.success) {
    return failure(409, resolved.code, resolved.error);
  }
  const { binding } = resolved;
  if (
    binding.actorId !== actorId
    || binding.harbor !== harbor
    || binding.inboxTarget !== actorId
  ) {
    return failure(
      503,
      'ACTOR_INBOX_BINDING_INVALID',
      'the live inbox registry returned a non-canonical actor binding',
    );
  }
  return { ok: true, actorId, harbor, inboxTarget: binding.inboxTarget };
}

/** Require the exact credential-owned canonical actor named by the route. */
export function authorizeCanonicalInboxOwner(params: {
  souls?: InboxActorSouls | null;
  resolver?: LiveInboxResolver | null;
  headers: Record<string, unknown>;
  body?: unknown;
  requestedActorId: string;
  route: string;
  logger?: BoundaryLogger;
}): CanonicalInboxBinding | InboxBoundaryFailure {
  const harbor = canonicalInboxHarbor(params.souls);
  if (typeof harbor !== 'string') return harbor;

  const identity = resolveWriteIdentity({
    souls: params.souls,
    credential: extractActorCredential(params.headers, params.body),
    assertedAgentId: null,
    route: params.route,
    harbor,
    logger: params.logger,
    requireIdentity: true,
  });
  if (!identity.ok) {
    return failure(identity.httpStatus, identity.code, identity.error);
  }
  if (identity.kind !== 'verified') {
    return failure(401, 'IDENTITY_CREDENTIAL_REQUIRED', 'a verified actor credential is required');
  }

  // Aliases are display metadata. Even an alias that resolves to this soul is
  // not accepted as an inbox party or path selector.
  if (params.requestedActorId !== identity.actorId) {
    return failure(
      403,
      'INBOX_OWNER_MISMATCH',
      'the credential does not own the exact canonical actor inbox selected by this route',
    );
  }
  return exactLiveBinding(params.resolver, identity.actorId, harbor);
}

/** Resolve a path target only through the daemon-owned live binding table. */
export function resolveCanonicalInboxTarget(params: {
  souls?: InboxActorSouls | null;
  resolver?: LiveInboxResolver | null;
  requestedActorId: string;
}): CanonicalInboxBinding | InboxBoundaryFailure {
  const harbor = canonicalInboxHarbor(params.souls);
  if (typeof harbor !== 'string') return harbor;
  const requested = typeof params.requestedActorId === 'string' ? params.requestedActorId : '';
  if (!requested || requested !== requested.trim()) {
    return failure(400, 'ACTOR_INBOX_TARGET_INVALID', 'a canonical actor inbox target is required');
  }
  return exactLiveBinding(params.resolver, requested, harbor);
}

const CALLER_AUTHORITY_FIELDS = Object.freeze([
  'from',
  'type',
  'wake',
  'project',
  'harbor',
  'agentId',
  'operatorToken',
  'identity',
  'actorId',
  'actorCredential',
  'credential',
  'sender',
  'provenance',
  'messageContent',
  'deliveryKey',
  'idempotencyKey',
  'signal',
  'target',
  'to',
]);

export function parseExternalInboxContent(
  body: unknown,
  maxBytes: number = MAX_EXTERNAL_INBOX_CONTENT_BYTES,
): ExternalInboxContent | InboxBoundaryFailure {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return failure(400, 'VALIDATION_ERROR', 'a JSON object body is required');
  }
  const record = body as Record<string, unknown>;
  const forbidden = CALLER_AUTHORITY_FIELDS.find(field => Object.prototype.hasOwnProperty.call(record, field));
  if (forbidden) {
    return failure(
      400,
      'INBOX_AUTHORITY_OVERRIDE_FORBIDDEN',
      `inbox ${forbidden} is selected by the daemon and cannot be supplied by the caller`,
    );
  }
  const unsupported = Object.keys(record).find(field => field !== 'content' && field !== 'contentType');
  if (unsupported) {
    return failure(
      400,
      'INBOX_FIELD_UNSUPPORTED',
      `external inbox field ${unsupported} is not supported`,
    );
  }

  const content = record.content;
  if (content === undefined || content === null || (typeof content === 'string' && !content.trim())) {
    return failure(400, 'VALIDATION_ERROR', 'content required');
  }
  const requestedType = record.contentType;
  if (requestedType !== undefined && requestedType !== 'text' && requestedType !== 'json') {
    return failure(400, 'INBOX_CONTENT_TYPE_INVALID', 'external inbox contentType must be text or json');
  }
  const contentType = requestedType ?? (typeof content === 'string' ? 'text' : 'json');
  if (contentType === 'text' && typeof content !== 'string') {
    return failure(400, 'INBOX_CONTENT_TYPE_INVALID', 'text inbox content must be a string');
  }

  let serialized: string;
  try {
    serialized = contentType === 'text' ? content as string : JSON.stringify(content);
  } catch {
    return failure(400, 'INBOX_CONTENT_INVALID', 'inbox content must be JSON serializable');
  }
  if (typeof serialized !== 'string') {
    return failure(400, 'INBOX_CONTENT_INVALID', 'inbox content must be JSON serializable');
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) {
    return failure(413, 'INBOX_CONTENT_TOO_LARGE', `inbox content exceeds ${maxBytes} bytes`);
  }
  return { ok: true, content, contentType, bytes };
}

/**
 * Attribute public sends to either a verified live canonical actor or one
 * fixed anonymous principal. Request JSON never selects the stored sender.
 */
export function resolveExternalInboxSender(params: {
  souls?: InboxActorSouls | null;
  resolver?: LiveInboxResolver | null;
  headers: Record<string, unknown>;
  harbor: string;
  route: string;
  logger?: BoundaryLogger;
}): ExternalInboxSender | InboxBoundaryFailure {
  const identity = resolveWriteIdentity({
    souls: params.souls,
    credential: extractActorCredential(params.headers, undefined),
    assertedAgentId: null,
    route: params.route,
    harbor: params.harbor,
    logger: params.logger,
    requireIdentity: false,
  });
  if (!identity.ok) return failure(identity.httpStatus, identity.code, identity.error);
  if (identity.kind === 'anonymous') {
    return {
      ok: true,
      from: 'external:anonymous',
      messageType: 'external.anonymous',
      provenance: { kind: 'anonymous-external', actorId: null, harbor: params.harbor },
    };
  }

  const live = exactLiveBinding(params.resolver, identity.actorId, params.harbor);
  if (!live.ok) return live;
  return {
    ok: true,
    from: identity.actorId,
    messageType: 'external.authenticated',
    provenance: {
      kind: 'authenticated-external',
      actorId: identity.actorId,
      harbor: params.harbor,
    },
  };
}

export interface ExternalInboxRateLimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
  scope?: 'anonymous' | 'actor' | 'target' | 'global' | 'state';
}

export interface ExternalInboxRateLimiter {
  consume(input: { senderActorId: string | null; targetActorId: string }): ExternalInboxRateLimitResult;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

export function createExternalInboxRateLimiter(options: {
  now?: () => number;
  windowMs?: number;
  anonymousLimit?: number;
  actorLimit?: number;
  targetLimit?: number;
  globalLimit?: number;
  maxKeys?: number;
} = {}): ExternalInboxRateLimiter {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 60_000;
  const anonymousLimit = options.anonymousLimit ?? 20;
  const actorLimit = options.actorLimit ?? 60;
  const targetLimit = options.targetLimit ?? 60;
  const globalLimit = options.globalLimit ?? 120;
  const maxKeys = options.maxKeys ?? 1_024;
  const senders = new Map<string, RateWindow>();
  const targets = new Map<string, RateWindow>();
  let global: RateWindow = { startedAt: now(), count: 0 };

  function current(map: Map<string, RateWindow>, key: string, timestamp: number): RateWindow | null {
    const existing = map.get(key);
    if (existing && timestamp - existing.startedAt < windowMs) return existing;
    if (existing) map.delete(key);
    for (const [candidate, value] of map) {
      if (timestamp - value.startedAt >= windowMs) map.delete(candidate);
    }
    if (map.size >= maxKeys) return null;
    const created = { startedAt: timestamp, count: 0 };
    map.set(key, created);
    return created;
  }

  function retry(window: RateWindow, timestamp: number): number {
    return Math.max(1, Math.ceil((windowMs - (timestamp - window.startedAt)) / 1000));
  }

  return {
    consume({ senderActorId, targetActorId }): ExternalInboxRateLimitResult {
      const timestamp = now();
      if (timestamp - global.startedAt >= windowMs) global = { startedAt: timestamp, count: 0 };
      if (global.count >= globalLimit) {
        return { ok: false, scope: 'global', retryAfterSeconds: retry(global, timestamp) };
      }
      const senderKey = senderActorId ?? 'anonymous';
      const sender = current(senders, senderKey, timestamp);
      const target = current(targets, targetActorId, timestamp);
      if (!sender || !target) return { ok: false, scope: 'state', retryAfterSeconds: 1 };
      const senderLimit = senderActorId ? actorLimit : anonymousLimit;
      if (sender.count >= senderLimit) {
        return {
          ok: false,
          scope: senderActorId ? 'actor' : 'anonymous',
          retryAfterSeconds: retry(sender, timestamp),
        };
      }
      if (target.count >= targetLimit) {
        return { ok: false, scope: 'target', retryAfterSeconds: retry(target, timestamp) };
      }
      global.count += 1;
      sender.count += 1;
      target.count += 1;
      return { ok: true };
    },
  };
}
