import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adjudicateObservedEffect,
  computeActionDigest,
  computeAdjudicationDigest,
  verifyAdjudication,
} from '../../lib/agent-harbor/governance/action-adjudication.js';

const here = dirname(fileURLToPath(import.meta.url));
const HASH = (character) => `sha256:${character.repeat(64)}`;

function proposal(overrides = {}) {
  return {
    schema: 'pd.agent-harbor.action-proposal.v0',
    actionId: 'act_test',
    actionClass: 'repository.merge',
    operation: 'merge.pull-request',
    subject: {
      actorId: 'actor_test',
      bodyId: 'body_test',
      sessionId: 'session_test',
      executionEnvelopeDigest: HASH('1'),
    },
    target: { kind: 'github.pull-request', id: 'port-daddy#1', scopeDigest: HASH('2') },
    parametersDigest: HASH('3'),
    policyInputDigest: HASH('4'),
    requestedAt: '2026-09-08T12:00:00.000Z',
    expiresAt: '2026-09-08T12:10:00.000Z',
    ...overrides,
  };
}

function receipt(action, overrides = {}) {
  return {
    schema: 'pd.agent-harbor.adjudication-receipt.v0',
    receiptId: 'adj_test',
    actionDigest: computeActionDigest(action),
    decision: 'permit',
    reasonCodes: ['policy-satisfied'],
    policy: { policyId: 'test.v1', policyDigest: HASH('5'), evaluatorDigest: HASH('6') },
    authority: {
      issuer: 'external-controller-test',
      domain: 'external-controller',
      grantDigest: HASH('7'),
      proof: 'signed-test-proof',
    },
    mediation: {
      interceptionPoint: 'credential-broker-before-effect',
      evaluatorSeparatedFromSubject: true,
      decisionBeforeEffect: true,
    },
    obligations: [],
    issuedAt: '2026-09-08T12:01:00.000Z',
    expiresAt: '2026-09-08T12:05:00.000Z',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    now: new Date('2026-09-08T12:02:00.000Z'),
    trustedPolicyDigests: new Set([HASH('5')]),
    verifyAuthorityProof: () => true,
    verifyEffectWitness: () => true,
    ...overrides,
  };
}

function effect(action, adjudication, overrides = {}) {
  return {
    schema: 'pd.agent-harbor.effect-receipt.v0',
    effectId: 'eff_test',
    actionDigest: computeActionDigest(action),
    adjudicationDigest: adjudication === null ? null : computeAdjudicationDigest(adjudication),
    effect: {
      kind: 'github.pull-request.merged',
      targetDigest: action.target.scopeDigest,
      resultDigest: HASH('9'),
    },
    witness: { observedBy: 'github-api', evidenceDigest: HASH('a') },
    occurredAt: '2026-09-08T12:03:00.000Z',
    ...overrides,
  };
}

describe('provable action adjudication evidence contract', () => {
  it('hashes semantically identical proposals identically', () => {
    const left = proposal();
    const right = { ...left, subject: { ...left.subject } };
    expect(computeActionDigest(left)).toBe(computeActionDigest(right));
  });

  it('permits only an exact, current, trusted, externally verified decision', () => {
    const action = proposal();
    expect(verifyAdjudication(action, receipt(action), context())).toEqual({
      executable: true,
      findings: [],
    });
  });

  it.each([
    ['mutated action', (action, decision, ctx) => [
      { ...action, operation: 'merge.force' }, decision, ctx,
    ], 'action-digest-mismatch'],
    ['untrusted policy', (action, decision, ctx) => [
      action, decision, { ...ctx, trustedPolicyDigests: new Set() },
    ], 'untrusted-policy'],
    ['unverified authority', (action, decision, ctx) => [
      action, decision, { ...ctx, verifyAuthorityProof: () => false },
    ], 'unverified-authority'],
    ['self adjudication', (action, decision, ctx) => [
      action, { ...decision, mediation: { ...decision.mediation, evaluatorSeparatedFromSubject: false } }, ctx,
    ], 'self-adjudication'],
    ['post-effect observation', (action, decision, ctx) => [
      action, { ...decision, mediation: { ...decision.mediation, decisionBeforeEffect: false } }, ctx,
    ], 'post-effect-decision'],
    ['fixture authority', (action, decision, ctx) => [
      action, { ...decision, authority: { ...decision.authority, domain: 'test-fixture' } }, ctx,
    ], 'non-production-authority'],
    ['missing authority grant', (action, decision, ctx) => [
      action, { ...decision, authority: { ...decision.authority, grantDigest: null } }, ctx,
    ], 'missing-authority-grant'],
    ['future decision', (action, decision, ctx) => [
      action, decision, { ...ctx, now: new Date('2026-09-08T12:00:30.000Z') },
    ], 'receipt-not-yet-valid'],
    ['malformed proposal expiry', (action, decision, ctx) => [
      { ...action, expiresAt: 'never' }, decision, ctx,
    ], 'proposal-expired'],
    ['malformed proposal request time', (action, decision, ctx) => [
      { ...action, requestedAt: 'not a date' }, decision, ctx,
    ], 'invalid-proposal-time'],
    ['non-string proposal request time', (action, decision, ctx) => [
      { ...action, requestedAt: 0 }, decision, ctx,
    ], 'invalid-proposal-time'],
  ])('fails closed for %s', (_name, mutate, expected) => {
    const action = proposal();
    const decision = receipt(action);
    const [changedAction, changedDecision, changedContext] = mutate(action, decision, context());
    const result = verifyAdjudication(changedAction, changedDecision, changedContext);
    expect(result.executable).toBe(false);
    expect(result.findings).toContain(expected);
  });

  it('keeps a deny non-executable even when its evidence is valid', () => {
    const action = proposal();
    expect(verifyAdjudication(action, receipt(action, { decision: 'deny' }), context())).toEqual({
      executable: false,
      findings: [],
    });
  });

  it('requires a concrete obligation for permit-with-obligations', () => {
    const action = proposal();
    const result = verifyAdjudication(
      action,
      receipt(action, { decision: 'permit-with-obligations', obligations: [] }),
      context(),
    );
    expect(result).toEqual({ executable: false, findings: ['obligations-missing'] });
  });

  it.each([
    ['malformed', 'eventually', 'obligation-due-at-invalid'],
    ['already due', '2026-09-08T12:01:30.000Z', 'obligation-already-due'],
  ])('rejects a %s obligation deadline before execution', (_name, dueAt, expected) => {
    const action = proposal();
    const result = verifyAdjudication(
      action,
      receipt(action, {
        decision: 'permit-with-obligations',
        obligations: [{ obligationId: 'obl_1', predicateDigest: HASH('b'), dueAt }],
      }),
      context(),
    );
    expect(result.executable).toBe(false);
    expect(result.findings).toContain(expected);
  });

  it('classifies an exact permit and preserves open obligations', () => {
    const action = proposal();
    const permit = receipt(action);
    expect(adjudicateObservedEffect(action, permit, effect(action, permit), context()).status)
      .toBe('authorized');

    const obligated = receipt(action, {
      decision: 'permit-with-obligations',
      obligations: [{ obligationId: 'obl_1', predicateDigest: HASH('b'), dueAt: null }],
    });
    expect(adjudicateObservedEffect(action, obligated, effect(action, obligated), context()).status)
      .toBe('authorized-with-open-obligations');
  });

  it('evaluates a historical permit at effect time, not observation time', () => {
    const action = proposal();
    const permit = receipt(action);
    const longAfterExpiry = context({ now: new Date('2026-09-09T12:00:00.000Z') });
    expect(adjudicateObservedEffect(action, permit, effect(action, permit), longAfterExpiry).status)
      .toBe('authorized');
  });

  it('classifies an observed effect after a deny as a violation', () => {
    const action = proposal();
    const denial = receipt(action, { decision: 'deny' });
    expect(adjudicateObservedEffect(action, denial, effect(action, denial), context())).toEqual({
      status: 'violation-against-decision',
      executable: false,
      findings: [],
    });
  });

  it('never treats a mismatched or post-dated receipt as authority', () => {
    const action = proposal();
    const permit = receipt(action);
    const result = adjudicateObservedEffect(
      action,
      permit,
      effect(action, permit, { adjudicationDigest: HASH('f'), occurredAt: '2026-09-08T12:00:30.000Z' }),
      context(),
    );
    expect(result.status).toBe('bypass-invalid-adjudication');
    expect(result.findings).toEqual(expect.arrayContaining([
      'effect-adjudication-digest-mismatch',
      'effect-predates-decision',
    ]));
  });

  it('fails closed when the effect witness cannot be verified', () => {
    const action = proposal();
    const permit = receipt(action);
    const result = adjudicateObservedEffect(
      action,
      permit,
      effect(action, permit),
      context({ verifyEffectWitness: () => false }),
    );
    expect(result.status).toBe('bypass-invalid-adjudication');
    expect(result.findings).toContain('unverified-effect-witness');
  });

  it('records the force-landed hook fix as bypass evidence, not retrospective permission', () => {
    const fixture = JSON.parse(readFileSync(
      join(here, '..', 'fixtures', 'action-adjudication', 'pr-10104-force-merge.json'),
      'utf8',
    ));
    expect(fixture.effect.actionDigest).toBe(computeActionDigest(fixture.proposal));
    expect(adjudicateObservedEffect(
      fixture.proposal,
      fixture.adjudication,
      fixture.effect,
      context(),
    ).status).toBe(fixture.expectedStatus);
  });
});
