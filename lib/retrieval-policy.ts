import { createHash } from 'node:crypto';
import { embeddingProfiles } from './model-registry.js';
import type {
  EmbeddingProfile,
  EmbeddingQualityTier,
  EmbeddingRetrievalRole,
} from './model-registry-data.js';

export const CORPUS_POLICY_VERSION = 1 as const;

export type CorpusClassification = 'public' | 'internal' | 'confidential' | 'secret';
export type RemoteEgressPolicy = 'deny' | 'allow';

export interface CorpusPolicyInput {
  readonly version: typeof CORPUS_POLICY_VERSION;
  readonly policyId: string;
  readonly revision: string;
  readonly corpusId: string;
  readonly classification: CorpusClassification;
  readonly allowedRoles: readonly EmbeddingRetrievalRole[];
  readonly tierPreference: readonly EmbeddingQualityTier[];
  readonly allowedProviders: readonly string[];
  readonly remoteEgress: RemoteEgressPolicy;
  readonly allowLexicalFallback: boolean;
  readonly redactionPolicyId: string;
  readonly retentionPolicyId: string;
  readonly latencyBudgetMs: { readonly p50: number; readonly p95: number };
  readonly costCapUsdPerThousandQueries: number;
}

export interface CorpusPolicy extends CorpusPolicyInput {
  readonly policyDigest: string;
}

export interface EmbeddingSelection {
  readonly policy: CorpusPolicy;
  readonly role: EmbeddingRetrievalRole;
  readonly profile: Readonly<EmbeddingProfile>;
  readonly tier: EmbeddingQualityTier;
  readonly requiresProducerConformance: true;
}

export type EmbeddingPolicyErrorCode =
  | 'INVALID_POLICY'
  | 'ROLE_FORBIDDEN'
  | 'NO_AUTHORIZED_PROFILE';

export class EmbeddingPolicyError extends Error {
  constructor(
    message: string,
    readonly code: EmbeddingPolicyErrorCode,
  ) {
    super(message);
    this.name = 'EmbeddingPolicyError';
  }
}

const CLASSIFICATIONS = new Set<CorpusClassification>([
  'public',
  'internal',
  'confidential',
  'secret',
]);
const ROLES = new Set<EmbeddingRetrievalRole>([
  'text_dense',
  'code_dense',
  'ui_multimodal_dense',
  'rerank',
]);
const TIERS = new Set<EmbeddingQualityTier>([
  'local_fast',
  'local_quality',
  'remote_quality',
]);
const POLICY_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,127}$/;

/**
 * Normalize one ordered policy list without changing its selection priority.
 * The design rejects empty or repeated authority declarations because either
 * can make two ostensibly identical policies select differently.
 *
 * @param values Ordered policy values supplied by the corpus owner.
 * @param field Field name used in actionable validation errors.
 * @returns Trimmed values with the original order preserved.
 */
function uniqueNonEmptyStrings(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new EmbeddingPolicyError(`${field} must be a non-empty list`, 'INVALID_POLICY');
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new EmbeddingPolicyError(`${field} contains an empty value`, 'INVALID_POLICY');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new EmbeddingPolicyError(`${field} must not contain duplicates`, 'INVALID_POLICY');
  }
  return normalized;
}

/**
 * Validate a positive finite policy budget. The purpose is to reject NaN and
 * infinity before they can accidentally disable an admission boundary.
 *
 * @param value Numeric policy value to validate.
 * @param field Field name used in the validation error.
 * @returns The validated value unchanged.
 */
function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new EmbeddingPolicyError(`${field} must be positive and finite`, 'INVALID_POLICY');
  }
  return value;
}

/**
 * Project policy input into a fixed-order digest payload. This design keeps
 * policy identity stable across object insertion order and implementation refactors.
 *
 * @param policy Validated, normalized corpus policy input.
 * @returns A fixed-order JSON-serializable identity payload.
 */
function canonicalPolicyPayload(policy: CorpusPolicyInput): object {
  return {
    version: policy.version,
    policyId: policy.policyId,
    revision: policy.revision,
    corpusId: policy.corpusId,
    classification: policy.classification,
    allowedRoles: [...policy.allowedRoles],
    tierPreference: [...policy.tierPreference],
    allowedProviders: [...policy.allowedProviders],
    remoteEgress: policy.remoteEgress,
    allowLexicalFallback: policy.allowLexicalFallback,
    redactionPolicyId: policy.redactionPolicyId,
    retentionPolicyId: policy.retentionPolicyId,
    latencyBudgetMs: {
      p50: policy.latencyBudgetMs.p50,
      p95: policy.latencyBudgetMs.p95,
    },
    costCapUsdPerThousandQueries: policy.costCapUsdPerThousandQueries,
  };
}

/**
 * Validate and content-address a corpus policy before it can participate in
 * model selection. The design makes selection bind this digest, never a mutable
 * object reference or a display label.
 *
 * @param input Versioned policy authority supplied for one corpus.
 * @returns An immutable normalized policy carrying its content digest.
 */
export function compileCorpusPolicy(input: CorpusPolicyInput): CorpusPolicy {
  if (!input || typeof input !== 'object' || input.version !== CORPUS_POLICY_VERSION) {
    throw new EmbeddingPolicyError(
      `corpus policy version must be ${CORPUS_POLICY_VERSION}`,
      'INVALID_POLICY',
    );
  }
  if (!POLICY_ID.test(input.policyId)) {
    throw new EmbeddingPolicyError('policyId is malformed', 'INVALID_POLICY');
  }
  if (!REVISION.test(input.revision)) {
    throw new EmbeddingPolicyError('revision is malformed', 'INVALID_POLICY');
  }
  if (!POLICY_ID.test(input.corpusId)) {
    throw new EmbeddingPolicyError('corpusId is malformed', 'INVALID_POLICY');
  }
  if (!CLASSIFICATIONS.has(input.classification)) {
    throw new EmbeddingPolicyError('classification is invalid', 'INVALID_POLICY');
  }
  const allowedRoles = uniqueNonEmptyStrings(input.allowedRoles, 'allowedRoles');
  if (allowedRoles.some((role) => !ROLES.has(role as EmbeddingRetrievalRole))) {
    throw new EmbeddingPolicyError('allowedRoles contains an unknown role', 'INVALID_POLICY');
  }
  const tierPreference = uniqueNonEmptyStrings(input.tierPreference, 'tierPreference');
  if (tierPreference.some((tier) => !TIERS.has(tier as EmbeddingQualityTier))) {
    throw new EmbeddingPolicyError('tierPreference contains an unknown tier', 'INVALID_POLICY');
  }
  const allowedProviders = uniqueNonEmptyStrings(input.allowedProviders, 'allowedProviders');
  if (input.remoteEgress !== 'deny' && input.remoteEgress !== 'allow') {
    throw new EmbeddingPolicyError('remoteEgress must be deny or allow', 'INVALID_POLICY');
  }
  if (input.classification === 'secret' && input.remoteEgress !== 'deny') {
    throw new EmbeddingPolicyError('secret corpora must deny remote egress', 'INVALID_POLICY');
  }
  if (typeof input.allowLexicalFallback !== 'boolean') {
    throw new EmbeddingPolicyError('allowLexicalFallback must be boolean', 'INVALID_POLICY');
  }
  if (!POLICY_ID.test(input.redactionPolicyId) || !POLICY_ID.test(input.retentionPolicyId)) {
    throw new EmbeddingPolicyError('redaction and retention policy ids are required', 'INVALID_POLICY');
  }
  const p50 = positiveFinite(input.latencyBudgetMs?.p50, 'latencyBudgetMs.p50');
  const p95 = positiveFinite(input.latencyBudgetMs?.p95, 'latencyBudgetMs.p95');
  if (p50 > p95) {
    throw new EmbeddingPolicyError('latencyBudgetMs.p50 cannot exceed p95', 'INVALID_POLICY');
  }
  if (!Number.isFinite(input.costCapUsdPerThousandQueries) || input.costCapUsdPerThousandQueries < 0) {
    throw new EmbeddingPolicyError(
      'costCapUsdPerThousandQueries must be finite and non-negative',
      'INVALID_POLICY',
    );
  }

  const normalized: CorpusPolicyInput = {
    ...input,
    allowedRoles: allowedRoles as EmbeddingRetrievalRole[],
    tierPreference: tierPreference as EmbeddingQualityTier[],
    allowedProviders,
    latencyBudgetMs: { p50, p95 },
  };
  const policyDigest = `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalPolicyPayload(normalized)), 'utf8')
    .digest('hex')}`;
  return Object.freeze({
    ...normalized,
    allowedRoles: Object.freeze([...normalized.allowedRoles]),
    tierPreference: Object.freeze([...normalized.tierPreference]),
    allowedProviders: Object.freeze([...normalized.allowedProviders]),
    latencyBudgetMs: Object.freeze({ ...normalized.latencyBudgetMs }),
    policyDigest,
  });
}

/**
 * Choose a declared logical profile from policy. This is deliberately not an
 * execution authorization. The design keeps every generated profile
 * `declarative-only`, so a producer must separately prove conformance before
 * it writes or compares vectors carrying the selected `spaceId`.
 *
 * @param policy Compiled corpus authority controlling providers, roles, and tiers.
 * @param role Retrieval role requested by the calling pipeline.
 * @returns The highest-preference authorized profile plus policy binding.
 */
export function selectEmbeddingProfile(
  policy: CorpusPolicy,
  role: EmbeddingRetrievalRole,
): EmbeddingSelection {
  if (!policy.allowedRoles.includes(role)) {
    throw new EmbeddingPolicyError(
      `corpus policy ${policy.policyId}@${policy.revision} forbids role ${role}`,
      'ROLE_FORBIDDEN',
    );
  }
  const profiles = Object.values(embeddingProfiles()).filter((profile) =>
    profile.retrievalRoles.includes(role) &&
    policy.tierPreference.includes(profile.qualityTier) &&
    policy.allowedProviders.includes(profile.servingProvider) &&
    (profile.executionClass !== 'remote' || policy.remoteEgress === 'allow'),
  );
  profiles.sort((left, right) => {
    const tier = policy.tierPreference.indexOf(left.qualityTier) -
      policy.tierPreference.indexOf(right.qualityTier);
    return tier || left.spaceId.localeCompare(right.spaceId);
  });
  const profile = profiles[0];
  if (!profile) {
    throw new EmbeddingPolicyError(
      `no ${role} embedding profile is authorized by ${policy.policyId}@${policy.revision}`,
      'NO_AUTHORIZED_PROFILE',
    );
  }
  return Object.freeze({
    policy,
    role,
    profile: Object.freeze({
      ...profile,
      retrievalRoles: Object.freeze([...profile.retrievalRoles]),
    }),
    tier: profile.qualityTier,
    requiresProducerConformance: true,
  });
}

/**
 * Build the strict local-text baseline used while callers become fully
 * corpus-configurable. Its purpose is to remove model literals immediately
 * without granting remote egress or claiming benchmark promotion.
 *
 * @param corpusId Stable identity of the caller's indexed corpus.
 * @returns A compiled zero-cost, local-only text retrieval policy.
 */
export function localTextCorpusPolicy(corpusId: string): CorpusPolicy {
  return compileCorpusPolicy({
    version: CORPUS_POLICY_VERSION,
    policyId: 'pd.retrieval.local-text.v1',
    revision: '1',
    corpusId,
    classification: 'internal',
    allowedRoles: ['text_dense'],
    tierPreference: ['local_fast'],
    allowedProviders: ['local-transformers-js'],
    remoteEgress: 'deny',
    allowLexicalFallback: true,
    redactionPolicyId: 'pd.redaction.local-text.v1',
    retentionPolicyId: 'pd.retention.source-owned.v1',
    latencyBudgetMs: { p50: 100, p95: 500 },
    costCapUsdPerThousandQueries: 0,
  });
}
