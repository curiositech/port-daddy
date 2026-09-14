import { describe, expect, it } from 'vitest';
import {
  computeFleetQuorum,
  decideShipParticipation,
  mintShipExecutionGrant,
  parseShipExecutionPolicy,
  parseShipParticipationPolicy,
} from '../../shared/fleet-participation.js';

describe('ship participation', () => {
  it('selects PR-class and risk-specific participation deterministically', () => {
    const policy = parseShipParticipationPolicy({
      default: 'ineligible',
      rules: [
        { disposition: 'required', riskSignals: ['authentication'], reason: 'auth boundary changed' },
        { disposition: 'advisory', prClasses: ['documentation'] },
      ],
    }, false);

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

  it('preserves legacy blocking only as the default when no richer policy exists', () => {
    expect(parseShipParticipationPolicy(undefined, true).default).toBe('required');
    expect(parseShipParticipationPolicy(undefined, false).default).toBe('advisory');
  });

  it('drops misspelled selectors instead of turning them into match-all rules', () => {
    const policy = parseShipParticipationPolicy({
      default: 'ineligible',
      rules: [{ disposition: 'required', prClasses: ['securty'] }],
    }, false);
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
    ], {
      minimumEligibleVoters: 2,
      minimumApprovals: 2,
      requireEveryRequiredApproval: true,
    });

    expect(result).toMatchObject({
      reached: true,
      eligibleVoters: 2,
      approvals: 2,
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
    ], {
      minimumEligibleVoters: 1,
      minimumApprovals: 1,
      requireEveryRequiredApproval: true,
    });
    expect(result.reached).toBe(false);
    expect(result.failures).toBe(1);
    expect(result.abstentions).toBe(1);
    expect(result.unmetRequiredShips).toEqual(['code-reviewer', 'privacy-warden']);
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
    networkAllowlist: ['api.github.com'],
    writePathAllowlist: ['apps/widget', 'tests/widget'],
    maxWallClockMs: 300_000,
    maxCostMicrousd: 2_000_000,
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
  });

  it('denies write paths in a read-only sandbox', () => {
    expect(parseShipExecutionPolicy({ ...writablePolicy, mode: 'read_only_sandbox' }).mode).toBe('none');
  });

  it('denies wildcard capabilities and unbounded time or spend', () => {
    expect(parseShipExecutionPolicy({ ...writablePolicy, toolAllowlist: ['*'] }).mode).toBe('none');
    expect(parseShipExecutionPolicy({ ...writablePolicy, maxWallClockMs: 31 * 60 * 1000 }).mode).toBe('none');
    expect(parseShipExecutionPolicy({ ...writablePolicy, maxCostMicrousd: 25_000_001 }).mode).toBe('none');
  });

  it('mints an exact tenant/repository/worktree/cwd grant', () => {
    const policy = parseShipExecutionPolicy(writablePolicy);
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
    });
    expect(grant).toMatchObject({
      mode: 'write_sandbox',
      tenantId: 'tenant-1',
      repositoryId: 'repo-42',
      repositoryFullName: 'acme/widget',
      worktreePath: '/fleet/worktrees/run-7',
      cwdPath: '/fleet/worktrees/run-7/apps/widget',
    });
  });

  it('refuses cross-tenant/repository and traversal-shaped grants', () => {
    const policy = parseShipExecutionPolicy(writablePolicy);
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
    };
    expect(mintShipExecutionGrant(base)).toBeNull();
    expect(mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      admittedTenantId: 'tenant-2',
    })).toBeNull();
    expect(mintShipExecutionGrant({
      ...base,
      admittedRepositoryFullName: 'acme/widget',
      worktreePath: '/fleet/other/run-7',
    })).toBeNull();
    expect(parseShipExecutionPolicy({ ...writablePolicy, cwd: '../other-repo' }).mode).toBe('none');
  });
});
