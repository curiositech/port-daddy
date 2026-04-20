import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const originalFetch = global.fetch;

const previewFixture = {
  requestedPath: 'routes/operator.ts',
  resolvedPath: '/Users/test/port-daddy/routes/operator.ts',
  displayPath: 'routes/operator.ts',
  source: 'working-tree' as const,
  additions: 2,
  deletions: 1,
  truncated: false,
  lines: [
    { kind: 'hunk' as const, text: '@@ -1,2 +1,3 @@' },
    { kind: 'remove' as const, text: '-old line' },
    { kind: 'add' as const, text: '+new line' },
  ],
};

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
  delete (global as { window?: unknown }).window;
});

describe('fleet-config-ui api', () => {
  test('sendAgentMessage treats wake conflicts as partial success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: false,
        delivered: true,
        woke: false,
        messageId: 42,
        error: 'No running fleet agent matches spark',
      }),
    })) as typeof fetch;

    const { sendAgentMessage } = await import('../../fleet-config-ui/src/api.ts');
    const result = await sendAgentMessage('spark', {
      content: 'What should I do next?',
      project: 'port-daddy',
      wake: true,
    });

    expect(result).toEqual(expect.objectContaining({
      delivered: true,
      woke: false,
      messageId: 42,
      error: 'No running fleet agent matches spark',
    }));
  });

  test('fetchFilePreview unwraps the daemon preview envelope', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: true,
        preview: previewFixture,
      }),
    })) as typeof fetch;

    const { fetchFilePreview } = await import('../../fleet-config-ui/src/api.ts');
    const preview = await fetchFilePreview('routes/operator.ts', '/Users/test/port-daddy', 24);

    expect(preview).toEqual(previewFixture);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/operator/file-preview',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  test('fetchFilePreview still accepts raw preview payloads for compatibility', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => previewFixture,
    })) as typeof fetch;

    const { fetchFilePreview } = await import('../../fleet-config-ui/src/api.ts');
    const preview = await fetchFilePreview('routes/operator.ts', '/Users/test/port-daddy', 24);

    expect(preview).toEqual(previewFixture);
  });
});
