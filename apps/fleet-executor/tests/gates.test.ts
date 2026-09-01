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
  const TESTS = ['apps/fleet-executor/tests/foo.test.ts'];

  it('ideation ships ALWAYS run — including on a docs-only diff', () => {
    const spark = ship({ name: 'spark', ideation: true });
    expect(decideShipGate(spark, ['docs/plan.md'], true).run).toBe(true);
    expect(decideShipGate(spark, CODE, false).run).toBe(true);
  });

  it('reviewer ships SKIP a docs-only diff (nothing to review for correctness)', () => {
    const g = decideShipGate(ship({ name: 'code-reviewer' }), ['docs/plan.md'], true);
    expect(g.run).toBe(false);
    expect(g.reason).toMatch(/docs-only/);
  });

  it('red-team runs ONLY when the diff touches its security surface', () => {
    const rt = ship({ name: 'red-team', blocking: true });
    expect(decideShipGate(rt, SECURITY, false).run).toBe(true);
    const off = decideShipGate(rt, CODE, false);
    expect(off.run).toBe(false);
    expect(off.reason).toMatch(/surface not touched/);
  });

  it('red-team runs on key-wrap/vault crypto surfaces (PRs #9873, #9882 real diffs)', () => {
    // Regression: none of these paths contained crypto|sign|verify|hash|token|
    // secret|auth|capabilit, so red-team silently never spawned on either PR —
    // the exact gap that made it look broken. key|vault|wrap|hpke close it.
    const rt = ship({ name: 'red-team', blocking: true });
    expect(decideShipGate(rt, ['core/kernel/pd-vault/src/hpke.rs'], false).run).toBe(true);
    expect(decideShipGate(rt, ['core/kernel/pd-vault/src/keys.rs'], false).run).toBe(true);
    expect(decideShipGate(rt, ['apps/relay/src/device-keys.ts'], false).run).toBe(true);
    expect(decideShipGate(rt, ['apps/relay/migrations/2026-08-26-b3-device-keys.sql'], false).run).toBe(true);
  });

  it('tautology-sniffer runs only when the diff touches test files', () => {
    expect(decideShipGate(ship({ name: 'tautology-sniffer' }), TESTS, false).run).toBe(true);
    expect(decideShipGate(ship({ name: 'tautology-sniffer' }), CODE, false).run).toBe(false);
  });

  it('an ungated reviewer (code-reviewer, qa) runs on any code diff', () => {
    expect(decideShipGate(ship({ name: 'code-reviewer' }), CODE, false).run).toBe(true);
    expect(decideShipGate(ship({ name: 'qa' }), CODE, false).run).toBe(true);
  });
});
