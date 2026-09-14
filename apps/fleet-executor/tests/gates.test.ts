import { describe, it, expect } from 'vitest';
import { isDocsOnly, decideShipGate, isReviewableForBugs } from '../src/gates.js';
import type { ShipConfig } from '../src/fleet.js';

const ship = (over: Partial<ShipConfig>): ShipConfig => ({
  name: 'code-reviewer',
  trigger: 'pull_request:opened',
  prompt: 'p',
  cfModel: '@cf/qwen/qwen3-30b-a3b-fp8',
  temperature: null,
  role: 'r',
  telos: 't',
  blocking: false,
  needsExecution: false,
  ideation: false,
  purser: false,
  blockWithoutSandbox: false,
  testPaths: [],
  graft: [],
  participation: { default: 'advisory', rules: [] },
  participationValid: true,
  execution: {
    mode: 'none', repository: 'current_repository', worktree: 'isolated', cwd: '.',
    toolAllowlist: [], mcpAllowlist: [], networkAllowlist: [], writePathAllowlist: [],
    maxWallClockMs: 0, maxCostMicrousd: 0,
  },
  ...over,
});

describe('isDocsOnly', () => {
  it('true when every changed path is prose (md/mdx or under docs/)', () => {
    expect(isDocsOnly(['docs/plans/x.md', 'AGENTS.md', 'fleet/ships/spider.md'])).toBe(true);
    expect(isDocsOnly(['docs/adr/0099-thing.md'])).toBe(true);
  });
  it('false when any code file changed (a code+docs diff is not docs-only)', () => {
    expect(isDocsOnly(['docs/x.md', 'src/a.ts'])).toBe(false);
    expect(isDocsOnly(['README.md', 'apps/fleet-executor/src/gates.ts'])).toBe(false);
    expect(isDocsOnly(['pd-fleet.yml'])).toBe(false); // yaml is config/code, not prose
  });
  it('false for an empty diff', () => {
    expect(isDocsOnly([])).toBe(false);
  });
});

describe('isReviewableForBugs', () => {
  it('excludes generated Porthole artifacts and raw terminal recordings from model input', () => {
    expect(
      isReviewableForBugs(
        'docs/artifacts/porthole-harness-proof-v2/harness-proof-current.html',
      ),
    ).toBe(false);
    expect(
      isReviewableForBugs('docs/artifacts/porthole-harness-proof-v2/parley-source.cast'),
    ).toBe(false);
    expect(isReviewableForBugs('website-v2/public/casts/porthole/collision.cast')).toBe(false);
  });

  it('excludes only the docs/artifacts directory, not same-prefix authored files', () => {
    expect(isReviewableForBugs('docs/artifacts/porthole-harness-proof-v2/receipt.json')).toBe(false);
    expect(isReviewableForBugs('docs/artifacts.txt')).toBe(true);
  });

  it('keeps authored source reviewable after evidence is excluded', () => {
    expect(isReviewableForBugs('apps/fleet-executor/src/execute.ts')).toBe(true);
  });
});

describe('decideShipGate', () => {
  const CODE = ['apps/fleet-executor/src/execute.ts'];
  const SECURITY = ['lib/auth/session.ts'];

  it('uses declared class policy, never a ship-name exception', () => {
    const classScoped = ship({ participation: { default: 'abstain', rules: [
      { disposition: 'required', prClasses: ['code'] },
    ] } });
    expect(decideShipGate(classScoped, CODE, false).disposition).toBe('required');
    expect(decideShipGate(classScoped, ['docs/plan.md'], true).disposition).toBe('abstain');
  });

  it('uses declared risk policy for security-sensitive paths', () => {
    const riskScoped = ship({ participation: { default: 'abstain', rules: [
      { disposition: 'required', riskSignals: ['authentication', 'cryptography'] },
    ] } });
    expect(decideShipGate(riskScoped, SECURITY, false).run).toBe(true);
    expect(decideShipGate(riskScoped, ['core/kernel/pd-vault/src/hpke.rs'], false).run).toBe(true);
    expect(decideShipGate(riskScoped, CODE, false).run).toBe(false);
  });

  it('advisory agents run but do not acquire a required vote', () => {
    const advisory = ship({ participation: { default: 'advisory', rules: [] } });
    expect(decideShipGate(advisory, CODE, false)).toMatchObject({ run: true, disposition: 'advisory' });
  });

  it('invalid policy is unavailable rather than PASS', () => {
    expect(decideShipGate(ship({ participationValid: false }), CODE, false)).toMatchObject({
      run: false, disposition: 'ineligible',
    });
  });

  it('promotes an incomplete inventory to the strongest declared runnable posture', () => {
    const scoped = ship({ participation: { default: 'abstain', rules: [
      { disposition: 'advisory', prClasses: ['documentation'] },
      { disposition: 'required', riskSignals: ['secrets'] },
    ] } });
    expect(decideShipGate(scoped, [], false, 0, true)).toMatchObject({
      run: true,
      disposition: 'required',
    });
  });
});
