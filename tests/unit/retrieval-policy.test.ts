import { describe, expect, test } from '@jest/globals';
import {
  CORPUS_POLICY_VERSION,
  EmbeddingPolicyError,
  compileCorpusPolicy,
  localTextCorpusPolicy,
  selectEmbeddingProfile,
  type CorpusPolicyInput,
} from '../../lib/retrieval-policy.js';

function policy(overrides: Partial<CorpusPolicyInput> = {}) {
  return compileCorpusPolicy({
    version: CORPUS_POLICY_VERSION,
    policyId: 'pd.test.retrieval.v1',
    revision: 'fixture-1',
    corpusId: 'pd.test.corpus',
    classification: 'internal',
    allowedRoles: ['text_dense'],
    tierPreference: ['local_fast'],
    allowedProviders: ['local-transformers-js'],
    remoteEgress: 'deny',
    allowLexicalFallback: true,
    redactionPolicyId: 'pd.redaction.test.v1',
    retentionPolicyId: 'pd.retention.test.v1',
    latencyBudgetMs: { p50: 50, p95: 200 },
    costCapUsdPerThousandQueries: 0,
    ...overrides,
  });
}

describe('corpus-policy embedding selection', () => {
  test('selects the local text profile by role, tier, and provider policy', () => {
    const selected = selectEmbeddingProfile(policy(), 'text_dense');

    expect(selected.profile.servingProvider).toBe('local-transformers-js');
    expect(selected.profile.executionClass).toBe('local');
    expect(selected.profile.retrievalRoles).toContain('text_dense');
    expect(selected.profile.qualityTier).toBe('local_fast');
    expect(selected.profile.spaceId).toMatch(/^embed-v2:[0-9a-f]{64}$/);
    expect(selected.requiresProducerConformance).toBe(true);
  });

  test('selects BGE only when that corpus explicitly allows remote egress', () => {
    const selected = selectEmbeddingProfile(policy({
      tierPreference: ['remote_quality'],
      allowedProviders: ['cloudflare-workers-ai'],
      remoteEgress: 'allow',
      costCapUsdPerThousandQueries: 1,
    }), 'text_dense');

    expect(selected.profile.servingProvider).toBe('cloudflare-workers-ai');
    expect(selected.profile.executionClass).toBe('remote');
    expect(selected.profile.qualityTier).toBe('remote_quality');
  });

  test('denies a remote profile before selection when egress is not authorized', () => {
    expect(() => selectEmbeddingProfile(policy({
      tierPreference: ['remote_quality'],
      allowedProviders: ['cloudflare-workers-ai'],
      remoteEgress: 'deny',
    }), 'text_dense')).toThrow(EmbeddingPolicyError);

    try {
      selectEmbeddingProfile(policy({
        tierPreference: ['remote_quality'],
        allowedProviders: ['cloudflare-workers-ai'],
        remoteEgress: 'deny',
      }), 'text_dense');
    } catch (error) {
      expect((error as EmbeddingPolicyError).code).toBe('NO_AUTHORIZED_PROFILE');
    }
  });

  test('fails closed for code until a code profile is registered and evaluated', () => {
    const codePolicy = policy({
      allowedRoles: ['code_dense'],
      tierPreference: ['local_fast', 'local_quality', 'remote_quality'],
      allowedProviders: ['local-transformers-js', 'cloudflare-workers-ai'],
      remoteEgress: 'allow',
      costCapUsdPerThousandQueries: 1,
    });

    expect(() => selectEmbeddingProfile(codePolicy, 'code_dense')).toThrow(
      /no code_dense embedding profile is authorized/,
    );
  });

  test('rejects a role the corpus policy did not authorize', () => {
    expect(() => selectEmbeddingProfile(policy(), 'rerank')).toThrow(
      /forbids role rerank/,
    );
  });

  test('secret corpora cannot opt into remote egress', () => {
    expect(() => policy({ classification: 'secret', remoteEgress: 'allow' })).toThrow(
      /secret corpora must deny remote egress/,
    );
  });

  test('content-addresses policy revisions and freezes selection inputs', () => {
    const first = localTextCorpusPolicy('pd.test.one');
    const same = localTextCorpusPolicy('pd.test.one');
    const other = localTextCorpusPolicy('pd.test.two');

    expect(first.policyDigest).toBe(same.policyDigest);
    expect(first.policyDigest).not.toBe(other.policyDigest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.allowedProviders)).toBe(true);
    expect(Object.isFrozen(first.latencyBudgetMs)).toBe(true);
  });
});
