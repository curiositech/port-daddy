/**
 * Unit tests for the unified LLM backend resolver. This is the single
 * source of env-cascade truth for every Port Daddy actor — spawn-shape
 * (fleet engine) reads raw, request-shape (judge + future actors) reads
 * normalized + materializes a transport.
 *
 * Network is mocked via globalThis.fetch.
 */
import { describe, expect, test, jest } from '@jest/globals';
import {
  resolveRawBackendName,
  resolveBackendName,
  defaultModelFor,
  resolveLLMBackend,
  actorBackendEnvKey,
  normalizeBackend,
} from '../../lib/llm-backend-resolver.js';
import {
  DEFAULT_OPERATOR_CLAUDE_MODEL,
  DEFAULT_OPERATOR_CODEX_MODEL,
  DEFAULT_OPERATOR_CLOUDFLARE_MODEL,
} from '../../lib/backend-telemetry-policy.js';

describe('actorBackendEnvKey', () => {
  test('builds PD_<ACTOR>_BACKEND from kebab/snake names', () => {
    expect(actorBackendEnvKey('judge')).toBe('PD_JUDGE_BACKEND');
    expect(actorBackendEnvKey('cartographer-similarity')).toBe('PD_CARTOGRAPHER_SIMILARITY_BACKEND');
    expect(actorBackendEnvKey('foo.bar')).toBe('PD_FOO_BAR_BACKEND');
  });
});

describe('normalizeBackend', () => {
  test('collapses spawn-only variants into family', () => {
    expect(normalizeBackend('claude-cli')).toBe('claude');
    expect(normalizeBackend('codex-cli')).toBe('codex');
  });
  test('aliases cf and local', () => {
    expect(normalizeBackend('cf')).toBe('cloudflare');
    expect(normalizeBackend('local')).toBe('ollama');
  });
  test('case-insensitive', () => {
    expect(normalizeBackend('CLOUDFLARE')).toBe('cloudflare');
    expect(normalizeBackend('Codex')).toBe('codex');
  });
  test('returns null for unknown', () => {
    expect(normalizeBackend('gemini')).toBeNull();
  });
});

describe('resolveRawBackendName — env precedence', () => {
  test('options.backend wins', () => {
    const env = { PD_JUDGE_BACKEND: 'cloudflare', PD_FLEET_DEFAULT_BACKEND: 'codex' };
    expect(resolveRawBackendName({ backend: 'ollama', env })).toEqual({ raw: 'ollama', source: 'options' });
  });

  test('actor env override wins over fleet default', () => {
    const env = { PD_JUDGE_BACKEND: 'cloudflare', PD_FLEET_DEFAULT_BACKEND: 'claude' };
    expect(resolveRawBackendName({ actor: 'judge', env })).toEqual({ raw: 'cloudflare', source: 'actor-env' });
  });

  test('actor env not consulted when actor is undefined', () => {
    const env = { PD_JUDGE_BACKEND: 'cloudflare', PD_FLEET_DEFAULT_BACKEND: 'codex' };
    expect(resolveRawBackendName({ env })).toEqual({ raw: 'codex', source: 'fleet-default' });
  });

  test('falls through to PD_FLEET_DEFAULT_BACKEND', () => {
    expect(resolveRawBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'claude-cli' } }))
      .toEqual({ raw: 'claude-cli', source: 'fleet-default' });
  });

  test('falls through to PORT_DADDY_FLEET_DEFAULT_BACKEND last', () => {
    expect(resolveRawBackendName({ env: { PORT_DADDY_FLEET_DEFAULT_BACKEND: 'claude' } }))
      .toEqual({ raw: 'claude', source: 'fleet-default' });
  });

  test('preserves raw spelling — does NOT collapse claude-cli to claude', () => {
    // The fleet engine relies on this distinction to spawn the CLI vs the SDK.
    expect(resolveRawBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'claude-cli' } }).raw).toBe('claude-cli');
    expect(resolveRawBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'CLAUDE-CLI' } }).raw).toBe('CLAUDE-CLI');
  });

  test('returns null when nothing configured', () => {
    expect(resolveRawBackendName({ env: {} })).toEqual({ raw: null, source: 'unset' });
  });

  test('whitespace-only env values treated as unset', () => {
    const env = { PD_JUDGE_BACKEND: '   ', PD_FLEET_DEFAULT_BACKEND: 'cloudflare' };
    expect(resolveRawBackendName({ actor: 'judge', env })).toEqual({ raw: 'cloudflare', source: 'fleet-default' });
  });
});

describe('resolveBackendName — normalized', () => {
  test('collapses claude-cli to claude for request-shape', () => {
    expect(resolveBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'claude-cli' } }))
      .toEqual({ backend: 'claude', source: 'fleet-default' });
  });

  test('returns null for unknown backend (not just unset)', () => {
    expect(resolveBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'gemini' } }))
      .toEqual({ backend: null, source: 'unset' });
  });

  test('actor cascade still works through normalization', () => {
    const env = { PD_JUDGE_BACKEND: 'cf' };
    expect(resolveBackendName({ actor: 'judge', env }))
      .toEqual({ backend: 'cloudflare', source: 'actor-env' });
  });
});

describe('defaultModelFor', () => {
  test('returns operator-tier model from backend-telemetry-policy', () => {
    expect(defaultModelFor('claude')).toBe(DEFAULT_OPERATOR_CLAUDE_MODEL);
    expect(defaultModelFor('codex')).toBe(DEFAULT_OPERATOR_CODEX_MODEL);
    expect(defaultModelFor('cloudflare')).toBe(DEFAULT_OPERATOR_CLOUDFLARE_MODEL);
  });

  test('ollama default is overridable via PD_OLLAMA_DEFAULT_MODEL', () => {
    expect(defaultModelFor('ollama', { PD_OLLAMA_DEFAULT_MODEL: 'llama3:8b' })).toBe('llama3:8b');
    expect(defaultModelFor('ollama', {})).toMatch(/.+/);
  });

  test('custom backend returns empty string', () => {
    expect(defaultModelFor('custom')).toBe('');
  });
});

describe('resolveLLMBackend — full transport resolution', () => {
  test('returns null when nothing configured', () => {
    expect(resolveLLMBackend({ actor: 'judge', env: {} })).toBeNull();
  });

  test('cloudflare: returns null when creds missing', () => {
    expect(resolveLLMBackend({ actor: 'judge', env: { PD_JUDGE_BACKEND: 'cloudflare' } })).toBeNull();
  });

  test('cloudflare: builds transport with default model', () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acct-123',
      CLOUDFLARE_API_TOKEN: 'tok-abc',
    };
    const r = resolveLLMBackend({ actor: 'judge', env });
    expect(r).not.toBeNull();
    expect(r.backend).toBe('cloudflare');
    expect(r.model).toBe(DEFAULT_OPERATOR_CLOUDFLARE_MODEL);
    expect(r.source).toBe('actor-env');
    expect(r.transport.label).toContain('cloudflare:');
  });

  test('cloudflare transport: success path', async () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acct-123',
      CLOUDFLARE_API_TOKEN: 'tok-abc',
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: '{"intervene": true}' } }), { status: 200 })
    );
    try {
      const { transport } = resolveLLMBackend({ actor: 'judge', env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r).toEqual({ ok: true, text: '{"intervene": true}' });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('/accounts/acct-123/ai/run/');
      expect(opts.headers.Authorization).toBe('Bearer tok-abc');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('cloudflare transport: HTTP error → ok:false with status', async () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_API_TOKEN: 't',
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 })
    );
    try {
      const { transport } = resolveLLMBackend({ actor: 'judge', env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('429');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('ollama: builds transport without creds', () => {
    const r = resolveLLMBackend({ actor: 'judge', env: { PD_JUDGE_BACKEND: 'ollama' } });
    expect(r).not.toBeNull();
    expect(r.backend).toBe('ollama');
    expect(r.transport.label).toContain('ollama:');
  });

  test('ollama transport: posts to OLLAMA_HOST/api/chat', async () => {
    const env = { PD_JUDGE_BACKEND: 'ollama', OLLAMA_HOST: 'http://localhost:11434' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '{"intervene": false}' } }), { status: 200 })
    );
    try {
      const { transport } = resolveLLMBackend({ actor: 'judge', env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: 'qwen2.5-coder:1.5b', signal: ctrl.signal });
      expect(r).toEqual({ ok: true, text: '{"intervene": false}' });
      expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('claude/codex resolve to a notSupported transport with operator guidance', async () => {
    for (const backend of ['claude', 'codex']) {
      const r = resolveLLMBackend({ actor: 'judge', env: { PD_JUDGE_BACKEND: backend } });
      expect(r.backend).toBe(backend);
      const ctrl = new AbortController();
      const result = await r.transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not built/);
      expect(result.error).toMatch(/PD_<ACTOR>_BACKEND/);
    }
  });

  test('claude-cli at fleet level resolves to claude transport (request-shape collapses spawn variant)', () => {
    const env = { PD_FLEET_DEFAULT_BACKEND: 'claude-cli' };
    const r = resolveLLMBackend({ actor: 'judge', env });
    expect(r.backend).toBe('claude');
    expect(r.source).toBe('fleet-default');
  });

  test('explicit transport injection bypasses backend → transport mapping', () => {
    const fakeTransport = { label: 'fake', async complete() { return { ok: true, text: '{}' }; } };
    const env = { PD_JUDGE_BACKEND: 'cloudflare' }; // would fail without creds
    const r = resolveLLMBackend({ actor: 'judge', env, transport: fakeTransport });
    expect(r).not.toBeNull();
    expect(r.transport).toBe(fakeTransport);
    expect(r.backend).toBe('cloudflare');
  });

  test('different actors get isolated env scopes', () => {
    const env = {
      PD_JUDGE_BACKEND: 'ollama',
      PD_CARTOGRAPHER_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_API_TOKEN: 't',
    };
    const judge = resolveLLMBackend({ actor: 'judge', env });
    const cart = resolveLLMBackend({ actor: 'cartographer', env });
    expect(judge.backend).toBe('ollama');
    expect(cart.backend).toBe('cloudflare');
  });
});
