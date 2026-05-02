/**
 * Unit tests for the judge's backend resolver. The resolver is what turns
 * the operator's existing fleet backend env (PD_FLEET_DEFAULT_BACKEND, etc.)
 * into a concrete JudgeTransport — so the judge doesn't have to bake in any
 * backend choices and the operator only configures one knob.
 *
 * Network is mocked via globalThis.fetch.
 */
import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import {
  resolveJudgeBackendName,
  defaultJudgeModelFor,
  resolveJudgeBackend,
} from '../../lib/coordination-judge-backends.js';
import {
  DEFAULT_OPERATOR_CLAUDE_MODEL,
  DEFAULT_OPERATOR_CODEX_MODEL,
  DEFAULT_OPERATOR_CLOUDFLARE_MODEL,
} from '../../lib/backend-telemetry-policy.js';

describe('resolveJudgeBackendName — env precedence', () => {
  test('explicit options.backend wins over everything', () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      PD_FLEET_DEFAULT_BACKEND: 'codex',
    };
    expect(resolveJudgeBackendName({ backend: 'ollama', env })).toBe('ollama');
  });

  test('PD_JUDGE_BACKEND wins over PD_FLEET_DEFAULT_BACKEND', () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      PD_FLEET_DEFAULT_BACKEND: 'claude',
    };
    expect(resolveJudgeBackendName({ env })).toBe('cloudflare');
  });

  test('falls through to PD_FLEET_DEFAULT_BACKEND when PD_JUDGE_BACKEND unset', () => {
    expect(resolveJudgeBackendName({ env: { PD_FLEET_DEFAULT_BACKEND: 'codex' } })).toBe('codex');
  });

  test('falls through to PORT_DADDY_FLEET_DEFAULT_BACKEND last', () => {
    expect(resolveJudgeBackendName({ env: { PORT_DADDY_FLEET_DEFAULT_BACKEND: 'claude' } })).toBe('claude');
  });

  test('returns null when nothing is configured', () => {
    expect(resolveJudgeBackendName({ env: {} })).toBeNull();
  });

  test('aliases: claude-cli → claude, cf → cloudflare, local → ollama', () => {
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'claude-cli' } })).toBe('claude');
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'cf' } })).toBe('cloudflare');
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'local' } })).toBe('ollama');
  });

  test('unknown values resolve to null (rather than throw)', () => {
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'gemini' } })).toBeNull();
  });

  test('whitespace-only env values are treated as unset', () => {
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: '   ', PD_FLEET_DEFAULT_BACKEND: 'cloudflare' } }))
      .toBe('cloudflare');
  });

  test('case-insensitive', () => {
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'Cloudflare' } })).toBe('cloudflare');
    expect(resolveJudgeBackendName({ env: { PD_JUDGE_BACKEND: 'CODEX' } })).toBe('codex');
  });
});

describe('defaultJudgeModelFor', () => {
  test('returns the operator-tier model from backend-telemetry-policy for each backend', () => {
    expect(defaultJudgeModelFor('claude')).toBe(DEFAULT_OPERATOR_CLAUDE_MODEL);
    expect(defaultJudgeModelFor('codex')).toBe(DEFAULT_OPERATOR_CODEX_MODEL);
    expect(defaultJudgeModelFor('cloudflare')).toBe(DEFAULT_OPERATOR_CLOUDFLARE_MODEL);
  });

  test('ollama default is a small local model', () => {
    expect(defaultJudgeModelFor('ollama')).toMatch(/.+/);
  });

  test('custom backend returns empty string (caller must provide a model)', () => {
    expect(defaultJudgeModelFor('custom')).toBe('');
  });
});

describe('resolveJudgeBackend — full transport resolution', () => {
  test('returns null when no backend is configured', () => {
    expect(resolveJudgeBackend({ env: {} })).toBeNull();
  });

  test('cloudflare: returns null when CLOUDFLARE creds are missing', () => {
    const env = { PD_JUDGE_BACKEND: 'cloudflare' };
    expect(resolveJudgeBackend({ env })).toBeNull();
  });

  test('cloudflare: builds a transport when creds present', () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acct-123',
      CLOUDFLARE_API_TOKEN: 'tok-abc',
    };
    const resolved = resolveJudgeBackend({ env });
    expect(resolved).not.toBeNull();
    expect(resolved.backend).toBe('cloudflare');
    expect(resolved.model).toBe(DEFAULT_OPERATOR_CLOUDFLARE_MODEL);
    expect(resolved.transport.label).toContain('cloudflare:');
  });

  test('cloudflare: model override threads through to transport label and call', async () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acct-123',
      CLOUDFLARE_API_TOKEN: 'tok-abc',
    };
    const resolved = resolveJudgeBackend({ env, model: '@cf/test/custom' });
    expect(resolved.model).toBe('@cf/test/custom');
    expect(resolved.transport.label).toBe('cloudflare:@cf/test/custom');
  });

  test('cloudflare transport: success path parses .result.response', async () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acct-123',
      CLOUDFLARE_API_TOKEN: 'tok-abc',
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: '{"intervene": true}' } }), { status: 200 })
    );
    try {
      const { transport } = resolveJudgeBackend({ env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r).toEqual({ ok: true, text: '{"intervene": true}' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      const { transport } = resolveJudgeBackend({ env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('429');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('cloudflare transport: empty response → ok:false', async () => {
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_API_TOKEN: 't',
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: '' } }), { status: 200 })
    );
    try {
      const { transport } = resolveJudgeBackend({ env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toBe('empty response');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('ollama: builds a transport without requiring credentials', () => {
    const env = { PD_JUDGE_BACKEND: 'ollama' };
    const resolved = resolveJudgeBackend({ env });
    expect(resolved).not.toBeNull();
    expect(resolved.backend).toBe('ollama');
    expect(resolved.transport.label).toContain('ollama:');
  });

  test('ollama transport: posts to OLLAMA_HOST/api/chat and parses message.content', async () => {
    const env = { PD_JUDGE_BACKEND: 'ollama', OLLAMA_HOST: 'http://localhost:11434' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '{"intervene": false}' } }), { status: 200 })
    );
    try {
      const { transport } = resolveJudgeBackend({ env });
      const ctrl = new AbortController();
      const r = await transport.complete({ prompt: 'p', model: 'qwen2.5-coder:1.5b', signal: ctrl.signal });
      expect(r).toEqual({ ok: true, text: '{"intervene": false}' });
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('claude/codex resolve to a "not supported" transport that returns ok:false with guidance', async () => {
    for (const backend of ['claude', 'codex']) {
      const env = { PD_JUDGE_BACKEND: backend };
      const resolved = resolveJudgeBackend({ env });
      expect(resolved).not.toBeNull();
      expect(resolved.backend).toBe(backend);
      const ctrl = new AbortController();
      const r = await resolved.transport.complete({ prompt: 'p', model: '', signal: ctrl.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not built into this binary/);
      expect(r.error).toMatch(/PD_JUDGE_BACKEND/);
    }
  });

  test('explicit transport injection bypasses the backend → transport mapping', () => {
    const fakeTransport = {
      label: 'fake',
      async complete() { return { ok: true, text: '{"intervene": false}' }; },
    };
    const env = {
      PD_JUDGE_BACKEND: 'cloudflare',
      // No CF creds — would normally fail. Injection should win.
    };
    const resolved = resolveJudgeBackend({ env, transport: fakeTransport });
    expect(resolved).not.toBeNull();
    expect(resolved.transport).toBe(fakeTransport);
    expect(resolved.backend).toBe('cloudflare');
  });
});
