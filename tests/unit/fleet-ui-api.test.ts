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

  test('sendAgentMessage sends typed JSON inbox payloads with wake summary', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: true,
        delivered: true,
        woke: true,
        messageId: 77,
      }),
    })) as typeof fetch;

    const { sendAgentMessage } = await import('../../fleet-config-ui/src/api.ts');
    const result = await sendAgentMessage('qa', {
      content: { type: 'visual-task', title: 'Button is clipped' },
      contentType: 'json',
      type: 'visual-task',
      messageContent: '[visual-task:fix] Button is clipped',
      wake: true,
    });

    expect(result.messageId).toBe(77);
    // No `from` in the body (#8877 / ADR-0122): the UI holds an anonymous
    // minted soul with no bound alias, so it has no display name it is
    // entitled to claim and the daemon derives attribution from the
    // credential instead. The old `from: 'fleet-ui-visual'` was a
    // self-asserted string on an instruction plane.
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/agents/qa/inbox',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: { type: 'visual-task', title: 'Button is clipped' },
          project: undefined,
          type: 'visual-task',
          contentType: 'json',
          messageContent: '[visual-task:fix] Button is clipped',
          wake: true,
        }),
      }),
    );
  });

  test('a mutating call presents the UI actor credential; a read does not', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit | undefined });
      if (String(url).endsWith('/actors/register')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true, actorId: 'UI-ACTOR', credential: 'UI-ACTOR.secret' }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, delivered: true, woke: false, messageId: 5, messages: [] }),
      };
    }) as unknown as typeof fetch;

    const api = await import('../../fleet-config-ui/src/api.ts');

    await api.sendAgentMessage('qa', { content: 'hello', wake: false });
    const send = calls.find((c) => c.url.endsWith('/agents/qa/inbox'));
    expect(send).toBeDefined();
    expect((send!.init!.headers as Record<string, string>)['x-actor-credential']).toBe('UI-ACTOR.secret');

    calls.length = 0;
    await api.fetchAgentInbox('qa');
    const read = calls.find((c) => c.url.includes('/agents/qa/inbox'));
    expect(read).toBeDefined();
    // Reads mint nothing: a dashboard render must not flood the newcomer pool.
    expect(calls.some((c) => c.url.endsWith('/actors/register'))).toBe(false);
    expect((read!.init?.headers as Record<string, string> | undefined)?.['x-actor-credential']).toBeUndefined();
  });

  test('proposeDispatchGoal posts a review dispatch goal', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        ok: true,
        dispatch: {
          id: 'dispatch-1',
          slug: 'visual-button-clipped',
          goal: 'Visual task from FleetBar',
          state: 'proposed',
        },
      }),
    })) as typeof fetch;

    const { proposeDispatchGoal } = await import('../../fleet-config-ui/src/api.ts');
    const dispatch = await proposeDispatchGoal({
      goal: 'Visual task from FleetBar',
      requestedBy: 'fleet-ui-visual',
      targetActorId: 'qa',
    });

    expect(dispatch.id).toBe('dispatch-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          goal: 'Visual task from FleetBar',
          requestedBy: 'fleet-ui-visual',
          mergePolicy: 'review',
          targetActorId: 'qa',
        }),
      }),
    );
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

  test('fetchRoadmapProgress resolves the selected project root', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        generatedAt: 1,
        sources: {
          roadmapPath: '/repo/docs/ROADMAP.md',
          ideasTrovePath: '/repo/docs/recovery/IDEAS-TROVE.md',
          dogfoodFeedbackPath: '/repo/docs/recovery/DOGFOOD-FEEDBACK.md',
          currentWorkPath: '/repo/docs/recovery/CURRENT-WORK.md',
          cartographerStatusPath: '/repo/.cartographer/status.md',
        },
        freshness: { latestUpdateMs: 1, hoursSinceLastUpdate: 0.2 },
        nextCuts: [{ slug: 'cartographer-roadmap-progress-screen', summary: 'Surface roadmap state.' }],
        ideasNow: [],
        dogfoodFeedback: [],
        currentWorkExcerpt: null,
        cartographerStatusExcerpt: null,
        warnings: [],
      }),
    })) as typeof fetch;

    const { fetchRoadmapProgress } = await import('../../fleet-config-ui/src/api.ts');
    const progress = await fetchRoadmapProgress('/Users/test/port-daddy');

    expect(progress.nextCuts[0]?.slug).toBe('cartographer-roadmap-progress-screen');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/cartographer/roadmap-progress?root=%2FUsers%2Ftest%2Fport-daddy',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('fetchResourceOverview passes project and cap context', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: true,
        generatedAt: 123,
        buckets: [],
        history: [],
        policy: {
          mode: 'observe',
          userCap: 2,
          suggestedConcurrentSpawns: 4,
          safeToAskForMore: true,
          escalation: {
            recommended: true,
            title: 'This computer looks comfortable enough to ask for more.',
            body: 'Measured headroom supports asking first.',
            suggestedCap: 4,
          },
        },
      }),
    })) as typeof fetch;

    const { fetchResourceOverview } = await import('../../fleet-config-ui/src/api.ts');
    const overview = await fetchResourceOverview({
      projectDir: '/Users/test/port-daddy',
      maxConcurrentSpawns: 2,
    });

    expect(overview.policy.suggestedConcurrentSpawns).toBe(4);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/resources/overview?projectDir=%2FUsers%2Ftest%2Fport-daddy&maxConcurrentSpawns=2',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('runSetupAction forwards the server-issued setup token for mutating actions', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: true,
        action: 'fleetbar',
        command: 'pd',
        args: ['setup', '--no-daemon'],
        cwd: '/Users/test/port-daddy',
        exitCode: 0,
        timedOut: false,
        stdout: 'ok',
        stderr: '',
      }),
    })) as typeof fetch;

    const { runSetupAction } = await import('../../fleet-config-ui/src/api.ts');
    await runSetupAction({
      action: 'fleetbar',
      confirmed: true,
      projectDir: '/Users/test/port-daddy',
      setupToken: 'setup-token-123',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/setup/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'fleetbar',
          confirmed: true,
          projectDir: '/Users/test/port-daddy',
          setupToken: 'setup-token-123',
        }),
      }),
    );
  });

  test('setFleetConfigRuntime posts the ready-runtime bulk update', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        success: true,
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        modelTier: null,
        updatedAgents: ['qa', 'spider'],
        skippedAgents: [],
      }),
    })) as typeof fetch;

    const { setFleetConfigRuntime } = await import('../../fleet-config-ui/src/api.ts');
    const result = await setFleetConfigRuntime('/Users/test/port-daddy', {
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      clearFallbacks: true,
    });

    expect(result.updatedAgents).toEqual(['qa', 'spider']);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/fleet/config/%2FUsers%2Ftest%2Fport-daddy/runtime',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          backend: 'cloudflare',
          model: '@cf/qwen/qwen3-30b-a3b-fp8',
          clearFallbacks: true,
        }),
      }),
    );
  });
});
