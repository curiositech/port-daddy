/**
 * General, account-scoped GitHub App publisher.
 *
 * The local daemon proves the active Port Daddy session and repository before
 * it sends this request. Relay independently authenticates the operator's pdu_
 * account token, rechecks that the same GitHub App installation grants the
 * exact repository, reserves a durable D1 intent, and mints one short-lived
 * installation token for that repository only. No App token crosses Relay.
 *
 * Publication uses GitHub's Git Data API: all blobs feed one tree, one commit,
 * and one create-only (or fast-forward-only) ref update. A network ambiguity is
 * recovered by exact ref/commit/PR readback; it is never retried blindly.
 */

import type { Env } from './types.js';
import {
  FLEETBOT_ACTION_SCHEMA,
  FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
  FLEETBOT_RECEIPT_SCHEMA,
  fleetbotIdempotencyPreimage,
  fleetbotPublisherCapabilityPreimage,
  fleetbotMutationMarker,
  fleetbotReceiptId,
  fleetbotReceiptPreimage,
  isGitSha,
  isRepository,
  isSafePublisherIdentifier,
  safeRepositoryPath,
  stampFleetbotMessage,
  stampPullRequestBody,
  validateRoadmapTrailer,
  type FleetbotActionRequest,
  type FleetbotAuthorship,
  type FleetbotOperation,
  type FleetbotPublisherCapability,
  type FleetbotReceipt,
  type FleetbotTreeChange,
} from '../../../lib/github-publisher-contract.js';
import { fromHex, hashBytes, hashHex, pubKeyFromPrivKey, signEd25519, toHex, verifyEd25519 } from './crypto.js';
import {
  getGitHubAppIdentity,
  getRepoInstallationId,
  mintRepositoryInstallationToken,
  revokeInstallationToken,
  type GitHubAppIdentity,
  type InstallationPermission,
} from './github-app.js';
import {
  replaceUserTokenGitHubCredential,
  resolveUserTokenReadOnly,
  resolveUserTokenWithGitHubCredential,
  type UserRow,
} from './db.js';
import {
  githubCredentialNeedsRefresh,
  githubTokenKeyring,
  openGitHubUserCredential,
  refreshGitHubUserCredential,
  sealGitHubUserCredential,
  type GitHubTokenWrappingEnvironment,
  type GitHubUserCredential,
} from './github-user-token.js';

const GH_API = 'https://api.github.com';
const GH_GRAPHQL = 'https://api.github.com/graphql';
const GITHUB_TIMEOUT_MS = 15_000;
const INTENT_LEASE_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 1_000_000;
const MAX_MESSAGE_BYTES = 8_000;
const MAX_CHANGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_CHANGE_BYTES = 8 * 1024 * 1024;
const MAX_OUTER_REQUEST_BYTES = Math.ceil(MAX_TOTAL_CHANGE_BYTES * 4 / 3) + MAX_BODY_BYTES + 256_000;
const MAX_CHANGES = 100;
const MAX_REPOSITORY_PAGES = 50;
const MAX_GITHUB_LIST_PAGES = 100;
const CAPABILITY_MAX_TTL_SECONDS = 5 * 60;
const CAPABILITY_CLOCK_SKEW_SECONDS = 30;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const PDU_RE = /^pdu_[0-9a-f]{64}$/i;

type PublisherEnv = Env & GitHubTokenWrappingEnvironment;

class PublisherFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'PublisherFailure';
  }
}

interface CommonPayload {
  baseBranch: string;
  baseSha: string;
}

interface CommitPayload extends CommonPayload {
  sourceHeadSha: string;
  sourceTreeSha: string;
  sourceCommittedAt: number;
  commitMessage: string;
  changes: FleetbotTreeChange[];
}

interface PublishPayload extends CommitPayload {
  title: string;
  body: string;
  draft: boolean;
}

interface ExistingPayload extends CommonPayload {
  pullRequestNumber: number;
  expectedGithubHeadSha: string;
}

interface UpdatePayload extends ExistingPayload, CommitPayload {
  title: string;
  body: string;
}

interface ReviewersPayload extends ExistingPayload {
  reviewers: string[];
  teamReviewers: string[];
}

interface MessagePayload extends ExistingPayload {
  body: string;
  commentId?: number;
}

type ParsedPayload =
  | PublishPayload
  | UpdatePayload
  | ExistingPayload
  | ReviewersPayload
  | MessagePayload;

interface IntentKey {
  accountUserId: string;
  accountGithubUserId: number;
  installationId: number;
  repository: string;
  scopeSha: string;
  idempotencyKey: string;
  requestHash: string;
  operation: FleetbotOperation;
  authorship: FleetbotAuthorship;
}

interface IntentRow {
  request_hash: string;
  state: 'reserved' | 'running' | 'ambiguous' | 'succeeded' | 'failed';
  receipt_json: string | null;
  updated_at: number;
  lease_fence: number;
}

interface IdentityAuthorityRow {
  pub_key: string;
  expires_at: number | null;
  revoked: number;
  key_generation: number;
}

interface CapabilityUseRow {
  account_user_id: string;
  account_token_hash: string;
  request_hash: string;
  idempotency_key: string;
}

interface PullRequestWitness {
  number: number;
  nodeId: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  title: string;
  body: string;
  author: string;
  headRef: string;
  headSha: string;
  headRepository: string;
  baseRef: string;
  baseSha: string;
  baseRepository: string;
}

interface ExecutionResult {
  resourceUrl: string;
  resourceNumber: number | null;
  publishedBranch: string | null;
  githubHeadSha: string | null;
  result: FleetbotReceipt['result'];
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function failure(code: string, status: number, message: string, ambiguous = false): never {
  throw new PublisherFailure(code, status, message, ambiguous);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0)) {
    failure('INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    failure('INVALID_REQUEST', 400, `${field} must be a positive integer`);
  }
  return value as number;
}

function safeRef(value: unknown, field: string): string {
  const ref = boundedString(value, field, 200);
  if (!REF_RE.test(ref) || ref.includes('..') || ref.includes('//') || ref.includes('@{')
      || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock')) {
    failure('INVALID_REQUEST', 400, `${field} is not a safe Git ref`);
  }
  return ref;
}

function sha(value: unknown, field: string): string {
  if (!isGitSha(value)) failure('INVALID_REQUEST', 400, `${field} must be one Git SHA-1`);
  return value.toLowerCase();
}

function validateAuthorship(value: unknown, sessionId: string): FleetbotAuthorship {
  const row = record(value);
  if (!row || row.sessionId !== sessionId
      || !isSafePublisherIdentifier(row.actorId)
      || !isSafePublisherIdentifier(row.agentId)
      || !isSafePublisherIdentifier(row.sessionId)
      || !isSafePublisherIdentifier(row.identityProject)
      || typeof row.purpose !== 'string' || row.purpose.trim().length === 0 || row.purpose.length > 2_000
      || (row.roadmapItem !== null && !isSafePublisherIdentifier(row.roadmapItem))
      || (row.sidequestReason !== null && (typeof row.sidequestReason !== 'string' || row.sidequestReason.length > 1_000))
      || (row.worktreeId !== null && !isSafePublisherIdentifier(row.worktreeId))
      || (row.sourceBranch !== null && typeof row.sourceBranch !== 'string')) {
    failure('INVALID_PROVENANCE', 400, 'daemon-bound authorship is missing or malformed');
  }
  if ((row.roadmapItem === null) === (row.sidequestReason === null)) {
    failure('INVALID_PROVENANCE', 400, 'authorship must carry one roadmap item or one sidequest reason');
  }
  if (row.sourceBranch !== null) safeRef(row.sourceBranch, 'authorship.sourceBranch');
  return row as unknown as FleetbotAuthorship;
}

function decodeBase64Size(value: string): number {
  if (!value || value.length > Math.ceil(MAX_CHANGE_BYTES * 4 / 3) + 4
      || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    failure('INVALID_REQUEST', 400, 'change contentBase64 is malformed or too large');
  }
  try {
    return atob(value).length;
  } catch {
    failure('INVALID_REQUEST', 400, 'change contentBase64 is malformed');
  }
}

function parseChanges(value: unknown): FleetbotTreeChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
    failure('INVALID_REQUEST', 400, `changes must contain 1-${MAX_CHANGES} entries`);
  }
  let total = 0;
  const paths = new Set<string>();
  return value.map((entry) => {
    const row = record(entry);
    if (!row || !safeRepositoryPath(row.path) || paths.has(row.path)) {
      failure('INVALID_REQUEST', 400, 'changes contain an unsafe or duplicate path');
    }
    paths.add(row.path);
    const deleting = row.delete === true;
    const content = typeof row.contentBase64 === 'string' ? row.contentBase64 : null;
    if (deleting === (content !== null) || Object.keys(row).some((key) => !['path', 'mode', 'contentBase64', 'delete'].includes(key))) {
      failure('INVALID_REQUEST', 400, 'each change must contain exactly one of delete or contentBase64');
    }
    const mode = row.mode ?? '100644';
    if (mode !== '100644' && mode !== '100755' && mode !== '120000') {
      failure('INVALID_REQUEST', 400, 'change mode is invalid');
    }
    if (content !== null) {
      total += decodeBase64Size(content);
      if (total > MAX_TOTAL_CHANGE_BYTES) failure('INVALID_REQUEST', 400, 'change set is too large');
    }
    return deleting
      ? { path: row.path, delete: true }
      : { path: row.path, mode, contentBase64: content! };
  });
}

function parseCommon(payload: Record<string, unknown>): CommonPayload {
  return { baseBranch: safeRef(payload.baseBranch, 'baseBranch'), baseSha: sha(payload.baseSha, 'baseSha') };
}

function parseCommit(payload: Record<string, unknown>): CommitPayload {
  const common = parseCommon(payload);
  const sourceCommittedAt = positiveInteger(payload.sourceCommittedAt, 'sourceCommittedAt');
  if (sourceCommittedAt > Math.floor(Date.now() / 1000) + 300) {
    failure('INVALID_REQUEST', 400, 'sourceCommittedAt is in the future');
  }
  return {
    ...common,
    sourceHeadSha: sha(payload.sourceHeadSha, 'sourceHeadSha'),
    sourceTreeSha: sha(payload.sourceTreeSha, 'sourceTreeSha'),
    sourceCommittedAt,
    commitMessage: boundedString(payload.commitMessage, 'commitMessage', MAX_MESSAGE_BYTES),
    changes: parseChanges(payload.changes),
  };
}

function parseExisting(payload: Record<string, unknown>): ExistingPayload {
  return {
    ...parseCommon(payload),
    pullRequestNumber: positiveInteger(payload.pullRequestNumber, 'pullRequestNumber'),
    expectedGithubHeadSha: sha(payload.expectedGithubHeadSha, 'expectedGithubHeadSha'),
  };
}

function parsePayload(operation: FleetbotOperation, value: unknown, authorship: FleetbotAuthorship): ParsedPayload {
  const payload = record(value);
  if (!payload) failure('INVALID_REQUEST', 400, 'payload must be an object');
  const exactKeys = (allowed: readonly string[]): void => {
    const extras = Object.keys(payload).filter((key) => !allowed.includes(key));
    if (extras.length > 0) failure('INVALID_REQUEST', 400, 'payload contains fields not used by this operation');
  };
  if (operation === 'pull-request.publish') {
    exactKeys(['baseBranch', 'baseSha', 'sourceHeadSha', 'sourceTreeSha', 'sourceCommittedAt', 'commitMessage', 'changes', 'title', 'body', 'draft']);
    const parsed: PublishPayload = {
      ...parseCommit(payload),
      title: boundedString(payload.title, 'title', 256),
      body: boundedString(payload.body, 'body', MAX_BODY_BYTES),
      draft: payload.draft === true,
    };
    const roadmapError = validateRoadmapTrailer(parsed.body, authorship);
    if (roadmapError) failure(roadmapError.code, 400, roadmapError.error);
    return parsed;
  }
  const existing = parseExisting(payload);
  if (operation === 'pull-request.update') {
    exactKeys(['baseBranch', 'baseSha', 'pullRequestNumber', 'expectedGithubHeadSha', 'sourceHeadSha', 'sourceTreeSha', 'sourceCommittedAt', 'commitMessage', 'changes', 'title', 'body']);
    const parsed: UpdatePayload = {
      ...existing,
      ...parseCommit(payload),
      title: boundedString(payload.title, 'title', 256),
      body: boundedString(payload.body, 'body', MAX_BODY_BYTES),
    };
    const roadmapError = validateRoadmapTrailer(parsed.body, authorship);
    if (roadmapError) failure(roadmapError.code, 400, roadmapError.error);
    return parsed;
  }
  if (operation === 'pull-request.request-reviewers') {
    exactKeys(['baseBranch', 'baseSha', 'pullRequestNumber', 'expectedGithubHeadSha', 'reviewers', 'teamReviewers']);
    const parseNames = (input: unknown, field: string): string[] => {
      if (input === undefined) return [];
      if (!Array.isArray(input) || input.length > 20 || input.some((item) => !isSafePublisherIdentifier(item))) {
        failure('INVALID_REQUEST', 400, `${field} is invalid`);
      }
      return [...new Set(input as string[])].sort();
    };
    const reviewers = parseNames(payload.reviewers, 'reviewers');
    const teamReviewers = parseNames(payload.teamReviewers, 'teamReviewers');
    if (reviewers.length + teamReviewers.length === 0) failure('INVALID_REQUEST', 400, 'at least one reviewer is required');
    return { ...existing, reviewers, teamReviewers };
  }
  if (operation === 'pull-request.comment' || operation === 'pull-request.review-reply') {
    exactKeys(operation === 'pull-request.review-reply'
      ? ['baseBranch', 'baseSha', 'pullRequestNumber', 'expectedGithubHeadSha', 'body', 'commentId']
      : ['baseBranch', 'baseSha', 'pullRequestNumber', 'expectedGithubHeadSha', 'body']);
    const result: MessagePayload = {
      ...existing,
      body: boundedString(payload.body, 'body', MAX_BODY_BYTES),
    };
    if (operation === 'pull-request.review-reply') result.commentId = positiveInteger(payload.commentId, 'commentId');
    return result;
  }
  exactKeys(['baseBranch', 'baseSha', 'pullRequestNumber', 'expectedGithubHeadSha']);
  return existing;
}

function parseCapability(value: unknown, signature: unknown): {
  capability: FleetbotPublisherCapability;
  signature: string;
} {
  const row = record(value);
  const keys = row ? Object.keys(row).sort() : [];
  const expected = [
    'accountTokenHash', 'baseBranch', 'baseSha', 'daemonFingerprint', 'expiresAt',
    'headSha', 'issuedAt', 'nonce', 'operation', 'repository', 'requestHash',
    'schema', 'sessionId', 'signingKeyGeneration',
  ].sort();
  if (!row || JSON.stringify(keys) !== JSON.stringify(expected)
      || row.schema !== FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA
      || !/^[0-9a-f]{64}$/i.test(String(row.accountTokenHash))
      || !/^[0-9a-f]{64}$/i.test(String(row.daemonFingerprint))
      || !Number.isSafeInteger(row.signingKeyGeneration) || (row.signingKeyGeneration as number) < 1
      || !isSafePublisherIdentifier(row.sessionId)
      || !isRepository(row.repository) || row.repository !== String(row.repository).toLowerCase()
      || typeof row.operation !== 'string'
      || typeof row.baseBranch !== 'string'
      || !isGitSha(row.baseSha) || !isGitSha(row.headSha)
      || !/^[0-9a-f]{64}$/i.test(String(row.requestHash))
      || !Number.isSafeInteger(row.issuedAt) || !Number.isSafeInteger(row.expiresAt)
      || !/^[0-9a-f]{64}$/i.test(String(row.nonce))
      || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) {
    failure('CAPABILITY_INVALID', 401, 'publisher capability is malformed');
  }
  return {
    capability: row as unknown as FleetbotPublisherCapability,
    signature: signature.toLowerCase(),
  };
}

function parseRequest(value: unknown): {
  request: FleetbotActionRequest;
  payload: ParsedPayload;
  requestHash: string;
  capability: FleetbotPublisherCapability;
  capabilitySignature: string;
} {
  const row = record(value);
  const operations: FleetbotOperation[] = [
    'pull-request.publish',
    'pull-request.update',
    'pull-request.ready',
    'pull-request.request-reviewers',
    'pull-request.comment',
    'pull-request.review-reply',
    'pull-request.enqueue',
    'pull-request.inspect',
  ];
  const requestKeys = [
    'authorship', 'capability', 'capabilitySignature', 'idempotencyKey',
    'operation', 'payload', 'repository', 'schema', 'sessionId',
  ].sort();
  if (!row || row.schema !== FLEETBOT_ACTION_SCHEMA || !operations.includes(row.operation as FleetbotOperation)
      || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(requestKeys)
      || !isRepository(row.repository) || row.repository !== row.repository.toLowerCase()
      || !isSafePublisherIdentifier(row.sessionId) || typeof row.idempotencyKey !== 'string') {
    failure('INVALID_REQUEST', 400, 'publisher request envelope is invalid');
  }
  const authorship = validateAuthorship(row.authorship, row.sessionId as string);
  const request = row as unknown as FleetbotActionRequest;
  const requestHash = hashHex(fleetbotIdempotencyPreimage(request));
  if (row.idempotencyKey !== `pd-gh-${requestHash}`) {
    failure('IDEMPOTENCY_MISMATCH', 400, 'idempotency key does not bind the canonical request');
  }
  const parsedCapability = parseCapability(row.capability, row.capabilitySignature);
  return {
    request,
    payload: parsePayload(request.operation, request.payload, authorship),
    requestHash,
    capability: parsedCapability.capability,
    capabilitySignature: parsedCapability.signature,
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_OUTER_REQUEST_BYTES) {
      failure('REQUEST_TOO_LARGE', 413, `publisher request exceeds ${MAX_OUTER_REQUEST_BYTES} bytes`);
    }
  }
  if (!request.body) failure('INVALID_JSON', 400, 'request body must be JSON');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let total = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_OUTER_REQUEST_BYTES) {
        await reader.cancel();
        failure('REQUEST_TOO_LARGE', 413, `publisher request exceeds ${MAX_OUTER_REQUEST_BYTES} bytes`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof PublisherFailure) throw error;
    failure('INVALID_JSON', 400, 'request body must be JSON');
  }
}

function bearer(request: Request): string {
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+(pdu_[0-9a-f]{64})$/i);
  if (!match || !PDU_RE.test(match[1]!)) failure('UNAUTHENTICATED', 401, 'a Port Daddy account login is required');
  return match[1]!;
}

function configured(env: PublisherEnv): { appId: string; privateKey: string } {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !/^\d+$/.test(appId) || !privateKey || !env.RELAY_ED25519_PRIVATE_KEY_HEX) {
    failure('PUBLISHER_UNCONFIGURED', 503, 'Fleetbot publisher is not configured');
  }
  return { appId, privateKey };
}

async function credentialForAccount(
  env: PublisherEnv,
  tokenHash: string,
  now: number,
): Promise<{ user: UserRow; credential: GitHubUserCredential }> {
  const row = await resolveUserTokenWithGitHubCredential(env.DB, tokenHash, now);
  if (!row) failure('PUBLISHER_REAUTH_REQUIRED', 401, 'sign in again to authorize App publication');
  const keyring = githubTokenKeyring(env);
  const binding = { kind: 'device-token' as const, rowId: tokenHash, userId: row.user.id };
  const opened = await openGitHubUserCredential(keyring, binding, {
    enc: row.ghCredentialEnc,
    iv: row.ghCredentialIv,
    keyVersion: row.ghCredentialKeyVersion,
  });
  if (!opened) failure('PUBLISHER_REAUTH_REQUIRED', 401, 'sign in again to authorize App publication');
  let credential = opened.credential;
  let needsReseal = opened.needsReseal;
  if (githubCredentialNeedsRefresh(credential, now)) {
    try {
      credential = await refreshGitHubUserCredential(credential, {
        clientId: env.GITHUB_OAUTH_CLIENT_ID ?? '',
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        now,
      });
      needsReseal = true;
    } catch {
      failure('PUBLISHER_REAUTH_REQUIRED', 401, 'GitHub authorization expired; sign in again');
    }
  }
  if (needsReseal) {
    const sealed = await sealGitHubUserCredential(keyring, binding, credential);
    const replaced = await replaceUserTokenGitHubCredential(env.DB, {
      tokenHash,
      userId: row.user.id,
      expectedEnc: row.ghCredentialEnc,
      ghCredentialEnc: sealed.enc,
      ghCredentialIv: sealed.iv,
      ghCredentialKeyVersion: sealed.keyVersion,
    });
    if (!replaced) failure('CREDENTIAL_RACE', 409, 'GitHub authorization changed concurrently; retry from current account state');
  }
  return { user: row.user, credential };
}

function capabilityHead(operation: FleetbotOperation, payload: ParsedPayload): string {
  return operation === 'pull-request.publish'
    ? (payload as PublishPayload).sourceHeadSha
    : (payload as ExistingPayload).expectedGithubHeadSha;
}

async function verifyAndConsumeCapability(
  env: PublisherEnv,
  capability: FleetbotPublisherCapability,
  signature: string,
  request: FleetbotActionRequest,
  payload: ParsedPayload,
  requestHash: string,
  tokenHash: string,
  accountUserId: string,
  now: number,
): Promise<void> {
  if (capability.accountTokenHash.toLowerCase() !== tokenHash
      || capability.sessionId !== request.sessionId
      || capability.sessionId !== request.authorship!.sessionId
      || capability.repository !== request.repository
      || capability.operation !== request.operation
      || capability.baseBranch !== (payload as CommonPayload).baseBranch
      || capability.baseSha.toLowerCase() !== (payload as CommonPayload).baseSha
      || capability.headSha.toLowerCase() !== capabilityHead(request.operation, payload)
      || capability.requestHash.toLowerCase() !== requestHash) {
    failure('CAPABILITY_SCOPE_MISMATCH', 403, 'publisher capability does not bind this exact action');
  }
  if (capability.issuedAt > now + CAPABILITY_CLOCK_SKEW_SECONDS
      || capability.expiresAt <= now
      || capability.expiresAt <= capability.issuedAt
      || capability.expiresAt - capability.issuedAt > CAPABILITY_MAX_TTL_SECONDS) {
    failure('CAPABILITY_EXPIRED', 401, 'publisher capability is expired or outside its bounded lifetime');
  }
  const identity = await env.DB.prepare(
    `SELECT pub_key, expires_at, revoked, key_generation
       FROM identities WHERE daemon_fingerprint = ?`,
  ).bind(capability.daemonFingerprint).first<IdentityAuthorityRow>();
  const registeredFingerprint = identity && /^[0-9a-f]{64}$/i.test(identity.pub_key)
    ? toHex(hashBytes(fromHex(identity.pub_key)))
    : null;
  if (!identity || identity.revoked !== 0
      || (identity.expires_at !== null && identity.expires_at <= now)
      || identity.key_generation !== capability.signingKeyGeneration
      || registeredFingerprint !== capability.daemonFingerprint.toLowerCase()
      || !(await verifyEd25519(
        identity.pub_key,
        hashHex(fleetbotPublisherCapabilityPreimage(capability)),
        signature,
      ))) {
    failure('CAPABILITY_SIGNATURE_INVALID', 401, 'publisher capability is not signed by the live daemon identity');
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO github_publisher_capability_uses
       (daemon_fingerprint, signing_key_generation, nonce, account_user_id,
        account_token_hash, request_hash, idempotency_key, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    capability.daemonFingerprint,
    capability.signingKeyGeneration,
    capability.nonce,
    accountUserId,
    tokenHash,
    requestHash,
    request.idempotencyKey,
    now,
  ).run();
  const use = await env.DB.prepare(
    `SELECT account_user_id, account_token_hash, request_hash, idempotency_key
       FROM github_publisher_capability_uses
      WHERE daemon_fingerprint = ? AND signing_key_generation = ? AND nonce = ?`,
  ).bind(
    capability.daemonFingerprint,
    capability.signingKeyGeneration,
    capability.nonce,
  ).first<CapabilityUseRow>();
  if (!use || use.account_user_id !== accountUserId || use.account_token_hash !== tokenHash
      || use.request_hash !== requestHash || use.idempotency_key !== request.idempotencyKey) {
    failure('CAPABILITY_REPLAY', 409, 'publisher capability nonce was already consumed by another action');
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'port-daddy-relay/fleetbot-publisher',
  };
}

async function fetchJson<T>(
  url: string,
  token: string,
  options: { method?: string; body?: unknown; allow404?: boolean; mutation?: () => void } = {},
): Promise<{ status: number; body: T | null }> {
  const method = options.method ?? 'GET';
  if (method !== 'GET') options.mutation?.();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: githubHeaders(token),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    failure('GITHUB_IO_FAILED', 502, 'GitHub did not return a bounded response', method !== 'GET');
  }
  if (options.allow404 && response.status === 404) return { status: 404, body: null };
  if (!response.ok) failure('GITHUB_OPERATION_FAILED', response.status >= 500 ? 502 : 409, `GitHub refused ${method} with status ${response.status}`, method !== 'GET');
  if (response.status === 204) return { status: response.status, body: null };
  try {
    return { status: response.status, body: await response.json() as T };
  } catch {
    failure('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid JSON', method !== 'GET');
  }
}

async function listAllPages<T>(url: string, token: string): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 1; page <= MAX_GITHUB_LIST_PAGES; page += 1) {
    const target = new URL(url);
    target.searchParams.set('per_page', '100');
    target.searchParams.set('page', String(page));
    const result = await fetchJson<unknown>(target.toString(), token);
    if (!Array.isArray(result.body)) {
      failure('GITHUB_LIST_INVALID', 502, 'GitHub returned an invalid paginated list');
    }
    collected.push(...result.body as T[]);
    if (result.body.length < 100) return collected;
  }
  failure('GITHUB_LIST_TOO_LARGE', 409, 'GitHub list exceeds the bounded pagination scan');
}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  mutation?: () => void,
): Promise<T> {
  const response = await fetchJson<{ data?: T; errors?: unknown }>(GH_GRAPHQL, token, {
    method: 'POST',
    body: { query, variables },
    mutation,
  });
  if (!response.body?.data || response.body.errors) {
    failure('GITHUB_GRAPHQL_FAILED', 409, 'GitHub GraphQL operation failed', Boolean(mutation));
  }
  return response.body.data;
}

async function authorizeExactRepository(
  installationId: number,
  repository: string,
  userToken: string,
): Promise<void> {
  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const result = await fetchJson<{
      total_count?: number;
      repositories?: Array<{ full_name?: string }>;
    }>(`${GH_API}/user/installations/${installationId}/repositories?per_page=100&page=${page}`, userToken);
    const repositories = result.body?.repositories;
    if (!Array.isArray(repositories)) failure('GITHUB_GRANT_INVALID', 502, 'GitHub installation repository response is invalid');
    if (repositories.some((entry) => entry.full_name?.toLowerCase() === repository)) return;
    if (repositories.length < 100 || (Number.isSafeInteger(result.body?.total_count)
      && page * 100 >= (result.body?.total_count ?? 0))) {
      failure('REPOSITORY_NOT_AUTHORIZED', 403, 'the signed-in user has not granted this repository to Port Daddy');
    }
  }
  failure('GITHUB_GRANT_TOO_LARGE', 403, 'repository grant exceeds the bounded authorization scan');
}

function intentBinds(key: IntentKey): unknown[] {
  return [key.accountUserId, key.installationId, key.repository, key.scopeSha, key.idempotencyKey];
}

async function parseStoredReceipt(env: PublisherEnv, raw: string | null, key: IntentKey): Promise<FleetbotReceipt> {
  let receipt: FleetbotReceipt;
  try { receipt = JSON.parse(raw ?? '') as FleetbotReceipt; } catch { failure('INTENT_CORRUPT', 500, 'stored publisher receipt is corrupt'); }
  if (receipt.schema !== FLEETBOT_RECEIPT_SCHEMA || receipt.idempotencyKey !== key.idempotencyKey
      || receipt.repository !== key.repository || receipt.accountUserId !== key.accountUserId
      || receipt.accountGithubUserId !== key.accountGithubUserId
      || receipt.operation !== key.operation || receipt.sessionId !== key.authorship.sessionId
      || receipt.tokenCleanup !== 'confirmed'
      || receipt.relayPublicKey !== pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX)
      || !/^[0-9a-f]{128}$/i.test(receipt.signature)
      || !(await verifyEd25519(
        receipt.relayPublicKey,
        hashHex(fleetbotReceiptPreimage(receipt)),
        receipt.signature,
      ))) {
    failure('INTENT_CORRUPT', 500, 'stored publisher receipt does not match its authority scope');
  }
  return receipt;
}

async function reserveIntent(
  env: PublisherEnv,
  key: IntentKey,
  now: number,
): Promise<{ reused: FleetbotReceipt } | { fence: number }> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO github_publisher_intents
       (account_user_id, account_github_user_id, installation_id, repository,
        scope_sha, idempotency_key, request_hash, operation, state,
        actor_id, agent_id, session_id, identity_project, roadmap_item,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    key.accountUserId,
    key.accountGithubUserId,
    key.installationId,
    key.repository,
    key.scopeSha,
    key.idempotencyKey,
    key.requestHash,
    key.operation,
    key.authorship.actorId,
    key.authorship.agentId,
    key.authorship.sessionId,
    key.authorship.identityProject,
    key.authorship.roadmapItem,
    now,
    now,
  ).run();
  const row = await env.DB.prepare(
    `SELECT request_hash, state, receipt_json, updated_at, lease_fence
       FROM github_publisher_intents
      WHERE account_user_id = ? AND installation_id = ? AND repository = ?
        AND scope_sha = ? AND idempotency_key = ?`,
  ).bind(...intentBinds(key)).first<IntentRow>();
  if (!row) failure('INTENT_RESERVATION_FAILED', 500, 'publisher intent was not durably reserved');
  if (row.request_hash !== key.requestHash) failure('IDEMPOTENCY_REPLAY_MISMATCH', 409, 'idempotency key was already used for different content');
  if (row.state === 'succeeded') return { reused: await parseStoredReceipt(env, row.receipt_json, key) };
  const leased = await env.DB.prepare(
    `UPDATE github_publisher_intents
        SET state = 'running', updated_at = ?, error_code = NULL,
            lease_fence = lease_fence + 1
      WHERE account_user_id = ? AND installation_id = ? AND repository = ?
        AND scope_sha = ? AND idempotency_key = ?
        AND (state IN ('reserved', 'ambiguous', 'failed')
          OR (state = 'running' AND updated_at < ?))
      RETURNING lease_fence`,
  ).bind(now, ...intentBinds(key), now - INTENT_LEASE_SECONDS).first<{ lease_fence: number }>();
  if (!leased || !Number.isSafeInteger(leased.lease_fence) || leased.lease_fence < 1) {
    failure('INTENT_IN_PROGRESS', 409, 'the same publisher intent is already running');
  }
  return { fence: leased.lease_fence };
}

async function finishIntent(
  env: PublisherEnv,
  key: IntentKey,
  fence: number,
  state: 'ambiguous' | 'succeeded' | 'failed',
  now: number,
  values: {
    result?: ExecutionResult;
    receipt?: FleetbotReceipt;
    errorCode?: string;
  },
): Promise<void> {
  const updated = await env.DB.prepare(
    `UPDATE github_publisher_intents
        SET state = ?, resource_number = ?, resource_url = ?, published_branch = ?,
            github_head_sha = ?, receipt_json = ?, error_code = ?, updated_at = ?
      WHERE account_user_id = ? AND installation_id = ? AND repository = ?
        AND scope_sha = ? AND idempotency_key = ? AND request_hash = ?
        AND state = 'running' AND lease_fence = ?`,
  ).bind(
    state,
    values.result?.resourceNumber ?? null,
    values.result?.resourceUrl ?? null,
    values.result?.publishedBranch ?? null,
    values.result?.githubHeadSha ?? null,
    values.receipt ? JSON.stringify(values.receipt) : null,
    values.errorCode ?? null,
    now,
    ...intentBinds(key),
    key.requestHash,
    fence,
  ).run();
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    failure('INTENT_FINALIZE_FAILED', 500, 'publisher outcome was not durably finalized', state === 'succeeded');
  }
}

function permissionsFor(operation: FleetbotOperation): Readonly<Record<string, InstallationPermission>> {
  return operation === 'pull-request.publish' || operation === 'pull-request.update'
    ? { contents: 'write', pull_requests: 'write' }
    : operation === 'pull-request.inspect'
      ? { pull_requests: 'read' }
      : { pull_requests: 'write' };
}

function expectedBranch(request: FleetbotActionRequest, accountUserId: string): string {
  const name = request.authorship!.agentId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'agent';
  const scope = hashHex(`${accountUserId}:${request.idempotencyKey}`).slice(0, 12);
  return `pd-agent/${name}-${scope}`;
}

function commitMessage(
  payload: CommitPayload,
  authorship: FleetbotAuthorship,
  receiptId: string,
): string {
  const roadmap = authorship.roadmapItem ?? `none — ${authorship.sidequestReason}`;
  return [
    payload.commitMessage.trim(),
    '',
    `Port-Daddy-Agent: ${authorship.agentId}`,
    `Port-Daddy-Session: ${authorship.sessionId}`,
    `Port-Daddy-Actor: ${authorship.actorId}`,
    `Port-Daddy-Project: ${authorship.identityProject}`,
    `Port-Daddy-Source-Head: ${payload.sourceHeadSha}`,
    `Port-Daddy-Receipt: ${receiptId}`,
    `Roadmap-Item: ${roadmap}`,
  ].join('\n');
}

function pullWitness(value: unknown): PullRequestWitness {
  const row = record(value);
  const user = record(row?.user);
  const head = record(row?.head);
  const base = record(row?.base);
  const headRepo = record(head?.repo);
  const baseRepo = record(base?.repo);
  if (!row || !Number.isSafeInteger(row.number) || typeof row.node_id !== 'string'
      || typeof row.html_url !== 'string' || typeof row.state !== 'string' || typeof row.draft !== 'boolean'
      || typeof row.title !== 'string' || (row.body !== null && typeof row.body !== 'string')
      || typeof user?.login !== 'string' || typeof head?.ref !== 'string' || !isGitSha(head?.sha)
      || typeof headRepo?.full_name !== 'string' || typeof base?.ref !== 'string' || !isGitSha(base?.sha)
      || typeof baseRepo?.full_name !== 'string') {
    failure('GITHUB_RESPONSE_INVALID', 502, 'GitHub pull-request response is invalid');
  }
  return {
    number: row.number as number,
    nodeId: row.node_id,
    htmlUrl: row.html_url,
    state: row.state,
    draft: row.draft,
    title: row.title,
    body: row.body ?? '',
    author: user.login,
    headRef: head.ref,
    headSha: head.sha.toLowerCase(),
    headRepository: headRepo.full_name.toLowerCase(),
    baseRef: base.ref,
    baseSha: base.sha.toLowerCase(),
    baseRepository: baseRepo.full_name.toLowerCase(),
  };
}

function verifyPull(
  pull: PullRequestWitness,
  input: {
    repository: string;
    app: GitHubAppIdentity;
    baseBranch: string;
    baseSha: string;
    headSha: string;
    number?: number;
    headRef?: string;
    draft?: boolean;
    title?: string;
    body?: string;
  },
): void {
  if ((input.number !== undefined && pull.number !== input.number)
      || pull.state !== 'open' || pull.author.toLowerCase() !== input.app.botName.toLowerCase()
      || pull.headRepository !== input.repository || pull.baseRepository !== input.repository
      || pull.baseRef !== input.baseBranch || pull.baseSha !== input.baseSha || pull.headSha !== input.headSha
      || (input.headRef !== undefined && pull.headRef !== input.headRef)
      || (input.draft !== undefined && pull.draft !== input.draft)
      || (input.title !== undefined && pull.title !== input.title)
      || (input.body !== undefined && pull.body !== input.body)) {
    failure('PULL_REQUEST_SCOPE_CHANGED', 409, 'pull request no longer matches the exact Fleetbot lease');
  }
}

async function getPull(owner: string, repo: string, number: number, token: string): Promise<PullRequestWitness> {
  const result = await fetchJson<unknown>(`${GH_API}/repos/${owner}/${repo}/pulls/${number}`, token);
  return pullWitness(result.body);
}

async function createCommit(
  owner: string,
  repo: string,
  token: string,
  parentSha: string,
  payload: CommitPayload,
  authorship: FleetbotAuthorship,
  receiptId: string,
  app: GitHubAppIdentity,
  mutated: () => void,
): Promise<string> {
  const parent = await fetchJson<{ tree?: { sha?: string } }>(`${GH_API}/repos/${owner}/${repo}/git/commits/${parentSha}`, token);
  const parentTree = parent.body?.tree?.sha;
  if (!isGitSha(parentTree)) failure('GITHUB_RESPONSE_INVALID', 502, 'parent commit has no valid tree');

  const entries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
  for (let start = 0; start < payload.changes.length; start += 10) {
    const batch = payload.changes.slice(start, start + 10);
    const resolved = await Promise.all(batch.map(async (change) => {
      if (change.delete) return { path: change.path, mode: change.mode ?? '100644', type: 'blob' as const, sha: null };
      const blob = await fetchJson<{ sha?: string }>(`${GH_API}/repos/${owner}/${repo}/git/blobs`, token, {
        method: 'POST',
        body: { content: change.contentBase64, encoding: 'base64' },
        mutation: mutated,
      });
      if (!isGitSha(blob.body?.sha)) failure('GITHUB_RESPONSE_INVALID', 502, 'created blob has no valid SHA', true);
      return { path: change.path, mode: change.mode ?? '100644', type: 'blob' as const, sha: blob.body.sha.toLowerCase() };
    }));
    entries.push(...resolved);
  }

  const tree = await fetchJson<{ sha?: string }>(`${GH_API}/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: { base_tree: parentTree, tree: entries },
    mutation: mutated,
  });
  if (!isGitSha(tree.body?.sha) || tree.body.sha.toLowerCase() !== payload.sourceTreeSha) {
    failure('SOURCE_TREE_MISMATCH', 409, 'GitHub tree does not match the daemon-verified source tree', true);
  }
  const message = commitMessage(payload, authorship, receiptId);
  const identity = { name: app.botName, email: app.botEmail, date: new Date(payload.sourceCommittedAt * 1000).toISOString() };
  const commit = await fetchJson<{ sha?: string }>(`${GH_API}/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: { message, tree: payload.sourceTreeSha, parents: [parentSha], author: identity, committer: identity },
    mutation: mutated,
  });
  if (!isGitSha(commit.body?.sha)) failure('GITHUB_RESPONSE_INVALID', 502, 'created commit has no valid SHA', true);
  const commitSha = commit.body.sha.toLowerCase();
  const observed = await fetchJson<{
    sha?: string;
    message?: string;
    tree?: { sha?: string };
    parents?: Array<{ sha?: string }>;
    author?: { name?: string; email?: string };
    committer?: { name?: string; email?: string };
  }>(`${GH_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, token);
  const row = observed.body;
  if (row?.sha?.toLowerCase() !== commitSha || row.message !== message || row.tree?.sha?.toLowerCase() !== payload.sourceTreeSha
      || row.parents?.length !== 1 || row.parents[0]?.sha?.toLowerCase() !== parentSha
      || row.author?.name !== app.botName || row.author?.email !== app.botEmail
      || row.committer?.name !== app.botName || row.committer?.email !== app.botEmail) {
    failure('COMMIT_ATTRIBUTION_MISMATCH', 409, 'GitHub did not preserve exact Fleetbot commit provenance', true);
  }
  return commitSha;
}

async function ensureBranch(
  owner: string,
  repo: string,
  branch: string,
  shaValue: string,
  token: string,
  mutated: () => void,
): Promise<'created' | 'reused'> {
  const url = `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  let current = await fetchJson<{ object?: { sha?: string } }>(url, token, { allow404: true });
  if (current.status === 404) {
    try {
      await fetchJson(`${GH_API}/repos/${owner}/${repo}/git/refs`, token, {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: shaValue },
        mutation: mutated,
      });
    } catch (error) {
      if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
    }
    current = await fetchJson<{ object?: { sha?: string } }>(url, token);
    if (current.body?.object?.sha?.toLowerCase() !== shaValue) {
      failure('BRANCH_CREATE_AMBIGUOUS', 409, 'created branch did not read back at the exact commit', true);
    }
    return 'created';
  }
  if (current.body?.object?.sha?.toLowerCase() !== shaValue) {
    failure('BRANCH_ALREADY_EXISTS', 409, 'deterministic publisher branch already points elsewhere');
  }
  return 'reused';
}

async function advanceBranch(
  owner: string,
  repo: string,
  branch: string,
  expectedOld: string,
  next: string,
  token: string,
  mutated: () => void,
): Promise<'updated' | 'reused'> {
  const url = `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const before = await fetchJson<{ object?: { sha?: string } }>(url, token);
  const current = before.body?.object?.sha?.toLowerCase();
  if (current === next) return 'reused';
  if (current !== expectedOld) failure('BRANCH_CAS_FAILED', 409, 'publisher branch moved since the daemon observed it');
  try {
    await fetchJson(url, token, {
      method: 'PATCH',
      body: { sha: next, force: false },
      mutation: mutated,
    });
  } catch (error) {
    if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
  }
  const after = await fetchJson<{ object?: { sha?: string } }>(url, token);
  if (after.body?.object?.sha?.toLowerCase() !== next) {
    failure('BRANCH_UPDATE_AMBIGUOUS', 409, 'publisher branch update did not read back at the exact commit', true);
  }
  return 'updated';
}

async function findPullByBranch(
  owner: string,
  repo: string,
  branch: string,
  base: string,
  token: string,
): Promise<PullRequestWitness | null> {
  const query = new URLSearchParams({ state: 'all', head: `${owner}:${branch}`, base });
  const rows = await listAllPages<unknown>(`${GH_API}/repos/${owner}/${repo}/pulls?${query}`, token);
  if (rows.length > 1) {
    failure('PULL_REQUEST_AMBIGUOUS', 409, 'deterministic branch has an ambiguous pull-request history');
  }
  return rows.length === 1 ? pullWitness(rows[0]) : null;
}

async function publish(
  request: FleetbotActionRequest,
  payload: PublishPayload,
  owner: string,
  repo: string,
  token: string,
  app: GitHubAppIdentity,
  accountUserId: string,
  mutated: () => void,
): Promise<ExecutionResult> {
  const baseRef = await fetchJson<{ object?: { sha?: string } }>(
    `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(payload.baseBranch)}`,
    token,
  );
  if (baseRef.body?.object?.sha?.toLowerCase() !== payload.baseSha) {
    failure('STALE_BASE', 409, 'base branch moved since the daemon verified the source');
  }
  const receiptId = fleetbotReceiptId(request.idempotencyKey!);
  const githubHead = await createCommit(
    owner, repo, token, payload.baseSha, payload, request.authorship!, receiptId, app, mutated,
  );
  const branch = expectedBranch(request, accountUserId);
  const branchResult = await ensureBranch(owner, repo, branch, githubHead, token, mutated);
  const body = stampPullRequestBody({
    body: payload.body,
    authorship: request.authorship!,
    receiptId,
    sourceHeadSha: payload.sourceHeadSha,
  });
  let pull = await findPullByBranch(owner, repo, branch, payload.baseBranch, token);
  let result: FleetbotReceipt['result'] = branchResult;
  if (!pull) {
    try {
      await fetchJson(`${GH_API}/repos/${owner}/${repo}/pulls`, token, {
        method: 'POST',
        body: { title: payload.title, body, head: branch, base: payload.baseBranch, draft: payload.draft },
        mutation: mutated,
      });
    } catch (error) {
      if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
    }
    pull = await findPullByBranch(owner, repo, branch, payload.baseBranch, token);
    if (!pull) failure('PULL_REQUEST_CREATE_AMBIGUOUS', 409, 'pull request creation did not read back', true);
    result = 'created';
  }
  verifyPull(pull, {
    repository: request.repository,
    app,
    baseBranch: payload.baseBranch,
    baseSha: payload.baseSha,
    headSha: githubHead,
    headRef: branch,
    draft: payload.draft,
    title: payload.title,
    body,
  });
  return {
    resourceUrl: pull.htmlUrl,
    resourceNumber: pull.number,
    publishedBranch: branch,
    githubHeadSha: githubHead,
    result,
  };
}

async function exactExistingPull(
  request: FleetbotActionRequest,
  payload: ExistingPayload,
  owner: string,
  repo: string,
  token: string,
  app: GitHubAppIdentity,
): Promise<PullRequestWitness> {
  const pull = await getPull(owner, repo, payload.pullRequestNumber, token);
  verifyPull(pull, {
    repository: request.repository,
    app,
    baseBranch: payload.baseBranch,
    baseSha: payload.baseSha,
    headSha: payload.expectedGithubHeadSha,
    number: payload.pullRequestNumber,
  });
  if (!pull.headRef.startsWith('pd-agent/')) {
    failure('PULL_REQUEST_NOT_OWNED', 403, 'Fleetbot can mutate only branches created by the governed publisher');
  }
  return pull;
}

async function updatePull(
  request: FleetbotActionRequest,
  payload: UpdatePayload,
  owner: string,
  repo: string,
  token: string,
  app: GitHubAppIdentity,
  mutated: () => void,
): Promise<ExecutionResult> {
  const pull = await exactExistingPull(request, payload, owner, repo, token, app);
  const receiptId = fleetbotReceiptId(request.idempotencyKey!);
  const githubHead = await createCommit(
    owner, repo, token, payload.expectedGithubHeadSha, payload,
    request.authorship!, receiptId, app, mutated,
  );
  const branchResult = await advanceBranch(
    owner, repo, pull.headRef, payload.expectedGithubHeadSha, githubHead, token, mutated,
  );
  const body = stampPullRequestBody({
    body: payload.body,
    authorship: request.authorship!,
    receiptId,
    sourceHeadSha: payload.sourceHeadSha,
  });
  try {
    await fetchJson(`${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}`, token, {
      method: 'PATCH',
      body: { title: payload.title, body },
      mutation: mutated,
    });
  } catch (error) {
    if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
  }
  const observed = await getPull(owner, repo, pull.number, token);
  verifyPull(observed, {
    repository: request.repository,
    app,
    baseBranch: payload.baseBranch,
    baseSha: payload.baseSha,
    headSha: githubHead,
    number: pull.number,
    headRef: pull.headRef,
    title: payload.title,
    body,
  });
  return {
    resourceUrl: observed.htmlUrl,
    resourceNumber: observed.number,
    publishedBranch: observed.headRef,
    githubHeadSha: githubHead,
    result: branchResult === 'reused' ? 'reused' : 'updated',
  };
}

async function listIssueComments(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<Array<{ id?: number; body?: string; html_url?: string; user?: { login?: string } }>> {
  return listAllPages(`${GH_API}/repos/${owner}/${repo}/issues/${number}/comments`, token);
}

async function executeExisting(
  request: FleetbotActionRequest,
  payload: ExistingPayload | ReviewersPayload | MessagePayload,
  owner: string,
  repo: string,
  token: string,
  app: GitHubAppIdentity,
  mutated: () => void,
): Promise<ExecutionResult> {
  let pull = await exactExistingPull(request, payload, owner, repo, token, app);
  let result: FleetbotReceipt['result'] = 'observed';
  const receiptId = fleetbotReceiptId(request.idempotencyKey!);
  const marker = fleetbotMutationMarker(receiptId);
  if (request.operation === 'pull-request.ready') {
    if (pull.draft) {
      try {
        await graphql(token,
          'mutation($id:ID!,$clientMutationId:String!){markPullRequestReadyForReview(input:{pullRequestId:$id,clientMutationId:$clientMutationId}){pullRequest{id isDraft}}}',
          { id: pull.nodeId, clientMutationId: request.idempotencyKey }, mutated);
      } catch (error) {
        if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
      }
      result = 'updated';
      pull = await getPull(owner, repo, pull.number, token);
      verifyPull(pull, { repository: request.repository, app, baseBranch: payload.baseBranch, baseSha: payload.baseSha, headSha: payload.expectedGithubHeadSha, number: payload.pullRequestNumber, draft: false });
    } else result = 'reused';
  } else if (request.operation === 'pull-request.request-reviewers') {
    const reviewers = payload as ReviewersPayload;
    const requested = await fetchJson<{
      users?: Array<{ login?: string }>;
      teams?: Array<{ slug?: string }>;
    }>(`${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}/requested_reviewers`, token);
    const currentUsers = new Set((requested.body?.users ?? []).map((entry) => entry.login?.toLowerCase()));
    const currentTeams = new Set((requested.body?.teams ?? []).map((entry) => entry.slug?.toLowerCase()));
    const missingUsers = reviewers.reviewers.filter((name) => !currentUsers.has(name.toLowerCase()));
    const missingTeams = reviewers.teamReviewers.filter((name) => !currentTeams.has(name.toLowerCase()));
    if (missingUsers.length || missingTeams.length) {
      try {
        await fetchJson(`${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}/requested_reviewers`, token, {
          method: 'POST', body: { reviewers: missingUsers, team_reviewers: missingTeams }, mutation: mutated,
        });
      } catch (error) {
        if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
      }
      result = 'updated';
      const observed = await fetchJson<{ users?: Array<{ login?: string }>; teams?: Array<{ slug?: string }> }>(
        `${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}/requested_reviewers`, token,
      );
      const users = new Set((observed.body?.users ?? []).map((entry) => entry.login?.toLowerCase()));
      const teams = new Set((observed.body?.teams ?? []).map((entry) => entry.slug?.toLowerCase()));
      if (reviewers.reviewers.some((name) => !users.has(name.toLowerCase()))
          || reviewers.teamReviewers.some((name) => !teams.has(name.toLowerCase()))) {
        failure('REVIEWER_REQUEST_AMBIGUOUS', 409, 'reviewer request did not read back exactly', true);
      }
    } else result = 'reused';
  } else if (request.operation === 'pull-request.comment') {
    const message = payload as MessagePayload;
    const body = stampFleetbotMessage({ body: message.body, authorship: request.authorship!, receiptId });
    let comment = (await listIssueComments(owner, repo, pull.number, token))
      .find((entry) => entry.body?.includes(marker) && entry.body === body
        && entry.user?.login?.toLowerCase() === app.botName.toLowerCase());
    if (!comment) {
      try {
        await fetchJson(`${GH_API}/repos/${owner}/${repo}/issues/${pull.number}/comments`, token, {
          method: 'POST', body: { body }, mutation: mutated,
        });
      } catch (error) {
        if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
      }
      comment = (await listIssueComments(owner, repo, pull.number, token))
        .find((entry) => entry.body?.includes(marker) && entry.body === body
          && entry.user?.login?.toLowerCase() === app.botName.toLowerCase());
      if (!comment) failure('COMMENT_CREATE_AMBIGUOUS', 409, 'comment did not read back exactly', true);
      result = 'created';
    } else result = 'reused';
  } else if (request.operation === 'pull-request.review-reply') {
    const message = payload as MessagePayload;
    const body = stampFleetbotMessage({ body: message.body, authorship: request.authorship!, receiptId });
    const commentsUrl = `${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}/comments`;
    const existing = await listAllPages<{ body?: string; in_reply_to_id?: number; user?: { login?: string } }>(commentsUrl, token);
    let found = existing.some((entry) => entry.body?.includes(marker) && entry.body === body && entry.in_reply_to_id === message.commentId
      && entry.user?.login?.toLowerCase() === app.botName.toLowerCase());
    if (!found) {
      try {
        await fetchJson(`${GH_API}/repos/${owner}/${repo}/pulls/${pull.number}/comments/${message.commentId}/replies`, token, {
          method: 'POST', body: { body }, mutation: mutated,
        });
      } catch (error) {
        if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
      }
      const observed = await listAllPages<{ body?: string; in_reply_to_id?: number; user?: { login?: string } }>(commentsUrl, token);
      found = observed.some((entry) => entry.body?.includes(marker) && entry.body === body && entry.in_reply_to_id === message.commentId
        && entry.user?.login?.toLowerCase() === app.botName.toLowerCase());
      if (!found) failure('REVIEW_REPLY_AMBIGUOUS', 409, 'review reply did not read back exactly', true);
      result = 'created';
    } else result = 'reused';
  } else if (request.operation === 'pull-request.enqueue') {
    if (pull.draft) failure('PULL_REQUEST_NOT_READY', 409, 'draft pull request cannot enter the merge queue');
    const queueQuery = 'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){id headRefOid mergeQueueEntry{id}}}}';
    type QueueData = { repository?: { pullRequest?: { id?: string; headRefOid?: string; mergeQueueEntry?: { id?: string } | null } | null } };
    let state = await graphql<QueueData>(token, queueQuery, { owner, repo, number: pull.number });
    let node = state.repository?.pullRequest;
    if (!node || node.id !== pull.nodeId || node.headRefOid?.toLowerCase() !== payload.expectedGithubHeadSha) {
      failure('PULL_REQUEST_SCOPE_CHANGED', 409, 'merge queue preflight no longer matches the exact head');
    }
    if (!node.mergeQueueEntry?.id) {
      try {
        await graphql(token,
          'mutation($input:EnqueuePullRequestInput!){enqueuePullRequest(input:$input){mergeQueueEntry{id}}}',
          { input: { pullRequestId: pull.nodeId, expectedHeadOid: payload.expectedGithubHeadSha, jump: false, clientMutationId: request.idempotencyKey } },
          mutated);
      } catch (error) {
        if (!(error instanceof PublisherFailure) || !error.ambiguous) throw error;
      }
      state = await graphql<QueueData>(token, queueQuery, { owner, repo, number: pull.number });
      node = state.repository?.pullRequest;
      if (!node?.mergeQueueEntry?.id || node.headRefOid?.toLowerCase() !== payload.expectedGithubHeadSha) {
        failure('MERGE_QUEUE_AMBIGUOUS', 409, 'merge queue admission did not read back exactly', true);
      }
      result = 'updated';
    } else result = 'reused';
  }
  return {
    resourceUrl: pull.htmlUrl,
    resourceNumber: pull.number,
    publishedBranch: pull.headRef,
    githubHeadSha: pull.headSha,
    result,
  };
}

async function execute(
  request: FleetbotActionRequest,
  payload: ParsedPayload,
  token: string,
  app: GitHubAppIdentity,
  accountUserId: string,
  mutated: () => void,
): Promise<ExecutionResult> {
  const [owner, repo] = request.repository.split('/') as [string, string];
  if (request.operation === 'pull-request.publish') {
    return publish(request, payload as PublishPayload, owner, repo, token, app, accountUserId, mutated);
  }
  if (request.operation === 'pull-request.update') {
    return updatePull(request, payload as UpdatePayload, owner, repo, token, app, mutated);
  }
  return executeExisting(
    request,
    payload as ExistingPayload | ReviewersPayload | MessagePayload,
    owner,
    repo,
    token,
    app,
    mutated,
  );
}

async function requireOwnedPullRequest(
  env: PublisherEnv,
  accountUserId: string,
  repository: string,
  pullRequestNumber: number,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT account_user_id
       FROM github_publisher_intents
      WHERE repository = ? AND resource_number = ? AND state = 'succeeded'
        AND operation = 'pull-request.publish'
      ORDER BY updated_at ASC LIMIT 2`,
  ).bind(repository, pullRequestNumber).all<{ account_user_id: string }>();
  if (rows.results.length !== 1 || rows.results[0]?.account_user_id !== accountUserId) {
    failure('PULL_REQUEST_NOT_OWNED', 403, 'this account has no unique governed publication receipt for the pull request');
  }
}

async function signedReceipt(
  env: PublisherEnv,
  request: FleetbotActionRequest,
  user: UserRow,
  result: ExecutionResult,
  cleanup: FleetbotReceipt['tokenCleanup'],
  now: number,
  app: GitHubAppIdentity,
): Promise<FleetbotReceipt> {
  const unsigned: Omit<FleetbotReceipt, 'signature'> = {
    schema: FLEETBOT_RECEIPT_SCHEMA,
    receiptId: fleetbotReceiptId(request.idempotencyKey!),
    authority: 'port-daddy-relay-github-app',
    appSlug: app.slug,
    operation: request.operation,
    repository: request.repository,
    idempotencyKey: request.idempotencyKey!,
    accountUserId: user.id,
    accountGithubUserId: user.github_user_id,
    actorId: request.authorship!.actorId,
    agentId: request.authorship!.agentId,
    sessionId: request.authorship!.sessionId,
    roadmapItem: request.authorship!.roadmapItem,
    resourceUrl: result.resourceUrl,
    resourceNumber: result.resourceNumber,
    publishedBranch: result.publishedBranch,
    sourceHeadSha: 'sourceHeadSha' in (request.payload as Record<string, unknown>)
      ? String((request.payload as Record<string, unknown>).sourceHeadSha)
      : null,
    githubHeadSha: result.githubHeadSha,
    result: result.result,
    verifiedAt: now,
    relayPublicKey: pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX),
    tokenCleanup: cleanup,
  };
  const signature = await signEd25519(
    env.RELAY_ED25519_PRIVATE_KEY_HEX,
    hashHex(fleetbotReceiptPreimage(unsigned)),
  );
  return { ...unsigned, signature };
}

/** Relay route handler for governed GitHub App publication operations. */
export async function handleFleetbotPublisher(request: Request, env: PublisherEnv): Promise<Response> {
  let key: IntentKey | null = null;
  let leaseFence: number | null = null;
  let appToken: string | null = null;
  let mutationAttempted = false;
  let executionResult: ExecutionResult | undefined;
  try {
    if (request.method !== 'POST') failure('METHOD_NOT_ALLOWED', 405, 'publisher accepts POST only');
    const rawToken = bearer(request);
    const parsedBody = await readBoundedJson(request);
    const {
      request: action,
      payload,
      requestHash,
      capability,
      capabilitySignature,
    } = parseRequest(parsedBody);
    const config = configured(env);
    const now = Math.floor(Date.now() / 1000);
    const tokenHash = hashHex(rawToken);
    const accountAuthority = await resolveUserTokenReadOnly(env.DB, tokenHash, now);
    if (!accountAuthority) failure('PUBLISHER_REAUTH_REQUIRED', 401, 'sign in again to authorize App publication');
    await verifyAndConsumeCapability(
      env,
      capability,
      capabilitySignature,
      action,
      payload,
      requestHash,
      tokenHash,
      accountAuthority.id,
      now,
    );
    const account = await credentialForAccount(env, tokenHash, now);
    if (account.user.id !== accountAuthority.id) {
      failure('CREDENTIAL_RACE', 409, 'account authority changed during publisher admission');
    }
    const [owner, repo] = action.repository.split('/') as [string, string];
    const installationId = await getRepoInstallationId(config.appId, config.privateKey, owner, repo, env.KV, true);
    await authorizeExactRepository(installationId, action.repository, account.credential.accessToken);
    key = {
      accountUserId: account.user.id,
      accountGithubUserId: account.user.github_user_id,
      installationId,
      repository: action.repository,
      scopeSha: (payload as CommonPayload).baseSha,
      idempotencyKey: action.idempotencyKey!,
      requestHash,
      operation: action.operation,
      authorship: action.authorship!,
    };
    if (action.operation !== 'pull-request.publish') {
      await requireOwnedPullRequest(
        env,
        account.user.id,
        action.repository,
        (payload as ExistingPayload).pullRequestNumber,
      );
    }
    const reservation = await reserveIntent(env, key, now);
    if ('reused' in reservation) return json(200, { code: 'OK', receipt: reservation.reused });
    leaseFence = reservation.fence;

    const app = await getGitHubAppIdentity(config.appId, config.privateKey, env.KV);
    const minted = await mintRepositoryInstallationToken(
      config.appId,
      config.privateKey,
      installationId,
      owner,
      repo,
      permissionsFor(action.operation),
    );
    appToken = minted.token;
    executionResult = await execute(action, payload, appToken, app, account.user.id, () => { mutationAttempted = true; });
    const cleanup = await revokeInstallationToken(appToken);
    appToken = null;
    const receipt = await signedReceipt(env, action, account.user, executionResult, cleanup ? 'confirmed' : 'unconfirmed', now, app);
    if (!cleanup) {
      await finishIntent(env, key, leaseFence, 'ambiguous', now, {
        result: executionResult,
        receipt,
        errorCode: 'TOKEN_CLEANUP_UNCONFIRMED',
      });
      return json(502, {
        code: 'TOKEN_CLEANUP_UNCONFIRMED',
        error: 'GitHub accepted the action but scoped token cleanup is unconfirmed',
        receipt,
      });
    }
    await finishIntent(env, key, leaseFence, 'succeeded', now, { result: executionResult, receipt });
    return json(receipt.result === 'created' ? 201 : 200, { code: 'OK', receipt });
  } catch (error) {
    const cleanupConfirmed = appToken ? await revokeInstallationToken(appToken) : true;
    const known = error instanceof PublisherFailure
      ? error
      : new PublisherFailure('PUBLISHER_FAILED', 500, 'publisher failed without exposing credential or transport details');
    if (key && leaseFence !== null) {
      try {
        await finishIntent(
          env,
          key,
          leaseFence,
          known.ambiguous || mutationAttempted || !cleanupConfirmed ? 'ambiguous' : 'failed',
          Math.floor(Date.now() / 1000),
          { result: executionResult, errorCode: !cleanupConfirmed ? 'TOKEN_CLEANUP_UNCONFIRMED' : known.code },
        );
      } catch { /* preserve the safe response; D1 outage is already failure */ }
    }
    return json(known.status, { code: known.code, error: known.message });
  }
}

/** Narrow test seam for hostile authority, lease, and transport cases. */
export const __fleetbotPublisherTest = {
  parseRequest,
  readBoundedJson,
  verifyAndConsumeCapability,
  reserveIntent,
  finishIntent,
  listAllPages,
  executeExisting,
  maxOuterRequestBytes: MAX_OUTER_REQUEST_BYTES,
};
