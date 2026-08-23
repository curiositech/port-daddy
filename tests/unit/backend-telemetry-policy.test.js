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
      effectiveModel: 'claude-haiku-4-5',
    }));
  });

  test.each(['cli:agy', 'cli:gemini', 'cli:groq', 'cli:grok'])('%s is flat-rate subscription — launch allowed without per-token telemetry', (backend) => {
    const policy = assessBackendTelemetryPolicy(backend);
    expect(policy).toEqual(expect.objectContaining({
      backend,
      launchAllowed: true,
      effectiveModel: backend === 'cli:agy' ? null : backend.slice('cli:'.length),
    }));
    expect(policy.summary).toContain('flat-rate');
  });

  test('cli:agy preserves an explicit operator model string without inventing a default', () => {
    expect(assessBackendTelemetryPolicy('cli:agy').effectiveModel).toBeNull();
    expect(assessBackendTelemetryPolicy('cli:agy', 'real-agy-model').effectiveModel).toBe('real-agy-model');
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
    // rates for Workers AI models. Gemini moved off this list too: its REST
    // adapter extracts exact usage (promptTokenCount + candidatesTokenCount +
    // thoughtsTokenCount) and the 2.5 family has known rates, so it is allowed
    // when the model has a rate (see the gemini tests below). Ollama and
    // claude-cli are excluded for the same reason. `aider` and `custom` remain
    // opaque: no per-token telemetry pipeline.
    for (const backend of ['aider', 'custom']) {
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

  test('allows Gemini with the default (gemini-3.7-flash) when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('gemini');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.backend).toBe('gemini');
    expect(policy.effectiveModel).toBe('gemini-3.7-flash');
  });

  test('blocks Gemini for a model with no known rate', () => {
    const policy = assessBackendTelemetryPolicy('gemini', 'gemini-9-imaginary');
    expect(policy.launchAllowed).toBe(false);
  });

  test('allows Groq with the default (llama-3.3-70b-versatile) when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('groq');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.backend).toBe('groq');
    expect(policy.effectiveModel).toBe('llama-3.3-70b-versatile');
  });

  test('allows Groq for the gpt-oss family', () => {
    const policy = assessBackendTelemetryPolicy('groq', 'openai/gpt-oss-120b');
    expect(policy.launchAllowed).toBe(true);
  });

  test('blocks Groq for a model with no known rate', () => {
    const policy = assessBackendTelemetryPolicy('groq', 'mystery-model-9000');
    expect(policy.launchAllowed).toBe(false);
  });

  // Claude CLI is no longer hard-blocked: runClaudeCli captures the CLI's own
  // usage (exact) with a labelled estimate fallback. The launch is allowed when
  // the model has a cost rate, and blocked only when it can't be priced.
  test('allows Claude CLI when the model has a cost rate entry', () => {
    // An EXPLICIT model is echoed back verbatim — including a dated snapshot id.
    // The registry's canonical form is now undated, but a caller pinning a dated
    // id must still pass through and still price (substring match).
    const policy = assessBackendTelemetryPolicy('claude-cli', 'claude-haiku-4-5-20251001');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-haiku-4-5-20251001');
  });

  test('allows Claude CLI with the default operator model when none is supplied', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli');
    expect(policy.launchAllowed).toBe(true);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-haiku-4-5');
  });

  test('still blocks Claude CLI for a model with no known cost rate', () => {
    const policy = assessBackendTelemetryPolicy('claude-cli', 'claude-mystery-model');
    expect(policy.launchAllowed).toBe(false);
    expect(policy.backend).toBe('claude-cli');
    expect(policy.effectiveModel).toBe('claude-mystery-model');
    expect(policy.summary).toMatch(/no cost rate/i);
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

  test('does NOT let Ollama family keys false-match non-ollama backends', () => {
    // Substrings like "llama" / "qwen" / "mistral" must NEVER allow a paid
    // remote backend to bypass the telemetry gate just because a future
    // model name contains those tokens.
    for (const evilModel of [
      'claude-llama-experimental',
      'claude-3-7-qwen-tune',
      'gemini-mistral-7b-distill',
    ]) {
      const policy = assessBackendTelemetryPolicy('claude', evilModel);
      expect(policy.launchAllowed).toBe(false);
      // Claude case message: "no exact cost rate entry"
      expect(policy.summary).toContain('no exact cost rate entry');
    }
  });
});
