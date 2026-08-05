import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeCheckRun } from '../src/github';

describe('completeCheckRun', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes a completed check with its receipt URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await completeCheckRun(
      'curiositech',
      'port-daddy',
      42,
      'neutral',
      'review complete',
      'installation-token',
      'https://relay.portdaddy.dev/fleet/runs/run-42',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/curiositech/port-daddy/check-runs/42');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      details_url: 'https://relay.portdaddy.dev/fleet/runs/run-42',
      output: { title: 'Port Daddy Fleet', summary: 'review complete' },
    });
  });

  it('throws when GitHub rejects completion so the queue delivery retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('installation token expired', { status: 401 })),
    );

    await expect(
      completeCheckRun(
        'curiositech',
        'port-daddy',
        73,
        'success',
        'all clear',
        'expired-token',
      ),
    ).rejects.toThrow('complete check run 73 failed 401: installation token expired');
  });

  it('retries a transient completion failure locally before succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporary outage', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeCheckRun('curiositech', 'port-daddy', 74, 'success', 'all clear', 'token'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after bounded transient retries are exhausted', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('still down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeCheckRun('curiositech', 'port-daddy', 75, 'failure', 'failed closed', 'token'),
    ).rejects.toThrow('complete check run 75 failed 503: still down');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
