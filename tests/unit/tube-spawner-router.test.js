/**
 * Tests for lib/tube-spawner-router.ts — the tube→spawner bridge.
 *
 * Locks the contract that lets Codex/ChatGPT drive the fleet over `pd tube`,
 * and — critically — that the bridge is FAIL-CLOSED: disabled by default,
 * sender-gated, backend-allow-listed, timeout-clamped, and loud on every
 * refusal (a refusal is always posted back, never silently dropped).
 */
import { describe, it, expect } from '@jest/globals';
import {
  parseTubeCommand,
  isSenderAllowed,
  buildSpawnSpec,
  routeInboundTubeMessage,
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
  const policy = { enabled: true, allowedBackends: ['ollama'], maxTimeoutMs: 60000 };
  it('refuses a backend outside the allowlist', () => {
    const r = buildSpawnSpec({ command: 'spawn', backend: 'custom', task: 't' }, policy);
    expect('refusal' in r).toBe(true);
  });
  it('clamps timeout to the policy ceiling', () => {
    const r = buildSpawnSpec({ command: 'spawn', backend: 'ollama', task: 't', timeout: 9e9 }, policy);
    expect(r.spec.timeout).toBe(60000);
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
});
