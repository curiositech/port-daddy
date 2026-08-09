/**
 * ADR-0120 cross-Worker parity gate — relay half.
 *
 * The relay VERIFIES run-page capability tokens that the fleet-executor MINTS
 * (hex(HMAC-SHA256(secret, runId))), and each Worker hand-implements the
 * function because they deploy separately. This suite pins the relay's copy to
 * the shared fixture at tests/fixtures/run-page-token-parity-vectors.json; the
 * executor's suite pins its copy to the same file. A divergence in either copy
 * fails that app's CI instead of silently breaking every details_url link.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runPageToken } from '../src/fleet-run-page.js';

interface ParityVector {
  secret: string;
  runId: string;
  hmacHex: string;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/run-page-token-parity-vectors.json', import.meta.url), 'utf8'),
) as { vectors: ParityVector[] };

describe('runPageToken parity (relay ⇄ fleet-executor shared fixture)', () => {
  it('fixture is present and non-trivial', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(3);
  });

  for (const v of fixture.vectors) {
    it(`reproduces vector for runId=${v.runId}`, async () => {
      expect(await runPageToken(v.secret, v.runId)).toBe(v.hmacHex);
    });
  }
});
