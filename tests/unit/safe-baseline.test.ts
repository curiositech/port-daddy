/**
 * A2 baseline unit tests (jest). ADR-0088 Phase A test plan:
 *  - first scan flags N; accept all; re-scan flags 0; inject 1 new → flags exactly 1.
 *  - fingerprint excludes the line number (survives edits above the secret).
 *  - no raw value is ever stored in the baseline.
 */
import {
  fingerprint,
  baselineFromFindings,
  applyBaseline,
  triage,
  emptyBaseline,
} from '../../lib/safe/baseline.js';
import type { SecretFinding } from '../../lib/safe/types.js';

function finding(over: Partial<SecretFinding> = {}): SecretFinding {
  return {
    path: '/home/test/.env',
    line: 1,
    ruleId: 'aws-access-token',
    last4: 'MPLE',
    entropy: 3.8,
    method: 'structured-format',
    verified: null,
    ...over,
  };
}

describe('A2: fingerprint', () => {
  test('is stable over ruleId+path+last4 and EXCLUDES the line number', () => {
    const a = finding({ line: 1 });
    const b = finding({ line: 999 }); // same secret, moved down the file
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  test('differs when ruleId, path, or last4 differ', () => {
    const base = finding();
    expect(fingerprint(base)).not.toBe(fingerprint(finding({ last4: 'XXXX' })));
    expect(fingerprint(base)).not.toBe(fingerprint(finding({ path: '/other' })));
    expect(fingerprint(base)).not.toBe(fingerprint(finding({ ruleId: 'github-pat' })));
  });
});

describe('A2: baseline triage flow (the ADR test plan)', () => {
  test('first scan flags N → accept all → re-scan flags 0 → inject 1 → flags exactly 1', () => {
    // First scan: 3 findings.
    const first = [
      finding({ ruleId: 'aws-access-token', last4: 'AAAA' }),
      finding({ ruleId: 'github-pat', last4: 'BBBB' }),
      finding({ ruleId: 'gcp-api-key', last4: 'CCCC' }),
    ];
    expect(first).toHaveLength(3);

    // Accept all → baseline.
    const baseline = baselineFromFindings(first, 'accepted');
    expect(baseline.entries).toHaveLength(3);

    // Re-scan (identical findings) → 0 NEW.
    const rescan = applyBaseline(first, baseline);
    expect(rescan.newFindings).toHaveLength(0);
    expect(rescan.suppressed).toBe(3);

    // Inject ONE new secret → exactly 1 NEW.
    const withNew = [...first, finding({ ruleId: 'slack-bot-token', last4: 'DDDD' })];
    const after = applyBaseline(withNew, baseline);
    expect(after.newFindings).toHaveLength(1);
    expect(after.newFindings[0].ruleId).toBe('slack-bot-token');
    expect(after.suppressed).toBe(3);
  });

  test('a moved (re-lined) accepted finding stays suppressed', () => {
    const f = finding({ line: 5 });
    const baseline = baselineFromFindings([f], 'accepted');
    const moved = applyBaseline([finding({ line: 88 })], baseline);
    expect(moved.newFindings).toHaveLength(0);
  });

  test('false-positive suppresses; rotated does NOT suppress', () => {
    const fp = finding({ ruleId: 'github-pat', last4: 'FFFF' });
    const rot = finding({ ruleId: 'gcp-api-key', last4: 'RRRR' });
    let b = emptyBaseline();
    b = triage(b, fp, 'false-positive');
    b = triage(b, rot, 'rotated');
    const res = applyBaseline([fp, rot], b);
    expect(res.suppressed).toBe(1); // only the false-positive
    expect(res.newFindings.map((x) => x.ruleId)).toEqual(['gcp-api-key']);
  });
});

describe('A2: no raw secret is ever stored in the baseline', () => {
  test('baseline JSON contains only path/ruleId/last4/state, never a full token', () => {
    // Synthetic, obviously-fake AWS-shaped token assembled at runtime so no
    // scanner-recognizable literal sits in source. The point: its full form must
    // NEVER end up in the baseline; only its last4 (an identifier) may.
    const RAW = 'AKIA' + 'FAKETESTKEY' + '23456';
    const f = finding({ last4: RAW.slice(-4) });
    const b = baselineFromFindings([f], 'accepted');
    expect(JSON.stringify(b).includes(RAW)).toBe(false);
    expect(b.entries[0]).toMatchObject({
      ruleId: 'aws-access-token',
      last4: '3456',
      state: 'accepted',
    });
  });

  test('triage upserts (no duplicate fingerprints) and is pure', () => {
    const f = finding();
    let b = emptyBaseline();
    b = triage(b, f, 'accepted');
    const before = b.entries.length;
    b = triage(b, f, 'false-positive', { note: 'test placeholder, not a real key' });
    expect(b.entries).toHaveLength(before); // upsert, not append
    expect(b.entries[0].state).toBe('false-positive');
    expect(b.entries[0].note).toBe('test placeholder, not a real key');
  });
});
