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
    // rates for Workers AI models. Claude CLI still stays blocked because
    // subprocess launches do not yet prove exact token counts end-to-end.
    // Ollama is excluded here because it's no longer in the opaque-blocked
    // class — the policy now allows it when the model has a known rate
    // (see "allows Ollama when the model has an exact rate entry" below).
    for (const backend of ['claude-cli', 'gemini', 'aider', 'custom']) {
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
    expect(policy.summary).toContain('blocked until exact token counts');
    expect(policy.nextStep).toContain('subprocess telemetry is exact');
  });

  test('blocks Claude CLI when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-haiku-4-5-20251001');
    expect(policy.summary).toContain('exact nonzero cost');
  });

  test('blocks Claude CLI before model-rate checks can imply readiness', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli', 'claude-mystery-model');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-mystery-model');
    expect(policy.summary).toContain('blocked until exact token counts');
  });

  test('allows Ollama when the model has an exact rate entry', () => {
    const policy = assessBackendTelemetryPolicy('ollama', 'qwen2.5-coder:7b');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.backend).toBe('ollama');
    expect(policy.effectiveModel).toBe('qwen2.5-coder:7b');
    expect(policy.summary).toContain('Exact telemetry policy satisfied');
  });

  test('allows Ollama for each canonical local model family', () => {
    const families = [
      'qwen2.5-coder:14b',
      'llama3.1:8b',
      'dolphin-mistral:7b',
      'hermes4:14b',
      'dolphin-llama3:70b',
      'phi3:mini',
      'gemma2:9b',
      'codellama:13b',
      'nomic-embed-text:latest',
    ];
    for (const model of families) {
      const policy = assessBackendTelemetryPolicy('ollama', model);
      expect(policy.launchAllowed).toBe(true);
      expect(policy.effectiveModel).toBe(model);
    }
  });

  test('blocks Ollama when no model is supplied', () => {
    const policy = assessBackendTelemetryPolicy('ollama');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('ollama');
    expect(policy.summary).toContain('Ollama model is required');
  });

  test('blocks Ollama when the model has no rate entry', () => {
    const policy = assessBackendTelemetryPolicy('ollama', 'unobtanium-7b');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('ollama');
    expect(policy.effectiveModel).toBe('unobtanium-7b');
    expect(policy.summary).toContain('has no exact cost rate entry');
  });
});
