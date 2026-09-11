import { createHash } from 'node:crypto';

import { canonicalJson } from '../../merkle-chain.js';

export type ActionDecision = 'permit' | 'deny' | 'permit-with-obligations' | 'indeterminate';

export interface ActionProposal {
  schema: 'pd.agent-harbor.action-proposal.v0';
  actionId: string;
  actionClass: string;
  operation: string;
  subject: {
    actorId: string;
    bodyId: string | null;
    sessionId: string | null;
    executionEnvelopeDigest: string | null;
  };
  target: {
    kind: string;
    id: string;
    scopeDigest: string;
  };
  parametersDigest: string;
  policyInputDigest: string;
  requestedAt: string;
  expiresAt: string;
}

export interface AdjudicationReceipt {
  schema: 'pd.agent-harbor.adjudication-receipt.v0';
  receiptId: string;
  actionDigest: string;
  decision: ActionDecision;
  reasonCodes: string[];
  policy: {
    policyId: string;
    policyDigest: string;
    evaluatorDigest: string;
  };
  authority: {
    issuer: string;
    domain: 'external-controller' | 'operator' | 'test-fixture';
    grantDigest: string | null;
    proof: string | null;
  };
  mediation: {
    interceptionPoint: string;
    evaluatorSeparatedFromSubject: boolean;
    decisionBeforeEffect: boolean;
  };
  obligations: Array<{
    obligationId: string;
    predicateDigest: string;
    dueAt: string | null;
  }>;
  issuedAt: string;
  expiresAt: string;
}

export interface EffectReceipt {
  schema: 'pd.agent-harbor.effect-receipt.v0';
  effectId: string;
  actionDigest: string;
  adjudicationDigest: string | null;
  effect: {
    kind: string;
    targetDigest: string;
    resultDigest: string;
  };
  witness: {
    observedBy: string;
    evidenceDigest: string;
  };
  occurredAt: string;
}

export interface AdjudicationVerificationContext {
  now: Date;
  trustedPolicyDigests: ReadonlySet<string>;
  verifyAuthorityProof: (receipt: AdjudicationReceipt) => boolean;
  verifyEffectWitness: (effect: EffectReceipt) => boolean;
}

export type AdjudicationFindingCode =
  | 'action-digest-mismatch'
  | 'proposal-expired'
  | 'receipt-expired'
  | 'receipt-predates-proposal'
  | 'untrusted-policy'
  | 'unverified-authority'
  | 'self-adjudication'
  | 'post-effect-decision'
  | 'missing-reason'
  | 'obligations-missing'
  | 'non-production-authority'
  | 'missing-authority-grant'
  | 'invalid-proposal-time'
  | 'invalid-receipt-time'
  | 'proposal-not-yet-valid'
  | 'receipt-not-yet-valid'
  | 'invalid-evaluation-time'
  | 'obligation-due-at-invalid'
  | 'obligation-already-due'
  | 'effect-action-digest-mismatch'
  | 'effect-adjudication-digest-mismatch'
  | 'effect-target-digest-mismatch'
  | 'effect-result-digest-invalid'
  | 'unverified-effect-witness'
  | 'effect-predates-decision';

export interface AdjudicationVerification {
  executable: boolean;
  findings: AdjudicationFindingCode[];
}

export type EffectAdjudicationStatus =
  | 'authorized'
  | 'authorized-with-open-obligations'
  | 'bypass-unadjudicated'
  | 'bypass-invalid-adjudication'
  | 'violation-against-decision';

export interface EffectAdjudication {
  status: EffectAdjudicationStatus;
  executable: boolean;
  findings: AdjudicationFindingCode[];
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function computeActionDigest(proposal: ActionProposal): string {
  return digest(proposal);
}

export function computeAdjudicationDigest(receipt: AdjudicationReceipt): string {
  return digest(receipt);
}

function validTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Pure, fail-closed verification of a proposed action against one decision.
 * This verifies evidence binding; it does not claim the caller actually routes
 * every effect through this function. Complete mediation belongs to the
 * external execution controller described by ADR-0140.
 */
export function verifyAdjudication(
  proposal: ActionProposal,
  receipt: AdjudicationReceipt,
  context: AdjudicationVerificationContext,
): AdjudicationVerification {
  const findings: AdjudicationFindingCode[] = [];
  const requestedAt = validTime(proposal.requestedAt);
  const proposalExpiry = validTime(proposal.expiresAt);
  const issuedAt = validTime(receipt.issuedAt);
  const receiptExpiry = validTime(receipt.expiresAt);
  const now = context.now.getTime();

  if (!SHA256.test(receipt.actionDigest) || receipt.actionDigest !== computeActionDigest(proposal)) {
    findings.push('action-digest-mismatch');
  }
  if (proposalExpiry === null || proposalExpiry <= now) {
    findings.push('proposal-expired');
  }
  if (!Number.isFinite(now)) findings.push('invalid-evaluation-time');
  if (requestedAt === null) findings.push('invalid-proposal-time');
  if (issuedAt === null || receiptExpiry === null) findings.push('invalid-receipt-time');
  if (requestedAt !== null && requestedAt > now) findings.push('proposal-not-yet-valid');
  if (receiptExpiry === null || receiptExpiry <= now) findings.push('receipt-expired');
  if (requestedAt === null || issuedAt === null || issuedAt < requestedAt) {
    findings.push('receipt-predates-proposal');
  }
  if (issuedAt !== null && issuedAt > now) findings.push('receipt-not-yet-valid');
  if (!SHA256.test(receipt.policy.policyDigest)
      || !context.trustedPolicyDigests.has(receipt.policy.policyDigest)) {
    findings.push('untrusted-policy');
  }
  let authorityVerified = false;
  try {
    authorityVerified = context.verifyAuthorityProof(receipt);
  } catch {
    authorityVerified = false;
  }
  if (!authorityVerified) findings.push('unverified-authority');
  if (receipt.authority.domain === 'test-fixture') findings.push('non-production-authority');
  if ((receipt.decision === 'permit' || receipt.decision === 'permit-with-obligations')
      && (receipt.authority.grantDigest === null || !SHA256.test(receipt.authority.grantDigest))) {
    findings.push('missing-authority-grant');
  }
  if (!receipt.mediation.evaluatorSeparatedFromSubject) findings.push('self-adjudication');
  if (!receipt.mediation.decisionBeforeEffect) findings.push('post-effect-decision');
  if (receipt.reasonCodes.length === 0) findings.push('missing-reason');
  if (receipt.decision === 'permit-with-obligations' && receipt.obligations.length === 0) {
    findings.push('obligations-missing');
  }
  if (receipt.decision === 'permit-with-obligations') {
    for (const obligation of receipt.obligations) {
      if (obligation.dueAt === null) continue;
      const dueAt = validTime(obligation.dueAt);
      if (dueAt === null) findings.push('obligation-due-at-invalid');
      else if (dueAt <= now) findings.push('obligation-already-due');
    }
  }

  const permits = receipt.decision === 'permit' || receipt.decision === 'permit-with-obligations';
  return { executable: permits && findings.length === 0, findings };
}

/** Classify an observed effect without laundering post-hoc evidence into permission. */
export function adjudicateObservedEffect(
  proposal: ActionProposal,
  receipt: AdjudicationReceipt | null,
  effect: EffectReceipt,
  context: AdjudicationVerificationContext,
): EffectAdjudication {
  const effectFindings: AdjudicationFindingCode[] = [];
  if (effect.actionDigest !== computeActionDigest(proposal)) {
    effectFindings.push('effect-action-digest-mismatch');
  }
  if (effect.effect.targetDigest !== proposal.target.scopeDigest) {
    effectFindings.push('effect-target-digest-mismatch');
  }
  if (!SHA256.test(effect.effect.resultDigest)) {
    effectFindings.push('effect-result-digest-invalid');
  }
  let effectWitnessVerified = false;
  try {
    effectWitnessVerified = context.verifyEffectWitness(effect);
  } catch {
    effectWitnessVerified = false;
  }
  if (!effectWitnessVerified) effectFindings.push('unverified-effect-witness');

  if (receipt === null || effect.adjudicationDigest === null) {
    return {
      status: 'bypass-unadjudicated',
      executable: false,
      findings: effectFindings,
    };
  }

  const bindingFindings: AdjudicationFindingCode[] = [...effectFindings];
  if (effect.adjudicationDigest !== computeAdjudicationDigest(receipt)) {
    bindingFindings.push('effect-adjudication-digest-mismatch');
  }
  const effectAt = validTime(effect.occurredAt);
  const receiptAt = validTime(receipt.issuedAt);
  if (effectAt === null || receiptAt === null || effectAt < receiptAt) {
    bindingFindings.push('effect-predates-decision');
  }
  const verification = verifyAdjudication(proposal, receipt, {
    ...context,
    // Historical authorization is evaluated at effect time. A receipt that
    // was valid when used does not become a bypass merely because its lease
    // has since expired.
    now: effectAt === null ? context.now : new Date(effectAt),
  });

  if (bindingFindings.length > 0 || verification.findings.length > 0) {
    return {
      status: 'bypass-invalid-adjudication',
      executable: false,
      findings: [...verification.findings, ...bindingFindings],
    };
  }
  if (!verification.executable) {
    return { status: 'violation-against-decision', executable: false, findings: [] };
  }
  return {
    status: receipt.decision === 'permit-with-obligations'
      ? 'authorized-with-open-obligations'
      : 'authorized',
    executable: true,
    findings: [],
  };
}
