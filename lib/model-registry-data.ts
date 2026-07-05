/**
 * Model registry DATA — the single declarative dictionary mapping
 * (backend, capability) → concrete model ID (ADR-0057).
 *
 * This is the ONE place a concrete model ID legitimately lives. It is a TS module
 * (not a runtime-read JSON) so it resolves through the import graph identically
 * under bun, @swc/jest, tsc, and the dist build — no fragile cwd/path resolution.
 * `scripts/refresh-model-registry.ts` rewrites this file per version build.
 *
 * Every ID here is prefix-priced in lib/cost-tracker.ts so the fail-closed
 * telemetry policy admits it. Capabilities: cheap / balanced / high /
 * max-thinking / code. NEVER hardcode a model ID anywhere else — declare a
 * (backend, capability) and call resolveModel() (lib/model-registry.ts).
 */

export interface ModelRegistryData {
  generatedAt: string;
  generatedBy: string;
  source: string;
  tierAliases: Record<string, string>;
  backends: Record<string, Record<string, string>>;
}

export const MODEL_REGISTRY_DATA: ModelRegistryData = {
  generatedAt: '2026-06-15',
  generatedBy: 'manual seed — scripts/refresh-model-registry.ts rewrites this per build',
  source:
    "reconciled from lib/backend-telemetry-policy.ts DEFAULT_OPERATOR_* (the 'cheap' row) + lib/fleet-engine.ts FLEET_MODEL_TIERS (mid/high) at 2026-06-15; all IDs verified cost-priced",
  tierAliases: {
    low: 'cheap',
    mid: 'balanced',
    high: 'high',
  },
  backends: {
    anthropic: {
      cheap: 'claude-haiku-4-5-20251001',
      balanced: 'claude-sonnet-4-5-20250929',
      high: 'claude-opus-4-1-20250805',
      'max-thinking': 'claude-opus-4-8',
      code: 'claude-sonnet-4-5-20250929',
    },
    claude: {
      cheap: 'claude-haiku-4-5-20251001',
      balanced: 'claude-sonnet-4-5-20250929',
      high: 'claude-opus-4-1-20250805',
      'max-thinking': 'claude-opus-4-8',
      code: 'claude-sonnet-4-5-20250929',
    },
    'claude-cli': {
      cheap: 'claude-haiku-4-5-20251001',
      balanced: 'claude-sonnet-4-5-20250929',
      high: 'claude-opus-4-1-20250805',
      'max-thinking': 'claude-opus-4-8',
      code: 'claude-sonnet-4-5-20250929',
    },
    openai: {
      cheap: 'gpt-5-mini',
      balanced: 'gpt-5-mini',
      high: 'gpt-5',
      'max-thinking': 'gpt-5',
      code: 'gpt-5',
    },
    codex: {
      cheap: 'gpt-5.4-mini',
      balanced: 'gpt-5.3-codex',
      high: 'gpt-5.4',
      'max-thinking': 'gpt-5.4',
      code: 'gpt-5.3-codex',
    },
    cloudflare: {
      cheap: '@cf/zai-org/glm-4.7-flash',
      balanced: '@cf/openai/gpt-oss-120b',
      // kimi-k2-instruct is the REAL Workers AI slug. The previous
      // '@cf/moonshotai/kimi-k2.6' does not exist on Workers AI: ai.run() of an
      // unknown id HANGS (never errors), which is how the fleet PR reviewer
      // silently died on 2026-07-03 — every ship pinned to a phantom model.
      high: '@cf/moonshotai/kimi-k2-instruct',
      'max-thinking': '@cf/moonshotai/kimi-k2-instruct',
      code: '@cf/qwen/qwen3-30b-a3b-fp8',
    },
    aider: {
      cheap: 'gpt-4.1-mini',
      balanced: 'gpt-4.1',
      high: 'gpt-5',
      'max-thinking': 'gpt-5',
      code: 'gpt-4.1',
    },
    gemini: {
      cheap: 'gemini-2.5-flash',
      balanced: 'gemini-2.5-flash',
      high: 'gemini-2.5-pro',
      'max-thinking': 'gemini-2.5-pro',
      code: 'gemini-2.5-pro',
    },
    groq: {
      cheap: 'llama-3.3-70b-versatile',
      balanced: 'llama-3.3-70b-versatile',
      high: 'openai/gpt-oss-120b',
      'max-thinking': 'openai/gpt-oss-120b',
      code: 'llama-3.3-70b-versatile',
    },
    deepseek: {
      cheap: 'deepseek-chat',
      balanced: 'deepseek-chat',
      high: 'deepseek-reasoner',
      'max-thinking': 'deepseek-reasoner',
      code: 'deepseek-chat',
    },
    xai: {
      cheap: 'grok-code-fast-1',
      balanced: 'grok-2-latest',
      high: 'grok-2-latest',
      'max-thinking': 'grok-3',
      code: 'grok-code-fast-1',
    },
  },
};
