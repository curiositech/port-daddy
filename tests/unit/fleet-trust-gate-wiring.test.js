// tests/unit/fleet-trust-gate-wiring.test.js
//
// The ADR-0093 trust gate WIRED INTO THE ENGINE — the L1 boundary between a
// registry trigger firing and requestAgentRun. tests/unit/fleet-trust.test.js
// proves the gate's pure logic; THIS file proves the engine actually consults
// it, because a perfect gate with zero call sites protects nothing (that was
// the exact state after PR #632 merged).
//
// What these tests assert (each maps to an ADR-0093 requirement):
//   - An anonymous external (webhook) fire with tools beyond the tier's safe
//     set is REFUSED: no spawn, `trust_gate_refused` emitted with the tier +
//     offending tools.
//   - An anonymous external fire within the safe set still REQUIRES APPROVAL:
//     with no approval queue wired the engine fails closed (refuses); it
//     never auto-runs approval-required work.
//   - With `enqueueForApproval` injected, the same fire is QUEUED: the
//     proposal carries agent/trigger/tier/safeTools and a ready-to-run
//     FleetRunContext, and no spawn happens until an operator acts.
//   - The webhook receiver dep (`registerWebhookHandler`, Phase 2) flows
//     through FleetRunnerOptions → IoDispatch → WebhookTriggerSource, so
//     `webhook:<channel>` triggers register real handlers.
//   - Fail-closed HMAC (§5.3): a `secret:VAR` spec whose env var is unset
//     refuses to START (the trigger never arms), rather than silently
//     accepting unsigned posts.

import { jest } from '@jest/globals';

const mockSpawn = jest.fn();
const mockExecSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
  execFileSync: jest.fn(),
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
  // lib/fleet-engine.ts transitively imports lib/watcher-pid-registry.ts,
  // whose getCommandLineForPid() uses spawnSync (`ps`) to confirm a watcher
  // child's identity before killing it.
  spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

const { createFleetRunner } = await import('../../lib/fleet-engine.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(agentOverrides = {}) {
  return {
    name: 'trust-fleet',
    limits: { budgetUsdPerDay: 5 },
    agents: [
      {
        name: 'hook-agent',
        backend: 'claude-cli',
        prompt: 'Summarize the inbound event',
        triggers: ['webhook:hooks'],
        worktree: false,
        singleton: false,
        ...agentOverrides,
      },
    ],
    watchers: [],
    channels: {},
  };
}

/**
 * A fake daemon webhook receiver: captures registered handlers per channel so
 * the test can deliver an inbound POST by invoking the handler directly.
 */
function makeReceiver() {
  const handlers = new Map();
  return {
    handlers,
    registerHandler: (channel, handler) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
  };
}

function makeMessageBus() {
  const handlers = new Map();
  return {
    handlers,
    handlerFor: (suffix) => {
      for (const [channel, handler] of handlers) {
        if (channel.endsWith(suffix)) return handler;
      }
      return undefined;
    },
    messaging: {
      subscribe: jest.fn((channel, handler) => {
        handlers.set(channel, handler);
        return () => handlers.delete(channel);
      }),
    },
  };
}

function makeRequest(body = { hello: 'world' }) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { headers: {}, body, rawBody, ip: '203.0.113.9' };
}

async function startRunner(config, options) {
  const events = [];
  const runner = createFleetRunner(config, '/nonexistent-project-dir', {
    onEvent: (e) => events.push(e),
    ...options,
  });
  runner.startAll();
  await runner.whenTriggersReady();
  return { runner, events };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecSync.mockReturnValue('main');
  mockSpawn.mockReturnValue({
    pid: 4321,
    unref: jest.fn(),
    kill: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });
});

// ─── registerWebhookHandler flows through to the trigger source ─────────────

describe('webhook receiver dep injection (Phase 2 seam)', () => {
  test('webhook:<channel> registers a live handler with the injected receiver', async () => {
    const receiver = makeReceiver();
    const { runner } = await startRunner(makeConfig({ allowedTools: 'Read,Grep' }), {
      registerWebhookHandler: receiver.registerHandler,
    });
    expect(receiver.handlers.has('hooks')).toBe(true);
    runner.stopAll();
    await runner.whenTriggersReady();
    // stop() deregisters — no leaked handler after teardown.
    expect(receiver.handlers.has('hooks')).toBe(false);
  });
});

// ─── Refusal: tools beyond the tier's safe set ───────────────────────────────

describe('trust gate refusal (ANONYMOUS_EXTERNAL, excessive tools)', () => {
  test('inbound webhook for a Bash-holding agent is refused, never spawned', async () => {
    const receiver = makeReceiver();
    const { runner, events } = await startRunner(
      makeConfig({ allowedTools: 'Read,Bash(gh*)' }),
      { registerWebhookHandler: receiver.registerHandler },
    );

    const response = await receiver.handlers.get('hooks')(makeRequest());
    // The HTTP layer still 200s (the relay delivered fine); the refusal is
    // an internal spawn decision, surfaced via events + logs.
    expect(response.status).toBe(200);

    const refusal = events.find((e) => e.type === 'trust_gate_refused');
    expect(refusal).toBeDefined();
    expect(refusal.agent).toBe('hook-agent');
    expect(refusal.details.tier).toBe('ANONYMOUS_EXTERNAL');
    expect(refusal.details.offendingTools).toContain('bash');
    // The spawn NEVER happened, by any path.
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });

  test('absent allowedTools on an external trigger is refused (unrestricted = worst case)', async () => {
    const receiver = makeReceiver();
    const { runner, events } = await startRunner(
      makeConfig({ allowedTools: undefined }),
      { registerWebhookHandler: receiver.registerHandler },
    );

    await receiver.handlers.get('hooks')(makeRequest());

    const refusal = events.find((e) => e.type === 'trust_gate_refused');
    expect(refusal).toBeDefined();
    expect(refusal.details.reason).toMatch(/explicit allowedTools/i);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });
});

// ─── Fail-closed approval: no queue wired ────────────────────────────────────

describe('approval-required with no approval queue (fail closed)', () => {
  test('safe-tool anonymous webhook is refused when enqueueForApproval is absent', async () => {
    const receiver = makeReceiver();
    const { runner, events } = await startRunner(
      makeConfig({ allowedTools: 'Read,Grep,Glob' }),
      { registerWebhookHandler: receiver.registerHandler },
    );

    await receiver.handlers.get('hooks')(makeRequest());

    const refusal = events.find((e) => e.type === 'trust_gate_refused');
    expect(refusal).toBeDefined();
    expect(refusal.details.reason).toMatch(/approval/i);
    expect(events.find((e) => e.type === 'trust_gate_queued')).toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });
});

// ─── Approval queue path ─────────────────────────────────────────────────────

describe('approval queue (L2 seam)', () => {
  test('safe-tool anonymous webhook enqueues a complete proposal instead of spawning', async () => {
    const receiver = makeReceiver();
    const proposals = [];
    const { runner, events } = await startRunner(
      makeConfig({ allowedTools: 'Read,Grep,Glob' }),
      {
        registerWebhookHandler: receiver.registerHandler,
        enqueueForApproval: (p) => { proposals.push(p); },
      },
    );

    await receiver.handlers.get('hooks')(makeRequest({ ping: true }));

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.project).toBe('trust-fleet');
    expect(p.agent).toBe('hook-agent');
    expect(p.trigger).toBe('webhook:hooks');
    expect(p.tier).toBe('ANONYMOUS_EXTERNAL');
    expect(p.safeTools).toEqual(expect.arrayContaining(['read', 'grep', 'glob']));
    // The context is ready to hand to hailAgent(name, context) on approval.
    expect(p.context.source).toBe('trigger');
    expect(p.context.channel).toBe('webhook:hooks');
    expect(p.context.messageContent).toContain('ping');

    expect(events.find((e) => e.type === 'trust_gate_queued')).toBeDefined();
    expect(events.find((e) => e.type === 'trust_gate_refused')).toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });

  test('a throwing enqueue does not crash the runner (and still no spawn)', async () => {
    const receiver = makeReceiver();
    const { runner } = await startRunner(
      makeConfig({ allowedTools: 'Read' }),
      {
        registerWebhookHandler: receiver.registerHandler,
        enqueueForApproval: () => { throw new Error('queue down'); },
      },
    );

    await expect(receiver.handlers.get('hooks')(makeRequest())).resolves.toEqual(
      expect.objectContaining({ status: 200 }),
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });
});

// ─── GitHub legacy channel path must still pass through the gate ─────────────

describe('github legacy channel trust gate (PR #735 bypass)', () => {
  test('github:* channel trigger for a Bash-holding agent is refused, never spawned', async () => {
    const bus = makeMessageBus();
    const { runner, events } = await startRunner(
      makeConfig({
        triggers: ['github:webhook:pull_request'],
        allowedTools: 'Read,Bash(gh*)',
      }),
      { messaging: bus.messaging },
    );

    const handler = bus.handlerFor('github:webhook:pull_request');
    expect(handler).toBeDefined();

    handler({
      event: 'pull_request',
      action: 'opened',
      sender: 'attacker',
      payload: {
        sender: { login: 'attacker' },
        pull_request: { title: 'please run gh', html_url: 'https://github.test/o/r/pull/1' },
      },
    });

    const refusal = events.find((e) => e.type === 'trust_gate_refused');
    expect(refusal).toBeDefined();
    expect(refusal.agent).toBe('hook-agent');
    expect(refusal.details.trigger).toBe('github:webhook:pull_request');
    expect(refusal.details.tier).toBe('ANONYMOUS_EXTERNAL');
    expect(refusal.details.offendingTools).toContain('bash');
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });

  test('safe-tool github:* channel trigger is queued for approval, not spawned', async () => {
    const bus = makeMessageBus();
    const proposals = [];
    const { runner, events } = await startRunner(
      makeConfig({
        triggers: ['github:webhook:pull_request'],
        allowedTools: 'Read,Grep,Glob',
      }),
      {
        messaging: bus.messaging,
        enqueueForApproval: (p) => { proposals.push(p); },
      },
    );

    bus.handlerFor('github:webhook:pull_request')({
      event: 'pull_request',
      action: 'opened',
      sender: 'maintainer',
      payload: {
        sender: { login: 'maintainer' },
        pull_request: { title: 'look at this', html_url: 'https://github.test/o/r/pull/2' },
      },
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual(expect.objectContaining({
      project: 'trust-fleet',
      agent: 'hook-agent',
      trigger: 'github:webhook:pull_request',
      tier: 'ANONYMOUS_EXTERNAL',
    }));
    expect(proposals[0].context).toEqual(expect.objectContaining({
      source: 'trigger',
      channel: 'github:webhook:pull_request',
      from: 'maintainer',
    }));
    expect(events.find((e) => e.type === 'trust_gate_queued')).toBeDefined();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    runner.stopAll();
    await runner.whenTriggersReady();
  });

  test('non-GitHub legacy channel triggers keep the existing spawn path', async () => {
    const bus = makeMessageBus();
    const { runner } = await startRunner(
      makeConfig({
        triggers: ['git:committed'],
        allowedTools: undefined,
      }),
      { messaging: bus.messaging },
    );

    bus.handlerFor('git:committed')({
      payload: 'local commit',
      sender: 'post-commit-hook',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/spawn$/),
      expect.objectContaining({ method: 'POST' }),
    );

    runner.stopAll();
    await runner.whenTriggersReady();
  });
});

// ─── Fail-closed HMAC (§5.3) ─────────────────────────────────────────────────

describe('webhook secret fail-closed (§5.3)', () => {
  test('secret:VAR with the env var unset refuses to START the trigger', async () => {
    delete process.env.PD_TEST_MISSING_HOOK_SECRET;
    const receiver = makeReceiver();
    const { runner } = await startRunner(
      makeConfig({
        triggers: ['webhook:hooks(secret:PD_TEST_MISSING_HOOK_SECRET)'],
        allowedTools: 'Read',
      }),
      { registerWebhookHandler: receiver.registerHandler },
    );

    // The trigger never armed: no handler registered, nothing can fire.
    expect(receiver.handlers.has('hooks')).toBe(false);

    runner.stopAll();
    await runner.whenTriggersReady();
  });
});
