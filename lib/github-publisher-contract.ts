/**
 * Runtime-neutral contract for the Fleetbot GitHub App publisher.
 *
 * This module deliberately contains no Node or Workers dependencies. The local
 * daemon and Relay import the same vocabulary and canonicalization rules so an
 * agent cannot exploit a parser difference between the identity gate and the
 * component holding the GitHub App key.
 */

import {
  fleetbotMutationMarker as sharedMutationMarker,
  stampPullRequestBody as sharedPullRequestBody,
  stampFleetbotMessage as sharedFleetbotMessage,
} from './github-publisher-stamp.mjs';

export const FLEETBOT_ACTION_SCHEMA = 'port-daddy.fleetbot-action.v1' as const;
export const FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA = 'port-daddy.fleetbot-publisher-capability.v2' as const;
export const FLEETBOT_RECEIPT_SCHEMA = 'port-daddy.fleetbot-receipt.v2' as const;
export const FLEETBOT_RECEIPT_READ_SCHEMA = 'port-daddy.publisher-receipt-read.v1' as const;
export const FLEETBOT_RECEIPT_RECOVERY_PATH = '/v1/fleetbot/publisher-receipts/recover' as const;

export type FleetbotOperation =
  | 'pull-request.publish'
  | 'pull-request.update'
  | 'pull-request.ready'
  | 'pull-request.request-reviewers'
  | 'pull-request.comment'
  | 'pull-request.review-reply'
  | 'pull-request.resolve-review-thread'
  | 'pull-request.enqueue'
  | 'pull-request.inspect';

/** Effects that may address an exact ordinary PR without changing its lifecycle state. */
export function isFleetbotConversationalOperation(operation: FleetbotOperation): boolean {
  return operation === 'pull-request.comment' || operation === 'pull-request.review-reply';
}

export interface FleetbotTreeChange {
  path: string;
  mode?: '100644' | '100755' | '120000';
  contentBase64?: string;
  delete?: true;
}

export interface FleetbotAuthorship {
  /** Daemon-minted soul, copied from the verified credential verdict. */
  actorId: string;
  /** Human-readable owner stored on the active session. */
  agentId: string;
  sessionId: string;
  purpose: string;
  /** Canonical daemon project/harbor scope stored on the session. */
  identityProject: string;
  roadmapItem: string | null;
  sidequestReason: string | null;
  worktreeId: string | null;
  sourceBranch: string | null;
}

/**
 * One logical GitHub publisher authority grant minted by the daemon identity.
 * Relay resolves the daemon key from its live identity registry; the public key
 * carried by a caller is never authority. Exact retries may reuse the same
 * nonce only when the canonical request and account binding are byte-identical.
 */
export interface FleetbotPublisherCapability {
  schema: typeof FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA;
  /** A Relay-side standing grant reference. It is not a bearer credential. */
  grantId: string;
  /** Exact monotone version read by the workload before it signed this request. */
  grantEpoch: number;
  daemonFingerprint: string;
  signingKeyGeneration: number;
  sessionId: string;
  repository: string;
  operation: FleetbotOperation;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  requestHash: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface FleetbotActionRequest {
  schema: typeof FLEETBOT_ACTION_SCHEMA;
  operation: FleetbotOperation;
  repository: string;
  payload: Record<string, unknown>;
  /** Supplied to the daemon as a selector; the daemon proves ownership. */
  sessionId: string;
  /** Added by the daemon after credential and session-owner verification. */
  authorship?: FleetbotAuthorship;
  /** Added by the daemon from the canonical request after authorship is bound. */
  idempotencyKey?: string;
  /** Daemon-signed, exact-scope, one-logical-use authority. */
  capability: FleetbotPublisherCapability;
  /** Raw Ed25519 signature, hex, over the capability preimage digest. */
  capabilitySignature: string;
}

export interface FleetbotReceipt {
  schema: typeof FLEETBOT_RECEIPT_SCHEMA;
  receiptId: string;
  authority: 'port-daddy-relay-github-app';
  appSlug: string;
  operation: FleetbotOperation;
  repository: string;
  idempotencyKey: string;
  /** Relay-authenticated account scope; never supplied by the daemon. */
  accountUserId: string;
  accountGithubUserId: number;
  /** Durable answer to both "why was this allowed?" and "which grant changed GitHub?". */
  authorizedBy: {
    grantId: string;
    grantEpoch: number;
    surface: 'publisher';
  };
  admission: 'standing-publisher-grant';
  actorId: string;
  agentId: string;
  sessionId: string;
  roadmapItem: string | null;
  resourceUrl: string;
  resourceNumber: number | null;
  publishedBranch: string | null;
  sourceHeadSha: string | null;
  githubHeadSha: string | null;
  result: 'created' | 'updated' | 'reused' | 'observed';
  verifiedAt: number;
  relayPublicKey: string;
  signature: string;
  tokenCleanup: 'confirmed' | 'unconfirmed';
}

/**
 * Sanitized, durable identity of one publisher intent. Relay stores this exact
 * binding before it obtains a GitHub token or performs an external effect.
 * It contains no credential, signature, request body, or GitHub token.
 */
export interface FleetbotReceiptRecoveryBinding {
  grantId: string;
  grantEpoch: number;
  repository: string;
  operation: FleetbotOperation;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  sessionId: string;
  requestHash: string;
  idempotencyKey: string;
}

/** A fresh, read-only authorization proof for recovering an existing receipt. */
export interface FleetbotReceiptReadProof {
  schema: typeof FLEETBOT_RECEIPT_READ_SCHEMA;
  method: 'POST';
  path: typeof FLEETBOT_RECEIPT_RECOVERY_PATH;
  daemonFingerprint: string;
  signingKeyGeneration: number;
  issuedAt: number;
  nonce: string;
  binding: FleetbotReceiptRecoveryBinding;
}

export interface FleetbotReceiptRecoveryEnvelope {
  proof: FleetbotReceiptReadProof;
  /** Raw Ed25519 signature, hex, over SHA-256 of the proof preimage. */
  proofSignature: string;
}

export interface ContractError {
  code: string;
  error: string;
}

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRAILER_RE = /^Roadmap-Item\s*:\s*(.+)$/gim;

/** Stable JSON representation used as the cross-runtime idempotency preimage. */
export function stableJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return JSON.stringify(normalize(value));
}

/** Canonical request portion committed by the idempotency key on both planes. */
export function fleetbotIdempotencyPreimage(
  request: FleetbotActionRequest,
): string {
  return stableJson({
    schema: request.schema,
    operation: request.operation,
    repository: request.repository,
    payload: request.payload,
    sessionId: request.sessionId,
    authorship: request.authorship,
  });
}

/** Stable capability bytes. Callers sign SHA-256 of this string. */
export function fleetbotPublisherCapabilityPreimage(
  capability: FleetbotPublisherCapability,
): string {
  return stableJson(capability);
}

/** Stable storage comparison bytes nested inside the domain-separated proof. */
export function fleetbotReceiptRecoveryBindingPreimage(
  binding: FleetbotReceiptRecoveryBinding,
): string {
  return stableJson(binding);
}

/** Stable receipt-read proof bytes. Callers sign SHA-256 of this string. */
export function fleetbotReceiptReadProofPreimage(
  proof: FleetbotReceiptReadProof,
): string {
  return stableJson(proof);
}

export function isGitSha(value: unknown): value is string {
  return typeof value === 'string' && SHA_RE.test(value);
}

export function isRepository(value: unknown): value is string {
  return typeof value === 'string' && REPOSITORY_RE.test(value);
}

export function isSafePublisherIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_RE.test(value);
}

export function safeRepositoryPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

/** Return every roadmap trailer, not merely the last one. */
export function roadmapTrailers(body: string): string[] {
  return [...body.matchAll(TRAILER_RE)].map((match) => (match[1] ?? '').trim());
}

/**
 * Require exactly one PR roadmap trailer and bind it to the daemon-stored rent.
 * A session linked to a roadmap cannot opt out; a sidequest cannot claim a slug.
 */
export function validateRoadmapTrailer(
  body: string,
  authorship: Pick<FleetbotAuthorship, 'roadmapItem' | 'sidequestReason'>,
): ContractError | null {
  const trailers = roadmapTrailers(body);
  if (trailers.length !== 1) {
    return {
      code: 'ROADMAP_TRAILER_INVALID',
      error: 'PR body must contain exactly one Roadmap-Item trailer.',
    };
  }
  const value = trailers[0]!;
  if (authorship.roadmapItem) {
    const slug = value.split(/[\s—–]/)[0];
    if (slug !== authorship.roadmapItem) {
      return {
        code: 'ROADMAP_OWNERSHIP_MISMATCH',
        error: `PR trailer must name the active session roadmap item "${authorship.roadmapItem}".`,
      };
    }
    return null;
  }
  const reason = value.match(/^none(?:\s*[—–:-]\s*|\s+)(.+)$/i)?.[1]?.trim();
  if (!authorship.sidequestReason || !reason || reason.length < 12
      || reason.toLocaleLowerCase('en-US') !== authorship.sidequestReason.trim().toLocaleLowerCase('en-US')) {
    return {
      code: 'ROADMAP_OPT_OUT_INVALID',
      error: 'Sidequest PRs require exactly one Roadmap-Item: none — <specific reason> trailer.',
    };
  }
  return null;
}

/** Stable, machine-readable GitHub mutation marker used for exact readback. */
export function fleetbotMutationMarker(receiptId: string): string {
  return sharedMutationMarker(receiptId);
}

/** Insert an idempotent visible signature immediately before the roadmap trailer. */
export function stampPullRequestBody(input: {
  body: string;
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}): string {
  return sharedPullRequestBody(input);
}

/** Append the same traceable signature to comments and review replies. */
export function stampFleetbotMessage(input: {
  body: string;
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}): string {
  return sharedFleetbotMessage(input);
}

export function fleetbotReceiptId(idempotencyKey: string): string {
  return `github_receipt_${idempotencyKey.replace(/^pd-gh-/, '').slice(0, 32)}`;
}

/** Exact signed receipt payload. The signature field can never sign itself. */
export function fleetbotReceiptPreimage(
  receipt: Omit<FleetbotReceipt, 'signature'> | FleetbotReceipt,
): string {
  const { signature: _signature, ...unsigned } = receipt as FleetbotReceipt;
  return stableJson(unsigned);
}
