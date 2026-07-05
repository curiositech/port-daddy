import { describe, expect, it } from 'vitest';
import { emitCloudTelemetry, extractWorkersAiUsage } from '../src/telemetry.js';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(response: Response | Error) {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { calls, fn };
}

describe('emitCloudTelemetry', () => {
  it('skips cleanly when no telemetry URL is configured', async () => {
    const stub = stubFetch(new Response('should not be called', { status: 500 }));
    const result = await emitCloudTelemetry({ event: 'pull_request', status: 'accepted' }, {}, stub.fn);
    expect(result).toEqual({ ok: true, skipped: true });
    expect(stub.calls).toHaveLength(0);
  });

  it('POSTs a normalized Port Daddy cloud telemetry event with bearer auth', async () => {
    const stub = stubFetch(new Response('ok', { status: 200 }));
    const result = await emitCloudTelemetry({
      deliveryId: 'delivery-1',
      event: 'pull_request',
      owner: 'curiositech',
      repo: 'port-daddy',
      ship: 'qa',
      status: 'clean',
    }, {
      PORT_DADDY_TELEMETRY_URL: 'https://daemon.example/telemetry/cloud-app',
      PORT_DADDY_TELEMETRY_TOKEN: 'tok',
    }, stub.fn);

    expect(result.ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe('https://daemon.example/telemetry/cloud-app');
    expect(stub.calls[0].init?.headers).toMatchObject({
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(stub.calls[0].init?.body))).toEqual(expect.objectContaining({
      source: 'github-app-receiver',
      provider: 'github',
      appSlug: 'port-daddy-fleet',
      deliveryId: 'delivery-1',
      ship: 'qa',
      status: 'clean',
    }));
  });

  it('reports non-2xx telemetry responses without throwing', async () => {
    const stub = stubFetch(new Response('nope', { status: 503 }));
    const result = await emitCloudTelemetry({ event: 'pull_request' }, {
      PORT_DADDY_TELEMETRY_URL: 'https://daemon.example/telemetry/cloud-app',
    }, stub.fn);
    expect(result).toEqual({ ok: false, status: 503, error: 'telemetry returned 503' });
  });
});

describe('extractWorkersAiUsage', () => {
  it('reads Cloudflare prompt/completion token usage when present', () => {
    expect(extractWorkersAiUsage({
      response: 'CLEAN',
      usage: { prompt_tokens: 123.4, completion_tokens: 56.1 },
    })).toEqual({ inputTokens: 123, outputTokens: 56 });
  });

  it('tolerates models that omit usage metadata', () => {
    expect(extractWorkersAiUsage({ response: 'CLEAN' })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
    });
  });
});
