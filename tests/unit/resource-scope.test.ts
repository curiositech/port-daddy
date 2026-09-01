/**
 * Hostile multi-repository isolation tests for the resource-scope kernel.
 *
 * These fixtures deliberately reuse the same actor, session, device number,
 * realm, harbor, and project across unrelated repositories. None of those
 * ambient similarities is authority. Only the resolved scope, immutable
 * repository authority, verified grant constraints, and explicit
 * repository-vs-worktree coverage may authorize a private operation.
 */
import {
  assessScopeGrantAttenuation,
  authorizeScopedResource,
  embeddingSpaceDescriptorDigest,
  parseRepositoryAuthority,
  parseResourceScope,
  prefilterAuthorizedVectors,
  repositoryAuthorityKey,
  sameRepositoryAuthority,
  type RepositoryAuthorityRef,
  type ResolvedScopeGrant,
  type EmbeddingSpace,
  type EmbeddingSpaceDescriptor,
  type ResourceScope,
  type ScopeKernelSnapshot,
  type ScopedResourceRequest,
} from '../../lib/resource-scope.js';
import { emptyEnvelope } from '../../lib/harbor-envelope.js';
import {
  expiresCaveat,
  hostCaveat,
  opCaveat,
  parseCaveat,
  repoCaveat,
  sessionCaveat,
  spendCeilingCaveat,
} from '../../lib/macaroon/caveats.js';

const NOW = 1_788_220_000_000;
const BODY_A = `sha256:${'a'.repeat(64)}`;
const BODY_B = `sha256:${'b'.repeat(64)}`;
const ACTOR = '01M1RESOURCEACTOR0000000000';
const SESSION = 'session-resource-scope-test';
const AUDIENCE = 'pd-daemon-resource-api';
const DEVICE = 'device-operator-macbook';
const PERSPECTIVE = 'perspective-resource-scope-worker';
const SOURCE_STORE = 'store-port-registry-device-local';
const EMBEDDING_DESCRIPTOR: EmbeddingSpaceDescriptor = {
  provider: 'transformers.js',
  model: 'Xenova/all-MiniLM-L6-v2',
  modelRevision: 'canonical-v1',
  modelDigest: `sha256:${'1'.repeat(64)}`,
  pooling: 'mean',
  preprocessingDigest: `sha256:${'2'.repeat(64)}`,
  distanceMetric: 'cosine',
  dimensions: 384,
  normalized: true,
};

function embeddingSpace(
  overrides: Partial<EmbeddingSpaceDescriptor & { spaceId: string }> = {},
): EmbeddingSpace {
  const { spaceId: requestedSpaceId, ...descriptorOverrides } = overrides;
  const spaceId = requestedSpaceId ?? 'embedding-space-canonical-local-v1';
  const descriptor: EmbeddingSpaceDescriptor = {
    ...EMBEDDING_DESCRIPTOR,
    ...descriptorOverrides,
  };
  return {
    spaceId,
    ...descriptor,
    descriptorDigest: embeddingSpaceDescriptorDigest(descriptor),
  };
}

const EMBEDDING_SPACE = embeddingSpace();

const REPO_A = {
  kind: 'local-git' as const,
  localRepositoryId: '11111111-1111-4111-8111-111111111111',
  gitCommonDir: {
    canonicalPath: '/srv/git/repository-a/.git',
    device: 42,
    inode: 1001,
  },
};

const REPO_B = {
  kind: 'local-git' as const,
  localRepositoryId: '22222222-2222-4222-8222-222222222222',
  gitCommonDir: {
    canonicalPath: '/srv/git/repository-b/.git',
    device: 42,
    inode: 1002,
  },
};

const LOCAL_ROOT_A = {
  kind: 'local-root' as const,
  localRepositoryId: '33333333-3333-4333-8333-333333333333',
  root: {
    canonicalPath: '/srv/non-git/project-a',
    device: 42,
    inode: 3001,
  },
};

const LOCAL_ROOT_B = {
  kind: 'local-root' as const,
  localRepositoryId: '44444444-4444-4444-8444-444444444444',
  root: {
    canonicalPath: '/srv/non-git/project-b',
    device: 42,
    inode: 3002,
  },
};

function privateScope(
  scopeId: string,
  repository: RepositoryAuthorityRef,
  world: ResourceScope['world'] = { kind: 'repository', id: 'repository' },
): ResourceScope {
  return {
    schema: 'pd.resource-scope.v1',
    scopeId,
    realm: {
      accountId: 'account-local-operator',
      teamId: 'team-port-daddy',
    },
    harborId: 'harbor-local',
    projectId: 'project-shared-display-name',
    repository,
    world,
    classification: 'private-project',
    containsPrivateMaterial: true,
  };
}

const SCOPE_REPO_A = privateScope('scope-repository-a', REPO_A);
const SCOPE_REPO_B = privateScope('scope-repository-b', REPO_B);
const SCOPE_WORKTREE_A1 = privateScope('scope-worktree-a-one', REPO_A, {
  kind: 'worktree',
  id: 'worktree-a-one',
  workspace: {
    canonicalPath: '/srv/worktrees/repository-a-one',
    device: 42,
    inode: 2001,
  },
});
const SCOPE_WORKTREE_A2 = privateScope('scope-worktree-a-two', REPO_A, {
  kind: 'worktree',
  id: 'worktree-a-two',
  workspace: {
    canonicalPath: '/srv/worktrees/repository-a-two',
    device: 42,
    inode: 2002,
  },
});
const SCOPE_LOCAL_ROOT_A = privateScope('scope-local-root-a', LOCAL_ROOT_A);
const SCOPE_LOCAL_ROOT_B = privateScope('scope-local-root-b', LOCAL_ROOT_B);

const PUBLIC_CATALOG: ResourceScope = {
  schema: 'pd.resource-scope.v1',
  scopeId: 'scope-global-public-catalog',
  realm: { accountId: 'account-public-catalog', teamId: null },
  harborId: 'harbor-public-catalog',
  projectId: 'project-public-catalog',
  repository: null,
  world: { kind: 'catalog', id: 'global-skill-agent-catalog' },
  classification: 'public-catalog',
  containsPrivateMaterial: false,
};

const LEGACY_QUARANTINE: ResourceScope = {
  schema: 'pd.resource-scope.v1',
  scopeId: 'scope-operator-salvage-quarantine',
  realm: { accountId: 'account-local-operator', teamId: null },
  harborId: 'harbor-local',
  projectId: 'project-ambiguous-legacy',
  repository: null,
  world: {
    kind: 'quarantine',
    id: 'legacy-unscoped-rows',
    sourceStoreId: SOURCE_STORE,
    sourceDeviceId: DEVICE,
  },
  classification: 'operator-salvage-quarantine',
  containsPrivateMaterial: true,
};

function grant(
  grantId: string,
  scope: ResourceScope,
  overrides: Partial<ResolvedScopeGrant> = {},
): ResolvedScopeGrant {
  const expiresAtMs = overrides.expiresAtMs ?? NOW + 60_000;
  const envelope = overrides.envelope ?? {
    ...emptyEnvelope(),
    tools: ['semantic-index'],
    mcps: ['resource-store'],
    budgetUsd: 2,
  };
  const repositoryCaveat = scope.repository
    ? [repoCaveat(repositoryAuthorityKey(scope.repository))]
    : [];
  return {
    schema: 'pd.resolved-scope-grant.v1',
    grantId,
    scopeId: scope.scopeId,
    principalActorId: ACTOR,
    deviceId: DEVICE,
    perspectiveId: PERSPECTIVE,
    sessionId: SESSION,
    bodyDigest: BODY_A,
    actions: [
      'search.read',
      'message.read',
      'message.write',
      'lock.read',
      'lock.write',
      'vector.read',
      'activity.read',
      'salvage.read',
      'salvage.import',
    ],
    audience: AUDIENCE,
    expiresAtMs,
    remainingDelegations: 2,
    envelope,
    verifiedMacaroonCaveats: [
      opCaveat('api-call'),
      ...repositoryCaveat,
      sessionCaveat(SESSION),
      expiresCaveat(expiresAtMs),
      spendCeilingCaveat(envelope.budgetUsd ?? 1_000_000),
    ],
    federation: 'none',
    ...overrides,
  };
}

const GRANT_REPO_A = grant('grant-repository-a', SCOPE_REPO_A);
const GRANT_WORKTREE_A1 = grant('grant-worktree-a-one', SCOPE_WORKTREE_A1);

function snapshot(
  scopes: readonly ResourceScope[] = [
    SCOPE_REPO_A,
    SCOPE_REPO_B,
    SCOPE_WORKTREE_A1,
    SCOPE_WORKTREE_A2,
    PUBLIC_CATALOG,
    LEGACY_QUARANTINE,
  ],
  grants: readonly ResolvedScopeGrant[] = [GRANT_REPO_A, GRANT_WORKTREE_A1],
  revokedGrantIds: readonly string[] = [],
): ScopeKernelSnapshot {
  return { scopes, grants, revokedGrantIds };
}

function request(overrides: Partial<ScopedResourceRequest> = {}): ScopedResourceRequest {
  return {
    scopeId: SCOPE_REPO_A.scopeId,
    grantId: GRANT_REPO_A.grantId,
    principal: {
      actorId: ACTOR,
      soulClass: 'operator',
      deviceId: DEVICE,
      perspectiveId: PERSPECTIVE,
    },
    sessionId: SESSION,
    bodyDigest: BODY_A,
    action: 'search.read',
    audience: AUDIENCE,
    resourceKind: 'search-index',
    costUsd: 0,
    nowMs: NOW,
    federated: false,
    sourceStoreId: SOURCE_STORE,
    ...overrides,
  };
}

describe('resource scope parsing and immutable repository authority', () => {
  test('rejects owner/name, cwd, and non-numeric forge ids as repository authority', () => {
    expect(parseRepositoryAuthority({ kind: 'forge', forge: 'github.com', repositoryId: 'curiositech/port-daddy' })).toBeNull();
    expect(parseRepositoryAuthority({ kind: 'local-git', cwd: '/srv/repo', branch: 'main' })).toBeNull();
  });

  test.each([
    { kind: 'forge', forge: 'GitHub.COM', repositoryId: '123' },
    { kind: 'forge', forge: 'github.com', repositoryId: 'ABC123' },
    { kind: 'forge', forge: 'github.com', repositoryId: '0' },
    { kind: 'forge', forge: 'github.com', repositoryId: '-42' },
    { kind: 'forge', forge: 'github.com', repositoryId: '00123' },
    { kind: 'local-git', localRepositoryId: 'not-a-uuid', gitCommonDir: REPO_A.gitCommonDir },
    { kind: 'local-root', localRepositoryId: '33333333-3333-3333-3333-333333333333', root: LOCAL_ROOT_A.root },
  ])('rejects non-canonical repository authority encoding %#', (authority) => {
    expect(parseRepositoryAuthority(authority)).toBeNull();
  });

  test('accepts a hosted forge plus immutable numeric repository id', () => {
    const parsed = parseRepositoryAuthority({
      kind: 'forge',
      forge: 'github.com',
      repositoryId: '123456789',
    });
    expect(parsed).toEqual({ kind: 'forge', forge: 'github.com', repositoryId: '123456789' });
  });

  test('same-device local repositories remain distinct while sibling worktrees share repository authority', () => {
    expect(sameRepositoryAuthority(REPO_A, REPO_B)).toBe(false);
    expect(sameRepositoryAuthority(SCOPE_WORKTREE_A1.repository, SCOPE_WORKTREE_A2.repository)).toBe(true);
  });

  test('canonical path is provenance only, while copied UUIDs and changed device/inode cannot forge authority', () => {
    expect(sameRepositoryAuthority(REPO_A, {
      ...REPO_A,
      gitCommonDir: {
        ...REPO_A.gitCommonDir,
        canonicalPath: '/srv/moved/repository-a/.git',
      },
    })).toBe(true);
    expect(sameRepositoryAuthority(REPO_A, {
      ...REPO_A,
      gitCommonDir: { ...REPO_A.gitCommonDir, inode: REPO_A.gitCommonDir.inode + 1 },
    })).toBe(false);
    expect(sameRepositoryAuthority(REPO_A, {
      ...REPO_A,
      localRepositoryId: '55555555-5555-4555-8555-555555555555',
    })).toBe(false);
  });

  test('non-Git roots use a daemon-minted UUID bound to canonical root device and inode', () => {
    expect(parseRepositoryAuthority(LOCAL_ROOT_A)).toEqual(LOCAL_ROOT_A);
    expect(sameRepositoryAuthority(LOCAL_ROOT_A, LOCAL_ROOT_B)).toBe(false);
    expect(sameRepositoryAuthority(LOCAL_ROOT_A, {
      ...LOCAL_ROOT_A,
      root: { ...LOCAL_ROOT_A.root, device: 99 },
    })).toBe(false);
    expect(sameRepositoryAuthority(LOCAL_ROOT_A, {
      ...LOCAL_ROOT_A,
      root: { ...LOCAL_ROOT_A.root, canonicalPath: '/srv/moved/non-git/project-a' },
    })).toBe(true);
  });

  test('a public catalog scope cannot carry a repository or private material', () => {
    expect(parseResourceScope({ ...PUBLIC_CATALOG, repository: REPO_A })).toBeNull();
    expect(parseResourceScope({ ...PUBLIC_CATALOG, containsPrivateMaterial: true })).toBeNull();
  });
});

describe('private operations fail closed at the explicit scope boundary', () => {
  test('a private operation with no explicit scope is denied', () => {
    const decision = authorizeScopedResource(request({ scopeId: undefined }), snapshot());
    expect(decision).toMatchObject({ allowed: false, code: 'SCOPE_REQUIRED' });
  });

  test.each([0, 'false'])('malformed private federated=%p is rejected instead of interpreted as local', (federated) => {
    expect(authorizeScopedResource(request({
      federated: federated as unknown as boolean,
    }), snapshot())).toMatchObject({ allowed: false, code: 'REQUEST_INVALID' });
  });

  test.each([
    ['search', 'search.read', 'search-index'],
    ['message', 'message.write', 'message'],
    ['lock', 'lock.write', 'lock'],
  ] as const)('same actor/session/device cannot use a repository-A grant for repository-B %s', (_label, action, resourceKind) => {
    const decision = authorizeScopedResource(request({
      scopeId: SCOPE_REPO_B.scopeId,
      action,
      resourceKind,
    }), snapshot());
    expect(decision).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });

  test('a repository grant intentionally covers sibling worktrees of that repository', () => {
    for (const scopeId of [SCOPE_WORKTREE_A1.scopeId, SCOPE_WORKTREE_A2.scopeId]) {
      expect(authorizeScopedResource(request({ scopeId }), snapshot())).toMatchObject({ allowed: true, code: 'ALLOWED' });
    }
  });

  test.each([
    ['account', { realm: { ...SCOPE_WORKTREE_A1.realm, accountId: 'account-other' } }],
    ['team', { realm: { ...SCOPE_WORKTREE_A1.realm, teamId: 'team-other' } }],
    ['harbor', { harborId: 'harbor-other-team' }],
    ['project', { projectId: 'project-other' }],
  ])('same repository authority does not bridge a changed %s lineage', (_label, change) => {
    const target = {
      ...SCOPE_WORKTREE_A1,
      ...change,
      scopeId: `scope-worktree-a-one-other-${_label}`,
    } satisfies ResourceScope;
    expect(authorizeScopedResource(request({ scopeId: target.scopeId }), snapshot([
      SCOPE_REPO_A,
      target,
    ], [GRANT_REPO_A]))).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });

  test('a non-Git local-root grant cannot cross to another root on the same user and device', () => {
    const rootGrant = grant('grant-local-root-a', SCOPE_LOCAL_ROOT_A);
    expect(authorizeScopedResource(request({
      scopeId: SCOPE_LOCAL_ROOT_B.scopeId,
      grantId: rootGrant.grantId,
    }), snapshot([SCOPE_LOCAL_ROOT_A, SCOPE_LOCAL_ROOT_B], [rootGrant])))
      .toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });

  test('a worktree grant covers only its exact worktree provenance', () => {
    const allowed = authorizeScopedResource(request({
      scopeId: SCOPE_WORKTREE_A1.scopeId,
      grantId: GRANT_WORKTREE_A1.grantId,
    }), snapshot());
    const denied = authorizeScopedResource(request({
      scopeId: SCOPE_WORKTREE_A2.scopeId,
      grantId: GRANT_WORKTREE_A1.grantId,
    }), snapshot());
    expect(allowed).toMatchObject({ allowed: true, code: 'ALLOWED' });
    expect(denied).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });
});

describe('opaque scope and exact request binding', () => {
  test('a forged unknown scope id is denied', () => {
    expect(authorizeScopedResource(request({ scopeId: 'scope-forged-by-request' }), snapshot()))
      .toMatchObject({ allowed: false, code: 'SCOPE_UNKNOWN' });
  });

  test('a conflicting duplicate definition makes an opaque scope id ambiguous and unusable', () => {
    const conflicting = { ...SCOPE_REPO_A, repository: REPO_B } satisfies ResourceScope;
    expect(authorizeScopedResource(request(), snapshot([
      SCOPE_REPO_A,
      conflicting,
    ], [GRANT_REPO_A]))).toMatchObject({ allowed: false, code: 'SCOPE_AMBIGUOUS' });
  });

  test('a grant cannot be replayed against a different body', () => {
    expect(authorizeScopedResource(request({ bodyDigest: BODY_B }), snapshot()))
      .toMatchObject({ allowed: false, code: 'BODY_MISMATCH' });
  });

  test.each([
    ['principal', { principal: {
      actorId: '01M1OTHERACTOR000000000000',
      soulClass: 'operator' as const,
      deviceId: DEVICE,
      perspectiveId: PERSPECTIVE,
    } }, 'PRINCIPAL_MISMATCH'],
    ['device', { principal: {
      actorId: ACTOR,
      soulClass: 'operator' as const,
      deviceId: 'device-other',
      perspectiveId: PERSPECTIVE,
    } }, 'DEVICE_MISMATCH'],
    ['perspective', { principal: {
      actorId: ACTOR,
      soulClass: 'operator' as const,
      deviceId: DEVICE,
      perspectiveId: 'perspective-other',
    } }, 'PERSPECTIVE_MISMATCH'],
    ['session', { sessionId: 'session-other' }, 'SESSION_MISMATCH'],
    ['action', { action: 'salvage.import' as const, resourceKind: 'legacy-row' as const }, 'ACTION_DENIED'],
    ['audience', { audience: 'some-other-service' }, 'AUDIENCE_MISMATCH'],
  ])('rejects a mismatched %s binding', (_label, override, code) => {
    const narrowGrant = { ...GRANT_REPO_A, actions: ['search.read'] as const };
    expect(authorizeScopedResource(request(override), snapshot(undefined, [narrowGrant])))
      .toMatchObject({ allowed: false, code });
  });

  test('an expired grant is denied', () => {
    const expired = grant('grant-expired', SCOPE_REPO_A, { expiresAtMs: NOW - 1 });
    expect(authorizeScopedResource(request({ grantId: expired.grantId }), snapshot(undefined, [expired])))
      .toMatchObject({ allowed: false, code: 'GRANT_EXPIRED' });
  });

  test('expiry is inclusive at the exact millisecond and denied one millisecond later', () => {
    const exactExpiry = grant('grant-exact-expiry', SCOPE_REPO_A, { expiresAtMs: NOW });
    const snap = snapshot(undefined, [exactExpiry]);
    expect(authorizeScopedResource(request({
      grantId: exactExpiry.grantId,
      nowMs: NOW,
    }), snap)).toMatchObject({ allowed: true, code: 'ALLOWED' });
    expect(authorizeScopedResource(request({
      grantId: exactExpiry.grantId,
      nowMs: NOW + 1,
    }), snap)).toMatchObject({ allowed: false, code: 'GRANT_EXPIRED' });
  });

  test('a revoked grant is denied before use', () => {
    expect(authorizeScopedResource(request(), snapshot(undefined, [GRANT_REPO_A], [GRANT_REPO_A.grantId])))
      .toMatchObject({ allowed: false, code: 'GRANT_REVOKED' });
  });

  test('egress host, Harbor envelope action, and cost are all exact grant boundaries', () => {
    const egressGrant: ResolvedScopeGrant = {
      ...GRANT_REPO_A,
      grantId: 'grant-exact-egress-and-cost',
      verifiedMacaroonCaveats: [
        ...GRANT_REPO_A.verifiedMacaroonCaveats,
        hostCaveat('api.portdaddy.dev'),
      ],
    };
    const snap = snapshot(undefined, [egressGrant]);
    expect(authorizeScopedResource(request({
      grantId: egressGrant.grantId,
      costUsd: 1,
      egressHost: 'api.portdaddy.dev',
      envelopeAction: { kind: 'tool', name: 'semantic-index' },
    }), snap)).toMatchObject({ allowed: true });
    expect(authorizeScopedResource(request({
      grantId: egressGrant.grantId,
      costUsd: 1,
      egressHost: 'api.attacker.invalid',
      envelopeAction: { kind: 'tool', name: 'semantic-index' },
    }), snap)).toMatchObject({ allowed: false, code: 'MACAROON_CONTEXT_DENIED' });
    expect(authorizeScopedResource(request({
      grantId: egressGrant.grantId,
      costUsd: 2.01,
      egressHost: 'api.portdaddy.dev',
      envelopeAction: { kind: 'tool', name: 'semantic-index' },
    }), snap)).toMatchObject({ allowed: false, code: 'MACAROON_CONTEXT_DENIED' });
    expect(authorizeScopedResource(request({
      grantId: egressGrant.grantId,
      costUsd: 1,
      egressHost: 'api.portdaddy.dev',
      envelopeAction: { kind: 'tool', name: 'unlisted-tool' },
    }), snap)).toMatchObject({ allowed: false, code: 'ENVELOPE_DENIED' });
  });

  test('a grant projection without the immutable repository caveat is denied', () => {
    const underBound: ResolvedScopeGrant = {
      ...GRANT_REPO_A,
      grantId: 'grant-without-repository-caveat',
      verifiedMacaroonCaveats: GRANT_REPO_A.verifiedMacaroonCaveats.filter(
        (caveat) => parseCaveat(caveat)?.field !== 'repo',
      ),
    };
    expect(authorizeScopedResource(request({ grantId: underBound.grantId }), snapshot(undefined, [underBound])))
      .toMatchObject({ allowed: false, code: 'MACAROON_CONTEXT_DENIED' });
  });
});

describe('vector search filters by authorized scope before similarity ranking', () => {
  test('a higher-scoring foreign vector is removed by the scope prefilter', () => {
    const result = prefilterAuthorizedVectors(request({
      action: 'vector.read',
      resourceKind: 'vector',
      embeddingSpace: EMBEDDING_SPACE,
    }), [
      { id: 'foreign-high-score', scopeId: SCOPE_REPO_B.scopeId, embeddingSpace: EMBEDDING_SPACE, similarity: 0.999 },
      { id: 'authorized-lower-score', scopeId: SCOPE_REPO_A.scopeId, embeddingSpace: EMBEDDING_SPACE, similarity: 0.51 },
    ], snapshot());
    expect(result.decision).toMatchObject({ allowed: true });
    expect(result.candidates).toEqual([
      { id: 'authorized-lower-score', scopeId: SCOPE_REPO_A.scopeId, embeddingSpace: EMBEDDING_SPACE, similarity: 0.51 },
    ]);
    expect(result.rejections).toContainEqual({ id: 'foreign-high-score', code: 'VECTOR_SCOPE_MISMATCH' });
  });

  test.each([
    ['space id', { spaceId: 'embedding-space-other' }],
    ['provider', { provider: 'remote-provider' }],
    ['model', { model: 'some-other-model' }],
    ['model revision', { modelRevision: 'unrelated' }],
    ['model digest', { modelDigest: `sha256:${'3'.repeat(64)}` }],
    ['pooling', { pooling: 'cls' }],
    ['preprocessing', { preprocessingDigest: `sha256:${'4'.repeat(64)}` }],
    ['distance metric', { distanceMetric: 'dot-product' as const }],
    ['dimensions', { dimensions: 768 }],
    ['normalization', { normalized: false }],
  ])('a same-scope candidate with mismatched %s is denied before ranking', (_label, override) => {
    const incompatibleSpace = embeddingSpace(override);
    const result = prefilterAuthorizedVectors(request({
      action: 'vector.read',
      resourceKind: 'vector',
      embeddingSpace: EMBEDDING_SPACE,
    }), [
      { id: 'wrong-vector-space', scopeId: SCOPE_REPO_A.scopeId, embeddingSpace: incompatibleSpace, similarity: 1 },
      { id: 'right-vector-space', scopeId: SCOPE_REPO_A.scopeId, embeddingSpace: EMBEDDING_SPACE, similarity: 0.5 },
    ], snapshot());
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['right-vector-space']);
    expect(result.rejections).toContainEqual({ id: 'wrong-vector-space', code: 'VECTOR_SPACE_MISMATCH' });
  });

  test('a forged embedding descriptor digest is denied before ranking', () => {
    const result = prefilterAuthorizedVectors(request({
      action: 'vector.read',
      resourceKind: 'vector',
      embeddingSpace: EMBEDDING_SPACE,
    }), [{
      id: 'forged-descriptor',
      scopeId: SCOPE_REPO_A.scopeId,
      embeddingSpace: { ...EMBEDDING_SPACE, descriptorDigest: `sha256:${'f'.repeat(64)}` },
      similarity: 1,
    }], snapshot());
    expect(result.candidates).toEqual([]);
    expect(result.rejections).toEqual([{ id: 'forged-descriptor', code: 'VECTOR_SPACE_MISMATCH' }]);
  });

  test('an unauthorized query receives no vector candidates at all', () => {
    const result = prefilterAuthorizedVectors(request({
      scopeId: SCOPE_REPO_B.scopeId,
      action: 'vector.read',
      resourceKind: 'vector',
      embeddingSpace: EMBEDDING_SPACE,
    }), [
      { id: 'foreign', scopeId: SCOPE_REPO_B.scopeId, embeddingSpace: EMBEDDING_SPACE, similarity: 1 },
    ], snapshot());
    expect(result.decision).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
    expect(result.candidates).toEqual([]);
  });
});

describe('public catalog, actor activity, and legacy quarantine separation', () => {
  test('global public catalog metadata is readable without a private grant, including federated reads', () => {
    expect(authorizeScopedResource(request({
      scopeId: PUBLIC_CATALOG.scopeId,
      grantId: undefined,
      principal: undefined,
      sessionId: undefined,
      bodyDigest: undefined,
      action: 'catalog.read',
      resourceKind: 'catalog-entry',
      federated: true,
    }), snapshot())).toMatchObject({ allowed: true, code: 'PUBLIC_CATALOG' });
  });

  test.each([0, 'false'])('malformed public-catalog federated=%p is rejected before classification', (federated) => {
    expect(authorizeScopedResource(request({
      scopeId: PUBLIC_CATALOG.scopeId,
      grantId: undefined,
      principal: undefined,
      sessionId: undefined,
      bodyDigest: undefined,
      action: 'catalog.read',
      resourceKind: 'catalog-entry',
      federated: federated as unknown as boolean,
    }), snapshot())).toMatchObject({ allowed: false, code: 'REQUEST_INVALID' });
  });

  test.each(['actor-activity', 'session-activity', 'attention-event'] as const)(
    '%s is private coordination metadata, never public catalog material',
    (resourceKind) => {
      expect(authorizeScopedResource(request({
        scopeId: PUBLIC_CATALOG.scopeId,
        grantId: undefined,
        action: 'activity.read',
        resourceKind,
      }), snapshot())).toMatchObject({ allowed: false, code: 'PUBLIC_RESOURCE_DENIED' });
    },
  );

  test('ambiguous legacy rows are visible only to operator salvage authority', () => {
    const quarantineGrant = grant('grant-legacy-quarantine', LEGACY_QUARANTINE, {
      actions: ['salvage.read', 'salvage.import'],
    });
    const snap = snapshot(undefined, [quarantineGrant]);
    expect(authorizeScopedResource(request({
      scopeId: LEGACY_QUARANTINE.scopeId,
      grantId: quarantineGrant.grantId,
      principal: {
        actorId: ACTOR,
        soulClass: 'graduated',
        deviceId: DEVICE,
        perspectiveId: PERSPECTIVE,
      },
      action: 'salvage.read',
      resourceKind: 'legacy-row',
    }), snap)).toMatchObject({ allowed: false, code: 'QUARANTINE_OPERATOR_REQUIRED' });
    expect(authorizeScopedResource(request({
      scopeId: LEGACY_QUARANTINE.scopeId,
      grantId: quarantineGrant.grantId,
      action: 'salvage.read',
      resourceKind: 'legacy-row',
    }), snap)).toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('operator status does not expose quarantine from another device, store, or federation path', () => {
    const quarantineGrant = grant('grant-local-quarantine-boundary', LEGACY_QUARANTINE, {
      actions: ['salvage.read'],
    });
    const snap = snapshot(undefined, [quarantineGrant]);
    expect(authorizeScopedResource(request({
      scopeId: LEGACY_QUARANTINE.scopeId,
      grantId: quarantineGrant.grantId,
      action: 'salvage.read',
      resourceKind: 'legacy-row',
      principal: {
        actorId: ACTOR,
        soulClass: 'operator',
        deviceId: 'device-other',
        perspectiveId: PERSPECTIVE,
      },
    }), snap)).toMatchObject({ allowed: false, code: 'DEVICE_MISMATCH' });
    expect(authorizeScopedResource(request({
      scopeId: LEGACY_QUARANTINE.scopeId,
      grantId: quarantineGrant.grantId,
      action: 'salvage.read',
      resourceKind: 'legacy-row',
      sourceStoreId: 'store-other',
    }), snap)).toMatchObject({ allowed: false, code: 'QUARANTINE_SOURCE_MISMATCH' });
    expect(authorizeScopedResource(request({
      scopeId: LEGACY_QUARANTINE.scopeId,
      grantId: quarantineGrant.grantId,
      action: 'salvage.read',
      resourceKind: 'legacy-row',
      federated: true,
    }), snap)).toMatchObject({ allowed: false, code: 'FEDERATION_DENIED' });
  });

  test.each([undefined, '', '   '])(
    'quarantine requires an explicit well-formed source store id (%p)',
    (sourceStoreId) => {
      const quarantineGrant = grant('grant-required-quarantine-source', LEGACY_QUARANTINE, {
        actions: ['salvage.read'],
      });
      expect(authorizeScopedResource(request({
        scopeId: LEGACY_QUARANTINE.scopeId,
        grantId: quarantineGrant.grantId,
        action: 'salvage.read',
        resourceKind: 'legacy-row',
        sourceStoreId,
      }), snapshot(undefined, [quarantineGrant]))).toMatchObject({
        allowed: false,
        code: 'QUARANTINE_SOURCE_REQUIRED',
      });
    },
  );
});

describe('federation and grant attenuation cannot create action authority', () => {
  test('local authority is not implicitly federated', () => {
    expect(authorizeScopedResource(request({ federated: true }), snapshot()))
      .toMatchObject({ allowed: false, code: 'FEDERATION_DENIED' });
  });

  test('a read-only federation grant permits a read but never a write', () => {
    const federatedRead = grant('grant-federated-read', SCOPE_REPO_A, {
      actions: ['search.read', 'message.read', 'lock.read', 'vector.read'],
      federation: 'read-only',
    });
    const snap = snapshot(undefined, [federatedRead]);
    expect(authorizeScopedResource(request({
      grantId: federatedRead.grantId,
      federated: true,
      action: 'search.read',
    }), snap)).toMatchObject({ allowed: true });
    expect(authorizeScopedResource(request({
      grantId: federatedRead.grantId,
      federated: true,
      action: 'message.write',
      resourceKind: 'message',
    }), snap)).toMatchObject({ allowed: false, code: 'ACTION_DENIED' });
  });

  test('attenuation cannot add read-only federation to a local-only parent', () => {
    const attempted = {
      ...GRANT_REPO_A,
      grantId: 'attempt-add-federation',
      actions: ['search.read'] as const,
      remainingDelegations: 1,
      federation: 'read-only' as const,
    };
    expect(assessScopeGrantAttenuation(GRANT_REPO_A, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test('attenuation may remove federation from a read-only parent', () => {
    const parent = grant('grant-read-only-parent', SCOPE_REPO_A, {
      actions: ['search.read', 'message.read'],
      federation: 'read-only',
    });
    const child = grant('grant-local-only-child', SCOPE_REPO_A, {
      actions: ['search.read'],
      remainingDelegations: 1,
      federation: 'none',
      verifiedMacaroonCaveats: [...parent.verifiedMacaroonCaveats],
    });
    expect(assessScopeGrantAttenuation(parent, child))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
  });

  test('a legitimate child narrows actions, expiry, delegation, budget, egress, and macaroon caveats', () => {
    const child = grant('grant-child', SCOPE_REPO_A, {
      actions: ['search.read'],
      expiresAtMs: NOW + 30_000,
      remainingDelegations: 1,
      envelope: {
        ...GRANT_REPO_A.envelope,
        tools: ['semantic-index'],
        mcps: [],
        budgetUsd: 1,
      },
      verifiedMacaroonCaveats: [
        ...GRANT_REPO_A.verifiedMacaroonCaveats,
        expiresCaveat(NOW + 30_000),
        hostCaveat('api.portdaddy.dev'),
        spendCeilingCaveat(1),
      ],
    });
    expect(assessScopeGrantAttenuation(GRANT_REPO_A, child))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
  });

  test.each([
    ['actions', { actions: [...GRANT_REPO_A.actions, 'catalog.read'] }],
    ['budget', { envelope: { ...GRANT_REPO_A.envelope, budgetUsd: 3 } }],
    ['delegation', { remainingDelegations: GRANT_REPO_A.remainingDelegations }],
    ['scope', { scopeId: SCOPE_REPO_B.scopeId }],
    ['device', { deviceId: 'device-other' }],
    ['perspective', { perspectiveId: 'perspective-other' }],
    ['audience', { audience: 'audience-other' }],
    ['macaroon ceiling', {
      verifiedMacaroonCaveats: [
        ...GRANT_REPO_A.verifiedMacaroonCaveats,
        spendCeilingCaveat(100),
      ],
    }],
  ])('rejects attempted %s escalation', (_label, override) => {
    const attempted = { ...GRANT_REPO_A, grantId: `attempt-${_label}`, ...override } as ResolvedScopeGrant;
    expect(assessScopeGrantAttenuation(GRANT_REPO_A, attempted).allowed).toBe(false);
  });
});
