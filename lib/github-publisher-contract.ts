/**
 * Runtime-neutral contract for the Fleetbot GitHub App publisher.
 *
 * This module deliberately contains no Node or Workers dependencies. The local
 * daemon and Relay import the same vocabulary and canonicalization rules so an
 * agent cannot exploit a parser difference between the identity gate and the
 * component holding the GitHub App key.
 */

export const FLEETBOT_ACTION_SCHEMA = 'port-daddy.fleetbot-action.v1' as const;
export const FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA = 'port-daddy.fleetbot-publisher-capability.v1' as const;
export const FLEETBOT_RECEIPT_SCHEMA = 'port-daddy.fleetbot-receipt.v1' as const;

export type FleetbotOperation =
  | 'pull-request.publish'
  | 'pull-request.update'
  | 'pull-request.ready'
  | 'pull-request.request-reviewers'
  | 'pull-request.comment'
  | 'pull-request.review-reply'
  | 'pull-request.enqueue'
  | 'pull-request.inspect';

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
  accountTokenHash: string;
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

export interface ContractError {
  code: string;
  error: string;
}

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRAILER_RE = /^Roadmap-Item\s*:\s*(.+)$/gim;
const PROVENANCE_START = '<!-- port-daddy:fleetbot-provenance:start -->';
const PROVENANCE_END = '<!-- port-daddy:fleetbot-provenance:end -->';

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

function stripExistingProvenance(body: string): string {
  const start = body.indexOf(PROVENANCE_START);
  if (start < 0) return body.trim();
  const end = body.indexOf(PROVENANCE_END, start);
  if (end < 0) return body.trim();
  return `${body.slice(0, start)}${body.slice(end + PROVENANCE_END.length)}`.trim();
}

function provenanceBlock(input: {
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}): string {
  const a = input.authorship;
  const source = input.sourceHeadSha ? `\n> Source head: \`${input.sourceHeadSha}\`` : '';
  const roadmap = a.roadmapItem
    ? `Roadmap: \`${a.roadmapItem}\``
    : 'Roadmap: explicit sidequest';
  return [
    PROVENANCE_START,
    fleetbotMutationMarker(input.receiptId),
    '> **Published by Port Daddy Fleetbot**',
    `> Responsible agent: \`${a.agentId}\``,
    `> Session: \`${a.sessionId}\` · ${roadmap}${source}`,
    `> Relay receipt: \`${input.receiptId}\``,
    PROVENANCE_END,
  ].join('\n');
}

/** Stable, machine-readable GitHub mutation marker used for exact readback. */
export function fleetbotMutationMarker(receiptId: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(receiptId)) {
    throw new Error('Fleetbot receipt id is invalid');
  }
  return `<!-- port-daddy:fleetbot-mutation:${receiptId.toLowerCase()} -->`;
}

/** Insert an idempotent visible signature immediately before the roadmap trailer. */
export function stampPullRequestBody(input: {
  body: string;
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}): string {
  const clean = stripExistingProvenance(input.body);
  const lines = clean.split(/\r?\n/);
  const trailerIndex = lines.findIndex((line) => /^Roadmap-Item\s*:/i.test(line.trim()));
  const block = provenanceBlock(input);
  if (trailerIndex < 0) return `${clean}\n\n${block}\n`;
  const before = lines.slice(0, trailerIndex).join('\n').trimEnd();
  const after = lines.slice(trailerIndex).join('\n').trimStart();
  return `${before}\n\n${block}\n\n${after}\n`;
}

/** Append the same traceable signature to comments and review replies. */
export function stampFleetbotMessage(input: {
  body: string;
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}): string {
  const clean = stripExistingProvenance(input.body);
  return `${clean}\n\n${provenanceBlock(input)}\n`;
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
