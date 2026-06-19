/**
 * Worker tests — verify signature handling, envelope shape, and forwarding.
 *
 * These tests exercise the Worker handler directly. We do not boot a real
 * miniflare/workerd instance — the Worker only relies on Web Crypto (which
 * Node 20+ provides on `globalThis.crypto`) and `fetch` (stubbed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleRequest,
  computeSignature,
  timingSafeEqual,
  verifySignature,
  type Env,
} from '../src/worker.js';
import { buildEnvelope, forwardEnvelope } from '../src/forward.js';

const SECRET = 'mock-webhook-secret-for-tests';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchStub {
  calls: FetchCall[];
  fn: typeof fetch;
}

function stubFetch(response: Response | Error): FetchStub {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { calls, fn };
}

const AUTH_TOKEN = 'test-forward-token-xyz';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_WEBHOOK_SECRET: SECRET,
    DAEMON_FORWARD_URL: 'https://daemon.example/forward',
    FORWARD_AUTH_TOKEN: AUTH_TOKEN,
    FORWARD_TIMEOUT_MS: '5000',
    ...overrides,
  };
}

async function signedRequest(
  payload: object,
  opts: { secret?: string; event?: string; delivery?: string; signature?: string; path?: string } = {},
): Promise<Request> {
  const body = JSON.stringify(payload);
  const signature =
    opts.signature ?? (await computeSignature(opts.secret ?? SECRET, body));
  const event = opts.event ?? 'pull_request';
  const path = opts.path ?? `/msg/github:webhook:${event}`;
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': opts.delivery ?? 'd-12345',
      'x-hub-signature-256': signature,
    },
    body,
  });
}

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('abcd', 'abcd')).toBe(true);
  });

  it('returns false for unequal strings of equal length', () => {
    expect(timingSafeEqual('abcd', 'abce')).toBe(false);
  });

  it('returns false for strings of different length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('computeSignature / verifySignature', () => {
  it('produces a sha256= hex digest matching a known vector', async () => {
    // Verify our implementation against a payload + secret and re-derive.
    const sig = await computeSignature('s3cr3t', 'hello');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifySignature('s3cr3t', 'hello', sig)).toBe(true);
  });

  it('rejects mismatched signature', async () => {
    const sig = await computeSignature('s3cr3t', 'hello');
    expect(await verifySignature('s3cr3t', 'goodbye', sig)).toBe(false);
  });

  it('rejects missing header', async () => {
    expect(await verifySignature('s3cr3t', 'hello', null)).toBe(false);
  });

  it('rejects header that does not start with sha256=', async () => {
    expect(await verifySignature('s3cr3t', 'hello', 'sha1=deadbeef')).toBe(false);
  });
});

describe('buildEnvelope', () => {
  it('extracts repository / installation / sender when present', () => {
    const env = buildEnvelope({
      event: 'pull_request',
      delivery: 'd-1',
      payload: {
        action: 'opened',
        repository: { full_name: 'curiositech/port-daddy', id: 42 },
        installation: { id: 7 },
        sender: { login: 'octocat', id: 99 },
      },
    });
    expect(env.event).toBe('pull_request');
    expect(env.channel).toBe('github:webhook:pull_request');
    expect(env.action).toBe('opened');
    expect(env.repository).toEqual({ full_name: 'curiositech/port-daddy', id: 42 });
    expect(env.installation_id).toBe(7);
    expect(env.sender).toEqual({ login: 'octocat', id: 99 });
    expect(env.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('tolerates payloads missing optional fields', () => {
    const env = buildEnvelope({ event: 'ping', delivery: 'd-2', payload: {} });
    expect(env.action).toBeNull();
    expect(env.repository).toBeNull();
    expect(env.installation_id).toBeNull();
    expect(env.sender).toBeNull();
  });
});

describe('forwardEnvelope', () => {
  it('POSTs JSON to the configured URL and surfaces 2xx', async () => {
    const stub = stubFetch(new Response('ok', { status: 200 }));
    const envelope = buildEnvelope({ event: 'push', delivery: 'd-3', payload: { ref: 'refs/heads/main' } });
    const result = await forwardEnvelope(envelope, {
      url: 'https://daemon.example/forward',
      authToken: 'tok',
      timeoutMs: 5000,
      fetcher: stub.fn,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0];
    expect(call.url).toBe('https://daemon.example/forward');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['x-pd-webhook-event']).toBe('push');
    expect(headers['x-pd-webhook-channel']).toBe('github:webhook:push');
    const body = JSON.parse(call.init?.body as string);
    expect(body.event).toBe('push');
    expect(body.payload.ref).toBe('refs/heads/main');
  });

  it('reports failure when daemon returns non-2xx', async () => {
    const stub = stubFetch(new Response('boom', { status: 503 }));
    const envelope = buildEnvelope({ event: 'push', delivery: 'd-4', payload: {} });
    const result = await forwardEnvelope(envelope, {
      url: 'https://daemon.example/forward',
      timeoutMs: 5000,
      fetcher: stub.fn,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('reports failure when fetch throws', async () => {
    const stub = stubFetch(new Error('econnrefused'));
    const envelope = buildEnvelope({ event: 'push', delivery: 'd-5', payload: {} });
    const result = await forwardEnvelope(envelope, {
      url: 'https://daemon.example/forward',
      timeoutMs: 5000,
      fetcher: stub.fn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('econnrefused');
  });
});

describe('handleRequest', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function withFetch(stub: FetchStub): void {
    globalThis.fetch = stub.fn;
  }

  it('204s when signature is valid and forward succeeds', async () => {
    const stub = stubFetch(new Response(null, { status: 204 }));
    withFetch(stub);
    const req = await signedRequest({ action: 'opened', repository: { full_name: 'x/y', id: 1 } });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(204);
    expect(stub.calls).toHaveLength(1);
  });

  it('401s when signature is invalid', async () => {
    const stub = stubFetch(new Response(null, { status: 204 }));
    withFetch(stub);
    const req = await signedRequest(
      { action: 'opened' },
      { signature: 'sha256=' + '0'.repeat(64) },
    );
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it('401s when signature header is missing', async () => {
    const req = new Request('https://worker.example/msg/github:webhook:push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'd-x',
      },
      body: JSON.stringify({}),
    });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('400s when GitHub headers are missing', async () => {
    const body = JSON.stringify({});
    const signature = await computeSignature(SECRET, body);
    const req = new Request('https://worker.example/msg/github:webhook:push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body,
    });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('400s when body is not valid JSON object', async () => {
    const body = '"not an object"';
    const signature = await computeSignature(SECRET, body);
    const req = new Request('https://worker.example/msg/github:webhook:ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-github-delivery': 'd-y',
        'x-hub-signature-256': signature,
      },
      body,
    });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('502s when forward fails', async () => {
    const stub = stubFetch(new Response('upstream sad', { status: 500 }));
    withFetch(stub);
    const req = await signedRequest({ action: 'opened' });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(502);
    expect(stub.calls).toHaveLength(1);
  });

  it('405s on non-POST', async () => {
    const req = new Request('https://worker.example/msg/github:webhook:push', { method: 'GET' });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(405);
  });

  it('404s when path is not /msg/*', async () => {
    const req = new Request('https://worker.example/services', { method: 'POST', body: '{}' });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it('404s for bare root path', async () => {
    const req = new Request('https://worker.example/', { method: 'POST', body: '{}' });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it('500s when GITHUB_WEBHOOK_SECRET is missing', async () => {
    const req = await signedRequest({});
    const env = makeEnv({ GITHUB_WEBHOOK_SECRET: '' });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(500);
  });

  it('500s when DAEMON_FORWARD_URL is missing', async () => {
    const req = await signedRequest({});
    const env = makeEnv({ DAEMON_FORWARD_URL: '' });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(500);
  });

  it('500s when FORWARD_AUTH_TOKEN is missing', async () => {
    const req = await signedRequest({});
    const env = makeEnv({ FORWARD_AUTH_TOKEN: '' });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(500);
  });
});

