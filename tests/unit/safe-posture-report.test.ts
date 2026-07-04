/**
 * A8 posture-report unit tests (jest, pure-fn). ADR-0088 Phase A test plan:
 *   - DETERMINISTIC score for a fixed fixture set (same inputs → same number).
 *   - footer contains the EXACT `HONEST_LIMITS` string, verbatim.
 *   - green = cooperative-case sensors clear (NOT a sandbox claim).
 *   - each deduction category moves the score the documented amount.
 *
 * The scorer is pure, so no clock/IO is mocked — fixtures fully determine the
 * output. The HONEST_LIMITS assertion is the load-bearing honesty check.
 */

import { HONEST_LIMITS } from '../../lib/coast-guard.js';
import {
  buildPostureReport,
  renderPostureReportText,
  DEFAULT_WEIGHTS,
  STATE_THRESHOLDS,
  type PostureInputs,
} from '../../lib/safe/posture-report.js';
import type {
  BaselinedScanResult,
  BinaryTrust,
  EgressSnapshot,
  McpInventoryResult,
  PermFinding,
  PermsAuditResult,
  SecretFinding,
} from '../../lib/safe/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function secrets(newFindings: SecretFinding[] = [], suppressed = 0): BaselinedScanResult {
  return { newFindings, suppressed, allFindings: newFindings };
}

function secretFinding(over: Partial<SecretFinding> = {}): SecretFinding {
  return {
    path: '/Users/op/.env',
    line: 3,
    ruleId: 'aws-access-token',
    last4: 'WXYZ',
    entropy: 4.7,
    method: 'structured-format',
    verified: null,
    ...over,
  };
}

function permFinding(over: Partial<PermFinding> = {}): PermFinding {
  return {
    path: '/Users/op/.ssh/id_rsa',
    exists: true,
    isDir: false,
    mode: '0600',
    groupReadable: false,
    worldReadable: false,
    groupOrWorldWritable: false,
    severity: 'ok',
    recommendedMode: null,
    ...over,
  };
}

function perms(
  findings: PermFinding[] = [permFinding()],
  coastGuardOn = true,
): PermsAuditResult {
  return {
    findings,
    coastGuard: {
      onByDefault: coastGuardOn,
      confinementAvailable: true,
      mechanism: 'seatbelt',
    },
  };
}

function binary(over: Partial<BinaryTrust> = {}): BinaryTrust {
  return {
    path: '/usr/bin/python3',
    trustClass: 'platform',
    pathOrigin: 'system',
    quarantine: 'no-quarantine',
    teamId: null,
    signingId: 'com.apple.python3',
    authority: ['Software Signing', 'Apple Root CA'],
    cdhash: 'platformhash',
    adhoc: false,
    verified: true,
    notarized: true,
    ...over,
  };
}

function egress(flows: EgressSnapshot['flows'] = []): EgressSnapshot {
  return { flows, nettopAvailable: true, lsofAvailable: true };
}

function mcp(servers: McpInventoryResult['servers'] = []): McpInventoryResult {
  return { servers, configsScanned: ['/Users/op/.mcp.json'] };
}

/** A fully clean host — nothing to deduct. */
function cleanInputs(): PostureInputs {
  return {
    secrets: secrets(),
    perms: perms(),
    binaries: [binary()],
    egress: egress(),
    mcp: mcp(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('A8 posture-report — clean host', () => {
  test('a clean host scores 100 and is green', () => {
    const r = buildPostureReport(cleanInputs());
    expect(r.score).toBe(100);
    expect(r.state).toBe('green');
    expect(r.deductions).toEqual([]);
    expect(r.blastRadius).toEqual([]);
  });

  test('green never implies sandboxed — the honesty footer is present verbatim', () => {
    const r = buildPostureReport(cleanInputs());
    expect(r.honestLimits).toBe(HONEST_LIMITS);
    const text = renderPostureReportText(r);
    expect(text).toContain(HONEST_LIMITS);
    // The rendered light explicitly disclaims sandboxing.
    expect(text).toMatch(/NOT a sandbox/i);
  });
});

describe('A8 posture-report — deductions are deterministic', () => {
  test('one new plaintext secret deducts exactly its weight', () => {
    const inputs = cleanInputs();
    inputs.secrets = secrets([secretFinding()]);
    const r = buildPostureReport(inputs);
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.newPlaintextSecret);
    expect(r.deductions).toHaveLength(1);
    expect(r.deductions[0]).toMatchObject({
      kind: 'new-plaintext-secret',
      points: DEFAULT_WEIGHTS.newPlaintextSecret,
      count: 1,
    });
    // Blast radius names the path but NEVER a raw value.
    expect(r.blastRadius[0].surface).toBe('read-plaintext-secret');
    expect(r.blastRadius[0].detail).toContain('/Users/op/.env');
    expect(r.blastRadius[0].detail).toContain('WXYZ'); // last4 only
  });

  test('coast guard off deducts its weight and adds a no-egress-cap blast item', () => {
    const inputs = cleanInputs();
    inputs.perms = perms([permFinding()], false);
    const r = buildPostureReport(inputs);
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.coastGuardOff);
    expect(r.summary.coastGuardOn).toBe(false);
    expect(r.blastRadius.some((b) => b.surface === 'no-egress-cap')).toBe(true);
  });

  test('an unsigned RUNNING binary deducts; an unsigned at-rest binary does not', () => {
    const running = cleanInputs();
    running.binaries = [binary({ trustClass: 'unsigned', pid: 4242, cdhash: null })];
    const r1 = buildPostureReport(running);
    expect(r1.score).toBe(100 - DEFAULT_WEIGHTS.unsignedRunningBinary);
    expect(r1.summary.untrustedRunningBinaries).toBe(1);

    const atRest = cleanInputs();
    atRest.binaries = [binary({ trustClass: 'unsigned', cdhash: null })]; // no pid
    const r2 = buildPostureReport(atRest);
    expect(r2.score).toBe(100);
  });

  test('a world-readable crown jewel deducts and is in the blast radius', () => {
    const inputs = cleanInputs();
    inputs.perms = perms([
      permFinding({
        path: '/Users/op/.aws/credentials',
        mode: '0644',
        worldReadable: true,
        severity: 'exposed',
        recommendedMode: '0600',
      }),
    ]);
    const r = buildPostureReport(inputs);
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.worldReadableCrownJewel);
    expect(r.summary.worldReadableJewels).toBe(1);
    expect(r.blastRadius.some((b) => b.surface === 'read-world-readable-secret')).toBe(true);
  });

  test('an unpinned MCP fetch deducts', () => {
    const inputs = cleanInputs();
    inputs.mcp = mcp([
      {
        name: 'sketchy',
        source: 'project-mcp-json',
        configPath: '/Users/op/.mcp.json',
        command: 'npx',
        args: ['sketchy-mcp'],
        flags: ['unpinned-npx'],
      },
    ]);
    const r = buildPostureReport(inputs);
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.unpinnedMcpFetch);
    expect(r.blastRadius.some((b) => b.surface === 'load-poisoned-mcp')).toBe(true);
  });

  test('a non-allowlisted egress flow deducts only when an allowlist is configured', () => {
    const flow = {
      pid: 5000,
      binary: 'curl',
      remoteHost: 'evil.example.com',
      remotePort: 443,
      bytes: 1024,
      agent: null,
    };
    // No allowlist → evidence only, no deduction.
    const noAllow = cleanInputs();
    noAllow.egress = egress([flow]);
    expect(buildPostureReport(noAllow).score).toBe(100);

    // With an allowlist that excludes the host → deduction.
    const withAllow = cleanInputs();
    withAllow.egress = egress([flow]);
    withAllow.allowlistedHosts = ['api.anthropic.com'];
    const r = buildPostureReport(withAllow);
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.flowToNonAllowlistedHost);
    expect(r.summary.nonAllowlistedFlows).toBe(1);
  });
});

describe('A8 posture-report — state mapping + caps', () => {
  test('a pile-up of problems reaches RED, capped per category', () => {
    const inputs = cleanInputs();
    // 10 new secrets — capped at perCategoryCap (40), not 120.
    inputs.secrets = secrets(
      Array.from({ length: 10 }, (_, i) => secretFinding({ line: i + 1, last4: `00${i}` })),
    );
    inputs.perms = perms([permFinding()], false); // coast guard off (15)
    const r = buildPostureReport(inputs);
    expect(r.deductions.find((d) => d.kind === 'new-plaintext-secret')!.points).toBe(
      DEFAULT_WEIGHTS.perCategoryCap,
    );
    // 40 (capped secrets) + 15 (cg off) = 55 → 45 → below amber → red.
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.perCategoryCap - DEFAULT_WEIGHTS.coastGuardOff);
    expect(r.state).toBe('red');
  });

  test('score never goes below 0', () => {
    const inputs = cleanInputs();
    inputs.secrets = secrets(
      Array.from({ length: 50 }, (_, i) => secretFinding({ line: i + 1 })),
    );
    inputs.perms = perms(
      [
        permFinding({ path: '/a', worldReadable: true, severity: 'exposed' }),
        permFinding({ path: '/b', worldReadable: true, severity: 'exposed' }),
      ],
      false,
    );
    inputs.binaries = [binary({ trustClass: 'unsigned', pid: 1, cdhash: null })];
    inputs.mcp = mcp([
      {
        name: 'x',
        source: 'project-mcp-json',
        configPath: '/m',
        command: 'npx',
        args: ['x'],
        flags: ['unpinned-npx'],
      },
    ]);
    const r = buildPostureReport(inputs);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  test('amber sits between the thresholds', () => {
    const inputs = cleanInputs();
    // coast guard off = 15 points → score 85 → between amberAt(60) and greenAt(90).
    inputs.perms = perms([permFinding()], false);
    const r = buildPostureReport(inputs);
    expect(r.score).toBeGreaterThanOrEqual(STATE_THRESHOLDS.amberAt);
    expect(r.score).toBeLessThan(STATE_THRESHOLDS.greenAt);
    expect(r.state).toBe('amber');
  });

  test('identical inputs always produce an identical report (determinism)', () => {
    const a = buildPostureReport(cleanInputs());
    const b = buildPostureReport(cleanInputs());
    expect(a).toEqual(b);
  });
});
