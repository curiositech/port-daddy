/**
 * Real-runtime (bun:test) regression suite for the tube→spawner router's
 * delegation/loop-detection + multi-backend routing.
 *
 * RUNTIME: bun:test, on purpose. Per repo policy a bug fix must be reproduced
 * and confirmed-fixed under the runtime where it actually runs — the daemon and
 * the compiled `pd` binary are bun, and the runner (scripts/tube-spawn-router.ts)
 * is `#!/usr/bin/env bun`. node:crypto's `createHash` (used by the structural
 * task fingerprint) behaves identically under bun, and this suite pins that.
 *
 * These tests assert CONSEQUENCES (a spawn actually fired with the right spec, a
 * refusal was actually posted, two perturbed tasks actually collide to one
 * fingerprint) — never that an input equals itself. The router is exercised
 * end-to-end through `routeInboundTubeMessage` with a recording fake spawn/send,
 * which is the same seam the real runner injects the daemon `/spawn` call into.
 */
import { describe, expect, test } from 'bun:test';
import {
  routeInboundTubeMessage,
  assessDelegation,
  normalizeTaskShape,
  parseDelegationChain,
  inboundChainFromEnv,
  createRouterState,
  DELEGATION_CHAIN_ENV,
  type RouterPolicy,
  type RouterDeps,
  type DelegationHop,
} from '../../lib/tube-spawner-router.ts';
import type { SpawnSpec, SpawnResult } from '../../lib/spawner.ts';
import type { TubeMessage } from '../../lib/tube.ts';

const mkMsg = (over: Partial<TubeMessage> = {}): TubeMessage => ({
  id: 1,
  sender: 'codex',
  createdAt: 1000,
  body: '',
  envelope: true,
  raw: null,
  ...over,
});

/** A recording harness: captures every spawn spec and every posted reply. */
function harness(policyOver: Partial<RouterPolicy> = {}, spawnImpl?: (s: SpawnSpec) => Promise<SpawnResult>) {
  const sent: Array<{ channel: string; body: string }> = [];
  const spawned: SpawnSpec[] = [];
  const state = createRouterState();
  const policy: RouterPolicy = {
    enabled: true,
    allowedSenders: ['codex'],
    allowedBackends: ['ollama', 'gemini', 'claude-cli'],
    defaultBackend: 'ollama',
    ...policyOver,
  };
  const deps: RouterDeps = {
    channel: 'ctrl',
    policy,
    state,
    send: async (channel, body) => {
      sent.push({ channel, body });
      return { id: sent.length };
    },
    spawn:
      spawnImpl ??
      (async (spec) => {
        spawned.push(spec);
        return {
          agentId: `agent-${spawned.length}`,
          backend: spec.backend,
          model: 'test-model',
          status: 'completed',
          output: 'ok',
          error: null,
          telemetry: null,
          startedAt: 0,
          completedAt: 1,
        } satisfies SpawnResult;
      }),
  };
  // wrap default spawn to also record even when a custom impl is given
  if (spawnImpl) {
    const orig = deps.spawn;
    deps.spawn = async (spec) => {
      spawned.push(spec);
      return orig(spec);
    };
  }
  return { deps, sent, spawned, state, policy };
}

const lastReply = (sent: Array<{ body: string }>) => JSON.parse(sent[sent.length - 1].body);

// ───────────────────────── normalizeTaskShape ──────────────────────────────

describe('normalizeTaskShape — structural, not keyword', () => {
  test('trivial perturbations (case/whitespace/punctuation/word-order) collapse to ONE shape', () => {
    const a = normalizeTaskShape('Build the API, then test it!');
    const b = normalizeTaskShape('test it then build   the  api');
    const c = normalizeTaskShape('BUILD THE API THEN TEST IT');
    // Consequence under test: three differently-dressed versions of the same
    // task produce the SAME fingerprint (so a loop cannot hide behind wording).
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test('swapping embedded ids / PR numbers / uuids / shas does NOT change the shape', () => {
    const base = normalizeTaskShape('rebase PR 262 onto main and update branch');
    const swapped = normalizeTaskShape('rebase PR 999 onto main and update branch');
    const withSha = normalizeTaskShape('rebase PR c95b4a62 onto main and update branch');
    const withUuid = normalizeTaskShape(
      'rebase PR 06cb714e-1234-5678-9abc-def012345678 onto main and update branch',
    );
    expect(swapped).toBe(base);
    expect(withSha).toBe(base);
    expect(withUuid).toBe(base);
  });

  test('genuinely different tasks get different shapes (the guard is not "match everything")', () => {
    // Anti-tautology guard: prove the fingerprint DISCRIMINATES. If everything
    // hashed to one value, ping-pong detection would refuse all real work.
    const x = normalizeTaskShape('summarize the README');
    const y = normalizeTaskShape('deploy the production database');
    expect(x).not.toBe(y);
  });

  test('a single nonce word DOES change the shape (documents the known evasion window)', () => {
    // Honest negative control: appending a unique junk token defeats ping-pong
    // (different token set → different hash). This is WHY the depth + budget +
    // total caps exist as the absolute backstop. Encoded so the limitation is
    // tracked, not silently assumed away.
    const a = normalizeTaskShape('do the thing');
    const b = normalizeTaskShape('do the thing zzqnonce');
    expect(b).not.toBe(a);
  });
});

// ───────────────────────── assessDelegation (pure) ─────────────────────────

describe('assessDelegation — loop gates (pure, exhaustive)', () => {
  const mkChain = (shapes: string[]): DelegationHop[] =>
    shapes.map((s, i) => ({ agentId: `a${i}`, taskShape: s, depth: i }));

  test('DEPTH: refuses once the inbound chain reaches the depth cap', () => {
    const policy: RouterPolicy = { enabled: true, maxDelegationDepth: 2 };
    const okChain = mkChain([normalizeTaskShape('one')]); // depth 1 < 2 → allowed
    const ok = assessDelegation({ command: 'spawn', task: 'two', delegationChain: okChain }, 'codex', policy);
    expect('ok' in ok).toBe(true);

    const fullChain = mkChain([normalizeTaskShape('one'), normalizeTaskShape('two')]); // depth 2 == cap
    const refused = assessDelegation(
      { command: 'spawn', task: 'three', delegationChain: fullChain },
      'codex',
      policy,
    );
    expect('refusal' in refused).toBe(true);
    if ('refusal' in refused) expect(refused.refusal).toMatch(/depth .*cap/i);
  });

  test('PING-PONG: refuses a task whose SHAPE already appears in the chain, even reworded', () => {
    const policy: RouterPolicy = { enabled: true, maxDelegationDepth: 8 };
    // Chain contains the shape of "build the api then test it".
    const chain = mkChain([normalizeTaskShape('build the api then test it')]);
    // Inbound task is the SAME shape, reworded + reordered + repunctuated.
    const refused = assessDelegation(
      { command: 'spawn', task: 'TEST IT, then build the API!!!', delegationChain: chain },
      'codex',
      policy,
    );
    expect('refusal' in refused).toBe(true);
    if ('refusal' in refused) expect(refused.refusal).toMatch(/ping-pong/i);
  });

  test('UPWARD: refuses delegating back to an ancestor identity by default', () => {
    const policy: RouterPolicy = { enabled: true };
    const chain: DelegationHop[] = [{ agentId: 'codex', taskShape: normalizeTaskShape('root'), depth: 0 }];
    const refused = assessDelegation({ command: 'spawn', task: 'child', delegationChain: chain }, 'codex', policy);
    expect('refusal' in refused).toBe(true);
    if ('refusal' in refused) expect(refused.refusal).toMatch(/upward delegation blocked/i);
  });

  test('UPWARD: permitted only with the explicit override flag', () => {
    const policy: RouterPolicy = { enabled: true, allowUpwardDelegation: true };
    const chain: DelegationHop[] = [{ agentId: 'codex', taskShape: normalizeTaskShape('root'), depth: 0 }];
    const ok = assessDelegation({ command: 'spawn', task: 'child', delegationChain: chain }, 'codex', policy);
    expect('ok' in ok).toBe(true);
  });

  test('hard caps cannot be loosened past the absolute ceiling', () => {
    // A policy asking for depth 9999 is silently clamped to HARD_MAX (8): a chain
    // of length 8 is refused even though the policy "allowed" 9999.
    const policy: RouterPolicy = { enabled: true, maxDelegationDepth: 9999 };
    const deepChain = Array.from({ length: 8 }, (_, i) => ({
      agentId: `a${i}`,
      taskShape: normalizeTaskShape(`hop-${i}`),
      depth: i,
    }));
    const refused = assessDelegation(
      { command: 'spawn', task: 'one more', delegationChain: deepChain },
      'codex',
      policy,
    );
    expect('refusal' in refused).toBe(true);
  });
});

// ─────────────────── routeInboundTubeMessage (end-to-end) ──────────────────

describe('routeInboundTubeMessage — lineage propagation + multi-backend', () => {
  test('a root spawn fires and the child receives the EXTENDED chain in its env', async () => {
    const { deps, spawned, sent } = harness();
    const out = await routeInboundTubeMessage(
      mkMsg({ body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'summarize the README' }) }),
      deps,
    );
    expect(out.action).toBe('spawned');
    // Consequence: the spawned spec carries a serialized chain in env, with the
    // task's shape at depth 0 — so a grandchild spawn would be depth 1.
    const env = spawned[0].env ?? {};
    const chain = parseDelegationChain(JSON.parse(env[DELEGATION_CHAIN_ENV]!));
    expect(chain).toHaveLength(1);
    expect(chain[0].depth).toBe(0);
    expect(chain[0].taskShape).toBe(normalizeTaskShape('summarize the README'));
    // And the reply echoes the applied lineage with the REAL agent id.
    const reply = lastReply(sent);
    expect(reply.kind).toBe('router.spawned');
    expect(reply.delegationChain[0].agentId).toBe(out.action === 'spawned' ? out.agentId : '');
  });

  test('a child spawn extends an inbound chain to depth 1 (lineage grows, not resets)', async () => {
    const { deps, spawned } = harness();
    const inbound: DelegationHop[] = [{ agentId: 'a0', taskShape: normalizeTaskShape('first task'), depth: 0 }];
    await routeInboundTubeMessage(
      mkMsg({
        body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'a different task', delegationChain: inbound }),
      }),
      deps,
    );
    const chain = parseDelegationChain(JSON.parse(spawned[0].env![DELEGATION_CHAIN_ENV]!));
    expect(chain).toHaveLength(2);
    expect(chain[1].depth).toBe(1);
  });

  test('a recursive ping-pong is refused end-to-end and the refusal is POSTED back', async () => {
    const { deps, spawned, sent } = harness();
    const inbound: DelegationHop[] = [
      { agentId: 'a0', taskShape: normalizeTaskShape('build the api then test it'), depth: 0 },
    ];
    const out = await routeInboundTubeMessage(
      mkMsg({
        body: JSON.stringify({
          command: 'spawn',
          backend: 'ollama',
          task: 'test it, then BUILD the API', // same shape, reworded
          delegationChain: inbound,
        }),
      }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawned).toHaveLength(0); // nothing launched
    expect(lastReply(sent).kind).toBe('router.refused'); // loud
  });

  test('MULTI-BACKEND: routes to gemini when requested and allowed', async () => {
    const { deps, spawned } = harness({ allowedBackends: ['ollama', 'gemini'] });
    const result = await routeInboundTubeMessage(
      mkMsg({ body: JSON.stringify({ command: 'spawn', backend: 'gemini', task: 'translate the docs' }) }),
      deps,
    );
    expect(result.action).toBe('spawned');
    expect(spawned[0].backend).toBe('gemini'); // the requested backend reached the spawner
  });

  test('MULTI-BACKEND: a disallowed-but-known backend is refused (smuggle attempt)', async () => {
    const { deps, spawned } = harness({ allowedBackends: ['ollama'] });
    const out = await routeInboundTubeMessage(
      mkMsg({ body: JSON.stringify({ command: 'spawn', backend: 'openai', task: 'do x' }) }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawned).toHaveLength(0);
  });

  test('MULTI-BACKEND: an UNKNOWN backend is refused even if the policy allowlist is wide', async () => {
    // Defense-in-depth: a fabricated backend never reaches the spawner.
    const { deps, spawned } = harness({ allowedBackends: ['ollama', 'haxxor' as SpawnSpec['backend']] });
    const out = await routeInboundTubeMessage(
      mkMsg({ body: JSON.stringify({ command: 'spawn', backend: 'haxxor', task: 'do x' }) }),
      deps,
    );
    expect(out.action).toBe('refused');
    expect(spawned).toHaveLength(0);
  });

  test('FAN-OUT BACKSTOP: the process-global cap halts spawns after the budget is spent', async () => {
    const { deps, spawned, sent } = harness({ maxTotalSpawns: 3 });
    // Three distinct (depth-0, distinct-shape) root spawns all pass the per-branch
    // guards — but the 4th is refused by the global fan-out backstop.
    for (let i = 0; i < 3; i++) {
      const r = await routeInboundTubeMessage(
        mkMsg({ id: i + 1, body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: `task number ${i}` }) }),
        deps,
      );
      expect(r.action).toBe('spawned');
    }
    const fourth = await routeInboundTubeMessage(
      mkMsg({ id: 4, body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'one too many' }) }),
      deps,
    );
    expect(fourth.action).toBe('refused');
    expect(spawned).toHaveLength(3); // exactly the budget, no more
    expect(lastReply(sent).reason).toMatch(/budget exhausted/i);
  });

  test('FAN-OUT BACKSTOP: an attempted-but-failed launch still consumes budget', async () => {
    // Resource-protection semantics: a spawn that throws still counts (the
    // expensive launch was attempted). Proves the counter increments BEFORE the
    // spawn call, not only on success.
    let calls = 0;
    const { deps, sent } = harness({ maxTotalSpawns: 1 }, async () => {
      calls++;
      throw new Error('backend exploded');
    });
    const first = await routeInboundTubeMessage(
      mkMsg({ body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'will fail' }) }),
      deps,
    );
    expect(first.action).toBe('error');
    const second = await routeInboundTubeMessage(
      mkMsg({ id: 2, body: JSON.stringify({ command: 'spawn', backend: 'ollama', task: 'also wants to run' }) }),
      deps,
    );
    expect(second.action).toBe('refused'); // budget already spent by the failed attempt
    expect(calls).toBe(1); // the second never reached the backend
  });
});

// ───────────────── inboundChainFromEnv (CLI propagation seam) ──────────────

describe('inboundChainFromEnv — the recursive-router propagation seam', () => {
  test('reads a valid serialized chain a parent router injected', () => {
    const chain: DelegationHop[] = [{ agentId: 'a0', taskShape: 'abc123', depth: 0 }];
    const got = inboundChainFromEnv({ [DELEGATION_CHAIN_ENV]: JSON.stringify(chain) } as NodeJS.ProcessEnv);
    expect(got).toHaveLength(1);
    expect(got[0].agentId).toBe('a0');
  });

  test('returns [] for absent or garbage env (fail-closed, never throws)', () => {
    expect(inboundChainFromEnv({} as NodeJS.ProcessEnv)).toHaveLength(0);
    expect(inboundChainFromEnv({ [DELEGATION_CHAIN_ENV]: 'not json {{{' } as NodeJS.ProcessEnv)).toHaveLength(0);
    expect(inboundChainFromEnv({ [DELEGATION_CHAIN_ENV]: '"a string"' } as NodeJS.ProcessEnv)).toHaveLength(0);
  });
});
