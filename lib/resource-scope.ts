/**
 * Resource-scope policy kernel.
 *
 * This module is deliberately storage- and transport-agnostic. It does not mint
 * an identity, credential, macaroon, or scope id. Callers resolve the opaque ids
 * from an authoritative store, verify the existing actor credential and
 * macaroon, then pass the resulting immutable records here for one fail-closed
 * policy decision.
 *
 * The kernel exists to make ambient similarity irrelevant: the same user,
 * device, checkout owner, display project, cwd, or branch confers no authority
 * over another repository. Hosted repositories use an immutable forge numeric
 * id. Local git repositories and non-git roots use a daemon-minted UUID bound to
 * the device/inode portion of the filesystem identity already defined by
 * workspace-identity.ts; canonical paths remain inspectable provenance only.
 */

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { SoulClass } from './actor-souls.js';
import {
  assessEnvelope,
  parseEnvelope,
  type EnvelopeAction,
  type HarborEnvelope,
} from './harbor-envelope.js';
import {
  checkCaveat,
  narrows,
  parseCaveat,
} from './macaroon/caveats.js';
import type { RequestContext } from './macaroon/types.js';
import type { WorkspaceIdentity } from './workspace-identity.js';

// ---------------------------------------------------------------------------
// Authority and scope records
// ---------------------------------------------------------------------------

export type RepositoryAuthorityRef =
  | {
      kind: 'forge';
      /** Canonical lowercase forge authority, e.g. github.com. */
      forge: string;
      /** Immutable positive numeric repository id, never owner/name. */
      repositoryId: string;
    }
  | {
      kind: 'local-git';
      /** Daemon-minted UUID for this local repository authority. */
      localRepositoryId: string;
      /** Canonical git-common-dir identity shared deliberately by worktrees. */
      gitCommonDir: WorkspaceIdentity;
    }
  | {
      kind: 'local-root';
      /** Daemon-minted UUID for this non-git project root. */
      localRepositoryId: string;
      /** Canonical non-git root identity. */
      root: WorkspaceIdentity;
    };

export type ResourceWorld =
  | { kind: 'repository'; id: string }
  | { kind: 'worktree'; id: string; workspace: WorkspaceIdentity }
  | { kind: 'ref'; id: string }
  | { kind: 'commit'; id: string }
  | { kind: 'harbor'; id: string }
  | { kind: 'catalog'; id: string }
  | {
      kind: 'quarantine';
      id: string;
      /** Ambiguous rows never leave the exact local store that observed them. */
      sourceStoreId: string;
      /** Nor may operator status on a different device reveal them. */
      sourceDeviceId: string;
    };

export interface ResourceRealm {
  /** Stable account authority. This is the realm anchor. */
  accountId: string;
  /** Exact team authority when team-scoped; null for personal/public/local salvage. */
  teamId: string | null;
}

export type ResourceClassification =
  | 'public-catalog'
  | 'private-personal'
  | 'private-project'
  | 'team-shared'
  | 'operator-salvage-quarantine';

export interface ResourceScope {
  schema: 'pd.resource-scope.v1';
  /** Opaque lookup key. No authority is derived from its spelling. */
  scopeId: string;
  realm: ResourceRealm;
  harborId: string;
  projectId: string;
  repository: RepositoryAuthorityRef | null;
  world: ResourceWorld;
  classification: ResourceClassification;
  /** Explicit public/private payload invariant, checked against classification. */
  containsPrivateMaterial: boolean;
}

export type ResourceAction =
  | 'catalog.read'
  | 'search.read'
  | 'message.read'
  | 'message.write'
  | 'lock.read'
  | 'lock.write'
  | 'vector.read'
  | 'activity.read'
  | 'evidence.read'
  | 'salvage.read'
  | 'salvage.import';

export type ResourceKind =
  | 'catalog-entry'
  | 'catalog-index'
  | 'search-index'
  | 'message'
  | 'lock'
  | 'vector'
  | 'actor-activity'
  | 'session-activity'
  | 'attention-event'
  | 'evidence'
  | 'private-record'
  | 'legacy-row';

export type EmbeddingDistanceMetric = 'cosine' | 'dot-product' | 'euclidean';

export interface EmbeddingSpaceDescriptor {
  provider: string;
  model: string;
  modelRevision: string;
  modelDigest: string;
  pooling: string;
  preprocessingDigest: string;
  distanceMetric: EmbeddingDistanceMetric;
  dimensions: number;
  normalized: boolean;
}

export interface EmbeddingSpace extends EmbeddingSpaceDescriptor {
  /** Immutable registry id; compared exactly and never inferred from model name. */
  spaceId: string;
  /** Digest over every descriptor field below, recomputed during parsing. */
  descriptorDigest: string;
}

/**
 * Policy facts extracted only after the existing actor credential and macaroon
 * have verified. This is not a bearer credential or wire format: it contains no
 * secret, signature, or minting path. The source macaroon remains authoritative;
 * verifiedMacaroonCaveats preserves its append-only constraints for evaluation.
 */
export interface ResolvedScopeGrant {
  schema: 'pd.resolved-scope-grant.v1';
  grantId: string;
  /** Anchor scope. Repository anchors may cover descendant worktree worlds. */
  scopeId: string;
  /** Actor id obtained from the existing daemon-minted actor credential. */
  principalActorId: string;
  /** Exact device provenance bound by the verified grant. */
  deviceId: string;
  /** Exact embodied agent/operator perspective bound by the verified grant. */
  perspectiveId: string;
  sessionId: string;
  /** Digest of the canonical request body, never the raw request body. */
  bodyDigest: string;
  actions: readonly ResourceAction[];
  audience: string;
  expiresAtMs: number;
  remainingDelegations: number;
  /** Reuses the Harbor envelope for tool/MCP/backend/channel and cost limits. */
  envelope: HarborEnvelope;
  /** Caveats from an already-verified existing macaroon, in chain order. */
  verifiedMacaroonCaveats: readonly string[];
  /** Cross-harbor federation is absent or read-only; it never implies action. */
  federation: 'none' | 'read-only';
}

export interface VerifiedActorContext {
  /** Actor id after existing actor-credential verification. */
  actorId: string;
  soulClass: SoulClass;
  deviceId: string;
  perspectiveId: string;
}

export interface ScopedResourceRequest {
  scopeId?: string;
  grantId?: string;
  principal?: VerifiedActorContext;
  sessionId?: string;
  bodyDigest?: string;
  action: ResourceAction;
  audience: string;
  resourceKind: ResourceKind;
  costUsd: number;
  nowMs: number;
  federated: boolean;
  /** Required only for source-local legacy quarantine access. */
  sourceStoreId?: string;
  /** Optional Harbor-envelope dimension crossed by this request. */
  envelopeAction?: EnvelopeAction;
  /** Exact egress host; requires a matching verified macaroon host caveat. */
  egressHost?: string;
  /** Required for vector requests and compared before similarity is considered. */
  embeddingSpace?: EmbeddingSpace;
}

export interface ScopeKernelSnapshot {
  /** Authoritative records at one read-consistent point in time. */
  scopes: readonly unknown[];
  /** Resolved policy facts from verified grants at the same point in time. */
  grants: readonly unknown[];
  revokedGrantIds?: readonly string[];
}

export type ScopeDecisionCode =
  | 'ALLOWED'
  | 'PUBLIC_CATALOG'
  | 'SCOPE_REQUIRED'
  | 'SCOPE_UNKNOWN'
  | 'SCOPE_AMBIGUOUS'
  | 'SCOPE_INVALID'
  | 'PUBLIC_RESOURCE_DENIED'
  | 'GRANT_REQUIRED'
  | 'GRANT_UNKNOWN'
  | 'GRANT_AMBIGUOUS'
  | 'GRANT_INVALID'
  | 'GRANT_REVOKED'
  | 'GRANT_SCOPE_MISMATCH'
  | 'PRINCIPAL_MISMATCH'
  | 'DEVICE_MISMATCH'
  | 'PERSPECTIVE_MISMATCH'
  | 'SESSION_MISMATCH'
  | 'BODY_MISMATCH'
  | 'ACTION_DENIED'
  | 'RESOURCE_ACTION_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'GRANT_EXPIRED'
  | 'REQUEST_INVALID'
  | 'MACAROON_CONTEXT_DENIED'
  | 'ENVELOPE_DENIED'
  | 'FEDERATION_DENIED'
  | 'QUARANTINE_OPERATOR_REQUIRED'
  | 'QUARANTINE_SOURCE_MISMATCH'
  | 'VECTOR_SPACE_REQUIRED'
  | 'ATTENUATION_ALLOWED'
  | 'ATTENUATION_DENIED';

export interface ScopeDecision {
  allowed: boolean;
  code: ScopeDecisionCode;
  reason: string;
  boundary:
    | 'scope'
    | 'classification'
    | 'grant'
    | 'principal'
    | 'session'
    | 'body'
    | 'action'
    | 'audience'
    | 'expiry'
    | 'revocation'
    | 'macaroon'
    | 'envelope'
    | 'federation'
    | 'vector-space'
    | 'attenuation';
}

const CLASSIFICATIONS = new Set<ResourceClassification>([
  'public-catalog',
  'private-personal',
  'private-project',
  'team-shared',
  'operator-salvage-quarantine',
]);

const ACTIONS = new Set<ResourceAction>([
  'catalog.read',
  'search.read',
  'message.read',
  'message.write',
  'lock.read',
  'lock.write',
  'vector.read',
  'activity.read',
  'evidence.read',
  'salvage.read',
  'salvage.import',
]);

const RESOURCE_KINDS = new Set<ResourceKind>([
  'catalog-entry',
  'catalog-index',
  'search-index',
  'message',
  'lock',
  'vector',
  'actor-activity',
  'session-activity',
  'attention-event',
  'evidence',
  'private-record',
  'legacy-row',
]);

const READ_ACTIONS = new Set<ResourceAction>([
  'catalog.read',
  'search.read',
  'message.read',
  'lock.read',
  'vector.read',
  'activity.read',
  'evidence.read',
  'salvage.read',
]);

const SOUL_CLASSES = new Set<SoulClass>(['newcomer', 'graduated', 'operator', 'unknown']);
const DISTANCE_METRICS = new Set<EmbeddingDistanceMetric>(['cosine', 'dot-product', 'euclidean']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FORGE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const POSITIVE_CANONICAL_INTEGER = /^[1-9][0-9]*$/;
const BODY_DIGEST = /^sha256:[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function parseWorkspaceIdentity(value: unknown): WorkspaceIdentity | null {
  const raw = record(value);
  if (!raw) return null;
  const canonicalPath = identifier(raw.canonicalPath);
  const device = raw.device;
  const inode = raw.inode;
  if (
    !canonicalPath
    || !isAbsolute(canonicalPath)
    || typeof device !== 'number'
    || !Number.isSafeInteger(device)
    || device < 0
    || typeof inode !== 'number'
    || !Number.isSafeInteger(inode)
    || inode <= 0
  ) {
    return null;
  }
  return { canonicalPath, device, inode };
}

function sameRecordedWorkspaceIdentity(a: WorkspaceIdentity, b: WorkspaceIdentity): boolean {
  // canonicalPath is inspectable provenance only. Renaming/moving a repository
  // must not change authority; the daemon-minted UUID plus device/inode is the
  // stable local authority tuple.
  return a.device === b.device && a.inode === b.inode;
}

/**
 * Parse an untrusted repository authority. Owner/name, cwd, branch, and display
 * project fields are intentionally ignored as non-authoritative; malformed or
 * non-canonical records return null.
 */
export function parseRepositoryAuthority(value: unknown): RepositoryAuthorityRef | null {
  const raw = record(value);
  if (!raw) return null;
  if (raw.kind === 'forge') {
    const forge = identifier(raw.forge);
    const repositoryId = identifier(raw.repositoryId);
    if (!forge || !FORGE.test(forge) || !repositoryId || !POSITIVE_CANONICAL_INTEGER.test(repositoryId)) {
      return null;
    }
    return { kind: 'forge', forge, repositoryId };
  }
  if (raw.kind === 'local-git') {
    const localRepositoryId = identifier(raw.localRepositoryId);
    const gitCommonDir = parseWorkspaceIdentity(raw.gitCommonDir);
    if (!localRepositoryId || !UUID.test(localRepositoryId) || !gitCommonDir) return null;
    return { kind: 'local-git', localRepositoryId, gitCommonDir };
  }
  if (raw.kind === 'local-root') {
    const localRepositoryId = identifier(raw.localRepositoryId);
    const root = parseWorkspaceIdentity(raw.root);
    if (!localRepositoryId || !UUID.test(localRepositoryId) || !root) return null;
    return { kind: 'local-root', localRepositoryId, root };
  }
  return null;
}

/**
 * Compare immutable repository authority, including both the daemon-minted
 * local UUID and recorded device/inode identity. Canonical path is provenance.
 */
export function sameRepositoryAuthority(a: unknown, b: unknown): boolean {
  const left = parseRepositoryAuthority(a);
  const right = parseRepositoryAuthority(b);
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'forge' && right.kind === 'forge') {
    return left.forge === right.forge && left.repositoryId === right.repositoryId;
  }
  if (left.kind === 'local-git' && right.kind === 'local-git') {
    return left.localRepositoryId === right.localRepositoryId
      && sameRecordedWorkspaceIdentity(left.gitCommonDir, right.gitCommonDir);
  }
  if (left.kind === 'local-root' && right.kind === 'local-root') {
    return left.localRepositoryId === right.localRepositoryId
      && sameRecordedWorkspaceIdentity(left.root, right.root);
  }
  return false;
}

/**
 * Produce the exact structured repository value used as the existing macaroon
 * `repo` caveat context. It is derived only from immutable authority fields.
 */
export function repositoryAuthorityKey(authority: RepositoryAuthorityRef): string {
  const parsed = parseRepositoryAuthority(authority);
  if (!parsed) throw new TypeError('invalid repository authority');
  if (parsed.kind === 'forge') {
    return `forge:${encodeURIComponent(parsed.forge)}:${parsed.repositoryId}`;
  }
  const workspace = parsed.kind === 'local-git' ? parsed.gitCommonDir : parsed.root;
  return [
    parsed.kind,
    parsed.localRepositoryId,
    workspace.device,
    workspace.inode,
  ].join(':');
}

function parseRealm(value: unknown): ResourceRealm | null {
  const raw = record(value);
  if (!raw) return null;
  const accountId = identifier(raw.accountId);
  const teamId = raw.teamId === null ? null : identifier(raw.teamId);
  if (!accountId || (raw.teamId !== null && !teamId)) return null;
  return { accountId, teamId };
}

function parseWorld(value: unknown): ResourceWorld | null {
  const raw = record(value);
  if (!raw) return null;
  const id = identifier(raw.id);
  if (!id) return null;
  switch (raw.kind) {
    case 'worktree': {
      const workspace = parseWorkspaceIdentity(raw.workspace);
      return workspace ? { kind: 'worktree', id, workspace } : null;
    }
    case 'repository':
    case 'ref':
    case 'commit':
    case 'harbor':
    case 'catalog':
      return raw.workspace === undefined ? { kind: raw.kind, id } : null;
    case 'quarantine': {
      const sourceStoreId = identifier(raw.sourceStoreId);
      const sourceDeviceId = identifier(raw.sourceDeviceId);
      return raw.workspace === undefined && sourceStoreId && sourceDeviceId
        ? { kind: 'quarantine', id, sourceStoreId, sourceDeviceId }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Parse and validate one immutable scope record. Classification invariants are
 * structural: public catalog records can contain no repository/private data;
 * quarantine is explicitly private and repository-ambiguous; ordinary private
 * scopes require immutable repository authority.
 */
export function parseResourceScope(value: unknown): ResourceScope | null {
  const raw = record(value);
  if (!raw || raw.schema !== 'pd.resource-scope.v1') return null;
  const scopeId = identifier(raw.scopeId);
  const realm = parseRealm(raw.realm);
  const harborId = identifier(raw.harborId);
  const projectId = identifier(raw.projectId);
  const world = parseWorld(raw.world);
  const classification = raw.classification as ResourceClassification;
  if (!scopeId || !realm || !harborId || !projectId || !world || !CLASSIFICATIONS.has(classification)) {
    return null;
  }
  if (typeof raw.containsPrivateMaterial !== 'boolean') return null;
  const repository = raw.repository === null ? null : parseRepositoryAuthority(raw.repository);
  if (raw.repository !== null && !repository) return null;

  if (classification === 'public-catalog') {
    if (repository !== null || world.kind !== 'catalog' || raw.containsPrivateMaterial || realm.teamId !== null) return null;
  } else if (classification === 'operator-salvage-quarantine') {
    if (repository !== null || world.kind !== 'quarantine' || !raw.containsPrivateMaterial || realm.teamId !== null) return null;
  } else if (classification === 'private-personal' && realm.teamId !== null) {
    return null;
  } else if (classification === 'team-shared' && realm.teamId === null) {
    return null;
  } else if (repository === null || world.kind === 'catalog' || world.kind === 'quarantine' || !raw.containsPrivateMaterial) {
    return null;
  }

  return {
    schema: 'pd.resource-scope.v1',
    scopeId,
    realm,
    harborId,
    projectId,
    repository,
    world,
    classification,
    containsPrivateMaterial: raw.containsPrivateMaterial,
  };
}

function parseEmbeddingDescriptor(value: unknown): EmbeddingSpaceDescriptor | null {
  const raw = record(value);
  if (!raw) return null;
  const provider = identifier(raw.provider);
  const model = identifier(raw.model);
  const modelRevision = identifier(raw.modelRevision);
  const modelDigest = identifier(raw.modelDigest);
  const pooling = identifier(raw.pooling);
  const preprocessingDigest = identifier(raw.preprocessingDigest);
  const distanceMetric = raw.distanceMetric as EmbeddingDistanceMetric;
  if (
    !provider
    || !model
    || !modelRevision
    || !modelDigest
    || !BODY_DIGEST.test(modelDigest)
    || !pooling
    || !preprocessingDigest
    || !BODY_DIGEST.test(preprocessingDigest)
    || !DISTANCE_METRICS.has(distanceMetric)
    || typeof raw.dimensions !== 'number'
    || !Number.isSafeInteger(raw.dimensions)
    || raw.dimensions <= 0
    || typeof raw.normalized !== 'boolean'
  ) {
    return null;
  }
  return {
    provider,
    model,
    modelRevision,
    modelDigest,
    pooling,
    preprocessingDigest,
    distanceMetric,
    dimensions: raw.dimensions,
    normalized: raw.normalized,
  };
}

/**
 * Compute the canonical descriptor digest for an embedding space. The digest
 * covers every model/preprocessing/comparison field; callers cannot reuse a
 * space id while silently changing how vectors were produced or compared.
 */
export function embeddingSpaceDescriptorDigest(descriptor: EmbeddingSpaceDescriptor): string {
  const parsed = parseEmbeddingDescriptor(descriptor);
  if (!parsed) throw new TypeError('invalid embedding-space descriptor');
  const canonical = JSON.stringify([
    parsed.provider,
    parsed.model,
    parsed.modelRevision,
    parsed.modelDigest,
    parsed.pooling,
    parsed.preprocessingDigest,
    parsed.distanceMetric,
    parsed.dimensions,
    parsed.normalized,
  ]);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function parseEmbeddingSpace(value: unknown): EmbeddingSpace | null {
  const raw = record(value);
  if (!raw) return null;
  const spaceId = identifier(raw.spaceId);
  const descriptorDigest = identifier(raw.descriptorDigest);
  const descriptor = parseEmbeddingDescriptor(raw);
  if (
    !spaceId
    || !descriptorDigest
    || !BODY_DIGEST.test(descriptorDigest)
    || !descriptor
    || embeddingSpaceDescriptorDigest(descriptor) !== descriptorDigest
  ) {
    return null;
  }
  return { spaceId, ...descriptor, descriptorDigest };
}

function sameEmbeddingSpace(a: unknown, b: unknown): boolean {
  const left = parseEmbeddingSpace(a);
  const right = parseEmbeddingSpace(b);
  return Boolean(
    left
    && right
    && left.spaceId === right.spaceId
    && left.descriptorDigest === right.descriptorDigest
    && left.provider === right.provider
    && left.model === right.model
    && left.modelRevision === right.modelRevision
    && left.modelDigest === right.modelDigest
    && left.pooling === right.pooling
    && left.preprocessingDigest === right.preprocessingDigest
    && left.distanceMetric === right.distanceMetric
    && left.dimensions === right.dimensions
    && left.normalized === right.normalized,
  );
}

function hasExactCaveat(caveats: readonly string[], field: string, value: string): boolean {
  return caveats.some((predicate) => {
    const caveat = parseCaveat(predicate);
    return caveat?.field === field && caveat.op === '=' && caveat.value === value;
  });
}

/**
 * Parse policy facts extracted from an already-verified grant. This parser does
 * not verify a bearer signature; that remains the existing macaroon verifier's
 * job. It rejects malformed or under-bound policy projections.
 */
export function parseResolvedScopeGrant(value: unknown): ResolvedScopeGrant | null {
  const raw = record(value);
  if (!raw || raw.schema !== 'pd.resolved-scope-grant.v1') return null;
  const grantId = identifier(raw.grantId);
  const scopeId = identifier(raw.scopeId);
  const principalActorId = identifier(raw.principalActorId);
  const deviceId = identifier(raw.deviceId);
  const perspectiveId = identifier(raw.perspectiveId);
  const sessionId = identifier(raw.sessionId);
  const bodyDigest = identifier(raw.bodyDigest);
  const audience = identifier(raw.audience);
  if (
    !grantId
    || !scopeId
    || !principalActorId
    || !deviceId
    || !perspectiveId
    || !sessionId
    || !bodyDigest
    || !BODY_DIGEST.test(bodyDigest)
    || !audience
  ) {
    return null;
  }
  if (!Array.isArray(raw.actions) || raw.actions.length === 0) return null;
  const actions = raw.actions.filter((item): item is ResourceAction => typeof item === 'string' && ACTIONS.has(item as ResourceAction));
  if (actions.length !== raw.actions.length || new Set(actions).size !== actions.length) return null;
  if (typeof raw.expiresAtMs !== 'number' || !Number.isSafeInteger(raw.expiresAtMs) || raw.expiresAtMs <= 0) return null;
  if (typeof raw.remainingDelegations !== 'number' || !Number.isSafeInteger(raw.remainingDelegations) || raw.remainingDelegations < 0) {
    return null;
  }
  if (!record(raw.envelope)) return null;
  const envelope = parseEnvelope(raw.envelope);
  if (!Array.isArray(raw.verifiedMacaroonCaveats) || raw.verifiedMacaroonCaveats.length === 0) return null;
  const caveats = raw.verifiedMacaroonCaveats.filter((item): item is string => typeof item === 'string' && Boolean(parseCaveat(item)));
  if (caveats.length !== raw.verifiedMacaroonCaveats.length) return null;
  if (raw.federation !== 'none' && raw.federation !== 'read-only') return null;
  if (raw.federation === 'read-only' && actions.some((action) => !READ_ACTIONS.has(action))) return null;
  if (!hasExactCaveat(caveats, 'op', 'api-call')) return null;
  if (!hasExactCaveat(caveats, 'session', sessionId)) return null;
  if (!hasExactCaveat(caveats, 'expires', String(raw.expiresAtMs))) return null;

  return {
    schema: 'pd.resolved-scope-grant.v1',
    grantId,
    scopeId,
    principalActorId,
    deviceId,
    perspectiveId,
    sessionId,
    bodyDigest,
    actions,
    audience,
    expiresAtMs: raw.expiresAtMs,
    remainingDelegations: raw.remainingDelegations,
    envelope,
    verifiedMacaroonCaveats: caveats,
    federation: raw.federation,
  };
}

type Resolution<T> =
  | { status: 'ok'; value: T }
  | { status: 'unknown' }
  | { status: 'ambiguous' }
  | { status: 'invalid' };

function rawId(value: unknown, field: string): string | null {
  const raw = record(value);
  return raw && typeof raw[field] === 'string' ? raw[field] as string : null;
}

function resolveUnique<T>(
  values: readonly unknown[],
  field: string,
  id: string,
  parse: (value: unknown) => T | null,
): Resolution<T> {
  const matches = values.filter((value) => rawId(value, field) === id);
  if (matches.length === 0) return { status: 'unknown' };
  if (matches.length !== 1) return { status: 'ambiguous' };
  const parsed = parse(matches[0]);
  return parsed ? { status: 'ok', value: parsed } : { status: 'invalid' };
}

function sameScopeLineage(anchor: ResourceScope, target: ResourceScope): boolean {
  return anchor.realm.accountId === target.realm.accountId
    && anchor.realm.teamId === target.realm.teamId
    && anchor.harborId === target.harborId
    && anchor.projectId === target.projectId
    && anchor.classification === target.classification;
}

/**
 * Decide whether an anchor scope covers a target. Exact opaque scope ids cover
 * themselves. A repository-world anchor may additionally cover worktree/ref/
 * commit worlds only when realm, harbor, project, classification, and immutable
 * repository authority are all identical. Narrow worlds never imply siblings.
 */
export function resourceScopeCovers(anchor: ResourceScope, target: ResourceScope): boolean {
  if (anchor.scopeId === target.scopeId) return true;
  if (!sameScopeLineage(anchor, target) || !anchor.repository || !target.repository) return false;
  if (!sameRepositoryAuthority(anchor.repository, target.repository)) return false;
  if (anchor.world.kind !== 'repository') return false;
  return target.world.kind === 'repository'
    || target.world.kind === 'worktree'
    || target.world.kind === 'ref'
    || target.world.kind === 'commit';
}

function allow(code: ScopeDecisionCode, reason: string, boundary: ScopeDecision['boundary']): ScopeDecision {
  return { allowed: true, code, reason, boundary };
}

function deny(code: ScopeDecisionCode, reason: string, boundary: ScopeDecision['boundary']): ScopeDecision {
  return { allowed: false, code, reason, boundary };
}

function actionMatchesResource(action: ResourceAction, resourceKind: ResourceKind): boolean {
  switch (resourceKind) {
    case 'catalog-entry':
    case 'catalog-index':
      return action === 'catalog.read';
    case 'search-index':
      return action === 'search.read';
    case 'message':
      return action === 'message.read' || action === 'message.write';
    case 'lock':
      return action === 'lock.read' || action === 'lock.write';
    case 'vector':
      return action === 'vector.read';
    case 'actor-activity':
    case 'session-activity':
    case 'attention-event':
      return action === 'activity.read';
    case 'evidence':
      return action === 'evidence.read';
    case 'legacy-row':
      return action === 'salvage.read' || action === 'salvage.import';
    case 'private-record':
      return action !== 'catalog.read';
    default:
      return false;
  }
}

function validateRequestBasics(request: ScopedResourceRequest): ScopeDecision | null {
  if (!ACTIONS.has(request.action) || !RESOURCE_KINDS.has(request.resourceKind)) {
    return deny('REQUEST_INVALID', 'unknown resource action or kind', 'action');
  }
  if (!identifier(request.audience)) return deny('REQUEST_INVALID', 'audience is required', 'audience');
  if (typeof request.federated !== 'boolean') {
    return deny('REQUEST_INVALID', 'federated must be an explicit boolean', 'federation');
  }
  if (!Number.isSafeInteger(request.nowMs) || request.nowMs <= 0) {
    return deny('REQUEST_INVALID', 'nowMs must be a positive integer', 'expiry');
  }
  if (typeof request.costUsd !== 'number' || !Number.isFinite(request.costUsd) || request.costUsd < 0) {
    return deny('REQUEST_INVALID', 'costUsd must be finite and non-negative', 'envelope');
  }
  if (!actionMatchesResource(request.action, request.resourceKind)) {
    return deny('RESOURCE_ACTION_MISMATCH', `${request.action} cannot access ${request.resourceKind}`, 'action');
  }
  return null;
}

function requiredPrivatePrincipal(request: ScopedResourceRequest): ScopeDecision | null {
  if (
    !request.principal
    || !identifier(request.principal.actorId)
    || !identifier(request.principal.deviceId)
    || !identifier(request.principal.perspectiveId)
    || !SOUL_CLASSES.has(request.principal.soulClass)
  ) {
    return deny('PRINCIPAL_MISMATCH', 'private access requires a verified actor context', 'principal');
  }
  if (!identifier(request.sessionId)) {
    return deny('SESSION_MISMATCH', 'private access requires an explicit session', 'session');
  }
  if (!request.bodyDigest || !BODY_DIGEST.test(request.bodyDigest)) {
    return deny('BODY_MISMATCH', 'private access requires a canonical sha256 body digest', 'body');
  }
  return null;
}

function publicCatalogDecision(request: ScopedResourceRequest): ScopeDecision {
  // Federation is deliberately allowed here: this path admits only zero-cost,
  // nonprivate catalog metadata and can never authorize an action or egress.
  if (
    request.action === 'catalog.read'
    && (request.resourceKind === 'catalog-entry' || request.resourceKind === 'catalog-index')
    && request.costUsd === 0
    && !request.envelopeAction
    && !request.egressHost
  ) {
    return allow('PUBLIC_CATALOG', 'explicit public catalog metadata contains no private material', 'classification');
  }
  return deny('PUBLIC_RESOURCE_DENIED', `${request.resourceKind} is not global public catalog material`, 'classification');
}

function requireRepositoryCaveat(grant: ResolvedScopeGrant, scope: ResourceScope): boolean {
  return !scope.repository || hasExactCaveat(
    grant.verifiedMacaroonCaveats,
    'repo',
    repositoryAuthorityKey(scope.repository),
  );
}

/**
 * Authorize one resource access against a read-consistent authoritative
 * snapshot. Every private path requires an explicit scope and verified grant;
 * missing, malformed, duplicate, expired, revoked, or mismatched state denies.
 */
export function authorizeScopedResource(
  request: ScopedResourceRequest,
  snapshot: ScopeKernelSnapshot,
): ScopeDecision {
  const basics = validateRequestBasics(request);
  if (basics) return basics;
  const scopeId = request.scopeId ? identifier(request.scopeId) : null;
  if (!scopeId) return deny('SCOPE_REQUIRED', 'private operations require an explicit scope id', 'scope');
  const scopeResolution = resolveUnique(snapshot.scopes, 'scopeId', scopeId, parseResourceScope);
  if (scopeResolution.status === 'unknown') return deny('SCOPE_UNKNOWN', 'scope id is not authoritative', 'scope');
  if (scopeResolution.status === 'ambiguous') return deny('SCOPE_AMBIGUOUS', 'scope id has multiple definitions', 'scope');
  if (scopeResolution.status === 'invalid') return deny('SCOPE_INVALID', 'scope record is malformed', 'scope');
  const targetScope = scopeResolution.value;

  if (targetScope.classification === 'public-catalog') return publicCatalogDecision(request);
  if (request.action === 'vector.read' && !parseEmbeddingSpace(request.embeddingSpace)) {
    return deny('VECTOR_SPACE_REQUIRED', 'vector access requires exact embedding-space metadata', 'vector-space');
  }
  const principalError = requiredPrivatePrincipal(request);
  if (principalError) return principalError;
  const grantId = request.grantId ? identifier(request.grantId) : null;
  if (!grantId) return deny('GRANT_REQUIRED', 'private access requires an explicit verified grant id', 'grant');
  const grantResolution = resolveUnique(snapshot.grants, 'grantId', grantId, parseResolvedScopeGrant);
  if (grantResolution.status === 'unknown') return deny('GRANT_UNKNOWN', 'grant id is not authoritative', 'grant');
  if (grantResolution.status === 'ambiguous') return deny('GRANT_AMBIGUOUS', 'grant id has multiple definitions', 'grant');
  if (grantResolution.status === 'invalid') return deny('GRANT_INVALID', 'grant policy projection is malformed', 'grant');
  const grant = grantResolution.value;
  if (snapshot.revokedGrantIds?.includes(grant.grantId)) {
    return deny('GRANT_REVOKED', 'grant has been revoked', 'revocation');
  }

  const anchorResolution = resolveUnique(snapshot.scopes, 'scopeId', grant.scopeId, parseResourceScope);
  if (anchorResolution.status !== 'ok') {
    return deny('GRANT_INVALID', 'grant anchor scope is missing, ambiguous, or malformed', 'grant');
  }
  const anchorScope = anchorResolution.value;
  if (!resourceScopeCovers(anchorScope, targetScope)) {
    return deny('GRANT_SCOPE_MISMATCH', 'grant scope does not cover the target lineage and repository', 'scope');
  }
  if (grant.principalActorId !== request.principal!.actorId) {
    return deny('PRINCIPAL_MISMATCH', 'grant principal does not match verified actor', 'principal');
  }
  if (grant.deviceId !== request.principal!.deviceId) {
    return deny('DEVICE_MISMATCH', 'grant device does not match verified actor device', 'principal');
  }
  if (grant.perspectiveId !== request.principal!.perspectiveId) {
    return deny('PERSPECTIVE_MISMATCH', 'grant perspective does not match the embodied request perspective', 'principal');
  }
  if (grant.sessionId !== request.sessionId) {
    return deny('SESSION_MISMATCH', 'grant session does not match request session', 'session');
  }
  if (grant.bodyDigest !== request.bodyDigest) {
    return deny('BODY_MISMATCH', 'grant body binding does not match request body digest', 'body');
  }
  if (!grant.actions.includes(request.action)) {
    return deny('ACTION_DENIED', `grant does not contain exact action ${request.action}`, 'action');
  }
  if (grant.audience !== request.audience) {
    return deny('AUDIENCE_MISMATCH', 'grant audience does not match request audience', 'audience');
  }
  if (request.nowMs > grant.expiresAtMs) {
    return deny('GRANT_EXPIRED', 'grant has expired', 'expiry');
  }
  if (request.federated && grant.federation !== 'read-only') {
    return deny('FEDERATION_DENIED', 'local grant is not federated', 'federation');
  }
  if (request.federated && !READ_ACTIONS.has(request.action)) {
    return deny('FEDERATION_DENIED', 'federated read authority never implies an action', 'federation');
  }
  if (
    targetScope.classification === 'operator-salvage-quarantine'
    && request.principal!.soulClass !== 'operator'
  ) {
    return deny('QUARANTINE_OPERATOR_REQUIRED', 'ambiguous legacy rows require operator salvage authority', 'classification');
  }
  if (
    targetScope.classification === 'operator-salvage-quarantine'
    && (request.resourceKind !== 'legacy-row' || (request.action !== 'salvage.read' && request.action !== 'salvage.import'))
  ) {
    return deny('ACTION_DENIED', 'quarantine permits only explicit salvage operations', 'classification');
  }
  if (targetScope.classification === 'operator-salvage-quarantine') {
    if (targetScope.world.kind !== 'quarantine') {
      return deny('SCOPE_INVALID', 'quarantine classification lacks source-local provenance', 'classification');
    }
    if (
      anchorScope.world.kind !== 'quarantine'
      || grant.deviceId !== targetScope.world.sourceDeviceId
      || request.principal!.deviceId !== targetScope.world.sourceDeviceId
      || request.sourceStoreId !== targetScope.world.sourceStoreId
    ) {
      return deny(
        'QUARANTINE_SOURCE_MISMATCH',
        'legacy quarantine is visible only on its exact source store and device',
        'classification',
      );
    }
  }
  if (!requireRepositoryCaveat(grant, anchorScope)) {
    return deny('MACAROON_CONTEXT_DENIED', 'verified macaroon lacks exact immutable repository authority', 'macaroon');
  }
  if (request.egressHost && !hasExactCaveat(grant.verifiedMacaroonCaveats, 'host', request.egressHost)) {
    return deny('MACAROON_CONTEXT_DENIED', 'egress host lacks an exact verified macaroon caveat', 'macaroon');
  }
  const macaroonContext: RequestContext = {
    op: 'api-call',
    repo: anchorScope.repository ? repositoryAuthorityKey(anchorScope.repository) : undefined,
    host: request.egressHost,
    spendUsd: request.costUsd,
    session: request.sessionId,
    nowMs: request.nowMs,
  };
  if (!grant.verifiedMacaroonCaveats.every((caveat) => checkCaveat(caveat, macaroonContext))) {
    return deny('MACAROON_CONTEXT_DENIED', 'verified macaroon caveats do not hold for this request', 'macaroon');
  }

  const spend = assessEnvelope(grant.envelope, { kind: 'spend', amountUsd: request.costUsd });
  if (!spend.allowed) return deny('ENVELOPE_DENIED', spend.reason, 'envelope');
  if (request.envelopeAction) {
    const envelope = assessEnvelope(grant.envelope, request.envelopeAction);
    if (!envelope.allowed) return deny('ENVELOPE_DENIED', envelope.reason, 'envelope');
  }
  return allow('ALLOWED', 'scope, grant, actor, request, macaroon, and envelope all match', 'grant');
}

function listNarrows(parent: readonly string[], child: readonly string[]): boolean {
  if (parent.includes('*')) return true;
  if (child.includes('*')) return false;
  return child.every((value) => parent.includes(value));
}

function envelopeNarrows(parent: HarborEnvelope, child: HarborEnvelope): boolean {
  const listsNarrow = listNarrows(parent.filesystem, child.filesystem)
    && listNarrows(parent.tools, child.tools)
    && listNarrows(parent.skills, child.skills)
    && listNarrows(parent.mcps, child.mcps)
    && listNarrows(parent.backends, child.backends)
    && listNarrows(parent.channels, child.channels);
  if (!listsNarrow) return false;
  if (parent.budgetUsd === null) return true;
  return child.budgetUsd !== null && child.budgetUsd <= parent.budgetUsd;
}

function caveatsAreAppendOnlyAttenuation(parent: readonly string[], child: readonly string[]): boolean {
  if (child.length < parent.length) return false;
  for (let i = 0; i < parent.length; i += 1) {
    if (parent[i] !== child[i]) return false;
  }
  const running = [...parent];
  for (const candidate of child.slice(parent.length)) {
    if (!narrows(running, candidate)) return false;
    running.push(candidate);
  }
  return true;
}

/**
 * Check whether a child grant is a genuine attenuation of its parent. The
 * existing macaroon chain must remain an exact prefix, while every explicit
 * policy dimension can only narrow and delegation depth must decrease.
 */
export function assessScopeGrantAttenuation(
  parentValue: ResolvedScopeGrant,
  childValue: ResolvedScopeGrant,
): ScopeDecision {
  const parent = parseResolvedScopeGrant(parentValue);
  const child = parseResolvedScopeGrant(childValue);
  if (!parent || !child || parent.grantId === child.grantId) {
    return deny('ATTENUATION_DENIED', 'parent or child grant is malformed or reuses the same id', 'attenuation');
  }
  if (
    parent.scopeId !== child.scopeId
    || parent.principalActorId !== child.principalActorId
    || parent.deviceId !== child.deviceId
    || parent.perspectiveId !== child.perspectiveId
    || parent.sessionId !== child.sessionId
    || parent.bodyDigest !== child.bodyDigest
    || parent.audience !== child.audience
  ) {
    return deny('ATTENUATION_DENIED', 'immutable grant bindings changed', 'attenuation');
  }
  if (parent.remainingDelegations <= 0 || child.remainingDelegations >= parent.remainingDelegations) {
    return deny('ATTENUATION_DENIED', 'delegation depth did not decrease', 'attenuation');
  }
  if (child.expiresAtMs > parent.expiresAtMs) {
    return deny('ATTENUATION_DENIED', 'child expiry extends the parent', 'attenuation');
  }
  if (!child.actions.every((action) => parent.actions.includes(action))) {
    return deny('ATTENUATION_DENIED', 'child adds an action', 'attenuation');
  }
  if (parent.federation === 'none' && child.federation !== 'none') {
    return deny('ATTENUATION_DENIED', 'child adds federation absent from the parent', 'attenuation');
  }
  if (!envelopeNarrows(parent.envelope, child.envelope)) {
    return deny('ATTENUATION_DENIED', 'child broadens envelope or cost', 'attenuation');
  }
  if (!caveatsAreAppendOnlyAttenuation(parent.verifiedMacaroonCaveats, child.verifiedMacaroonCaveats)) {
    return deny('ATTENUATION_DENIED', 'child macaroon constraints are not append-only attenuation', 'attenuation');
  }
  return allow('ATTENUATION_ALLOWED', 'every child grant dimension is equal or narrower', 'attenuation');
}

export interface ScopedVectorCandidate {
  id: string;
  scopeId: string;
  embeddingSpace: EmbeddingSpace;
}

export interface VectorPrefilterRejection {
  id: string;
  code: 'VECTOR_SCOPE_MISMATCH' | 'VECTOR_SPACE_MISMATCH';
}

/**
 * Authorize a vector query, then remove foreign scopes and incompatible
 * embedding spaces before any similarity value is considered. Candidate
 * scopeId must equal the exact target scope id even when the query grant's
 * repository anchor covers descendant worktrees; implicit descendant
 * aggregation belongs in an explicit higher-level query plan. A denied query
 * receives no candidates.
 */
export function prefilterAuthorizedVectors<T extends ScopedVectorCandidate>(
  request: ScopedResourceRequest,
  candidates: readonly T[],
  snapshot: ScopeKernelSnapshot,
): { decision: ScopeDecision; candidates: T[]; rejections: VectorPrefilterRejection[] } {
  const decision = authorizeScopedResource(request, snapshot);
  if (!decision.allowed) return { decision, candidates: [], rejections: [] };
  const accepted: T[] = [];
  const rejections: VectorPrefilterRejection[] = [];
  for (const candidate of candidates) {
    if (candidate.scopeId !== request.scopeId) {
      rejections.push({ id: candidate.id, code: 'VECTOR_SCOPE_MISMATCH' });
    } else if (!sameEmbeddingSpace(candidate.embeddingSpace, request.embeddingSpace)) {
      rejections.push({ id: candidate.id, code: 'VECTOR_SPACE_MISMATCH' });
    } else {
      accepted.push(candidate);
    }
  }
  return { decision, candidates: accepted, rejections };
}
