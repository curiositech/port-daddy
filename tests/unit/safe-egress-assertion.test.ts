/**
 * Egress-assertion unit tests (jest) — ADR-0101 tenancy-boundary Critical 1
 * ("local-only uploads nothing", issue #2460). This is the runtime-verifiable
 * backing artifact the audit's `localOnlyMode.uploadsNothingTestable` boolean
 * requires, so the tests must have TEETH:
 *   - a loopback-only snapshot PASSES,
 *   - a snapshot with ANY non-loopback flow FAILS and names the offender
 *     (the "any feature that phones home must fail this" guarantee),
 *   - an explicitly-allowed (paired-relay) host is permitted; an unlisted one
 *     is not,
 *   - a host that could not be inspected reports `verified:false` — NEVER a
 *     silent pass (the vacuous-pass trap the audit exists to catch),
 *   - the full capture→assert path runs over realistic lsof/nettop text.
 */
import {
  isLoopbackHost,
  assertLocalOnlyNoEgress,
  captureAndAssertLocalOnly,
} from '../../lib/safe/egress-assertion.js';
import type { EgressRunner } from '../../lib/safe/egress-snapshot.js';
import type { EgressSnapshot, EgressFlow } from '../../lib/safe/types.js';

// ── loopback classifier ──────────────────────────────────────────────────────

describe('isLoopbackHost', () => {
  test.each([
    ['127.0.0.1', true],
    ['127.5.99.250', true], // all of 127.0.0.0/8
    ['::1', true],
    ['[::1]', true], // bracketed IPv6
    ['::ffff:127.0.0.1', true], // IPv4-mapped IPv6 loopback
    ['localhost', true],
    ['0.0.0.0', true],
    ['::', true],
    ['*', true],
    ['', true],
    [null, true],
    ['1.2.3.4', false],
    ['8.8.8.8', false],
    ['140.82.112.3', false], // github
    ['api.anthropic.com', false],
    ['::ffff:8.8.8.8', false],
    ['2606:4700:4700::1111', false], // cloudflare v6
  ])('%s → loopback=%s', (host, expected) => {
    expect(isLoopbackHost(host as string | null)).toBe(expected);
  });
});

// ── snapshot builders ─────────────────────────────────────────────────────────

function flow(partial: Partial<EgressFlow>): EgressFlow {
  return {
    pid: 1000,
    binary: null,
    remoteHost: null,
    remotePort: null,
    bytes: null,
    agent: null,
    ...partial,
  };
}

function snapshot(flows: EgressFlow[], available = true): EgressSnapshot {
  return { flows, nettopAvailable: available, lsofAvailable: available };
}

// ── the core assertion ────────────────────────────────────────────────────────

describe('assertLocalOnlyNoEgress', () => {
  test('PASSES when every flow is loopback', () => {
    const snap = snapshot([
      flow({ pid: 1, binary: 'pd-daemon', remoteHost: '127.0.0.1', remotePort: 9886 }),
      flow({ pid: 1, binary: 'pd-daemon', remoteHost: '::1', remotePort: 11434 }), // ollama
    ]);
    const r = assertLocalOnlyNoEgress(snap);
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.consideredFlows).toBe(2);
  });

  // TEETH: a single phone-home must fail the whole assertion.
  test('FAILS and names the offender when a flow reaches a non-loopback host', () => {
    const snap = snapshot([
      flow({ pid: 1, binary: 'pd-daemon', remoteHost: '127.0.0.1', remotePort: 9886 }),
      flow({ pid: 42, binary: 'agent-worker', remoteHost: '140.82.112.3', remotePort: 443 }),
    ]);
    const r = assertLocalOnlyNoEgress(snap);
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({
      host: '140.82.112.3',
      pid: 42,
      binary: 'agent-worker',
      port: 443,
    });
    expect(r.reason).toContain('EGRESS VIOLATION');
    expect(r.reason).toContain('140.82.112.3');
  });

  test('an explicitly-allowed (paired relay) host is permitted; an unlisted one is not', () => {
    const flows = [flow({ pid: 1, binary: 'pd-daemon', remoteHost: '198.51.100.7', remotePort: 443 })];
    // allowed via full origin
    expect(
      assertLocalOnlyNoEgress(snapshot(flows), {
        allowHosts: ['https://198.51.100.7:443/'],
      }).ok,
    ).toBe(true);
    // a DIFFERENT allowed host does not cover this one
    const r = assertLocalOnlyNoEgress(snapshot(flows), { allowHosts: ['relay.example.com'] });
    expect(r.ok).toBe(false);
    expect(r.violations[0].host).toBe('198.51.100.7');
  });

  test('knownAgentsOnly scopes the assertion to PD-attributed flows', () => {
    const flows = [
      // unknown pid (e.g. the CI runner itself) talking to the internet
      flow({ pid: 999, binary: 'node', remoteHost: '8.8.8.8', remotePort: 443, agent: null }),
    ];
    expect(assertLocalOnlyNoEgress(snapshot(flows), { knownAgentsOnly: true }).ok).toBe(true);
    // …but without scoping, ALL egress counts
    expect(assertLocalOnlyNoEgress(snapshot(flows)).ok).toBe(false);
  });

  test('a known-agent phone-home is caught under knownAgentsOnly and labels the agent', () => {
    const flows = [
      flow({
        pid: 7,
        binary: 'agent-worker',
        remoteHost: '1.2.3.4',
        remotePort: 443,
        agent: { id: 'agent-abc' } as unknown as EgressFlow['agent'],
      }),
    ];
    const r = assertLocalOnlyNoEgress(snapshot(flows), { knownAgentsOnly: true });
    expect(r.ok).toBe(false);
    expect(r.violations[0].agent).toBe('agent-abc');
  });

  // VACUOUS-PASS GUARD: could-not-observe is not a pass.
  test('reports verified:false when neither tool produced output', () => {
    const r = assertLocalOnlyNoEgress(snapshot([], /* available */ false));
    expect(r.ok).toBe(true); // no violations seen…
    expect(r.verified).toBe(false); // …but nothing was actually observed
    expect(r.reason).toContain('UNVERIFIED');
  });

  test('null-destination flows are counted as unclassified, not as violations', () => {
    const r = assertLocalOnlyNoEgress(snapshot([flow({ pid: 3, remoteHost: null })]));
    expect(r.ok).toBe(true);
    expect(r.unclassifiedFlows).toBe(1);
    expect(r.consideredFlows).toBe(0);
  });
});

// ── full capture → assert path over realistic tool output ─────────────────────

describe('captureAndAssertLocalOnly (end-to-end over injected runner)', () => {
  const LSOF_LOOPBACK = [
    'COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME',
    'pd-daemon 500 test 10u IPv4 0x1 0t0 TCP 127.0.0.1:52000->127.0.0.1:9886 (ESTABLISHED)',
    'node      501 test 11u IPv6 0x2 0t0 TCP [::1]:52001->[::1]:11434 (ESTABLISHED)',
  ].join('\n');

  const LSOF_LEAK = [
    'COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME',
    'pd-daemon 500 test 10u IPv4 0x1 0t0 TCP 127.0.0.1:52000->127.0.0.1:9886 (ESTABLISHED)',
    'agent     777 test 12u IPv4 0x3 0t0 TCP 10.0.0.2:53000->140.82.112.3:443 (ESTABLISHED)',
  ].join('\n');

  const runnerFor = (lsofOut: string): EgressRunner => (cmd) =>
    cmd === 'lsof' ? lsofOut : null; // nettop absent (Linux-like)

  test('loopback-only capture verifies clean', () => {
    const r = captureAndAssertLocalOnly({ run: runnerFor(LSOF_LOOPBACK) });
    expect(r.verified).toBe(true); // lsof ran
    expect(r.ok).toBe(true);
    expect(r.consideredFlows).toBe(2);
  });

  test('a real leak in the captured output is caught', () => {
    const r = captureAndAssertLocalOnly({ run: runnerFor(LSOF_LEAK) });
    expect(r.ok).toBe(false);
    // Assert the violation carries fields the parser could ONLY have extracted
    // from LSOF_LEAK (pid 777, binary 'agent', port 443) — not just the host.
    // A stub that ignored the input and returned a hardcoded host would fail
    // these, so the test proves real parsing, not tautology.
    const v = r.violations.find((x) => x.host === '140.82.112.3');
    expect(v).toBeDefined();
    expect(v).toMatchObject({ host: '140.82.112.3', pid: 777, binary: 'agent', port: 443 });
    // And the loopback flow in the SAME fixture is NOT a violation.
    expect(r.violations.map((x) => x.host)).not.toContain('127.0.0.1');
  });

  test('no tools available → unverified, not a pass', () => {
    const r = captureAndAssertLocalOnly({ run: () => null });
    expect(r.verified).toBe(false);
    expect(r.reason).toContain('UNVERIFIED');
  });
});
