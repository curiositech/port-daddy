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

  test('blocks opaque backends until exact telemetry exists', () => {
    // Cloudflare is no longer opaque — `lib/cost-tracker.ts` ships exact
    // rates for Workers AI models. The remaining backends below still have
    // no exact telemetry contract and stay blocked.
    for (const backend of ['claude-cli', 'gemini', 'ollama', 'aider', 'custom']) {
      const policy = assessBackendTelemetryPolicy(backend);
      expect(policy.launchAllowed).toBe(false);
      expect(policy.summary).toContain('blocked');
    }
  });

  test('allows Cloudflare when the model has an exact rate entry', () => {
    const policy = assessBackendTelemetryPolicy('cloudflare');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.effectiveModel).toBe('@cf/zai-org/glm-4.7-flash');
  });

  test('blocks Claude CLI even when the model has an exact rate entry', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli', 'claude-haiku-4-5-20251001');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-haiku-4-5-20251001');
    expect(policy.summary).toMatch(/blocked until exact token counts/);
    expect(policy.nextStep).toMatch(/subprocess telemetry is exact/);
  });

  test('blocks Claude CLI when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-haiku-4-5-20251001');
    expect(policy.summary).toMatch(/blocked until exact token counts/);
  });

  test('blocks Claude CLI when the model has no exact rate entry', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli', 'claude-mystery-model');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-mystery-model');
    expect(policy.summary).toMatch(/blocked until exact token counts/);
  });
});
