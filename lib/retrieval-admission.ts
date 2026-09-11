import { createHash } from 'node:crypto';
import {
  HandoffScannerUnavailableError,
  HandoffSecretError,
  sanitizeHandoffText,
  type GitleaksRunner,
} from './handoff-capsule.js';
import type { CorpusPolicy } from './retrieval-policy.js';

export const RETRIEVAL_ADMISSION_VERSION = 1 as const;

export interface RetrievalAdmissionReceipt {
  readonly version: typeof RETRIEVAL_ADMISSION_VERSION;
  readonly receiptId: string;
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly derivativeDigest: string;
  readonly corpusId: string;
  readonly harborId: string;
  readonly repoRef: string | null;
  readonly policyDigest: string;
  readonly redactionPolicyId: string;
  readonly retentionPolicyId: string;
  readonly state: 'clean' | 'redacted';
  readonly sanitizers: readonly ['port-daddy-secret-redaction', 'port-daddy-gitleaks-rules', 'gitleaks-stdin'];
  readonly admittedAt: string;
}

export interface AdmittedRetrievalDerivative {
  readonly text: string;
  readonly receipt: RetrievalAdmissionReceipt;
}

export interface RetrievalAdmissionOptions {
  readonly home?: string;
  readonly gitleaksRunner?: GitleaksRunner;
  readonly now?: () => Date;
}

export class RetrievalAdmissionError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_ADMISSION' | 'SANITIZER_UNAVAILABLE' | 'SECRET_REJECTED' | 'QUERY_REDACTED',
  ) {
    super(message);
    this.name = 'RetrievalAdmissionError';
  }
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RetrievalAdmissionError(`${field} is required`, 'INVALID_ADMISSION');
  return normalized;
}

/**
 * Convert protected source text into the only representation retrieval may
 * tokenize, embed, or persist. The same local redactor and dual scanner used
 * by handoff capsules runs before the derivative crosses the index boundary.
 * Raw source content contributes only a digest and is never returned.
 *
 * @param input Source identity, candidate derivative, scope, and corpus policy.
 * @param options Injectable scanner and clock for deterministic tests.
 * @returns Sanitized text plus a content-addressed admission receipt.
 */
export function admitRetrievalDerivative(
  input: {
    sourceId: string;
    sourceContent: string;
    text: string;
    harborId: string;
    repoRef?: string | null;
    policy: CorpusPolicy;
  },
  options: RetrievalAdmissionOptions = {},
): AdmittedRetrievalDerivative {
  const sourceId = required(input.sourceId, 'sourceId');
  const harborId = required(input.harborId, 'harborId');
  if (input.policy.corpusId.trim().length === 0 || input.policy.policyDigest.trim().length === 0) {
    throw new RetrievalAdmissionError('compiled corpus policy is required', 'INVALID_ADMISSION');
  }
  let text: string;
  try {
    text = sanitizeHandoffText(input.text, {
      home: options.home,
      gitleaksRunner: options.gitleaksRunner,
      maxBytes: 128 * 1024,
    });
  } catch (error) {
    if (error instanceof HandoffScannerUnavailableError) {
      throw new RetrievalAdmissionError(
        'retrieval sanitizer is unavailable; source was not indexed',
        'SANITIZER_UNAVAILABLE',
      );
    }
    if (error instanceof HandoffSecretError) {
      throw new RetrievalAdmissionError(
        'retrieval sanitizer rejected residual secret material; source was not indexed',
        'SECRET_REJECTED',
      );
    }
    throw error;
  }
  const sourceDigest = digest(input.sourceContent);
  const derivativeDigest = digest(text);
  const repoRef = input.repoRef?.trim() || null;
  const state: RetrievalAdmissionReceipt['state'] = text === input.text ? 'clean' : 'redacted';
  const identity = {
    version: RETRIEVAL_ADMISSION_VERSION,
    sourceId,
    sourceDigest,
    derivativeDigest,
    corpusId: input.policy.corpusId,
    harborId,
    repoRef,
    policyDigest: input.policy.policyDigest,
    redactionPolicyId: input.policy.redactionPolicyId,
    retentionPolicyId: input.policy.retentionPolicyId,
    state,
    sanitizers: [
      'port-daddy-secret-redaction',
      'port-daddy-gitleaks-rules',
      'gitleaks-stdin',
    ] as const,
  };
  const receiptId = digest(JSON.stringify(identity));
  const receipt = Object.freeze({
    ...identity,
    receiptId,
    admittedAt: (options.now?.() ?? new Date()).toISOString(),
  });
  return Object.freeze({ text, receipt });
}

/**
 * Screen a query before lexical tokenization or dense-provider invocation.
 * Queries that require redaction are rejected rather than silently changing
 * user intent, and the clean receipt can be attached to the retrieval result.
 *
 * @param input Query identity, text, scope, and corpus policy.
 * @param options Injectable scanner and clock.
 * @returns Clean query text and its admission receipt.
 */
export function admitRetrievalQuery(
  input: {
    queryId: string;
    queryText: string;
    harborId: string;
    repoRef?: string | null;
    policy: CorpusPolicy;
  },
  options: RetrievalAdmissionOptions = {},
): AdmittedRetrievalDerivative {
  const admitted = admitRetrievalDerivative({
    sourceId: input.queryId,
    sourceContent: input.queryText,
    text: input.queryText,
    harborId: input.harborId,
    repoRef: input.repoRef,
    policy: input.policy,
  }, options);
  if (admitted.receipt.state !== 'clean') {
    throw new RetrievalAdmissionError(
      'retrieval query contains secret material and was rejected before ranking or egress',
      'QUERY_REDACTED',
    );
  }
  return admitted;
}
