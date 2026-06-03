/**
 * Tests for lib/attest.ts (engine) + lib/attest-invariants.ts (checks), ADR-0045.
 *
 * The contract under test is the honest-green rule: "all good" only when every
 * critical+warn invariant PASSED; a skipped/unknown critical is NOT green; the
 * report always surfaces the unverified set; CRITICAL fail → non-zero exit.
 */
import { describe, it, expect } from '@jest/globals';
import { runAttest, summarize, exitCode, renderReport } from '../../lib/attest.js';
import { createInvariants } from '../../lib/attest-invariants.js';

const R = (over) => ({ id: 'x', class: 'liveness', severity: 'critical', title: 't', status: 'pass', ...over });

describe('summarize — honest green', () => {
  it('is green only when every critical+warn passed', () => {
    const rep = summarize([R({ severity: 'critical', status: 'pass' }), R({ id: 'y', severity: 'warn', status: 'pass' })], 0);
    expect(rep.green).toBe(true);
  });
  it('is NOT green when a critical is skipped (never claim what we did not check)', () => {
    const rep = summarize([R({ severity: 'critical', status: 'skipped' })], 0);
    expect(rep.green).toBe(false);
    expect(rep.unverified).toHaveLength(1);
  });
  it('is NOT green when a critical is unknown', () => {
    expect(summarize([R({ status: 'unknown' })], 0).green).toBe(false);
  });
  it('info-level checks never gate green', () => {
    const rep = summarize([R({ severity: 'critical', status: 'pass' }), R({ id: 'i', severity: 'info', status: 'skipped' })], 0);
    expect(rep.green).toBe(true);
  });
  it('is NOT green when there are no gating invariants at all', () => {
    expect(summarize([R({ severity: 'info', status: 'pass' })], 0).green).toBe(false);
  });
});

describe('exitCode', () => {
  it('non-zero when a critical is not pass', () => {
    expect(exitCode(summarize([R({ severity: 'critical', status: 'fail' })], 0))).toBe(1);
  });
  it('zero when criticals pass even if a warn fails', () => {
    expect(exitCode(summarize([R({ severity: 'critical', status: 'pass' }), R({ id: 'w', severity: 'warn', status: 'fail' })], 0))).toBe(0);
  });
  it('a SKIPPED critical does not exit non-zero (couldn\'t-check != broken), but is not green', () => {
    const rep = summarize([R({ severity: 'critical', status: 'skipped' })], 0);
    expect(exitCode(rep)).toBe(0);
    expect(rep.green).toBe(false);
    expect(rep.criticalProblems).toHaveLength(0);
    expect(rep.unverified).toHaveLength(1);
  });
  it('an UNKNOWN critical DOES exit non-zero (the check errored)', () => {
    expect(exitCode(summarize([R({ severity: 'critical', status: 'unknown' })], 0))).toBe(1);
  });
});

describe('runAttest — a throwing check becomes unknown, never a silent pass', () => {
  it('captures exceptions as unknown', async () => {
    const invs = [{ id: 'boom', class: 'integrity', severity: 'critical', title: 'boom', run: () => { throw new Error('nope'); } }];
    const rep = await runAttest(invs, {});
    expect(rep.results[0].status).toBe('unknown');
    expect(rep.results[0].detail).toMatch(/nope/);
    expect(rep.green).toBe(false);
  });
});

describe('renderReport', () => {
  it('surfaces the NOT VERIFIED section and a scoped GREEN', () => {
    const rep = summarize([R({ severity: 'critical', status: 'pass' }), R({ id: 's', severity: 'info', status: 'skipped', detail: 'no probe' })], 0);
    const text = renderReport(rep);
    expect(text).toMatch(/GREEN/);
    expect(text).toMatch(/NOT VERIFIED/);
  });
  it('screams about critical problems', () => {
    const rep = summarize([R({ severity: 'critical', status: 'fail', detail: 'db corrupt' })], 0);
    expect(renderReport(rep)).toMatch(/CRITICAL/);
    expect(renderReport(rep)).toMatch(/NOT GREEN/);
  });
});

describe('invariants — probe-driven, missing probe = SKIPPED', () => {
  const find = (id, rep) => rep.results.find((r) => r.id === id);

  it('all checks SKIP cleanly with an empty context (nothing assumed-pass)', async () => {
    const rep = await runAttest(createInvariants(), {});
    expect(rep.results.every((r) => r.status === 'skipped')).toBe(true);
    expect(rep.green).toBe(false); // can't be green when nothing was verified
  });

  it('daemon-responds: pass / fail / version mismatch', async () => {
    const pass = await runAttest(createInvariants(), {
      daemonHealth: async () => ({ status: 'ok', version: '3.17.0' }),
      expectedVersion: '3.17.0',
    });
    expect(find('liveness.daemon-responds', pass).status).toBe('pass');
    expect(find('liveness.cli-daemon-version-match', pass).status).toBe('pass');

    const down = await runAttest(createInvariants(), { daemonHealth: async () => null });
    expect(find('liveness.daemon-responds', down).status).toBe('fail');

    const skew = await runAttest(createInvariants(), {
      daemonHealth: async () => ({ status: 'ok', version: '3.16.2' }),
      expectedVersion: '3.17.0',
    });
    expect(find('liveness.cli-daemon-version-match', skew).status).toBe('fail');
  });

  it('integrity: db corrupt + missing tables fail with fixes', async () => {
    const rep = await runAttest(createInvariants(), {
      dbIntegrityCheck: () => 'malformed disk image',
      schemaTables: () => ['agents'],
      requiredTables: ['agents', 'roadmap_items'],
    });
    const integ = find('integrity.db-integrity-check', rep);
    expect(integ.status).toBe('fail');
    expect(integ.fix).toMatch(/backup/);
    expect(find('integrity.schema-present', rep).detail).toMatch(/roadmap_items/);
  });

  it('provenance: brew-hash mismatch is a CRITICAL fail', async () => {
    const rep = await runAttest(createInvariants(), {
      installedBinarySha: async () => 'aaaa1111',
      tapDeclaredSha: async () => 'bbbb2222',
    });
    const p = find('provenance.brew-hash-match', rep);
    expect(p.status).toBe('fail');
    expect(p.severity).toBe('critical');
  });

  it('security + coordination: crypto break and Cartographer down both fail', async () => {
    const rep = await runAttest(createInvariants(), {
      cryptoSelfTest: () => false,
      committedActorsUp: async () => [{ id: 'cartographer', up: false }],
    });
    expect(find('security.crypto-self-test', rep).status).toBe('fail');
    expect(find('coordination.committed-actors-up', rep).detail).toMatch(/cartographer/);
  });
});
