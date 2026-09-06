/**
 * Chartroom authority kernel — signed, append-only program truth.
 *
 * Chartroom is broader than a roadmap: plans, ADRs, documents, decisions,
 * owners, dependencies, and visual evidence share one event history. D1 orders
 * verified intents and maintains bounded projections. It does not invent
 * authority: the owning harbor signs every mutation, and the Relay signs only
 * acceptance/readback receipts that a local harbor can retain.
 */

import type { Env } from './types.js';
import {
  ZERO_HASH,
  hashHex,
  pubKeyFromPrivKey,
  randomHex,
  signEd25519,
  verifyEd25519,
} from './crypto.js';
import { canonicalJson } from './envelope.js';
import {
  resolveSession,
  userCanReadRepo,
  userIsRepoAdmin,
} from './auth-github.js';
import { getInstallationTokenCached, getRepoInstallationId } from './github-app.js';

export const CHARTROOM_EVENT_TYPES = [
  'node.upsert', 'node.tombstone',
  'edge.upsert', 'edge.tombstone',
  'artifact.link', 'artifact.unlink',
  'decision.record', 'decision.supersede',
  'status.set', 'owner.assign', 'owner.unassign',
  'dependency.add', 'dependency.remove',
  'source.ingest', 'source.supersede',
] as const;

export type ChartroomEventType = (typeof CHARTROOM_EVENT_TYPES)[number];
export type ChartroomActorKind = 'operator' | 'agent' | 'automation' | 'importer';
export type ChartroomPermission = 'read' | 'write';

export interface ChartroomScope {
  accountId: string;
  teamId: string;
  repositoryId: string;
  repository: string;
  harborId: string;
  resourceId: string;
}

export interface ChartroomActor {
  kind: ChartroomActorKind;
  actorId: string;
  sessionId: string;
  agentNodeId: string;
}

export interface ChartroomIssuer {
  harborId: string;
  authorityEpoch: number;
  signature: string;
}

export interface ChartroomEventInput {
  type: ChartroomEventType;
  [key: string]: unknown;
}

export interface ChartroomCommand {
  scope: ChartroomScope;
  expectedPlanVersion: number;
  idempotencyKey: string;
  intentNonce: string;
  issuedAt: number;
  expiresAt: number;
  actor: ChartroomActor;
  issuer: ChartroomIssuer;
  event: ChartroomEventInput;
}

interface ChartroomStreamRow {
  account_id: string;
  team_id: string;
  repository_id: string;
  repo_full_name: string;
  harbor_id: string;
  resource_id: string;
  authority_epoch: number;
  plan_version: number;
  tip_hash: string;
  event_count: number;
  created_at: number;
  updated_at: number;
}

export interface ChartroomEventRow {
  account_id: string;
  team_id: string;
  repository_id: string;
  repo_full_name: string;
  harbor_id: string;
  resource_id: string;
  event_id: string;
  event_type: ChartroomEventType;
  plan_version: number;
  authority_epoch: number;
  previous_hash: string;
  event_hash: string;
  request_hash: string;
  capability_token_hash: string;
  idempotency_key: string;
  intent_nonce: string;
  issued_at: number;
  expires_at: number;
  actor_kind: ChartroomActorKind;
  actor_id: string;
  session_id: string;
  agent_node_id: string;
  issuer_pubkey: string;
  issuer_signature: string;
  payload_json: string;
  accepted_at: number;
}

interface ChartroomCapabilityRow {
  account_id: string;
  team_id: string;
  repository_id: string;
  repo_full_name: string;
  harbor_id: string;
  resource_id: string;
  token_hash: string;
  permission: ChartroomPermission;
  installation_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  event_count: number;
  max_events: number;
}

interface HarborAuthorityRow {
  id: string;
  pubkey: string;
  authority_epoch: number;
  role?: 'owner' | 'member';
}

export interface ChartroomAcceptanceReceipt {
  schema: 'port-daddy.chartroom-acceptance.v1';
  scope: ChartroomScope;
  eventId: string;
  eventType: ChartroomEventType;
  planVersion: number;
  authorityEpoch: number;
  previousHash: string;
  eventHash: string;
  requestHash: string;
  acceptedAt: number;
  readbackDigest: string;
  projectionInputDigest: string;
  relayPubKey: string;
  signature: string;
}

interface ChartroomAcceptanceReceiptRow {
  receipt_json: string;
  receipt_hash: string;
}

export interface ChartroomRepositoryIdentity {
  teamId: string;
  repositoryId: string;
  repository: string;
  installationId: string;
}

export interface ChartroomAccountIdentity {
  accountId: string;
}

export type ChartroomRepositoryVerifier = (
  env: Env,
  repository: string,
) => Promise<ChartroomRepositoryIdentity>;

export type ChartroomAccountAuthorizer = (
  request: Request,
  env: Env,
  repository: string,
  permission: ChartroomPermission,
) => Promise<ChartroomAccountIdentity>;

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_TITLE = 2_000;
const MAX_SUMMARY = 32 * 1024;
const MAX_IDENTIFIER = 200;
const MAX_EXPORT_ROWS = 250;
const MAX_PROJECTION_ROWS = 100;
const CAPABILITY_MAX_TTL_SECONDS = 10 * 60;
const INTENT_MAX_TTL_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 30;
const CHARTROOM_COMMAND_SCHEMA = 'port-daddy.chartroom-command.v1';
const HASH_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]*$/;
const REPOSITORY_RE = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
const LIKELY_CREDENTIAL_RE = /(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{16,})/;
const LOCAL_PRIVATE_PATH_RE = /(?:\bfile:\/\/|(?:^|[\s"'(])\/(?:Users|home|private|tmp|var\/folders)\/|(?:^|[\s"'(])[A-Za-z]:\\(?:Users|Documents and Settings)\\)/i;
const SECRET_KEYS = new Set([
  'authorization', 'cookie', 'password', 'passwd', 'secret', 'token',
  'apikey', 'privatekey', 'clientsecret', 'accesstoken', 'refreshtoken',
]);

/**
 * A typed failure keeps the security design fail-closed while allowing routes
 * to return useful conflict codes instead of leaking raw D1 errors.
 *
 * @param status - HTTP status appropriate for the refusal.
 * @param code - Stable machine-readable refusal code.
 * @param message - Operator-readable explanation.
 * @param detail - Bounded non-secret evidence about the conflict.
 */
export class ChartroomError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ChartroomError';
  }
}

/**
 * Build a no-store JSON response. The design keeps every Chartroom route from
 * accidentally caching scoped authority or capability material.
 *
 * @param status - HTTP status.
 * @param body - JSON-serializable response body.
 * @returns A no-store JSON response.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Narrow an unknown value to a plain object. The intent is to reject arrays
 * and exotic wire shapes before any security-relevant normalization.
 *
 * @param value - Unknown decoded JSON.
 * @returns A record or null.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Normalize bounded text. The design bounds every string before it can reach
 * D1, receipts, logs, or downstream indexing.
 *
 * @param value - Candidate string.
 * @param max - Maximum UTF-16 code units accepted.
 * @param allowEmpty - Whether an empty trimmed value is meaningful.
 * @returns The trimmed string or null.
 */
function boundedText(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max) return null;
  return text;
}

/**
 * Normalize a durable identifier. The conservative alphabet is a design
 * choice: ids must round-trip through URLs, SQLite, and logs without escaping
 * ambiguity.
 *
 * @param value - Candidate identifier.
 * @param max - Maximum identifier length.
 * @returns A normalized identifier or null.
 */
function identifier(value: unknown, max = MAX_IDENTIFIER): string | null {
  const text = boundedText(value, max);
  return text && IDENTIFIER_RE.test(text) ? text : null;
}

/**
 * Normalize a GitHub owner/name repository. The design uses a single lower-case
 * canonical form in every scope predicate and signed command.
 *
 * @param value - Candidate owner/name.
 * @returns Canonical lower-case owner/name or null.
 */
function repositoryName(value: unknown): string | null {
  const text = boundedText(value, 200)?.toLowerCase() ?? '';
  return REPOSITORY_RE.test(text) ? text : null;
}

/**
 * Validate safe integer clocks and versions. The purpose is to prevent JS/D1
 * precision drift from changing a signed value.
 *
 * @param value - Candidate number.
 * @param allowZero - Whether zero is valid.
 * @returns A safe integer or null.
 */
function safeInteger(value: unknown, allowZero = false): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const number = Number(value);
  return number > 0 || (allowZero && number === 0) ? number : null;
}

/**
 * Detect secret-bearing structured fields before persistence. The design is a
 * conservative pre-seal guard over exact key names, not an unreliable search
 * index or an attempt to inspect arbitrary prose.
 *
 * @param value - Decoded JSON subtree.
 * @param depth - Current recursion depth, bounded against pathological input.
 * @returns True when a known credential field is present.
 */
function containsPrivateMaterial(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') {
    return LIKELY_CREDENTIAL_RE.test(value) || LOCAL_PRIVATE_PATH_RE.test(value);
  }
  if (depth > 20) return true;
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsPrivateMaterial(item, depth + 1));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(normalized) || containsPrivateMaterial(child, depth + 1)) return true;
  }
  return false;
}

/**
 * Copy a JSON object only when its canonical representation is bounded. The
 * design measures what is actually signed, not a caller-supplied byte count.
 *
 * @param value - Candidate JSON object.
 * @param maxBytes - Maximum canonical byte budget.
 * @returns The object or null.
 */
function boundedObject(value: unknown, maxBytes = MAX_PAYLOAD_BYTES): Record<string, unknown> | null {
  const object = value === undefined ? {} : record(value);
  if (!object) return null;
  if (containsPrivateMaterial(object)) return null;
  try {
    return new TextEncoder().encode(canonicalJson(object)).byteLength <= maxBytes ? object : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a non-secret artifact/source URI. The design rejects embedded
 * credentials, query strings, fragments, local file paths, and unknown schemes
 * before a pointer enters remote D1.
 *
 * @param value - Candidate URI.
 * @param field - Field name for precise errors.
 * @param optional - Whether null/absence is accepted.
 * @returns Canonical URI or null when optional and absent.
 */
function safeUri(value: unknown, field: string, optional = false): string | null {
  if (optional && (value === null || value === undefined)) return null;
  const text = boundedText(value, 4_000);
  if (!text) throw new ChartroomError(400, 'BAD_EVENT', `${field} must be a bounded URI`);
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new ChartroomError(400, 'BAD_EVENT', `${field} must be an absolute URI`); }
  if (!['https:', 'github:', 'portdaddy:', 'r2:', 'repo:'].includes(parsed.protocol)) {
    throw new ChartroomError(400, 'BAD_EVENT', `${field} uses a forbidden URI scheme`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ChartroomError(400, 'SECRET_BEARING_URI', `${field} must not contain credentials, query, or fragment material`);
  }
  return parsed.toString();
}

/**
 * Read and parse a bounded JSON body. The dual declared/actual checks are a
 * cost-control design: lying or absent Content-Length cannot bypass the bound.
 *
 * @param request - Incoming request.
 * @returns Parsed JSON.
 */
async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new ChartroomError(413, 'PAYLOAD_TOO_LARGE', 'Chartroom request exceeds 128 KiB');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new ChartroomError(413, 'PAYLOAD_TOO_LARGE', 'Chartroom request exceeds 128 KiB');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ChartroomError(400, 'BAD_JSON', 'body must be valid JSON');
  }
}

/**
 * Normalize the complete isolation tuple. The core design refuses partial
 * scopes because an omitted dimension is how one-repo prototypes become
 * cross-tenant leaks.
 *
 * @param value - Candidate scope object.
 * @returns A canonical full scope.
 */
export function normalizeChartroomScope(value: unknown): ChartroomScope {
  const scope = record(value);
  const accountId = identifier(scope?.accountId);
  const teamId = identifier(scope?.teamId);
  const repositoryId = identifier(scope?.repositoryId);
  const repository = repositoryName(scope?.repository);
  const harborId = identifier(scope?.harborId);
  const resourceId = identifier(scope?.resourceId);
  if (!accountId || !teamId || !repositoryId || !repository || !harborId || !resourceId) {
    throw new ChartroomError(
      400,
      'BAD_SCOPE',
      'scope requires accountId, teamId, repositoryId, repository, harborId, and resourceId',
    );
  }
  return { accountId, teamId, repositoryId, repository, harborId, resourceId };
}

/**
 * Normalize attributable actor provenance. The design makes both session and
 * AgentNode mandatory even for imports, so a future investigator can follow
 * the responsibility chain without guessing which credential spoke.
 *
 * @param value - Candidate actor object.
 * @returns Canonical actor provenance.
 */
function normalizeActor(value: unknown): ChartroomActor {
  const actor = record(value);
  const kind = String(actor?.kind ?? '');
  const actorId = identifier(actor?.actorId);
  const sessionId = identifier(actor?.sessionId);
  const agentNodeId = identifier(actor?.agentNodeId);
  if (!['operator', 'agent', 'automation', 'importer'].includes(kind) || !actorId || !sessionId || !agentNodeId) {
    throw new ChartroomError(400, 'BAD_ACTOR', 'actor kind, actorId, sessionId, and agentNodeId are required');
  }
  return { kind: kind as ChartroomActorKind, actorId, sessionId, agentNodeId };
}

/**
 * Normalize harbor issuer evidence. The intent signature remains distinct from
 * Relay acceptance, preserving the design boundary between writer authority
 * and transport/storage acknowledgement.
 *
 * @param value - Candidate issuer object.
 * @returns Canonical issuer evidence.
 */
function normalizeIssuer(value: unknown): ChartroomIssuer {
  const issuer = record(value);
  const harborId = identifier(issuer?.harborId);
  const authorityEpoch = safeInteger(issuer?.authorityEpoch);
  const signature = typeof issuer?.signature === 'string' ? issuer.signature.toLowerCase() : '';
  if (!harborId || !authorityEpoch || !SIG_RE.test(signature)) {
    throw new ChartroomError(400, 'BAD_ISSUER', 'issuer requires harborId, authorityEpoch, and an Ed25519 signature');
  }
  return { harborId, authorityEpoch, signature };
}

/**
 * Require a bounded identifier field from an event. The helper's purpose is to
 * keep every event-specific failure precise without weakening normalization.
 *
 * @param event - Event record.
 * @param key - Field name.
 * @returns Canonical identifier.
 */
function eventId(event: Record<string, unknown>, key: string): string {
  const value = identifier(event[key]);
  if (!value) throw new ChartroomError(400, 'BAD_EVENT', `${event.type}.${key} must be a bounded identifier`);
  return value;
}

/**
 * Require a bounded event string. The design centralizes text caps so a new
 * projection cannot quietly exceed storage/indexing budgets.
 *
 * @param event - Event record.
 * @param key - Field name.
 * @param max - Maximum accepted length.
 * @param allowEmpty - Whether empty text is meaningful.
 * @returns Canonical text.
 */
function eventText(
  event: Record<string, unknown>,
  key: string,
  max: number,
  allowEmpty = false,
): string {
  const value = boundedText(event[key], max, allowEmpty);
  if (value === null) throw new ChartroomError(400, 'BAD_EVENT', `${event.type}.${key} is missing or too large`);
  if (LIKELY_CREDENTIAL_RE.test(value)) {
    throw new ChartroomError(400, 'SECRET_BEARING_TEXT', `${event.type}.${key} resembles credential material`);
  }
  if (LOCAL_PRIVATE_PATH_RE.test(value)) {
    throw new ChartroomError(400, 'LOCAL_PRIVATE_PATH', `${event.type}.${key} contains a local-private path`);
  }
  return value;
}

/**
 * Normalize optional identifiers without treating absence as corruption. The
 * purpose is to preserve explicit supersession/ownership links when present.
 *
 * @param value - Candidate optional id.
 * @param field - Field name for errors.
 * @returns A canonical id or null.
 */
function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const id = identifier(value);
  if (!id) throw new ChartroomError(400, 'BAD_EVENT', `${field} must be a bounded identifier`);
  return id;
}

/**
 * Normalize one typed event into its signed and stored shape. The design uses
 * an explicit switch rather than an open payload bag, so each new mutation is
 * reviewed as a projection/retention decision.
 *
 * @param value - Candidate event.
 * @returns Canonical event.
 */
function normalizeEvent(value: unknown): ChartroomEventInput {
  const input = record(value);
  const rawType = input?.type;
  if (!input || !CHARTROOM_EVENT_TYPES.includes(rawType as ChartroomEventType)) {
    throw new ChartroomError(400, 'BAD_EVENT', 'event.type is unsupported');
  }
  const type = rawType as ChartroomEventType;
  const payload = boundedObject(input.payload);
  if (!payload) throw new ChartroomError(400, 'BAD_EVENT', 'event.payload must be a bounded JSON object');
  switch (type) {
    case 'node.upsert': return {
      type, nodeId: eventId(input, 'nodeId'), nodeKind: eventId(input, 'nodeKind'),
      title: eventText(input, 'title', MAX_TITLE), summary: eventText(input, 'summary', MAX_SUMMARY, true),
      status: eventId(input, 'status'), ownerActorId: optionalId(input.ownerActorId, 'ownerActorId'),
      supersedesId: optionalId(input.supersedesId, 'supersedesId'), payload,
    };
    case 'node.tombstone': return {
      type, nodeId: eventId(input, 'nodeId'), reason: eventText(input, 'reason', MAX_SUMMARY), payload,
    };
    case 'edge.upsert': return {
      type, edgeId: eventId(input, 'edgeId'), edgeType: eventId(input, 'edgeType'),
      sourceId: eventId(input, 'sourceId'), targetId: eventId(input, 'targetId'), payload,
    };
    case 'edge.tombstone': return { type, edgeId: eventId(input, 'edgeId'), payload };
    case 'artifact.link': {
      const digest = input.digest == null ? null : String(input.digest).toLowerCase();
      if (digest !== null && !HASH_RE.test(digest)) throw new ChartroomError(400, 'BAD_EVENT', 'artifact digest must be SHA-256 hex');
      return {
        type, linkId: eventId(input, 'linkId'), nodeId: optionalId(input.nodeId, 'nodeId'),
        artifactKind: eventId(input, 'artifactKind'), uri: safeUri(input.uri, 'artifact.uri')!,
        digest, title: eventText(input, 'title', MAX_TITLE, true), payload,
      };
    }
    case 'artifact.unlink': return { type, linkId: eventId(input, 'linkId'), payload };
    case 'decision.record': {
      const affectedIds = Array.isArray(input.affectedIds) ? input.affectedIds.map((id) => optionalId(id, 'affectedIds')!) : [];
      if (affectedIds.length > 250) throw new ChartroomError(400, 'BAD_EVENT', 'decision affectedIds exceeds 250');
      const status = eventId(input, 'status');
      if (!['proposed', 'accepted', 'rejected', 'superseded'].includes(status)) {
        throw new ChartroomError(400, 'BAD_EVENT', 'decision status is unsupported');
      }
      return {
        type, decisionId: eventId(input, 'decisionId'), title: eventText(input, 'title', MAX_TITLE),
        rationale: eventText(input, 'rationale', MAX_SUMMARY), status, affectedIds,
        supersedesId: optionalId(input.supersedesId, 'supersedesId'), payload,
      };
    }
    case 'decision.supersede': return {
      type, decisionId: eventId(input, 'decisionId'), supersededById: eventId(input, 'supersededById'),
      rationale: eventText(input, 'rationale', MAX_SUMMARY), payload,
    };
    case 'status.set': return { type, nodeId: eventId(input, 'nodeId'), status: eventId(input, 'status'), payload };
    case 'owner.assign': return {
      type, nodeId: eventId(input, 'nodeId'), ownerActorId: eventId(input, 'ownerActorId'), payload,
    };
    case 'owner.unassign': return { type, nodeId: eventId(input, 'nodeId'), payload };
    case 'dependency.add': return {
      type, edgeId: eventId(input, 'edgeId'), sourceId: eventId(input, 'sourceId'),
      targetId: eventId(input, 'targetId'), payload,
    };
    case 'dependency.remove': return { type, edgeId: eventId(input, 'edgeId'), payload };
    case 'source.ingest': {
      const digest = String(input.digest ?? '').toLowerCase();
      if (!HASH_RE.test(digest)) throw new ChartroomError(400, 'BAD_EVENT', 'source digest must be SHA-256 hex');
      return {
        type, sourceId: eventId(input, 'sourceId'), revisionId: eventId(input, 'revisionId'),
        sourceKind: eventId(input, 'sourceKind'), uri: safeUri(input.uri, 'source.uri', true),
        digest, title: eventText(input, 'title', MAX_TITLE), summary: eventText(input, 'summary', MAX_SUMMARY, true),
        supersedesRevisionId: optionalId(input.supersedesRevisionId, 'supersedesRevisionId'), payload,
      };
    }
    case 'source.supersede': return {
      type, sourceId: eventId(input, 'sourceId'), revisionId: eventId(input, 'revisionId'),
      supersededByRevisionId: eventId(input, 'supersededByRevisionId'), payload,
    };
  }
}

/**
 * Validate and canonicalize a complete signed command. The design signs the
 * normalized contract, eliminating alternate JSON spellings from replay and
 * idempotency decisions.
 *
 * @param value - Unknown decoded request body.
 * @returns Canonical Chartroom command.
 */
export function validateChartroomCommand(value: unknown): ChartroomCommand {
  const input = record(value);
  if (!input) throw new ChartroomError(400, 'BAD_COMMAND', 'body must be an object');
  const scope = normalizeChartroomScope(input.scope);
  const expectedPlanVersion = safeInteger(input.expectedPlanVersion, true);
  const idempotencyKey = identifier(input.idempotencyKey, 160);
  const intentNonce = identifier(input.intentNonce, 160);
  const issuedAt = safeInteger(input.issuedAt);
  const expiresAt = safeInteger(input.expiresAt);
  if (expectedPlanVersion === null) throw new ChartroomError(400, 'BAD_PLAN_VERSION', 'expectedPlanVersion must be non-negative');
  if (!idempotencyKey || idempotencyKey.length < 8) throw new ChartroomError(400, 'BAD_IDEMPOTENCY', 'idempotencyKey must be 8..160 characters');
  if (!intentNonce || intentNonce.length < 16) throw new ChartroomError(400, 'BAD_NONCE', 'intentNonce must be 16..160 characters');
  if (!issuedAt || !expiresAt || expiresAt <= issuedAt || expiresAt - issuedAt > INTENT_MAX_TTL_SECONDS) {
    throw new ChartroomError(400, 'BAD_INTENT_WINDOW', 'intent lifetime must be positive and no more than five minutes');
  }
  const issuer = normalizeIssuer(input.issuer);
  if (issuer.harborId !== scope.harborId) throw new ChartroomError(400, 'HARBOR_SCOPE_MISMATCH', 'issuer harbor must equal scope harbor');
  return {
    scope,
    expectedPlanVersion,
    idempotencyKey,
    intentNonce,
    issuedAt,
    expiresAt,
    actor: normalizeActor(input.actor),
    issuer,
    event: normalizeEvent(input.event),
  };
}

/**
 * Remove only the signature from a command. The design commits every other
 * scope, provenance, clock, replay, and payload field to the issuer signature.
 *
 * @param command - Canonical command.
 * @returns Canonical unsigned command object.
 */
function unsignedCommand(command: ChartroomCommand): Record<string, unknown> {
  return {
    schema: CHARTROOM_COMMAND_SCHEMA,
    purpose: 'chartroom.event.append',
    ...command,
    issuer: {
      harborId: command.issuer.harborId,
      authorityEpoch: command.issuer.authorityEpoch,
    },
  };
}

/**
 * Resolve the account and live GitHub permission used to mint a capability.
 * The security design requires a same-origin browser session carrying the
 * user's GitHub OAuth grant; a long-lived `pdu_` device token is intentionally
 * insufficient. Read grants require repository readability and write grants
 * require GitHub admin authority before the App identity is checked separately.
 *
 * @param request - Same-origin browser request carrying the session cookie.
 * @param env - Relay auth and GitHub bindings.
 * @param repository - Canonical owner/name repository.
 * @param permission - Requested Chartroom permission.
 * @returns The authenticated Relay account id.
 */
export async function authorizeChartroomAccount(
  request: Request,
  env: Env,
  repository: string,
  permission: ChartroomPermission,
): Promise<ChartroomAccountIdentity> {
  const session = await resolveSession(request, env);
  if (!session?.ghToken) {
    throw new ChartroomError(
      401,
      'BROWSER_SESSION_REQUIRED',
      'capability minting requires a browser session with a live GitHub authorization',
    );
  }
  const [owner, name] = repository.split('/') as [string, string];
  const allowed = permission === 'write'
    ? await userIsRepoAdmin(env, session, owner, name)
    : await userCanReadRepo(env, session, owner, name);
  if (!allowed) {
    throw new ChartroomError(
      403,
      permission === 'write' ? 'REPOSITORY_ADMIN_REQUIRED' : 'REPOSITORY_ACCESS_REQUIRED',
      permission === 'write'
        ? 'GitHub repository admin permission is required to mint write authority'
        : 'GitHub repository read permission is required to mint read authority',
    );
  }
  return { accountId: session.user.id };
}

/**
 * Hash the normalized command that the harbor signs. The purpose is stable,
 * cross-language Ed25519 verification and exact idempotency comparison.
 *
 * @param command - Canonical Chartroom command.
 * @returns SHA-256 hex digest.
 */
export function chartroomCommandHash(command: ChartroomCommand): string {
  return hashHex(canonicalJson(unsignedCommand(command)));
}

/**
 * Return the isolation tuple in SQL binding order. The design keeps one order
 * everywhere so a swapped repository/harbor parameter cannot create a subtle
 * cross-scope query.
 *
 * @param scope - Complete Chartroom scope.
 * @returns Ordered D1 bind values.
 */
function scopeBindings(scope: ChartroomScope): string[] {
  return [
    scope.accountId,
    scope.teamId,
    scope.repositoryId,
    scope.repository,
    scope.harborId,
    scope.resourceId,
  ];
}

/**
 * Check the browser origin for capability minting. The purpose is explicit
 * recent step-up: ordinary bearer traffic can use a capability but cannot mint
 * one from an arbitrary web origin.
 *
 * @param request - Incoming capability request.
 * @param env - Relay configuration.
 * @returns True only for the Worker/public configured origin.
 */
function isChartroomSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin || !env.PUBLIC_BASE_URL) return false;
  try {
    const publicUrl = new URL(env.PUBLIC_BASE_URL);
    const requestUrl = new URL(request.url);
    const securePublicOrigin = publicUrl.protocol === 'https:'
      || (publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname));
    return securePublicOrigin
      && origin === publicUrl.origin
      && requestUrl.origin === publicUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Ask GitHub, through the installed Port Daddy App, for immutable numeric repo
 * and owner ids. The design never accepts these isolation keys from a client;
 * a repository name alone is mutable and therefore insufficient authority.
 *
 * @param env - Worker bindings and GitHub App credentials.
 * @param repository - Canonical owner/name.
 * @returns GitHub-verified repository identity.
 */
export async function verifyChartroomRepository(
  env: Env,
  repository: string,
): Promise<ChartroomRepositoryIdentity> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new ChartroomError(503, 'REPOSITORY_VERIFIER_UNAVAILABLE', 'GitHub App repository verification is not configured');
  }
  const [owner, name] = repository.split('/') as [string, string];
  let installationId: number;
  let token: string;
  try {
    installationId = await getRepoInstallationId(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      owner,
      name,
      env.KV,
    );
    token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
      env.KV,
    );
  } catch {
    throw new ChartroomError(404, 'REPOSITORY_NOT_AVAILABLE', 'repository is not available to the Port Daddy GitHub App');
  }
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'port-daddy-relay/1.0',
    },
  });
  if (!response.ok) throw new ChartroomError(404, 'REPOSITORY_NOT_AVAILABLE', 'GitHub refused repository verification');
  const body = await response.json() as {
    id?: number | string;
    full_name?: string;
    owner?: { id?: number | string };
  };
  const verifiedName = repositoryName(body.full_name);
  const repositoryId = body.id == null ? null : identifier(String(body.id));
  const teamId = body.owner?.id == null ? null : identifier(String(body.owner.id));
  if (!verifiedName || verifiedName !== repository || !repositoryId || !teamId) {
    throw new ChartroomError(502, 'REPOSITORY_IDENTITY_INVALID', 'GitHub repository identity response is incomplete');
  }
  return { teamId, repositoryId, repository: verifiedName, installationId: String(installationId) };
}

/**
 * Extract a raw Chartroom capability. The design uses its own auth scheme so a
 * generic account token can never be mistaken for repository authority.
 *
 * @param request - Incoming scoped request.
 * @returns Raw capability token or null.
 */
function readCapabilityToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Chartroom\s+(chr_[0-9a-f]{64})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Resolve a scope-bound capability using every isolation predicate. The design
 * intentionally avoids token-only lookup, which would turn a leaked token plus
 * attacker-selected scope into a confused-deputy boundary.
 *
 * @param request - Incoming request carrying a Chartroom capability.
 * @param env - Worker bindings.
 * @param scope - Full requested scope.
 * @param required - Minimum permission.
 * @param now - Relay wall clock in unix seconds.
 * @returns A live capability row.
 */
async function requireCapability(
  request: Request,
  env: Env,
  scope: ChartroomScope,
  required: ChartroomPermission,
  now: number,
): Promise<ChartroomCapabilityRow> {
  const token = readCapabilityToken(request);
  if (!token) throw new ChartroomError(401, 'CAPABILITY_REQUIRED', 'a scoped Chartroom capability is required');
  const row = await env.DB.prepare(
    `SELECT account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
            token_hash, permission, installation_id, created_at, expires_at, revoked_at,
            event_count, max_events
       FROM chartroom_capabilities
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND token_hash = ?`,
  ).bind(...scopeBindings(scope), hashHex(token)).first<ChartroomCapabilityRow>();
  if (!row || row.revoked_at !== null || row.expires_at < now) {
    throw new ChartroomError(403, 'CAPABILITY_REJECTED', 'Chartroom capability is absent, expired, revoked, or belongs to another scope');
  }
  if (required === 'write' && row.permission !== 'write') {
    throw new ChartroomError(403, 'CAPABILITY_READ_ONLY', 'write requires a write capability');
  }
  if (required === 'write' && row.event_count >= row.max_events) {
    throw new ChartroomError(429, 'CAPABILITY_EVENT_LIMIT', 'capability event budget is exhausted');
  }
  return row;
}

/**
 * Mint one short-lived capability after account, repository, and harbor checks.
 * The design returns the bearer once and stores only its hash; capabilities are
 * narrow enough to be disposable rather than durable account credentials.
 *
 * @param request - Same-origin authenticated mint request.
 * @param env - Worker bindings.
 * @param verifyRepository - Injectable live repository verifier for exact tests.
 * @param authorizeAccount - Injectable browser/GitHub account authorization.
 * @returns 201 with a raw one-time-visible capability and verified scope.
 */
export async function handleChartroomCapabilityPost(
  request: Request,
  env: Env,
  verifyRepository: ChartroomRepositoryVerifier = verifyChartroomRepository,
  authorizeAccount: ChartroomAccountAuthorizer = authorizeChartroomAccount,
): Promise<Response> {
  try {
    if (!isChartroomSameOrigin(request, env)) {
      throw new ChartroomError(403, 'CROSS_ORIGIN', 'capability minting requires the Relay origin');
    }
    const body = record(await readBoundedJson(request));
    const repository = repositoryName(body?.repository);
    const harborId = identifier(body?.harborId);
    const resourceId = identifier(body?.resourceId);
    const permission = body?.permission;
    const ttlSeconds = safeInteger(body?.ttlSeconds ?? CAPABILITY_MAX_TTL_SECONDS);
    const maxEvents = safeInteger(body?.maxEvents ?? 1000);
    if (!repository || !harborId || !resourceId || !['read', 'write'].includes(String(permission))) {
      throw new ChartroomError(400, 'BAD_CAPABILITY_REQUEST', 'repository, harborId, resourceId, and read/write permission are required');
    }
    if (!ttlSeconds || ttlSeconds > CAPABILITY_MAX_TTL_SECONDS || !maxEvents || maxEvents > 10_000) {
      throw new ChartroomError(400, 'BAD_CAPABILITY_BOUNDS', 'capability ttl is at most ten minutes and maxEvents at most 10000');
    }
    const account = await authorizeAccount(
      request,
      env,
      repository,
      permission as ChartroomPermission,
    );
    const now = Math.floor(Date.now() / 1_000);
    const harbor = await env.DB.prepare(
      `SELECT h.id, h.pubkey, h.authority_epoch, m.role
         FROM harbors h JOIN harbor_memberships m ON m.harbor_id = h.id
        WHERE h.id = ? AND m.member_kind = 'user' AND m.member_id = ?`,
    ).bind(harborId, account.accountId).first<HarborAuthorityRow>();
    if (!harbor) throw new ChartroomError(404, 'HARBOR_NOT_FOUND', 'harbor is absent or the account is not a member');
    if (permission === 'write' && harbor.role !== 'owner') {
      throw new ChartroomError(403, 'HARBOR_OWNER_REQUIRED', 'only a harbor owner may mint a Chartroom write capability');
    }
    const verified = await verifyRepository(env, repository);
    const scope: ChartroomScope = {
      accountId: account.accountId,
      teamId: verified.teamId,
      repositoryId: verified.repositoryId,
      repository: verified.repository,
      harborId,
      resourceId,
    };
    const rawToken = `chr_${randomHex(32)}`;
    const expiresAt = now + ttlSeconds;
    await env.DB.prepare(
      `INSERT INTO chartroom_capabilities
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         token_hash, permission, installation_id, minted_by, created_at, expires_at,
         revoked_at, event_count, max_events)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    ).bind(
      ...scopeBindings(scope),
      hashHex(rawToken),
      permission,
      verified.installationId,
      account.accountId,
      now,
      expiresAt,
      maxEvents,
    ).run();
    return json(201, {
      code: 'OK',
      error: null,
      scope,
      capability: rawToken,
      permission,
      expiresAt,
      authorityEpoch: harbor.authority_epoch,
      cost: { d1Statements: 3, returnedRows: 1, maxEvents },
    });
  } catch (error) {
    return chartroomErrorResponse(error);
  }
}

/**
 * Read one scoped stream head. The design never offers an unscoped stream id;
 * every lookup restates the complete isolation tuple.
 *
 * @param env - Worker bindings.
 * @param scope - Full Chartroom scope.
 * @returns Stream head or null.
 */
async function readStream(env: Env, scope: ChartroomScope): Promise<ChartroomStreamRow | null> {
  return env.DB.prepare(
    `SELECT account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
            authority_epoch, plan_version, tip_hash, event_count, created_at, updated_at
       FROM chartroom_streams
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ?`,
  ).bind(...scopeBindings(scope)).first<ChartroomStreamRow>();
}

/**
 * Read an event by its scoped idempotency key. This is the ambiguity-recovery
 * design: callers can retry after a lost response without guessing whether D1
 * committed their event.
 *
 * @param env - Worker bindings.
 * @param scope - Full Chartroom scope.
 * @param key - Caller idempotency key.
 * @returns Existing immutable event or null.
 */
async function readEventByIdempotency(
  env: Env,
  scope: ChartroomScope,
  key: string,
): Promise<ChartroomEventRow | null> {
  return env.DB.prepare(
    `SELECT * FROM chartroom_events
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND idempotency_key = ?`,
  ).bind(...scopeBindings(scope), key).first<ChartroomEventRow>();
}

/**
 * Read an event by its scoped intent nonce. The purpose is to distinguish a
 * harmless idempotent retry from a replay under a new idempotency key.
 *
 * @param env - Worker bindings.
 * @param scope - Full Chartroom scope.
 * @param nonce - Signed intent nonce.
 * @returns Existing immutable event or null.
 */
async function readEventByNonce(
  env: Env,
  scope: ChartroomScope,
  nonce: string,
): Promise<ChartroomEventRow | null> {
  return env.DB.prepare(
    `SELECT * FROM chartroom_events
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND intent_nonce = ?`,
  ).bind(...scopeBindings(scope), nonce).first<ChartroomEventRow>();
}

/**
 * Compute an event hash over the full immutable row except the hash itself.
 * The design commits scope, actor/session/AgentNode provenance, capability
 * reference, issuer proof, clocks, payload, and previous hash into one chain.
 *
 * @param event - Event row without event_hash.
 * @returns SHA-256 chain hash.
 */
export function computeChartroomEventHash(
  event: Omit<ChartroomEventRow, 'event_hash'>,
): string {
  return hashHex(canonicalJson(event));
}

/**
 * Verify an ordered event segment. The design accepts an explicit predecessor
 * so a bounded export page can be verified without loading the entire history.
 *
 * @param events - Events ordered by plan_version ascending.
 * @param expectedPreviousHash - Hash immediately before this segment.
 * @returns Chain validity plus the first failing version when present.
 */
export function verifyChartroomEventChain(
  events: ChartroomEventRow[],
  expectedPreviousHash = ZERO_HASH,
): { valid: boolean; tipHash: string; brokenAt?: number } {
  let previous = expectedPreviousHash;
  for (const event of events) {
    if (event.previous_hash !== previous) return { valid: false, tipHash: previous, brokenAt: event.plan_version };
    const { event_hash: claimed, ...unsigned } = event;
    const computed = computeChartroomEventHash(unsigned);
    if (claimed !== computed) return { valid: false, tipHash: previous, brokenAt: event.plan_version };
    previous = claimed;
  }
  return { valid: true, tipHash: previous };
}

/**
 * Confirm a scoped projection target exists and is not tombstoned. The purpose
 * is to refuse status/owner/edge mutations that would otherwise update zero
 * rows while the append-only event misleadingly claimed success.
 *
 * @param env - Worker bindings.
 * @param scope - Full Chartroom scope.
 * @param table - Hard-coded projection table name.
 * @param idColumn - Hard-coded projection id column.
 * @param id - Scoped target id.
 * @param tombstoneColumn - Tombstone column or null for immutable revisions.
 * @returns Nothing; throws when absent.
 */
async function requireProjectionTarget(
  env: Env,
  scope: ChartroomScope,
  table: 'chartroom_nodes' | 'chartroom_edges' | 'chartroom_artifact_links' | 'chartroom_decisions' | 'chartroom_sources',
  idColumn: 'node_id' | 'edge_id' | 'link_id' | 'decision_id' | 'revision_id',
  id: string,
  tombstoneColumn: 'tombstoned_at' | null,
): Promise<void> {
  const live = tombstoneColumn ? ` AND ${tombstoneColumn} IS NULL` : '';
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM ${table}
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND ${idColumn} = ?${live} LIMIT 1`,
  ).bind(...scopeBindings(scope), id).first<{ present: number }>();
  if (!row) throw new ChartroomError(404, 'PROJECTION_TARGET_NOT_FOUND', `${idColumn} ${id} is absent or tombstoned`);
}

/**
 * Require an exact immutable source revision. The design includes source_id in
 * this check because revision ids are only unique inside a source and a looser
 * lookup could supersede another document's revision.
 *
 * @param env - Worker bindings.
 * @param scope - Full Chartroom scope.
 * @param sourceId - Source identity.
 * @param revisionId - Revision identity inside that source.
 * @returns Nothing; throws when the exact revision is absent.
 */
async function requireSourceRevision(
  env: Env,
  scope: ChartroomScope,
  sourceId: string,
  revisionId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM chartroom_sources
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND source_id = ? AND revision_id = ?`,
  ).bind(...scopeBindings(scope), sourceId, revisionId).first<{ present: number }>();
  if (!row) throw new ChartroomError(404, 'SOURCE_REVISION_NOT_FOUND', `source revision ${sourceId}/${revisionId} is absent`);
}

/**
 * Build the projection statements for one event. The design keeps events
 * immutable while allowing deterministic current-state tables to be rebuilt;
 * deletion is represented only by tombstone/supersession fields.
 *
 * @param env - Worker bindings used for existence checks and statements.
 * @param command - Canonical signed command.
 * @param version - New plan version.
 * @param acceptedAt - Relay acceptance clock.
 * @returns Bounded D1 projection statements.
 */
async function projectionStatements(
  env: Env,
  command: ChartroomCommand,
  version: number,
  acceptedAt: number,
): Promise<D1PreparedStatement[]> {
  const scope = command.scope;
  const event = command.event;
  const s = scopeBindings(scope);
  const payloadJson = canonicalJson(event.payload ?? {});
  switch (event.type) {
    case 'node.upsert': {
      if (event.supersedesId) {
        await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.supersedesId), 'tombstoned_at');
      }
      return [env.DB.prepare(
      `INSERT INTO chartroom_nodes
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         node_id, node_kind, title, summary, status, owner_actor_id, supersedes_id,
         payload_json, plan_version, tombstoned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id, node_id)
       DO UPDATE SET node_kind = excluded.node_kind, title = excluded.title,
         summary = excluded.summary, status = excluded.status,
         owner_actor_id = excluded.owner_actor_id, supersedes_id = excluded.supersedes_id,
         payload_json = excluded.payload_json, plan_version = excluded.plan_version,
         tombstoned_at = NULL, updated_at = excluded.updated_at
       WHERE excluded.plan_version > chartroom_nodes.plan_version`,
    ).bind(
      ...s, event.nodeId, event.nodeKind, event.title, event.summary, event.status,
      event.ownerActorId, event.supersedesId, payloadJson, version, acceptedAt,
      )];
    }
    case 'node.tombstone': {
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.nodeId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_nodes SET tombstoned_at = ?, plan_version = ?, updated_at = ?,
           payload_json = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND node_id = ? AND tombstoned_at IS NULL`,
      ).bind(acceptedAt, version, acceptedAt, canonicalJson({ reason: event.reason, ...event.payload as object }), ...s, event.nodeId)];
    }
    case 'status.set': {
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.nodeId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_nodes SET status = ?, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND node_id = ? AND tombstoned_at IS NULL`,
      ).bind(event.status, version, acceptedAt, ...s, event.nodeId)];
    }
    case 'owner.assign': {
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.nodeId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_nodes SET owner_actor_id = ?, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND node_id = ? AND tombstoned_at IS NULL`,
      ).bind(event.ownerActorId, version, acceptedAt, ...s, event.nodeId)];
    }
    case 'owner.unassign': {
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.nodeId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_nodes SET owner_actor_id = NULL, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND node_id = ? AND tombstoned_at IS NULL`,
      ).bind(version, acceptedAt, ...s, event.nodeId)];
    }
    case 'edge.upsert':
    case 'dependency.add': {
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.sourceId), 'tombstoned_at');
      await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.targetId), 'tombstoned_at');
      const edgeType = event.type === 'dependency.add' ? 'depends-on' : event.edgeType;
      return [env.DB.prepare(
        `INSERT INTO chartroom_edges
          (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
           edge_id, edge_type, source_id, target_id, payload_json, plan_version, tombstoned_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id, edge_id)
         DO UPDATE SET edge_type = excluded.edge_type, source_id = excluded.source_id,
           target_id = excluded.target_id, payload_json = excluded.payload_json,
           plan_version = excluded.plan_version, tombstoned_at = NULL,
           updated_at = excluded.updated_at
         WHERE excluded.plan_version > chartroom_edges.plan_version`,
      ).bind(...s, event.edgeId, edgeType, event.sourceId, event.targetId, payloadJson, version, acceptedAt)];
    }
    case 'edge.tombstone':
    case 'dependency.remove': {
      await requireProjectionTarget(env, scope, 'chartroom_edges', 'edge_id', String(event.edgeId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_edges SET tombstoned_at = ?, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND edge_id = ? AND tombstoned_at IS NULL`,
      ).bind(acceptedAt, version, acceptedAt, ...s, event.edgeId)];
    }
    case 'artifact.link': {
      if (event.nodeId) await requireProjectionTarget(env, scope, 'chartroom_nodes', 'node_id', String(event.nodeId), 'tombstoned_at');
      return [env.DB.prepare(
        `INSERT INTO chartroom_artifact_links
          (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
           link_id, node_id, artifact_kind, uri, digest, title, payload_json,
           plan_version, tombstoned_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id, link_id)
         DO UPDATE SET node_id = excluded.node_id, artifact_kind = excluded.artifact_kind,
           uri = excluded.uri, digest = excluded.digest, title = excluded.title,
           payload_json = excluded.payload_json, plan_version = excluded.plan_version,
           tombstoned_at = NULL, updated_at = excluded.updated_at
         WHERE excluded.plan_version > chartroom_artifact_links.plan_version`,
      ).bind(
        ...s, event.linkId, event.nodeId, event.artifactKind, event.uri,
        event.digest, event.title, payloadJson, version, acceptedAt,
      )];
    }
    case 'artifact.unlink': {
      await requireProjectionTarget(env, scope, 'chartroom_artifact_links', 'link_id', String(event.linkId), 'tombstoned_at');
      return [env.DB.prepare(
        `UPDATE chartroom_artifact_links SET tombstoned_at = ?, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND link_id = ? AND tombstoned_at IS NULL`,
      ).bind(acceptedAt, version, acceptedAt, ...s, event.linkId)];
    }
    case 'decision.record': {
      if (event.supersedesId) {
        await requireProjectionTarget(env, scope, 'chartroom_decisions', 'decision_id', String(event.supersedesId), null);
      }
      return [env.DB.prepare(
      `INSERT INTO chartroom_decisions
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         decision_id, title, rationale, status, affected_ids_json, supersedes_id,
         superseded_by_id, payload_json, plan_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id, decision_id)
       DO UPDATE SET title = excluded.title, rationale = excluded.rationale,
         status = excluded.status, affected_ids_json = excluded.affected_ids_json,
         supersedes_id = excluded.supersedes_id, superseded_by_id = NULL,
         payload_json = excluded.payload_json,
         plan_version = excluded.plan_version, updated_at = excluded.updated_at
       WHERE excluded.plan_version > chartroom_decisions.plan_version`,
    ).bind(
      ...s, event.decisionId, event.title, event.rationale, event.status,
      canonicalJson(event.affectedIds), event.supersedesId, payloadJson, version, acceptedAt,
      )];
    }
    case 'decision.supersede': {
      await requireProjectionTarget(env, scope, 'chartroom_decisions', 'decision_id', String(event.decisionId), null);
      await requireProjectionTarget(env, scope, 'chartroom_decisions', 'decision_id', String(event.supersededById), null);
      return [env.DB.prepare(
        `UPDATE chartroom_decisions SET status = 'superseded', superseded_by_id = ?,
           rationale = ?, plan_version = ?, updated_at = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND decision_id = ?`,
      ).bind(event.supersededById, event.rationale, version, acceptedAt, ...s, event.decisionId)];
    }
    case 'source.ingest': {
      if (event.supersedesRevisionId) {
        await requireSourceRevision(env, scope, String(event.sourceId), String(event.supersedesRevisionId));
      }
      return [env.DB.prepare(
      `INSERT INTO chartroom_sources
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         source_id, revision_id, source_kind, uri, digest, title, summary, status,
         supersedes_revision_id, superseded_by_revision_id, payload_json, plan_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?)`,
    ).bind(
      ...s, event.sourceId, event.revisionId, event.sourceKind, event.uri,
      event.digest, event.title, event.summary, event.supersedesRevisionId,
      payloadJson, version, acceptedAt,
      )];
    }
    case 'source.supersede': {
      await requireSourceRevision(env, scope, String(event.sourceId), String(event.revisionId));
      await requireSourceRevision(env, scope, String(event.sourceId), String(event.supersededByRevisionId));
      return [env.DB.prepare(
        `UPDATE chartroom_sources SET status = 'superseded', superseded_by_revision_id = ?,
           plan_version = ?
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND source_id = ? AND revision_id = ?
            AND status = 'active'`,
      ).bind(event.supersededByRevisionId, version, ...s, event.sourceId, event.revisionId)];
    }
  }
}

/**
 * Verify current harbor membership, epoch, and signature. The design treats the
 * harbor key as writer authority; Relay account/capability checks alone can
 * never author a plan event.
 *
 * @param env - Worker bindings.
 * @param command - Canonical signed command.
 * @param requestHash - Hash over the unsigned normalized command.
 * @returns Current harbor authority row.
 */
async function verifyIssuer(
  env: Env,
  command: ChartroomCommand,
  requestHash: string,
): Promise<HarborAuthorityRow> {
  const harbor = await env.DB.prepare(
    `SELECT h.id, h.pubkey, h.authority_epoch
       FROM harbors h JOIN harbor_memberships m ON m.harbor_id = h.id
      WHERE h.id = ? AND m.member_kind = 'user' AND m.member_id = ?`,
  ).bind(command.scope.harborId, command.scope.accountId).first<HarborAuthorityRow>();
  if (!harbor) throw new ChartroomError(404, 'HARBOR_NOT_FOUND', 'harbor is absent or outside this account membership');
  if (command.issuer.authorityEpoch !== harbor.authority_epoch) {
    throw new ChartroomError(409, 'STALE_AUTHORITY_EPOCH', 'issuer authorityEpoch is not current', {
      currentAuthorityEpoch: harbor.authority_epoch,
    });
  }
  const valid = await verifyEd25519(harbor.pubkey, requestHash, command.issuer.signature);
  if (!valid) throw new ChartroomError(403, 'FORGED_INTENT', 'harbor signature does not verify');
  return harbor;
}

/**
 * Build a deterministic Relay acceptance receipt from an immutable event row.
 * The purpose of Relay's signature is readback evidence, not plan authorship;
 * retrying the same event yields the exact same receipt bytes.
 *
 * @param env - Worker signing key.
 * @param event - Immutable event read back from D1.
 * @returns Signed acceptance receipt.
 */
async function createAcceptanceReceipt(
  env: Env,
  event: ChartroomEventRow,
): Promise<ChartroomAcceptanceReceipt> {
  const scope: ChartroomScope = {
    accountId: event.account_id,
    teamId: event.team_id,
    repositoryId: event.repository_id,
    repository: event.repo_full_name,
    harborId: event.harbor_id,
    resourceId: event.resource_id,
  };
  const relayPubKey = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const readbackDigest = hashHex(canonicalJson(event));
  const projectionInputDigest = hashHex(canonicalJson({
    eventType: event.event_type,
    planVersion: event.plan_version,
    eventHash: event.event_hash,
    payload: JSON.parse(event.payload_json) as unknown,
  }));
  const unsigned: Omit<ChartroomAcceptanceReceipt, 'signature'> = {
    schema: 'port-daddy.chartroom-acceptance.v1',
    scope,
    eventId: event.event_id,
    eventType: event.event_type,
    planVersion: event.plan_version,
    authorityEpoch: event.authority_epoch,
    previousHash: event.previous_hash,
    eventHash: event.event_hash,
    requestHash: event.request_hash,
    acceptedAt: event.accepted_at,
    readbackDigest,
    projectionInputDigest,
    relayPubKey,
  };
  return {
    ...unsigned,
    signature: await signEd25519(
      env.RELAY_ED25519_PRIVATE_KEY_HEX,
      hashHex(canonicalJson(unsigned)),
    ),
  };
}

/**
 * Read and verify the exact acceptance receipt stored atomically beside an
 * event. The design verifies with the historical Relay public key carried by
 * the receipt, so key rotation cannot change or strand an accepted retry.
 *
 * @param env - Worker bindings.
 * @param event - Immutable event whose receipt is required.
 * @returns The original Relay-signed receipt bytes parsed as JSON.
 */
async function readAcceptanceReceipt(
  env: Env,
  event: ChartroomEventRow,
): Promise<ChartroomAcceptanceReceipt> {
  const row = await env.DB.prepare(
    `SELECT receipt_json, receipt_hash FROM chartroom_acceptance_receipts
      WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
        AND harbor_id = ? AND resource_id = ? AND event_id = ?`,
  ).bind(
    event.account_id, event.team_id, event.repository_id, event.repo_full_name,
    event.harbor_id, event.resource_id, event.event_id,
  ).first<ChartroomAcceptanceReceiptRow>();
  if (!row || hashHex(row.receipt_json) !== row.receipt_hash) {
    throw new ChartroomError(500, 'RECEIPT_READBACK_FAILED', 'stored acceptance receipt is absent or has a mismatched digest');
  }
  let receipt: ChartroomAcceptanceReceipt;
  try {
    const parsed = JSON.parse(row.receipt_json) as ChartroomAcceptanceReceipt;
    if (canonicalJson(parsed) !== row.receipt_json) throw new Error('receipt is not canonical JSON');
    receipt = parsed;
  } catch {
    throw new ChartroomError(500, 'RECEIPT_READBACK_FAILED', 'stored acceptance receipt is not canonical JSON');
  }
  const expectedScope: ChartroomScope = {
    accountId: event.account_id,
    teamId: event.team_id,
    repositoryId: event.repository_id,
    repository: event.repo_full_name,
    harborId: event.harbor_id,
    resourceId: event.resource_id,
  };
  if (
    receipt.schema !== 'port-daddy.chartroom-acceptance.v1'
    || canonicalJson(receipt.scope) !== canonicalJson(expectedScope)
    || receipt.eventId !== event.event_id
    || receipt.eventType !== event.event_type
    || receipt.planVersion !== event.plan_version
    || receipt.authorityEpoch !== event.authority_epoch
    || receipt.previousHash !== event.previous_hash
    || receipt.eventHash !== event.event_hash
    || receipt.requestHash !== event.request_hash
    || receipt.acceptedAt !== event.accepted_at
    || receipt.readbackDigest !== hashHex(canonicalJson(event))
    || receipt.projectionInputDigest !== hashHex(canonicalJson({
      eventType: event.event_type,
      planVersion: event.plan_version,
      eventHash: event.event_hash,
      payload: JSON.parse(event.payload_json) as unknown,
    }))
    || !HASH_RE.test(receipt.relayPubKey)
    || !SIG_RE.test(receipt.signature)
  ) {
    throw new ChartroomError(500, 'RECEIPT_READBACK_FAILED', 'stored acceptance receipt does not match its immutable event');
  }
  const { signature, ...unsigned } = receipt;
  if (!await verifyEd25519(receipt.relayPubKey, hashHex(canonicalJson(unsigned)), signature)) {
    throw new ChartroomError(500, 'RECEIPT_SIGNATURE_INVALID', 'stored acceptance receipt signature does not verify');
  }
  return receipt;
}

/**
 * Apply one verified intent in a single D1 batch. The design combines event,
 * projection, stream-CAS, and capability-budget writes transactionally; SQL
 * triggers are the final race guard after friendly preflight checks.
 *
 * @param env - Worker bindings.
 * @param inputCommand - Untrusted command input to snapshot and canonicalize.
 * @param capabilityTokenHash - Hash of the already scope-authorized capability.
 * @returns Deterministic acceptance receipt and duplicate marker.
 */
export async function applyChartroomCommand(
  env: Env,
  inputCommand: ChartroomCommand,
  capabilityTokenHash: string,
): Promise<{ receipt: ChartroomAcceptanceReceipt; duplicate: boolean }> {
  const acceptedAt = Math.floor(Date.now() / 1_000);
  if (!HASH_RE.test(capabilityTokenHash) || !Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) {
    throw new ChartroomError(500, 'BAD_RELAY_INPUT', 'Relay capability reference or clock is invalid');
  }
  // This exported kernel is also available to internal jobs. Re-run the full
  // validator and deep-snapshot its canonical JSON before the first await, so
  // neither HTTP-only validation nor caller mutation can change the signed
  // clocks, scope, or payload that verification and persistence observe.
  const command = JSON.parse(canonicalJson(
    validateChartroomCommand(inputCommand),
  )) as ChartroomCommand;
  const requestHash = chartroomCommandHash(command);
  const replay = await readEventByIdempotency(env, command.scope, command.idempotencyKey);
  if (replay) {
    if (replay.request_hash !== requestHash) {
      throw new ChartroomError(409, 'IDEMPOTENCY_KEY_REUSED', 'idempotency key already commits different content');
    }
    if (
      replay.issuer_signature !== command.issuer.signature
      || !await verifyEd25519(replay.issuer_pubkey, requestHash, command.issuer.signature)
    ) {
      throw new ChartroomError(403, 'FORGED_INTENT', 'retry does not carry the original verified harbor signature');
    }
    return { receipt: await readAcceptanceReceipt(env, replay), duplicate: true };
  }
  const harbor = await verifyIssuer(env, command, requestHash);
  const nonceReplay = await readEventByNonce(env, command.scope, command.intentNonce);
  if (nonceReplay) throw new ChartroomError(409, 'INTENT_REPLAYED', 'intent nonce was already consumed by another event');
  if (
    command.issuedAt > acceptedAt + CLOCK_SKEW_SECONDS
    || command.expiresAt < acceptedAt
  ) {
    throw new ChartroomError(403, 'INTENT_EXPIRED', 'signed intent is expired or issued too far in the future');
  }
  const stream = await readStream(env, command.scope);
  const currentVersion = stream?.plan_version ?? 0;
  const previousHash = stream?.tip_hash ?? ZERO_HASH;
  if (stream && stream.authority_epoch > harbor.authority_epoch) {
    throw new ChartroomError(409, 'STALE_AUTHORITY_EPOCH', 'stream has observed a newer harbor authority epoch');
  }
  if (command.expectedPlanVersion !== currentVersion) {
    throw new ChartroomError(409, 'STALE_PLAN_VERSION', 'expectedPlanVersion does not match Chartroom head', {
      currentPlanVersion: currentVersion,
      tipHash: previousHash,
    });
  }
  const planVersion = currentVersion + 1;
  const unsigned: Omit<ChartroomEventRow, 'event_hash'> = {
    account_id: command.scope.accountId,
    team_id: command.scope.teamId,
    repository_id: command.scope.repositoryId,
    repo_full_name: command.scope.repository,
    harbor_id: command.scope.harborId,
    resource_id: command.scope.resourceId,
    event_id: `ce_${randomHex(16)}`,
    event_type: command.event.type,
    plan_version: planVersion,
    authority_epoch: harbor.authority_epoch,
    previous_hash: previousHash,
    request_hash: requestHash,
    capability_token_hash: capabilityTokenHash,
    idempotency_key: command.idempotencyKey,
    intent_nonce: command.intentNonce,
    issued_at: command.issuedAt,
    expires_at: command.expiresAt,
    actor_kind: command.actor.kind,
    actor_id: command.actor.actorId,
    session_id: command.actor.sessionId,
    agent_node_id: command.actor.agentNodeId,
    issuer_pubkey: harbor.pubkey,
    issuer_signature: command.issuer.signature,
    payload_json: canonicalJson(command.event),
    accepted_at: acceptedAt,
  };
  const event: ChartroomEventRow = { ...unsigned, event_hash: computeChartroomEventHash(unsigned) };
  const receipt = await createAcceptanceReceipt(env, event);
  const receiptJson = canonicalJson(receipt);
  const projections = await projectionStatements(env, command, planVersion, acceptedAt);
  const s = scopeBindings(command.scope);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO chartroom_streams
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         authority_epoch, plan_version, tip_hash, event_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
    ).bind(...s, harbor.authority_epoch, ZERO_HASH, acceptedAt, acceptedAt),
    env.DB.prepare(
      `INSERT INTO chartroom_events
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         event_id, event_type, plan_version, authority_epoch, previous_hash, event_hash,
         request_hash, capability_token_hash, idempotency_key, intent_nonce, issued_at,
         expires_at, actor_kind, actor_id, session_id, agent_node_id, issuer_pubkey,
         issuer_signature, payload_json, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ...s, event.event_id, event.event_type, event.plan_version, event.authority_epoch,
      event.previous_hash, event.event_hash, event.request_hash, event.capability_token_hash,
      event.idempotency_key, event.intent_nonce, event.issued_at, event.expires_at,
      event.actor_kind, event.actor_id, event.session_id, event.agent_node_id,
      event.issuer_pubkey, event.issuer_signature, event.payload_json, event.accepted_at,
    ),
    env.DB.prepare(
      `INSERT INTO chartroom_acceptance_receipts
        (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
         event_id, request_hash, receipt_json, receipt_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ...s, event.event_id, event.request_hash, receiptJson, hashHex(receiptJson), acceptedAt,
    ),
    ...projections,
    env.DB.prepare(
      `UPDATE chartroom_streams
          SET authority_epoch = ?, plan_version = ?, tip_hash = ?,
              event_count = event_count + 1, updated_at = ?
        WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
          AND harbor_id = ? AND resource_id = ? AND plan_version = ? AND tip_hash = ?`,
    ).bind(harbor.authority_epoch, planVersion, event.event_hash, acceptedAt, ...s, currentVersion, previousHash),
    env.DB.prepare(
      `UPDATE chartroom_capabilities SET event_count = event_count + 1
        WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
          AND harbor_id = ? AND resource_id = ? AND token_hash = ?
          AND permission = 'write' AND revoked_at IS NULL AND expires_at >= ?
          AND event_count < max_events`,
    ).bind(...s, capabilityTokenHash, acceptedAt),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const racedReplay = await readEventByIdempotency(env, command.scope, command.idempotencyKey);
    if (
      racedReplay?.request_hash === requestHash
      && racedReplay.issuer_signature === command.issuer.signature
      && await verifyEd25519(racedReplay.issuer_pubkey, requestHash, command.issuer.signature)
    ) {
      return { receipt: await readAcceptanceReceipt(env, racedReplay), duplicate: true };
    }
    const nonceRace = await readEventByNonce(env, command.scope, command.intentNonce);
    if (nonceRace) throw new ChartroomError(409, 'INTENT_REPLAYED', 'intent nonce was consumed concurrently');
    const racedStream = await readStream(env, command.scope);
    if ((racedStream?.plan_version ?? 0) !== currentVersion || (racedStream?.tip_hash ?? ZERO_HASH) !== previousHash) {
      throw new ChartroomError(409, 'STALE_PLAN_VERSION', 'another writer advanced the Chartroom head', {
        currentPlanVersion: racedStream?.plan_version ?? 0,
        tipHash: racedStream?.tip_hash ?? ZERO_HASH,
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.includes('CHARTROOM_CAPABILITY_REJECTED')) {
      throw new ChartroomError(403, 'CAPABILITY_REJECTED', 'capability expired, was revoked, or exhausted its event budget');
    }
    if (reason.includes('CHARTROOM_STALE_AUTHORITY_EPOCH')) {
      throw new ChartroomError(409, 'STALE_AUTHORITY_EPOCH', 'authority epoch changed during the write');
    }
    if (reason.includes('CHARTROOM_HASH_CHAIN_BREAK')) {
      throw new ChartroomError(409, 'HASH_CHAIN_BREAK', 'stored chain head changed or is inconsistent');
    }
    throw new ChartroomError(500, 'CHARTROOM_WRITE_FAILED', 'D1 rejected the atomic event/projection batch', { reason });
  }
  const readback = await readEventByIdempotency(env, command.scope, command.idempotencyKey);
  if (!readback || readback.event_hash !== event.event_hash) {
    throw new ChartroomError(500, 'READBACK_FAILED', 'event commit did not produce exact D1 readback');
  }
  const readbackReceipt = await readAcceptanceReceipt(env, readback);
  if (canonicalJson(readbackReceipt) !== receiptJson) {
    throw new ChartroomError(500, 'RECEIPT_READBACK_FAILED', 'D1 did not preserve the exact atomic acceptance receipt');
  }
  return { receipt: readbackReceipt, duplicate: false };
}

/**
 * Apply one HTTP event command. The design authorizes the full scope before
 * parsing it into SQL and returns a receipt local harbors can persist.
 *
 * @param request - Capability-authenticated event request.
 * @param env - Worker bindings.
 * @returns 201 for a new event or 200 for an exact retry.
 */
export async function handleChartroomEventPost(request: Request, env: Env): Promise<Response> {
  try {
    const command = validateChartroomCommand(await readBoundedJson(request));
    const now = Math.floor(Date.now() / 1_000);
    const capability = await requireCapability(request, env, command.scope, 'write', now);
    const applied = await applyChartroomCommand(env, command, capability.token_hash);
    return json(applied.duplicate ? 200 : 201, {
      code: 'OK', error: null, duplicate: applied.duplicate, receipt: applied.receipt,
      cost: { d1Statements: applied.duplicate ? 4 : 8, returnedRows: 1, maxRequestBytes: MAX_REQUEST_BYTES },
    });
  } catch (error) {
    return chartroomErrorResponse(error);
  }
}

/**
 * Parse the full scope from query parameters. The design uses explicit names
 * rather than an opaque scope token so operators and logs can see which
 * isolation dimension a request intended.
 *
 * @param url - Parsed request URL.
 * @returns Canonical full scope.
 */
function scopeFromUrl(url: URL): ChartroomScope {
  return normalizeChartroomScope({
    accountId: url.searchParams.get('accountId'),
    teamId: url.searchParams.get('teamId'),
    repositoryId: url.searchParams.get('repositoryId'),
    repository: url.searchParams.get('repository'),
    harborId: url.searchParams.get('harborId'),
    resourceId: url.searchParams.get('resourceId'),
  });
}

/**
 * Clamp a caller-selected row count to a hard upper bound. The purpose is
 * predictable D1 and response cost even when a client supplies NaN or infinity.
 *
 * @param value - Raw query value.
 * @param fallback - Default count.
 * @param maximum - Absolute row bound.
 * @returns Safe positive integer count.
 */
function boundedLimit(value: string | null, fallback: number, maximum: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

/**
 * Read the current typed projections for one exact scope. The design keeps
 * projection reads bounded and returns the immutable stream head alongside
 * them, so consumers know exactly which plan version they observed.
 *
 * @param request - Capability-authenticated read request.
 * @param env - Worker bindings.
 * @returns Bounded nodes, edges, artifacts, decisions, and source revisions.
 */
export async function handleChartroomProjectionGet(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const scope = scopeFromUrl(url);
    const now = Math.floor(Date.now() / 1_000);
    await requireCapability(request, env, scope, 'read', now);
    const limit = boundedLimit(url.searchParams.get('limit'), 50, MAX_PROJECTION_ROWS);
    const s = scopeBindings(scope);
    const batch = await env.DB.batch([
      env.DB.prepare(
        `SELECT authority_epoch, plan_version, tip_hash, event_count, created_at, updated_at
           FROM chartroom_streams
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?`,
      ).bind(...s),
      env.DB.prepare(
        `SELECT node_id, node_kind, title, summary, status, owner_actor_id,
                supersedes_id, payload_json, plan_version, tombstoned_at, updated_at
           FROM chartroom_nodes
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?
          ORDER BY plan_version DESC, node_id ASC LIMIT ?`,
      ).bind(...s, limit + 1),
      env.DB.prepare(
        `SELECT edge_id, edge_type, source_id, target_id, payload_json,
                plan_version, tombstoned_at, updated_at
           FROM chartroom_edges
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?
          ORDER BY plan_version DESC, edge_id ASC LIMIT ?`,
      ).bind(...s, limit + 1),
      env.DB.prepare(
        `SELECT link_id, node_id, artifact_kind, uri, digest, title, payload_json,
                plan_version, tombstoned_at, updated_at
           FROM chartroom_artifact_links
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?
          ORDER BY plan_version DESC, link_id ASC LIMIT ?`,
      ).bind(...s, limit + 1),
      env.DB.prepare(
        `SELECT decision_id, title, rationale, status, affected_ids_json,
                supersedes_id, superseded_by_id, payload_json, plan_version, updated_at
           FROM chartroom_decisions
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?
          ORDER BY plan_version DESC, decision_id ASC LIMIT ?`,
      ).bind(...s, limit + 1),
      env.DB.prepare(
        `SELECT source_id, revision_id, source_kind, uri, digest, title, summary,
                status, supersedes_revision_id, superseded_by_revision_id,
                payload_json, plan_version, created_at
           FROM chartroom_sources
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?
          ORDER BY plan_version DESC, source_id ASC, revision_id ASC LIMIT ?`,
      ).bind(...s, limit + 1),
    ]) as Array<{ results?: Record<string, unknown>[] }>;
    const stream = batch[0]?.results?.[0] as unknown as ChartroomStreamRow | undefined;
    if (!stream) throw new ChartroomError(404, 'CHARTROOM_NOT_FOUND', 'no Chartroom stream exists for this scope');
    /**
     * Split a limit-plus-one query into returned rows and honest truncation
     * metadata. The design fetches one sentinel row so callers never mistake a
     * bounded preview for the complete projection.
     *
     * @param rows - Canonically ordered D1 rows including an optional sentinel.
     * @returns Bounded rows plus returned and truncated truth.
     */
    const page = (rows: Record<string, unknown>[]) => ({
      rows: rows.slice(0, limit),
      returned: Math.min(rows.length, limit),
      truncated: rows.length > limit,
    });
    const nodePage = page(batch[1]?.results ?? []);
    const edgePage = page(batch[2]?.results ?? []);
    const artifactPage = page(batch[3]?.results ?? []);
    const decisionPage = page(batch[4]?.results ?? []);
    const sourcePage = page(batch[5]?.results ?? []);
    const projection = {
      nodes: nodePage.rows,
      edges: edgePage.rows,
      artifacts: artifactPage.rows,
      decisions: decisionPage.rows,
      sources: sourcePage.rows,
    };
    const projectionMeta = {
      nodes: { returned: nodePage.returned, truncated: nodePage.truncated },
      edges: { returned: edgePage.returned, truncated: edgePage.truncated },
      artifacts: { returned: artifactPage.returned, truncated: artifactPage.truncated },
      decisions: { returned: decisionPage.returned, truncated: decisionPage.truncated },
      sources: { returned: sourcePage.returned, truncated: sourcePage.truncated },
    };
    const returnedRows = Object.values(projection).reduce((sum, rows) => sum + rows.length, 0);
    const fetchedRows = [nodePage, edgePage, artifactPage, decisionPage, sourcePage]
      .reduce((sum, result) => sum + result.returned + (result.truncated ? 1 : 0), 0);
    return json(200, {
      code: 'OK',
      error: null,
      authority: {
        scope,
        authorityEpoch: stream.authority_epoch,
        planVersion: stream.plan_version,
        tipHash: stream.tip_hash,
        eventCount: stream.event_count,
        updatedAt: stream.updated_at,
      },
      projection,
      projectionMeta,
      projectionComplete: Object.values(projectionMeta).every((meta) => !meta.truncated),
      projectionDigest: hashHex(canonicalJson({ projection, projectionMeta })),
      cost: { d1Statements: 7, returnedRows, fetchedRows, perProjectionLimit: limit },
    });
  } catch (error) {
    return chartroomErrorResponse(error);
  }
}

/**
 * Sign a bounded export receipt. The design lets a local harbor retain proof of
 * exactly which D1 event page it accepted without treating Relay as the issuer.
 *
 * @param env - Relay signing key.
 * @param scope - Exact exported scope.
 * @param events - Ordered immutable event page.
 * @param chain - Verification result for the page.
 * @param afterVersion - Cursor immediately before the page.
 * @returns Relay-signed export/readback receipt.
 */
async function exportReceipt(
  env: Env,
  scope: ChartroomScope,
  events: ChartroomEventRow[],
  chain: { valid: boolean; tipHash: string; brokenAt?: number },
  afterVersion: number,
): Promise<Record<string, unknown>> {
  const unsigned = {
    schema: 'port-daddy.chartroom-export.v1',
    scope,
    afterVersion,
    firstVersion: events[0]?.plan_version ?? null,
    lastVersion: events.at(-1)?.plan_version ?? afterVersion,
    count: events.length,
    chain,
    contentDigest: hashHex(canonicalJson(events)),
    relayPubKey: pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX),
  };
  return {
    ...unsigned,
    signature: await signEd25519(
      env.RELAY_ED25519_PRIVATE_KEY_HEX,
      hashHex(canonicalJson(unsigned)),
    ),
  };
}

/**
 * Export a bounded, independently verifiable event page. The design defaults
 * to 100 rows and hard-caps at 250, avoiding the prototype's whole-history
 * memory/cost hazard while preserving cursor-stable audit access.
 *
 * @param request - Capability-authenticated export request.
 * @param env - Worker bindings.
 * @returns Event page, chain verdict, and signed exact-readback receipt.
 */
export async function handleChartroomExportGet(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const scope = scopeFromUrl(url);
    const now = Math.floor(Date.now() / 1_000);
    await requireCapability(request, env, scope, 'read', now);
    const limit = boundedLimit(url.searchParams.get('limit'), 100, MAX_EXPORT_ROWS);
    const afterVersion = safeInteger(Number(url.searchParams.get('afterVersion') ?? 0), true);
    if (afterVersion === null) throw new ChartroomError(400, 'BAD_EXPORT_CURSOR', 'afterVersion must be non-negative');
    const s = scopeBindings(scope);
    const batch = await env.DB.batch([
      env.DB.prepare(
        `SELECT authority_epoch, plan_version, tip_hash, event_count, created_at, updated_at
           FROM chartroom_streams
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ?`,
      ).bind(...s),
      env.DB.prepare(
        `SELECT event_hash FROM chartroom_events
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND plan_version = ?`,
      ).bind(...s, afterVersion),
      env.DB.prepare(
        `SELECT * FROM chartroom_events
          WHERE account_id = ? AND team_id = ? AND repository_id = ? AND repo_full_name = ?
            AND harbor_id = ? AND resource_id = ? AND plan_version > ?
          ORDER BY plan_version ASC LIMIT ?`,
      ).bind(...s, afterVersion, limit),
    ]) as Array<{ results?: Record<string, unknown>[] }>;
    const stream = batch[0]?.results?.[0] as unknown as ChartroomStreamRow | undefined;
    if (!stream) throw new ChartroomError(404, 'CHARTROOM_NOT_FOUND', 'no Chartroom stream exists for this scope');
    if (afterVersion > stream.plan_version) {
      throw new ChartroomError(400, 'BAD_EXPORT_CURSOR', 'afterVersion is outside this stream');
    }
    const previous = batch[1]?.results?.[0] as { event_hash?: string } | undefined;
    if (afterVersion > 0 && !previous?.event_hash) {
      throw new ChartroomError(409, 'CHAIN_CURSOR_MISSING', 'export predecessor event is missing');
    }
    const events = (batch[2]?.results ?? []) as unknown as ChartroomEventRow[];
    const expectedPreviousHash = afterVersion > 0 ? previous!.event_hash! : ZERO_HASH;
    const chain = verifyChartroomEventChain(events, expectedPreviousHash);
    const receipt = await exportReceipt(env, scope, events, chain, afterVersion);
    const lastVersion = events.at(-1)?.plan_version ?? afterVersion;
    return json(chain.valid ? 200 : 409, {
      code: chain.valid ? 'OK' : 'HASH_CHAIN_BREAK',
      error: chain.valid ? null : 'stored event page failed hash-chain verification',
      authority: {
        scope,
        authorityEpoch: stream.authority_epoch,
        planVersion: stream.plan_version,
        tipHash: stream.tip_hash,
      },
      events,
      chain,
      receipt,
      nextAfterVersion: lastVersion < stream.plan_version ? lastVersion : null,
      cost: {
        d1Statements: 4,
        returnedRows: events.length,
        rowLimit: limit,
        maxRowLimit: MAX_EXPORT_ROWS,
      },
    });
  } catch (error) {
    return chartroomErrorResponse(error);
  }
}

/**
 * Convert internal failures into bounded public responses. The design never
 * returns raw stack traces, SQL, tokens, or GitHub response bodies.
 *
 * @param error - Unknown route failure.
 * @returns Stable Chartroom error envelope.
 */
function chartroomErrorResponse(error: unknown): Response {
  if (error instanceof ChartroomError) {
    return json(error.status, { code: error.code, error: error.message, ...error.detail });
  }
  return json(500, { code: 'CHARTROOM_ERROR', error: 'Chartroom request failed' });
}
