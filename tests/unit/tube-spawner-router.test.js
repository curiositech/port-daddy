/**
 * Tests for lib/tube-spawner-router.ts — the tube→spawner bridge.
 *
 * Locks the contract that lets Codex/ChatGPT drive the fleet over `pd tube`,
 * and — critically — that the bridge is FAIL-CLOSED: disabled by default,
 * sender-gated, backend-allow-listed, deadline-clamped, and loud on every
 * refusal (a refusal is always posted back, never silently dropped).
 */
import { describe, it, expect } from '@jest/globals';
import {
  parseTubeCommand,
  isSenderAllowed,
  buildSpawnSpec,
  routeInboundTubeMessage,
  normalizeTaskShape,
  assessDelegation,
  parseDelegationChain,
  createRouterState,
  DELEGATION_CHAIN_ENV,
} from '../../lib/tube-spawner-router.js';

const msg = (over = {}) => ({
  id: 1,
  sender: 'codex',
  createdAt: 1000,
  body: '',
  envelope: true,
  raw: null,
  ...over,
});

describe('parseTubeCommand', () => {
  it('treats plain text as not-a-command', () => {
    expect(parseTubeCommand('hello fleet').kind).toBe('none');
  });
  it('treats JSON without `command` as not-a-command', () => {
    expect(parseTubeCommand('{"hi":1}').kind).toBe('none');
  });
  it('parses ping', () => {
    expect(parseTubeCommand('{"command":"ping"}').kind).toBe('ping');
  });
  it('parses a valid spawn', () => {
    const p = parseTubeCommand('{"command":"spawn","backend":"ollama","task":"do x"}');
    expect(p.kind).toBe('spawn');
    expect(p.raw.task).toBe('do x');
  });
  it('rejects spawn without task', () => {
    const p = parseTubeCommand('{"command":"spawn","backend":"ollama"}');
    expect(p.kind).toBe('invalid');
  });
  it('rejects unknown commands', () => {
    expect(parseTubeCommand('{"command":"rm-rf"}').kind).toBe('invalid');
  });
});

describe('isSenderAllowed', () => {
  it('allows anyone when no allowlist set', () => {
    expect(isSenderAllowed('whoever', { enabled: true })).toBe(true);
  });
  it('enforces the allowlist', () => {
    const policy = { enabled: true, allowedSenders: ['codex'] };
    expect(isSenderAllowed('codex', policy)).toBe(true);
    expect(isSenderAllowed('attacker', policy)).toBe(false);
    expect(isSenderAllowed(null, policy)).toBe(false);
  });
});

describe('buildSpawnSpec', () => {
  const policy = { enabled: true, allowedBackends: ['ollama'], maxDeadlineMs: 60000 };
  it('refuses a backend outside the allowlist', () => {
    const r = buildSpawnSpec({ command: 'spawn', backend: 'custom', task: 't' }, policy);
    expect('refusal' in r).toBe(true);
  });
  it('clamps deadlineMs to the policy ceiling', () => {
    const r = buildSpawnSpec({ command: 'spawn', backend: 'ollama', task: 't', deadlineMs: 9e9 }, policy);
    expect(r.spec.deadlineMs).toBe(60000);
  });
  it('omits deadlineMs when none is requested', () => {
    const r = buildSpawnSpec({ command: 'spawn', backend: 'ollama', task: 't' }, policy);
    expect(r.spec).not.toHaveProperty('deadlineMs');
  });
  it.each(['cli:gemini', 'cli:groq', 'cli:grok'])('accepts %s when the policy allows it', (backend) => {
    const p = { enabled: true, allowedBackends: [backend] };
    const r = buildSpawnSpec({ command: 'spawn', backend, task: 't' }, p);
    expect('refusal' in r).toBe(false);
    expect(r.spec.backend).toBe(backend);
  });
  it('still refuses a backend the spawner does not implement', () => {
    const p = { enabled: true, allowedBackends: ['cli:bogus'] };
    const r = buildSpawnSpec({ command: 'spawn', backend: 'cli:bogus', task: 't' }, p);
    expect('refusal' in r).toBe(true);
    expect(r.refusal).toMatch(/not a known spawner backend/);
  });
  it('applies defaultBackend + defaultIdentity', () => {
    const p = { enabled: true, allowedBackends: ['ollama'], defaultBackend: 'ollama', defaultIdentity: 'pd:fleet:tube' };
    const r = buildSpawnSpec({ command: 'spawn', task: 't' }, p);
    expect(r.spec.backend).toBe('ollama');
    expect(r.spec.identity).toBe('pd:fleet:tube');
    expect(r.spec.trigger).toBe('tube');
  });
});

describe('routeInboundTubeMessage (fail-closed orchestration)', () => {
  const mkDeps = (over = {}) => {
    const sent = [];
    const spawnCalls = [];
    return {
      sent,
      spawnCalls,
      deps: {
        channel: 'ctrl',
        state: createRouterState(),
        policy: { enabled: true, allowedBackends: ['ollama'], allowedSenders: ['codex'] },
        send: async (_c, body) => {
          sent.push(body);
          return { id: 99 };
        },
        spawn: async (spec) => {
          spawnCalls.push(spec);
          return {
            agentId: 'a1', backend: spec.backend, model: 'm', status: 'completed',
            output: 'done', error: null, telemetry: null, startedAt: 0, completedAt: 1,
          };
        },
        ...over,
      },
    };
  };

  it('ignores everything when disabled (no send, no spawn)', async () => {
    const { deps, sent, spawnCalls } = mkDeps({ policy: { enabled: false } });
    const out = await routeInboundTubeMessage(msg({ body: '{"command":"spawn","task":"x"}' }), deps);
    expect(out.action).toBe('ignored');
    expect(sent).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });

  it('ignores ordinary chat', async () => {
    const { deps, spawnCalls } = mkDeps();
    const out = await routeInboundTubeMessage(msg({ body: 'just chatting' }), deps);
    expect(out.action).toBe('ignored');
    expect(spawnCalls).toHaveLength(0);
  });

  it('refuses (loudly) an unauthorized sender', async () => {
    const { deps, sent, spawnCalls } = mkDeps();
    const out = await routeInboundTubeMessage(
      msg({ sender: 'attacker', body: '{"command":"spawn","backend":"ollama","task":"x"}' }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawnCalls).toHaveLength(0);
    expect(sent[0]).toMatch(/router.refused/);
  });

  it('refuses a backend outside the allowlist', async () => {
    const { deps, spawnCalls } = mkDeps();
    const out = await routeInboundTubeMessage(
      msg({ body: '{"command":"spawn","backend":"custom","task":"x"}' }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawnCalls).toHaveLength(0);
  });

  it('answers ping with pong', async () => {
    const { deps, sent } = mkDeps();
    const out = await routeInboundTubeMessage(msg({ body: '{"command":"ping"}' }), deps);
    expect(out.action).toBe('pong');
    expect(sent[0]).toMatch(/router.pong/);
  });

  it('spawns an authorized, allow-listed command and posts the result back', async () => {
    const { deps, sent, spawnCalls } = mkDeps();
    const out = await routeInboundTubeMessage(
      msg({ body: '{"command":"spawn","backend":"ollama","task":"summarize repo"}' }),
      deps,
    );
    expect(out.action).toBe('spawned');
    expect(out.agentId).toBe('a1');
    expect(spawnCalls[0].task).toBe('summarize repo');
    expect(sent[0]).toMatch(/router.spawned/);
  });

  it('reports spawn failure loudly', async () => {
    const { deps, sent } = mkDeps({
      spawn: async () => { throw new Error('backend down'); },
    });
    const out = await routeInboundTubeMessage(
      msg({ body: '{"command":"spawn","backend":"ollama","task":"x"}' }),
      deps,
    );
    expect(out.action).toBe('error');
    expect(out.error).toMatch(/backend down/);
    expect(sent[0]).toMatch(/router.error/);
  });

  it('injects the delegation chain into the spawned agent env', async () => {
    const { deps, spawnCalls } = mkDeps();
    await routeInboundTubeMessage(
      msg({ body: '{"command":"spawn","backend":"ollama","task":"do x"}' }),
      deps,
    );
    const chain = parseDelegationChain(JSON.parse(spawnCalls[0].env[DELEGATION_CHAIN_ENV]));
    expect(chain).toHaveLength(1);
    expect(chain[0].depth).toBe(0);
    expect(chain[0].taskShape).toBe(normalizeTaskShape('do x'));
  });

  it('refuses a recursive ping-pong (reworded) and never spawns', async () => {
    const { deps, spawnCalls } = mkDeps();
    const inbound = [{ agentId: 'a0', taskShape: normalizeTaskShape('build the api'), depth: 0 }];
    const out = await routeInboundTubeMessage(
      msg({ body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'API the BUILD!', delegationChain: inbound }) }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawnCalls).toHaveLength(0);
  });

  it('enforces the process-global fan-out backstop', async () => {
    const { deps, spawnCalls } = mkDeps({
      policy: { enabled: true, allowedBackends: ['ollama'], allowedSenders: ['codex'], maxTotalSpawns: 2 },
    });
    const body = (t) => JSON.stringify({ command: 'spawn', backend: 'ollama', task: t });
    expect((await routeInboundTubeMessage(msg({ id: 1, body: body('alpha') }), deps)).action).toBe('spawned');
    expect((await routeInboundTubeMessage(msg({ id: 2, body: body('beta') }), deps)).action).toBe('spawned');
    expect((await routeInboundTubeMessage(msg({ id: 3, body: body('gamma') }), deps)).action).toBe('refused');
    expect(spawnCalls).toHaveLength(2);
  });
});

describe('normalizeTaskShape (structural fingerprint)', () => {
  it('collapses case/order/punctuation/ids to one shape but discriminates real differences', () => {
    const a = normalizeTaskShape('Build the API, then test PR 262!');
    expect(normalizeTaskShape('test pr 999 then build the api')).toBe(a);
    expect(normalizeTaskShape('summarize the changelog')).not.toBe(a);
  });
});

describe('assessDelegation (loop gates)', () => {
  it('refuses depth, ping-pong, and upward; allows a clean child', () => {
    const policy = { enabled: true, maxDelegationDepth: 3 };
    const shapeA = normalizeTaskShape('first');
    // clean child (depth 1, new shape, new identity)
    const clean = assessDelegation(
      { command: 'spawn', task: 'second', delegationChain: [{ agentId: 'a0', taskShape: shapeA, depth: 0 }] },
      'codex', policy,
    );
    expect('ok' in clean).toBe(true);
    // ping-pong
    const pp = assessDelegation(
      { command: 'spawn', task: 'first', delegationChain: [{ agentId: 'a0', taskShape: shapeA, depth: 0 }] },
      'codex', policy,
    );
    expect('refusal' in pp).toBe(true);
    // upward (sender is an ancestor)
    const up = assessDelegation(
      { command: 'spawn', task: 'second', delegationChain: [{ agentId: 'codex', taskShape: shapeA, depth: 0 }] },
      'codex', policy,
    );
    expect('refusal' in up).toBe(true);
  });
});

describe('createRouterState', () => {
  it('starts a fresh fan-out counter at zero', () => {
    expect(createRouterState().totalSpawns).toBe(0);
  });
});
