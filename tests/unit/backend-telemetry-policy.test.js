import { assessBackendTelemetryPolicy } from '../../lib/backend-telemetry-policy.js';

describe('backend telemetry policy', () => {
  test('allows Claude only when the model has an exact rate entry', () => {
    expect(
      assessBackendTelemetryPolicy('claude', 'claude-haiku-4-5-20251001')
    ).toEqual(expect.objectContaining({
      backend: 'claude',
      launchAllowed: true,
    }));

    expect(
      assessBackendTelemetryPolicy('claude', 'claude-mystery-model')
    ).toEqual(expect.objectContaining({
      backend: 'claude',
      launchAllowed: false,
    }));
  });

  test('defaults Claude to the shared exact-rate operator model when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('claude');

    expect(policy).toEqual(expect.objectContaining({
      backend: 'claude',
      launchAllowed: true,
      effectiveModel: 'claude-haiku-4-5-20251001',
    }));
  });

  test('allows Codex when the model has an exact rate entry', () => {
    expect(
      assessBackendTelemetryPolicy('codex', 'gpt-5.4-mini')
    ).toEqual(expect.objectContaining({
      backend: 'codex',
      launchAllowed: true,
      effectiveModel: 'gpt-5.4-mini',
    }));

    expect(
      assessBackendTelemetryPolicy('codex', 'gpt-mystery-model')
    ).toEqual(expect.objectContaining({
      backend: 'codex',
      launchAllowed: false,
    }));
  });

  test('defaults Codex to the spend-aware exact-rate mini model when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('codex');

    expect(policy).toEqual(expect.objectContaining({
      backend: 'codex',
      launchAllowed: true,
      effectiveModel: 'gpt-5.4-mini',
    }));
  });

  test('allows Cloudflare Workers AI only when the model has an exact rate entry', () => {
    expect(
      assessBackendTelemetryPolicy('cloudflare', '@cf/moonshotai/kimi-k2.6')
    ).toEqual(expect.objectContaining({
      backend: 'cloudflare',
      launchAllowed: true,
      effectiveModel: '@cf/moonshotai/kimi-k2.6',
    }));

    expect(
      assessBackendTelemetryPolicy('cloudflare', '@cf/meta/unknown-model')
    ).toEqual(expect.objectContaining({
      backend: 'cloudflare',
      launchAllowed: false,
    }));
  });

  test('defaults Cloudflare to the current exact-rate low Workers AI model when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('cloudflare');

    expect(policy).toEqual(expect.objectContaining({
      backend: 'cloudflare',
      launchAllowed: true,
      effectiveModel: '@cf/zai-org/glm-4.7-flash',
    }));
  });

  test('blocks opaque backends until exact telemetry exists', () => {
    for (const backend of ['claude-cli', 'gemini', 'ollama', 'aider', 'custom']) {
      const policy = assessBackendTelemetryPolicy(backend);
      expect(policy.launchAllowed).toBe(false);
      expect(policy.summary).toContain('blocked');
    }
  });
});
