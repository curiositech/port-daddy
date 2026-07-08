import { describe, it, expect, vi } from 'vitest';
import {
  emitCloudTelemetry,
  extractWorkersAiUsage,
  type PortDaddyTelemetryEnv,
} from '../src/telemetry.js';

describe('extractWorkersAiUsage', () => {
  it('reads the standard prompt/completion token shape', () => {
    const usage = extractWorkersAiUsage({
      response: 'x',
      usage: { prompt_tokens: 1200, completion_tokens: 340 },
    });
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 340, cachedInputTokens: undefined });
  });

  it('reads the Responses-API input/output token shape', () => {
    const usage = extractWorkersAiUsage({
      output: [],
      usage: { input_tokens: 90, output_tokens: 12 },
    });
    expect(usage.inputTokens).toBe(90);
    expect(usage.outputTokens).toBe(12);
  });

  it('reads cached-input tokens from a flat field and from prompt_tokens_details', () => {
    const flat = extractWorkersAiUsage({ usage: { prompt_tokens: 100, cached_tokens: 40 } });
    expect(flat.cachedInputTokens).toBe(40);

    const nested = extractWorkersAiUsage({
      usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 55 } },
    });
    expect(nested.cachedInputTokens).toBe(55);
  });

  it('rounds fractional counts and drops negatives / non-numbers', () => {
    const usage = extractWorkersAiUsage({
      usage: { prompt_tokens: 12.6, completion_tokens: -3, cached_tokens: 'nope' },
    });
    expect(usage.inputTokens).toBe(13);
    expect(usage.outputTokens).toBeUndefined();
    expect(usage.cachedInputTokens).toBeUndefined();
  });

  it('returns all-undefined for a result with no usage envelope', () => {
    expect(extractWorkersAiUsage({ response: 'hi' })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
    });
    expect(extractWorkersAiUsage(null)).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
    });
  });
});

describe('emitCloudTelemetry', () => {
  it('is a clean no-op when the URL is unconfigured (never posts)', async () => {
    const fetcher = vi.fn();
    const result = await emitCloudTelemetry({ event: 'ship-run' }, {}, fetcher as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, skipped: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('POSTs the enriched payload with source/provider/appSlug and no auth header when tokenless', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    const env: PortDaddyTelemetryEnv = { PORT_DADDY_TELEMETRY_URL: 'https://sink.example/telemetry/cloud-app' };
    const result = await emitCloudTelemetry(
      { event: 'ship-run', ship: 'code-reviewer', inputTokens: 100, outputTokens: 10 },
      env,
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sink.example/telemetry/cloud-app');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      source: 'fleet-executor',
      provider: 'github',
      appSlug: 'port-daddy-fleet',
      event: 'ship-run',
      ship: 'code-reviewer',
      inputTokens: 100,
      outputTokens: 10,
    });
  });

  it('adds a Bearer auth header when a token is configured', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    await emitCloudTelemetry(
      { event: 'ship-run' },
      { PORT_DADDY_TELEMETRY_URL: 'https://sink.example/x', PORT_DADDY_TELEMETRY_TOKEN: 's3cret' },
      fetcher as unknown as typeof fetch,
    );
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer s3cret');
  });

  it('returns { ok: false } with the status on a non-2xx response (never throws)', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 500 }));
    const result = await emitCloudTelemetry(
      { event: 'ship-run' },
      { PORT_DADDY_TELEMETRY_URL: 'https://sink.example/x' },
      fetcher as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('swallows a transport throw and reports { ok: false } with the error message', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const result = await emitCloudTelemetry(
      { event: 'ship-run' },
      { PORT_DADDY_TELEMETRY_URL: 'https://sink.example/x' },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'connection refused' });
  });
});
