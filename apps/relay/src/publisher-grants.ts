import {
  FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
  isRepository,
  isSafePublisherIdentifier,
  stableJson,
  type FleetbotOperation,
  type FleetbotPublisherCapability,
} from '../../../lib/github-publisher-contract.js';
import { fromHex, hashBytes, hashHex, toHex, verifyEd25519 } from './crypto.js';

const GRANT_ID_RE = /^pdg_[0-9a-f]{32}$/;
const HEX_64_RE = /^[0-9a-f]{64}$/i;
const SIGNATURE_RE = /^[0-9a-f]{128}$/i;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const READ_SCHEMA = 'port-daddy.publisher-grant-read.v1' as const;
const READ_CLOCK_SKEW_SECONDS = 5 * 60;

export class PublisherGrantFailure extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'PublisherGrantFailure';
  }
}

export interface PublisherGrant {
  grantId: string;
  epoch: number;
  surface: 'publisher';
  accountUserId: string;
  subjectFingerprint: string;
  subjectClass: 'ci' | 'host';
  installationId: number;
  repositories: string[];
  operations: FleetbotOperation[];
  branchPrefixes: string[];
  baseBranches: string[];
  mutationsPerDay: number;
  expiresAt: number;
}

interface PublisherGrantRow {
  grant_id: string;
  epoch: number;
  surface: string;
  account_user_id: string;
  subject_fingerprint: string;
  subject_class: string;
  installation_id: number;
  repositories_json: string;
  operations_json: string;
  branch_allow_json: string;
  base_allow_json: string;
  mutations_per_day: number;
  expires_at: number;
  revoked_at: number | null;
}

interface IdentityRow {
  pub_key: string;
  proof_method: string;
  expires_at: number | null;
  revoked: number;
  key_generation: number;
}

interface CapabilityUseRow {
  grant_id: string;
  grant_epoch: number;
  session_id: string;
  request_hash: string;
  idempotency_key: string;
  is_mutation: number;
}

const OPERATIONS: readonly FleetbotOperation[] = [
  'pull-request.publish',
  'pull-request.update',
  'pull-request.ready',
  'pull-request.request-reviewers',
  'pull-request.comment',
  'pull-request.review-reply',
  'pull-request.enqueue',
  'pull-request.inspect',
];

function fail(code: string, status: number, message: string): never {
  throw new PublisherGrantFailure(code, status, message);
}

function parseStringArray(raw: string, field: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail('PUBLISHER_GRANT_CORRUPT', 500, `${field} is corrupt`); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100
      || parsed.some((value) => typeof value !== 'string' || value.length === 0)
      || new Set(parsed).size !== parsed.length) {
    fail('PUBLISHER_GRANT_CORRUPT', 500, `${field} is not a bounded unique string list`);
  }
  return parsed as string[];
}

function parseGrant(row: PublisherGrantRow | null, now: number): PublisherGrant {
  if (!row) fail('PUBLISHER_GRANT_NOT_FOUND', 403, 'the standing publisher grant does not exist');
  if (row.revoked_at !== null) fail('PUBLISHER_GRANT_REVOKED', 403, 'the standing publisher grant was revoked');
  if (!Number.isSafeInteger(row.expires_at) || row.expires_at <= now) {
    fail('PUBLISHER_GRANT_EXPIRED', 403, 'the standing publisher grant expired');
  }
  const repositories = parseStringArray(row.repositories_json, 'repositories_json');
  const operations = parseStringArray(row.operations_json, 'operations_json');
  const branchPrefixes = parseStringArray(row.branch_allow_json, 'branch_allow_json');
  const baseBranches = parseStringArray(row.base_allow_json, 'base_allow_json');
  if (!GRANT_ID_RE.test(row.grant_id) || row.surface !== 'publisher'
      || !Number.isSafeInteger(row.epoch) || row.epoch <= 0
      || !isSafePublisherIdentifier(row.account_user_id)
      || !HEX_64_RE.test(row.subject_fingerprint)
      || (row.subject_class !== 'ci' && row.subject_class !== 'host')
      || !Number.isSafeInteger(row.installation_id) || row.installation_id <= 0
      || !Number.isSafeInteger(row.mutations_per_day) || row.mutations_per_day <= 0
      || repositories.some((repo) => !isRepository(repo) || repo !== repo.toLowerCase())
      || operations.some((operation) => !OPERATIONS.includes(operation as FleetbotOperation))
      || branchPrefixes.some((prefix) => !REF_RE.test(prefix) || prefix.includes('..') || prefix.includes('//'))
      || baseBranches.some((branch) => !REF_RE.test(branch) || branch.includes('..') || branch.includes('//'))) {
    fail('PUBLISHER_GRANT_CORRUPT', 500, 'the standing publisher grant has invalid authority scope');
  }
  return {
    grantId: row.grant_id,
    epoch: row.epoch,
    surface: 'publisher',
    accountUserId: row.account_user_id,
    subjectFingerprint: row.subject_fingerprint.toLowerCase(),
    subjectClass: row.subject_class,
    installationId: row.installation_id,
    repositories,
    operations: operations as FleetbotOperation[],
    branchPrefixes,
    baseBranches,
    mutationsPerDay: row.mutations_per_day,
    expiresAt: row.expires_at,
  };
}

export async function readPublisherGrant(db: D1Database, grantId: string, now: number): Promise<PublisherGrant> {
  if (!GRANT_ID_RE.test(grantId)) fail('PUBLISHER_GRANT_INVALID', 400, 'grantId is malformed');
  const row = await db.prepare(
    `SELECT grant_id, epoch, surface, account_user_id, subject_fingerprint,
            subject_class, installation_id, repositories_json, operations_json,
            branch_allow_json, base_allow_json, mutations_per_day, expires_at, revoked_at
       FROM publisher_grants WHERE grant_id = ? AND surface = 'publisher'`,
  ).bind(grantId).first<PublisherGrantRow>();
  return parseGrant(row, now);
}

async function readLiveIdentity(db: D1Database, grant: PublisherGrant, now: number): Promise<IdentityRow> {
  const identity = await db.prepare(
    `SELECT pub_key, proof_method, expires_at, revoked, key_generation
       FROM identities WHERE daemon_fingerprint = ?`,
  ).bind(grant.subjectFingerprint).first<IdentityRow>();
  const expectedProof = grant.subjectClass === 'ci' ? 'oidc' : 'operator-provisioned';
  const registeredFingerprint = identity && HEX_64_RE.test(identity.pub_key)
    ? toHex(hashBytes(fromHex(identity.pub_key)))
    : null;
  if (!identity || identity.revoked !== 0
      || (identity.expires_at !== null && identity.expires_at <= now)
      || identity.proof_method !== expectedProof
      || registeredFingerprint !== grant.subjectFingerprint) {
    fail('PUBLISHER_IDENTITY_INVALID', 401, 'the grant subject is not a live enrolled workload identity');
  }
  return identity;
}

export interface AuthorizePublisherGrantInput {
  capability: FleetbotPublisherCapability;
  capabilitySignature: string;
  requestHash: string;
  idempotencyKey: string;
  repository: string;
  operation: FleetbotOperation;
  baseBranch: string;
  /** Null only for the read-only inspect operation, which publishes no branch. */
  headBranch: string | null;
  sessionId: string;
  installationId: number;
  isMutation: boolean;
  now: number;
}

/** Re-read and consume a standing grant immediately before GitHub authority is minted. */
export async function authorizePublisherGrant(
  db: D1Database,
  input: AuthorizePublisherGrantInput,
): Promise<PublisherGrant> {
  const grant = await readPublisherGrant(db, input.capability.grantId, input.now);
  if (grant.epoch !== input.capability.grantEpoch
      || grant.subjectFingerprint !== input.capability.daemonFingerprint.toLowerCase()) {
    fail('PUBLISHER_GRANT_STALE', 403, 'the capability names a stale or different standing grant');
  }
  if (grant.installationId !== input.installationId
      || !grant.repositories.includes(input.repository)
      || !grant.operations.includes(input.operation)
      || !grant.baseBranches.includes(input.baseBranch)
      || (input.isMutation && (input.headBranch === null
        || !grant.branchPrefixes.some((prefix) => input.headBranch!.startsWith(prefix))))) {
    fail('PUBLISHER_GRANT_SCOPE_MISMATCH', 403, 'the standing grant does not authorize this exact GitHub action');
  }
  const identity = await readLiveIdentity(db, grant, input.now);
  if (identity.key_generation !== input.capability.signingKeyGeneration
      || !SIGNATURE_RE.test(input.capabilitySignature)
      || !(await verifyEd25519(
        identity.pub_key,
        hashHex(stableJson(input.capability)),
        input.capabilitySignature,
      ))) {
    fail('CAPABILITY_SIGNATURE_INVALID', 401, 'publisher capability is not signed by the live grant subject');
  }

  await db.prepare(
    `INSERT OR IGNORE INTO github_publisher_session_bindings
       (session_id, subject_fingerprint, first_grant_id, bound_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(input.sessionId, grant.subjectFingerprint, grant.grantId, input.now).run();
  const binding = await db.prepare(
    `SELECT subject_fingerprint FROM github_publisher_session_bindings WHERE session_id = ?`,
  ).bind(input.sessionId).first<{ subject_fingerprint: string }>();
  if (!binding || binding.subject_fingerprint !== grant.subjectFingerprint) {
    fail('CAPABILITY_SESSION_REBOUND', 409, 'sessionId is already bound to another workload identity');
  }

  const dayStart = input.now - (input.now % 86_400);
  await db.prepare(
    `INSERT OR IGNORE INTO github_publisher_capability_uses
       (daemon_fingerprint, signing_key_generation, nonce, grant_id, grant_epoch,
        session_id, request_hash, idempotency_key, is_mutation, consumed_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? = 0
         OR EXISTS (
           SELECT 1 FROM github_publisher_capability_uses
            WHERE daemon_fingerprint = ? AND signing_key_generation = ? AND nonce = ?
         )
         OR (
           SELECT count(*) FROM github_publisher_capability_uses
            WHERE grant_id = ? AND is_mutation = 1 AND consumed_at >= ?
         ) < ?`,
  ).bind(
    grant.subjectFingerprint, input.capability.signingKeyGeneration, input.capability.nonce,
    grant.grantId, grant.epoch, input.sessionId, input.requestHash, input.idempotencyKey,
    input.isMutation ? 1 : 0, input.now, input.isMutation ? 1 : 0,
    grant.subjectFingerprint, input.capability.signingKeyGeneration, input.capability.nonce,
    grant.grantId, dayStart, grant.mutationsPerDay,
  ).run();
  const use = await db.prepare(
    `SELECT grant_id, grant_epoch, session_id, request_hash, idempotency_key, is_mutation
       FROM github_publisher_capability_uses
      WHERE daemon_fingerprint = ? AND signing_key_generation = ? AND nonce = ?`,
  ).bind(
    grant.subjectFingerprint,
    input.capability.signingKeyGeneration,
    input.capability.nonce,
  ).first<CapabilityUseRow>();
  if (!use) fail('PUBLISHER_DAILY_MUTATION_CEILING', 429, 'the standing grant daily mutation ceiling is exhausted');
  if (use.grant_id !== grant.grantId || use.grant_epoch !== grant.epoch
      || use.session_id !== input.sessionId || use.request_hash !== input.requestHash
      || use.idempotency_key !== input.idempotencyKey || use.is_mutation !== (input.isMutation ? 1 : 0)) {
    fail('CAPABILITY_REPLAY', 409, 'publisher capability nonce was already consumed by another action');
  }
  return grant;
}

function grantReadPreimage(request: Request, fingerprint: string, issuedAt: number, nonce: string): string {
  return stableJson({ schema: READ_SCHEMA, method: 'GET', path: new URL(request.url).pathname, fingerprint, issuedAt, nonce });
}

/** Workload-authenticated current grant snapshot; no operator identity or credential is disclosed. */
export async function handlePublisherGrantSnapshot(
  request: Request,
  db: D1Database,
  grantId: string,
): Promise<Response> {
  try {
    if (request.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405, 'grant snapshot accepts GET only');
    const now = Math.floor(Date.now() / 1000);
    const fingerprint = request.headers.get('X-PD-Workload-Fingerprint')?.toLowerCase() ?? '';
    const issuedAt = Number(request.headers.get('X-PD-Workload-Issued-At'));
    const nonce = request.headers.get('X-PD-Workload-Nonce')?.toLowerCase() ?? '';
    const signature = request.headers.get('X-PD-Workload-Signature')?.toLowerCase() ?? '';
    if (!HEX_64_RE.test(fingerprint) || !Number.isSafeInteger(issuedAt)
        || Math.abs(now - issuedAt) > READ_CLOCK_SKEW_SECONDS
        || !HEX_64_RE.test(nonce) || !SIGNATURE_RE.test(signature)) {
      fail('WORKLOAD_PROOF_INVALID', 401, 'a fresh signed workload proof is required');
    }
    const grant = await readPublisherGrant(db, grantId, now);
    if (grant.subjectFingerprint !== fingerprint) fail('PUBLISHER_GRANT_SUBJECT_MISMATCH', 403, 'grant belongs to another workload');
    const identity = await readLiveIdentity(db, grant, now);
    if (!(await verifyEd25519(identity.pub_key, hashHex(grantReadPreimage(request, fingerprint, issuedAt, nonce)), signature))) {
      fail('WORKLOAD_PROOF_INVALID', 401, 'workload proof signature is invalid');
    }
    return Response.json({
      schema: 'port-daddy.publisher-grant-snapshot.v1',
      grantId: grant.grantId,
      grantEpoch: grant.epoch,
      surface: grant.surface,
      subjectClass: grant.subjectClass,
      signingKeyGeneration: identity.key_generation,
      repositories: grant.repositories,
      operations: grant.operations,
      branchPrefixes: grant.branchPrefixes,
      baseBranches: grant.baseBranches,
      mutationsPerDay: grant.mutationsPerDay,
      expiresAt: grant.expiresAt,
      refreshedAt: now,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof PublisherGrantFailure
      ? error
      : new PublisherGrantFailure('PUBLISHER_GRANT_READ_FAILED', 500, 'publisher grant could not be read');
    return Response.json({ code: known.code, error: known.message }, {
      status: known.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
