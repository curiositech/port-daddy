/**
 * Agent Harbor M5 — fail-closed behavior when the frozen guidance contract is
 * ABSENT (ADR-0096; Copilot review on PR #710).
 *
 * A trimmed/bundled install that lost schemas/agent-harbor/v0/ must not emit
 * signed guidance and must not vouch for the trusted channel: the daemon side
 * throws, the harness side rejects (an availability downgrade to C0 — the
 * honest ADR-0096 posture — never an unvalidated trusted render). The general
 * assertAgainstSchema { skipped } fail-safe is deliberate for the C2 emit
 * paths; the guidance AUTHORITY channel is held to the stricter rule, so the
 * skipped path is simulated here by mocking schema-validate.
 */
import { jest } from '@jest/globals';
import { describe, it, expect } from '@jest/globals';

jest.unstable_mockModule('../../lib/agent-harbor/schema-validate.js', () => ({
  validateAgainstSchema: () => ({ valid: true, skipped: true, errors: [] }),
  assertAgainstSchema: () => {},
  loadFrozenSchema: () => null,
}));

const {
  establishGuidanceKey,
  assembleGuidanceEnvelope,
  guidanceBindingTuple,
  signGuidanceBinding,
} = await import('../../lib/agent-harbor/guidance-envelope.js');
const { GuidanceJtiCache, verifyGuidanceEnvelope } = await import('../../lib/agent-harbor/guidance-verifier.js');

const SES = 'ses_trimmed_1';
const AGENT = 'an_trimmed_1';

describe('M5 guidance — schema-missing installs fail closed (ADR-0096)', () => {
  it('the daemon refuses to emit guidance without the frozen contract', () => {
    const key = establishGuidanceKey(SES, AGENT);
    expect(() => assembleGuidanceEnvelope(key, { turnSequence: 1, items: [{ kind: 'inbox', ref: 'msg_1' }] }))
      .toThrow(/refusing to emit unvalidated guidance/);
  });

  it('the harness refuses to vouch for the trusted channel without the frozen contract', () => {
    const key = establishGuidanceKey(SES, AGENT);
    // Hand-build a correctly signed envelope (the crypto helpers do not need
    // the schema) so ONLY the schema-availability gate is under test.
    const unsigned = {
      schema: 'pd.agent-harbor.guidance-envelope.v0',
      envelopeId: 'genv_trimmed_1',
      agentNodeId: AGENT,
      sessionId: SES,
      turnSequence: 1,
      issuedAt: new Date().toISOString(),
      notAfter: new Date(Date.now() + 120_000).toISOString(),
      nonce: 'bm9uY2UtdHJpbW1lZC0x',
      items: [{ kind: 'inbox', ref: 'msg_1' }],
      authority: { mode: 'loopback', authorityRef: null, operatorAction: 'daemon-policy' },
    };
    const envelope = {
      ...unsigned,
      sig: { alg: key.alg, keyId: key.keyId, value: signGuidanceBinding(key, guidanceBindingTuple(unsigned)) },
    };
    const verdict = verifyGuidanceEnvelope(envelope, {
      key,
      sessionId: SES,
      agentNodeId: AGENT,
      currentTurn: 1,
      jtiCache: new GuidanceJtiCache(),
    });
    expect(verdict.verified).toBe(false);
    expect(verdict.disposition).toBe('reject-injection');
    expect(verdict.reason).toMatch(/schema-unavailable/);
    expect(verdict.checks.find((c) => c.name === 'schema').passed).toBe(false);
  });
});
