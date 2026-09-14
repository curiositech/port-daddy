import { describe, expect, it } from 'vitest';
import {
  computeFleetQuorum,
  decideShipParticipation,
  mintShipExecutionGrant,
  parseShipExecutionConfiguration,
  parseShipExecutionPolicy,
  parseShipParticipationPolicy,
  recheckShipWriteTarget,
  type ShipExecutionGrant,
} from '../../shared/fleet-participation.js';

describe('ship participation', () => {
  it('selects PR-class and risk-specific participation deterministically', () => {
    const policy = parseShipParticipationPolicy({
      default: 'ineligible',
      rules: [
        { disposition: 'required', riskSignals: ['authentication'], reason: 'auth boundary changed' },
        { disposition: 'advisory', prClasses: ['documentation'] },
      ],
    });

    expect(decideShipParticipation(policy, {
      prClass: 'code',
      riskSignals: ['authentication'],
    })).toEqual({ disposition: 'required', reason: 'auth boundary changed', matchedRule: 0 });
    expect(decideShipParticipation(policy, {
      prClass: 'documentation',
      riskSignals: [],
    }).disposition).toBe('advisory');
    expect(decideShipParticipation(policy, {
      prClass: 'ui',
      riskSignals: [],
    }).disposition).toBe('ineligible');
  });

  it('does not project legacy blocking into voting authority', () => {
    expect(parseShipParticipationPolicy(undefined).default).toBe('ineligible');
  });

  it('drops misspelled selectors instead of turning them into match-all rules', () => {
    const policy = parseShipParticipationPolicy({
      default: 'ineligible',
      rules: [{ disposition: 'required', prClasses: ['securty'] }],
    });
    expect(policy.rules).toEqual([]);
    expect(decideShipParticipation(policy, { prClass: 'code', riskSignals: [] }).disposition)
      .toBe('ineligible');
  });

  it('computes quorum only from eligible voters and keeps abstention distinct', () => {
    const result = computeFleetQuorum([
      { ship: 'code-reviewer', participation: 'required', outcome: 'approve' },
      { ship: 'qa', participation: 'advisory', outcome: 'approve' },
      { ship: 'red-team', participation: 'ineligible', outcome: 'failed' },
      { ship: 'purser', participation: 'abstain', outcome: 'abstain' },
      { ship: 'style-critic', participation: 'ineligible', outcome: 'reject' },
    ]);

    expect(result).toMatchObject({
      reached: true,
      eligibleVoters: 1,
      approvals: 1,
      failures: 0,
      abstentions: 1,
      excludedIneligible: 2,
    });
  });

  it('does not let a required failure or abstention masquerade as quorum', () => {
    const result = computeFleetQuorum([
      { ship: 'code-reviewer', participation: 'required', outcome: 'failed' },
      { ship: 'qa', participation: 'advisory', outcome: 'approve' },
      { ship: 'privacy-warden', participation: 'required', outcome: 'abstain' },
    ]);
    expect(result.reached).toBe(false);
    expect(result.failures).toBe(1);
    expect(result.abstentions).toBe(1);
    expect(result.unmetRequiredShips).toEqual(['code-reviewer', 'privacy-warden']);
  });

  it('rejects duplicate ship identities and a fleet with no required voters', () => {
    expect(computeFleetQuorum([
      { ship: 'reviewer', participation: 'required', outcome: 'approve' },
      { ship: 'reviewer', participation: 'required', outcome: 'approve' },
    ])).toMatchObject({ reached: false, unmetRequiredShips: ['duplicate ship identity'] });
    expect(computeFleetQuorum([
      { ship: 'style', participation: 'advisory', outcome: 'approve' },
      { ship: 'ideas', participation: 'abstain', outcome: 'abstain' },
    ])).toMatchObject({ reached: false, eligibleVoters: 0, approvals: 0 });
  });
});

describe('ship execution authority', () => {
  const writablePolicy = {
    mode: 'write_sandbox',
    repository: 'current_repository',
    worktree: 'isolated',
    cwd: 'apps/widget',
    toolAllowlist: ['read_file', 'write_file', 'run_tests', 'dynamic_skill_search'],
    mcpAllowlist: ['github.read'],
    networkAllowlist: ['https://api.github.com'],
    writePathAllowlist: ['apps/widget', 'tests/widget'],
    maxWallClockMs: 300_000,
    maxCostMicrousd: 2_000_000,
  };
  const readOnlyPolicy = {
    ...writablePolicy,
    mode: 'read_only_sandbox',
    toolAllowlist: ['read_file', 'dynamic_skill_search'],
    networkAllowlist: [],
    writePathAllowlist: [],
  };

  it('defaults to no execution instead of inferring authority from tool names', () => {
    expect(parseShipExecutionPolicy(undefined)).toMatchObject({
      mode: 'none',
      toolAllowlist: [],
      mcpAllowlist: [],
      networkAllowlist: [],
      maxWallClockMs: 0,
      maxCostMicrousd: 0,
    });
    expect(parseShipExecutionPolicy({ allowedTools: 'Bash(npm test*)' }).mode).toBe('none');
    expect(parseShipExecutionConfiguration(undefined).state).toBe('absent');
    expect(parseShipExecutionConfiguration({ mode: 'none' }).state).toBe('valid');
    expect(parseShipExecutionConfiguration({ ...writablePolicy, surpriseAuthority: true }).state).toBe('invalid');
  });

  it('denies write paths in a read-only sandbox', () => {
    expect(parseShipExecutionPolicy({ ...writablePolicy, mode: 'read_only_sandbox' }).mode).toBe('none');
  });

  it('denies every mutating or unknown read-only capability', () => {
    const base = { ...writablePolicy, mode: 'read_only_sandbox', writePathAllowlist: [], networkAllowlist: [] };
    for (const tool of ['write_file', 'edit_file', 'run_tests', 'shell', 'made_up_reader']) {
      expect(parseShipExecutionPolicy({ ...base, toolAllowlist: [tool] }).mode).toBe('none');
    }
    for (const mcp of ['github.write', 'relay.write', 'unknown.read']) {
      expect(parseShipExecutionPolicy({ ...base, toolAllowlist: ['read_file'], mcpAllowlist: [mcp] }).mode).toBe('none');
    }
  });

  it('denies wildcard capabilities and unbounded time or spend', () => {
    expect(parseShipExecutionPolicy({ ...writablePolicy, toolAllowlist: ['*'] }).mode).toBe('none');
    expect(parseShipExecutionPolicy({ ...writablePolicy, surpriseAuthority: true }).mode).toBe('none');
    expect(parseShipExecutionPolicy({ ...writablePolicy, maxWallClockMs: 31 * 60 * 1000 }).mode).toBe('none');
    expect(parseShipExecutionPolicy({ ...writablePolicy, maxCostMicrousd: 25_000_001 }).mode).toBe('none');
  });

  it('requires exact HTTPS network origins and rejects symbolic provider authority', () => {
    expect(parseShipExecutionPolicy(writablePolicy).mode).toBe('write_sandbox');
    for (const endpoint of ['package_registry', 'github_api', 'https://*.example.com', 'http://api.github.com', 'https://api.github.com/path']) {
      expect(parseShipExecutionPolicy({ ...writablePolicy, networkAllowlist: [endpoint] }).mode).toBe('none');
    }
  });

  it('mints an exact read-only tenant/repository/worktree/cwd/head/attempt single-use grant', async () => {
    const policy = parseShipExecutionPolicy(readOnlyPolicy);
    const grant = mintShipExecutionGrant({
      policy,
      tenantId: 'tenant-1',
      admittedTenantId: 'tenant-1',
      repositoryId: 'repo-42',
      admittedRepositoryId: 'repo-42',
      repositoryFullName: 'acme/widget',
      admittedRepositoryFullName: 'ACME/widget',
      worktreePath: '/fleet/worktrees/run-7',
      isolatedWorktreeRoot: '/fleet/worktrees',
      canonicalizePath: async (path: string) => path,
      tenantBindingReceiptId: 'bind_123',
      headSha: 'a'.repeat(40),
      runId: 'run:delivery-7', attempt: 1, nonce: 'nonce_1234567890123456',
      nowEpochMs: 2_000, issuedAtEpochMs: 1_000, expiresAtEpochMs: 301_000,
    });
    expect(await grant).toMatchObject({
      mode: 'read_only_sandbox',
      tenantId: 'tenant-1',
      repositoryId: 'repo-42',
      repositoryFullName: 'acme/widget',
      worktreePath: '/fleet/worktrees/run-7',
      cwdPath: '/fleet/worktrees/run-7/apps/widget',
      canonicalWritePathRoots: [],
      requiresTargetRealpathRecheck: true,
      singleUse: true,
    });
    const futureWriteGrant = {
      ...(await grant)!,
      mode: 'write_sandbox',
      canonicalWritePathRoots: ['/fleet/worktrees/run-7/apps/widget'],
    } as ShipExecutionGrant;
    expect(await recheckShipWriteTarget(
      futureWriteGrant,
      '/fleet/worktrees/run-7/apps/widget/new.ts',
      2_000,
      async path => path,
    )).toBe('/fleet/worktrees/run-7/apps/widget/new.ts');
    expect(await recheckShipWriteTarget(
      futureWriteGrant,
      '/fleet/worktrees/run-7/apps/widget/link/private.ts',
      2_000,
      async () => '/other-tenant/private.ts',
    )).toBeNull();
  });

  it('canonicalizes every write root but refuses write grants until a consumer can recheck targets', async () => {
    const seen: string[] = [];
    const policy = parseShipExecutionPolicy(writablePolicy);
    const grant = await mintShipExecutionGrant({
      policy,
      tenantId: 'tenant-1', admittedTenantId: 'tenant-1',
      repositoryId: 'repo-42', admittedRepositoryId: 'repo-42',
      repositoryFullName: 'acme/widget', admittedRepositoryFullName: 'acme/widget',
      worktreePath: '/fleet/worktrees/run-7', isolatedWorktreeRoot: '/fleet/worktrees',
      canonicalizePath: async (path: string) => { seen.push(path); return path; },
      tenantBindingReceiptId: 'bind_123', headSha: 'a'.repeat(40), runId: 'run:delivery-7',
      attempt: 1, nonce: 'nonce_1234567890123456', nowEpochMs: 2_000,
      issuedAtEpochMs: 1_000, expiresAtEpochMs: 301_000,
    });
    expect(grant).toBeNull();
    expect(seen).toEqual(expect.arrayContaining([
      '/fleet/worktrees/run-7/apps/widget',
      '/fleet/worktrees/run-7/tests/widget',
    ]));
  });

  it('refuses cross-tenant/repository and traversal-shaped grants', async () => {
    const policy = parseShipExecutionPolicy(readOnlyPolicy);
    const base = {
      policy,
      tenantId: 'tenant-1',
      admittedTenantId: 'tenant-1',
      repositoryId: 'repo-42',
      admittedRepositoryId: 'repo-42',
      repositoryFullName: 'acme/widget',
      admittedRepositoryFullName: 'other/private',
      worktreePath: '/fleet/worktrees/run-7',
      isolatedWorktreeRoot: '/fleet/worktrees',
      canonicalizePath: async (path: string) => path,
      tenantBindingReceiptId: 'bind_123', headSha: 'a'.repeat(40), runId: 'run:delivery-7',
      attempt: 1, nonce: 'nonce_1234567890123456', nowEpochMs: 2_000,
      issuedAtEpochMs: 1_000, expiresAtEpochMs: 301_000,
    };
    expect(await mintShipExecutionGrant(base)).toBeNull();
    expect(await mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      admittedTenantId: 'tenant-2',
    })).toBeNull();
    expect(await mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      worktreePath: '/fleet/other/run-7',
    })).toBeNull();
    expect(await mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      canonicalizePath: async (path: string) => path === '/fleet/worktrees/run-7'
        ? '/other-tenant/worktrees/run-7'
        : path,
    })).toBeNull();
    expect(await mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      nowEpochMs: 301_000,
    })).toBeNull();
    expect(parseShipExecutionPolicy({ ...writablePolicy, cwd: '../other-repo' }).mode).toBe('none');
  });

  it('revalidates policy capabilities and limits when minting', async () => {
    const forged = { ...parseShipExecutionPolicy(writablePolicy), maxCostMicrousd: 25_000_001 };
    expect(await mintShipExecutionGrant({
      policy: forged,
      tenantId: 'tenant-1', admittedTenantId: 'tenant-1',
      repositoryId: 'repo-42', admittedRepositoryId: 'repo-42',
      repositoryFullName: 'acme/widget', admittedRepositoryFullName: 'acme/widget',
      worktreePath: '/fleet/worktrees/run-7', isolatedWorktreeRoot: '/fleet/worktrees',
      canonicalizePath: async (path: string) => path,
      tenantBindingReceiptId: 'bind_123', headSha: 'a'.repeat(40), runId: 'run:delivery-7',
      attempt: 1, nonce: 'nonce_1234567890123456', nowEpochMs: 2_000,
      issuedAtEpochMs: 1_000, expiresAtEpochMs: 301_000,
    })).toBeNull();
  });
});
