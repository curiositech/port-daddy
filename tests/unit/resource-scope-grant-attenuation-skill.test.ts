/**
 * Executable hostile-chain contract for the ResourceScope attenuation skill.
 *
 * The suite calls the merged public kernel rather than implementing a second
 * validator. Each mutation changes one authority dimension so failures identify
 * the exact boundary that would otherwise permit a delegated privilege gain.
 */
import {
  assessScopeGrantAttenuation,
  authorizeScopedResource,
  repositoryAuthorityKey,
  type RepositoryAuthorityRef,
  type ResolvedScopeGrant,
  type ResourceScope,
  type ScopeKernelSnapshot,
  type ScopedResourceIntent,
  type VerifiedScopeEvaluationContext,
} from '../../lib/resource-scope.js';
import type { HarborEnvelope } from '../../lib/harbor-envelope.js';
import {
  expiresCaveat,
  hostCaveat,
  opCaveat,
  repoCaveat,
  sessionCaveat,
  spendCeilingCaveat,
} from '../../lib/macaroon/caveats.js';

const NOW = 1_788_244_000_000;
const BODY = `sha256:${'a'.repeat(64)}`;
const ACTOR = '01M1ATTENUATIONACTOR0000000';
const DEVICE = 'device-scope-red-team';
const PERSPECTIVE = 'perspective-scope-red-team';
const SESSION = 'session-scope-red-team';
const AUDIENCE = 'pd-daemon-resource-api';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

const REPOSITORY_A: RepositoryAuthorityRef = deepFreeze({
  kind: 'forge',
  forge: 'github.com',
  repositoryId: '10001',
});

const REPOSITORY_B: RepositoryAuthorityRef = deepFreeze({
  kind: 'forge',
  forge: 'github.com',
  repositoryId: '10002',
});

function scope(
  scopeId: string,
  repository: RepositoryAuthorityRef,
  world: ResourceScope['world'],
): ResourceScope {
  return deepFreeze({
    schema: 'pd.resource-scope.v1',
    scopeId,
    realm: { accountId: 'account-red-team', teamId: 'team-red-team' },
    harborId: 'harbor-red-team',
    projectId: 'same-display-project',
    repository,
    world,
    classification: 'private-project',
    containsPrivateMaterial: true,
  });
}

const SCOPE_REPOSITORY_A = scope(
  'scope-repository-a',
  REPOSITORY_A,
  { kind: 'repository', id: 'repository-a' },
);
const SCOPE_WORKTREE_A = scope(
  'scope-worktree-a',
  REPOSITORY_A,
  {
    kind: 'worktree',
    id: 'worktree-a',
    workspace: { canonicalPath: '/srv/worktrees/a', device: 7, inode: 101 },
  },
);
const SCOPE_WORKTREE_A_SIBLING = scope(
  'scope-worktree-a-sibling',
  REPOSITORY_A,
  {
    kind: 'worktree',
    id: 'worktree-a-sibling',
    workspace: { canonicalPath: '/srv/worktrees/a-sibling', device: 7, inode: 102 },
  },
);
const SCOPE_REPOSITORY_B = scope(
  'scope-repository-b',
  REPOSITORY_B,
  { kind: 'repository', id: 'repository-b' },
);
const SCOPE_REPOSITORY_A_ALIAS = scope(
  'scope-repository-a-alias',
  REPOSITORY_A,
  { kind: 'repository', id: 'different-display-id-same-authority' },
);
const SCOPE_REPOSITORY_A_TEAM_SHARED = deepFreeze({
  ...SCOPE_REPOSITORY_A,
  scopeId: 'scope-repository-a-team-shared',
  classification: 'team-shared' as const,
});

const ROOT_ENVELOPE: HarborEnvelope = deepFreeze({
  filesystem: ['/srv/repository-a', '/srv/repository-a/docs'],
  tools: ['semantic-index', 'read-file'],
  skills: ['resource-scope-grant-attenuation', 'macaroon-capability-credentials'],
  mcps: ['resource-store', 'coordination'],
  backends: ['local-model', 'hosted-model'],
  channels: ['team-red', 'audit'],
  budgetUsd: 10,
});

function grant(
  grantId: string,
  anchor: ResourceScope,
  overrides: Partial<ResolvedScopeGrant> = {},
): ResolvedScopeGrant {
  const expiresAtMs = overrides.expiresAtMs ?? NOW + 60_000;
  const envelope = overrides.envelope ?? ROOT_ENVELOPE;
  const verifiedMacaroonCaveats = overrides.verifiedMacaroonCaveats ?? [
    opCaveat('api-call'),
    repoCaveat(repositoryAuthorityKey(anchor.repository!)),
    sessionCaveat(SESSION),
    expiresCaveat(expiresAtMs),
    spendCeilingCaveat(envelope.budgetUsd ?? 1_000_000),
  ];
  return {
    schema: 'pd.resolved-scope-grant.v1',
    grantId,
    scopeId: anchor.scopeId,
    principalActorId: ACTOR,
    deviceId: DEVICE,
    perspectiveId: PERSPECTIVE,
    sessionId: SESSION,
    bodyDigest: BODY,
    actions: ['search.read', 'message.read', 'message.write'],
    audience: AUDIENCE,
    expiresAtMs,
    remainingDelegations: 3,
    envelope,
    verifiedMacaroonCaveats,
    federation: 'none',
    ...overrides,
  };
}

function childGrant(
  parent: ResolvedScopeGrant,
  grantId: string,
  overrides: Partial<ResolvedScopeGrant> = {},
): ResolvedScopeGrant {
  const expiresAtMs = overrides.expiresAtMs ?? parent.expiresAtMs - 10_000;
  const envelope = overrides.envelope ?? {
    filesystem: ['/srv/repository-a'],
    tools: ['semantic-index'],
    skills: ['resource-scope-grant-attenuation'],
    mcps: ['resource-store'],
    backends: ['local-model'],
    channels: ['team-red'],
    budgetUsd: 5,
  };
  const verifiedMacaroonCaveats = overrides.verifiedMacaroonCaveats ?? [
    ...parent.verifiedMacaroonCaveats,
    expiresCaveat(expiresAtMs),
    hostCaveat('api.portdaddy.dev'),
    spendCeilingCaveat(envelope.budgetUsd ?? 1_000_000),
  ];
  return {
    ...parent,
    grantId,
    actions: ['search.read', 'message.read'],
    expiresAtMs,
    remainingDelegations: parent.remainingDelegations - 1,
    envelope,
    verifiedMacaroonCaveats,
    ...overrides,
  };
}

function intent(overrides: Partial<ScopedResourceIntent> = {}): ScopedResourceIntent {
  return {
    scopeId: SCOPE_WORKTREE_A.scopeId,
    grantId: LEAF.grantId,
    sessionId: SESSION,
    bodyDigest: BODY,
    action: 'search.read',
    audience: AUDIENCE,
    resourceKind: 'search-index',
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<VerifiedScopeEvaluationContext> = {},
): VerifiedScopeEvaluationContext {
  return {
    principal: {
      actorId: ACTOR,
      soulClass: 'operator',
      deviceId: DEVICE,
      perspectiveId: PERSPECTIVE,
    },
    nowMs: NOW,
    costUsd: 1,
    federated: false,
    egressHost: 'api.portdaddy.dev',
    ...overrides,
  };
}

function snapshot(
  grants: readonly unknown[] = [ROOT, WORKER, LEAF],
  revokedGrantIds: readonly string[] = [],
): ScopeKernelSnapshot {
  return {
    scopes: [
      SCOPE_REPOSITORY_A,
      SCOPE_WORKTREE_A,
      SCOPE_WORKTREE_A_SIBLING,
      SCOPE_REPOSITORY_A_ALIAS,
      SCOPE_REPOSITORY_A_TEAM_SHARED,
      SCOPE_REPOSITORY_B,
    ],
    grants,
    revokedGrantIds,
  };
}

const ROOT = deepFreeze(grant('grant-root', SCOPE_REPOSITORY_A));
const WORKER = deepFreeze(childGrant(ROOT, 'grant-worker'));
const LEAF = deepFreeze(childGrant(WORKER, 'grant-leaf', {
  actions: ['search.read'],
  remainingDelegations: 1,
  envelope: {
    filesystem: ['/srv/repository-a'],
    tools: ['semantic-index'],
    skills: ['resource-scope-grant-attenuation'],
    mcps: ['resource-store'],
    backends: ['local-model'],
    channels: ['team-red'],
    budgetUsd: 1,
  },
}));

describe('ResourceScope hostile multi-hop attenuation', () => {
  test('checks every adjacent hop before authorizing the leaf', () => {
    expect(assessScopeGrantAttenuation(ROOT, WORKER))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
    expect(assessScopeGrantAttenuation(WORKER, LEAF))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
    expect(authorizeScopedResource(intent(), evaluation(), snapshot()))
      .toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('a root-to-leaf check cannot hide a malicious intermediate hop', () => {
    const maliciousWorker = {
      ...WORKER,
      grantId: 'grant-malicious-worker',
      actions: [...ROOT.actions, 'catalog.read'],
    } as ResolvedScopeGrant;

    expect(assessScopeGrantAttenuation(ROOT, LEAF))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
    expect(assessScopeGrantAttenuation(ROOT, maliciousWorker))
      .toMatchObject({
        allowed: false,
        code: 'ATTENUATION_DENIED',
        reason: 'child adds an action',
      });
    expect(assessScopeGrantAttenuation(maliciousWorker, LEAF))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
  });

  test.each([
    ['scope', { scopeId: SCOPE_REPOSITORY_B.scopeId }],
    ['actor', { principalActorId: 'actor-attacker' }],
    ['device', { deviceId: 'device-attacker' }],
    ['perspective', { perspectiveId: 'perspective-attacker' }],
    ['session', { sessionId: 'session-attacker' }],
    ['body', { bodyDigest: `sha256:${'b'.repeat(64)}` }],
    ['audience', { audience: 'attacker-service' }],
  ] as const)('denies immutable %s rebinding at one hop', (_label, override) => {
    const attempted = { ...WORKER, grantId: `attack-${_label}`, ...override } as ResolvedScopeGrant;
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test('denies action, expiry, and delegation-depth widening', () => {
    expect(assessScopeGrantAttenuation(ROOT, {
      ...WORKER,
      grantId: 'attack-action',
      actions: [...ROOT.actions, 'catalog.read'],
    })).toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
    expect(assessScopeGrantAttenuation(ROOT, {
      ...WORKER,
      grantId: 'attack-expiry',
      expiresAtMs: ROOT.expiresAtMs + 1,
      verifiedMacaroonCaveats: [
        ...ROOT.verifiedMacaroonCaveats,
        expiresCaveat(ROOT.expiresAtMs + 1),
      ],
    })).toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
    expect(assessScopeGrantAttenuation(ROOT, {
      ...WORKER,
      grantId: 'attack-depth',
      remainingDelegations: ROOT.remainingDelegations,
    })).toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });
});

describe('ResourceScope envelope and caveat attenuation', () => {
  test.each([
    ['filesystem', '/srv/foreign'],
    ['tools', 'shell-root'],
    ['skills', 'credential-mint'],
    ['mcps', 'foreign-store'],
    ['backends', 'untrusted-backend'],
    ['channels', 'foreign-channel'],
  ] as const)('denies widening the %s allowlist', (dimension, extra) => {
    const attempted = {
      ...WORKER,
      grantId: `attack-envelope-${dimension}`,
      envelope: {
        ...WORKER.envelope,
        [dimension]: [...WORKER.envelope[dimension], extra],
      },
    };
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test.each([
    'filesystem',
    'tools',
    'skills',
    'mcps',
    'backends',
    'channels',
  ] as const)('denies replacing the finite %s allowlist with a wildcard', (dimension) => {
    const attempted = {
      ...WORKER,
      grantId: `attack-envelope-${dimension}-wildcard`,
      envelope: { ...WORKER.envelope, [dimension]: ['*'] },
    };
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test.each([
    ['higher ceiling', 10.01],
    ['unbounded ceiling', null],
  ] as const)('denies a %s beyond the parent budget', (_label, budgetUsd) => {
    const attempted = {
      ...WORKER,
      grantId: `attack-budget-${_label}`,
      envelope: { ...WORKER.envelope, budgetUsd },
    };
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test.each([
    ['removed inherited ceiling', WORKER.verifiedMacaroonCaveats.filter(
      (caveat) => caveat !== spendCeilingCaveat(ROOT.envelope.budgetUsd ?? 1_000_000),
    )],
    ['reordered prefix', [
      ROOT.verifiedMacaroonCaveats[1],
      ROOT.verifiedMacaroonCaveats[0],
      ...WORKER.verifiedMacaroonCaveats.slice(2),
    ]],
    ['looser spend ceiling', [...WORKER.verifiedMacaroonCaveats, spendCeilingCaveat(100)]],
  ] as const)('denies an otherwise-valid chain with %s', (_label, caveats) => {
    const attempted = {
      ...WORKER,
      grantId: `attack-caveat-${_label}`,
      verifiedMacaroonCaveats: caveats,
    } as ResolvedScopeGrant;
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({
        allowed: false,
        code: 'ATTENUATION_DENIED',
        reason: 'child macaroon constraints are not append-only attenuation',
      });
  });

  test.each([
    ['unknown field', 'mystery = allow-all'],
    ['invalid field/operator pair', `repo <= ${repositoryAuthorityKey(REPOSITORY_A)}`],
  ] as const)('%s fails parsing at attenuation and authorization', (_label, candidate) => {
    const malformed = {
      ...LEAF,
      grantId: `grant-${_label}`,
      verifiedMacaroonCaveats: [...LEAF.verifiedMacaroonCaveats, candidate],
    } as ResolvedScopeGrant;
    expect(assessScopeGrantAttenuation(WORKER, malformed))
      .toMatchObject({
        allowed: false,
        code: 'ATTENUATION_DENIED',
        reason: 'parent or child grant is malformed or reuses the same id',
      });
    expect(authorizeScopedResource(
      intent({ grantId: malformed.grantId }),
      evaluation(),
      snapshot([malformed]),
    )).toMatchObject({ allowed: false, code: 'GRANT_INVALID' });
  });

  test('records the unresolved numeric-caveat gap before terminal denial', () => {
    const semanticallyMalformed = {
      ...LEAF,
      grantId: 'grant-nonnumeric-spend',
      verifiedMacaroonCaveats: [
        ...LEAF.verifiedMacaroonCaveats,
        'spend_usd <= banana',
      ],
    } as ResolvedScopeGrant;
    expect(assessScopeGrantAttenuation(WORKER, semanticallyMalformed))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
    expect(authorizeScopedResource(
      intent({ grantId: semanticallyMalformed.grantId }),
      evaluation(),
      snapshot([semanticallyMalformed]),
    )).toMatchObject({ allowed: false, code: 'MACAROON_CONTEXT_DENIED' });
  });
});

describe('ResourceScope revocation and expiry', () => {
  test('an exact revoked leaf is rejected before use', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      snapshot([ROOT, WORKER, LEAF], [LEAF.grantId]),
    ))
      .toMatchObject({ allowed: false, code: 'GRANT_REVOKED' });
  });

  test('revocation is exact rather than substring-based', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      snapshot([ROOT, WORKER, LEAF], [`${LEAF.grantId}-near-match`]),
    )).toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('revoking an ancestor does not invent cascade semantics', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      snapshot([ROOT, WORKER, LEAF], [ROOT.grantId]),
    )).toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('expiry is inclusive, then fails closed one millisecond later', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation({ nowMs: LEAF.expiresAtMs }),
      snapshot(),
    )).toMatchObject({ allowed: true, code: 'ALLOWED' });
    expect(authorizeScopedResource(
      intent(),
      evaluation({ nowMs: LEAF.expiresAtMs + 1 }),
      snapshot(),
    )).toMatchObject({ allowed: false, code: 'GRANT_EXPIRED' });
  });
});

describe('ResourceScope snapshot boundaries', () => {
  test('malformed top-level snapshot collections fail closed', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      { scopes: 'not-an-array', grants: [] },
    )).toMatchObject({ allowed: false, code: 'SNAPSHOT_INVALID' });
  });

  test('duplicate authoritative grant ids are ambiguous', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      snapshot([LEAF, { ...LEAF }]),
    )).toMatchObject({ allowed: false, code: 'GRANT_AMBIGUOUS' });
  });

  test('duplicate revoked ids invalidate the whole snapshot', () => {
    expect(authorizeScopedResource(
      intent(),
      evaluation(),
      snapshot([LEAF], [LEAF.grantId, LEAF.grantId]),
    )).toMatchObject({ allowed: false, code: 'SNAPSHOT_INVALID' });
  });

  test('a malformed target scope record is never coerced', () => {
    const malformedTarget = {
      ...SCOPE_WORKTREE_A,
      repository: { kind: 'forge', forge: 'github.com' },
    };
    const malformedSnapshot = {
      ...snapshot([LEAF]),
      scopes: [SCOPE_REPOSITORY_A, malformedTarget],
    };
    expect(authorizeScopedResource(intent(), evaluation(), malformedSnapshot))
      .toMatchObject({ allowed: false, code: 'SCOPE_INVALID' });
  });
});

describe('ResourceScope repository and world isolation', () => {
  test('a repository anchor covers its exact descendant worktree', () => {
    expect(authorizeScopedResource(intent(), evaluation(), snapshot()))
      .toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('repository-world display ids do not override immutable repository authority', () => {
    expect(authorizeScopedResource(
      intent({ scopeId: SCOPE_REPOSITORY_A_ALIAS.scopeId }),
      evaluation(),
      snapshot(),
    )).toMatchObject({ allowed: true, code: 'ALLOWED' });
  });

  test('ambiently similar project metadata cannot bridge repositories', () => {
    expect(authorizeScopedResource(
      intent({ scopeId: SCOPE_REPOSITORY_B.scopeId }),
      evaluation(),
      snapshot(),
    )).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });

  test('classification changes cannot bridge an otherwise identical repository', () => {
    expect(authorizeScopedResource(
      intent({ scopeId: SCOPE_REPOSITORY_A_TEAM_SHARED.scopeId }),
      evaluation(),
      snapshot(),
    )).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });

  test('a worktree grant cannot authorize a sibling worktree', () => {
    const worktreeRoot = grant('grant-worktree-root', SCOPE_WORKTREE_A);
    const worktreeLeaf = childGrant(worktreeRoot, 'grant-worktree-leaf', {
      actions: ['search.read'],
      remainingDelegations: 1,
    });
    expect(authorizeScopedResource(
      intent({
        scopeId: SCOPE_WORKTREE_A_SIBLING.scopeId,
        grantId: worktreeLeaf.grantId,
      }),
      evaluation(),
      snapshot([worktreeLeaf]),
    )).toMatchObject({ allowed: false, code: 'GRANT_SCOPE_MISMATCH' });
  });
});

describe('ResourceScope federation never creates action authority', () => {
  test('a local parent cannot attenuate into a federated child', () => {
    const attempted = {
      ...WORKER,
      grantId: 'attack-add-federation',
      actions: ['search.read'] as const,
      federation: 'read-only' as const,
    };
    expect(assessScopeGrantAttenuation(ROOT, attempted))
      .toMatchObject({ allowed: false, code: 'ATTENUATION_DENIED' });
  });

  test('a read-only parent may narrow to a local-only child', () => {
    const parent = grant('grant-federated-parent', SCOPE_REPOSITORY_A, {
      actions: ['search.read', 'message.read'],
      federation: 'read-only',
    });
    const child = childGrant(parent, 'grant-local-child', {
      actions: ['search.read'],
      federation: 'none',
    });
    expect(assessScopeGrantAttenuation(parent, child))
      .toMatchObject({ allowed: true, code: 'ATTENUATION_ALLOWED' });
  });

  test('a read-only federated grant permits a read but not a write', () => {
    const federated = grant('grant-federated-read', SCOPE_REPOSITORY_A, {
      actions: ['search.read'],
      remainingDelegations: 1,
      federation: 'read-only',
    });
    const federatedSnapshot = snapshot([federated]);
    expect(authorizeScopedResource(
      intent({ grantId: federated.grantId }),
      evaluation({ federated: true, egressHost: undefined }),
      federatedSnapshot,
    )).toMatchObject({ allowed: true, code: 'ALLOWED' });
    expect(authorizeScopedResource(
      intent({
        grantId: federated.grantId,
        action: 'message.write',
        resourceKind: 'message',
      }),
      evaluation({ federated: true, egressHost: undefined }),
      federatedSnapshot,
    )).toMatchObject({ allowed: false, code: 'ACTION_DENIED' });
  });

  test('a read-only projection carrying a write action is invalid', () => {
    const malformed = grant('grant-federated-write', SCOPE_REPOSITORY_A, {
      actions: ['search.read', 'message.write'],
      federation: 'read-only',
    });
    expect(authorizeScopedResource(
      intent({ grantId: malformed.grantId }),
      evaluation({ federated: true, egressHost: undefined }),
      snapshot([malformed]),
    )).toMatchObject({ allowed: false, code: 'GRANT_INVALID' });
  });
});
