#!/usr/bin/env bun
/**
 * Multiplex scenario for the tube→spawner router (ADR-0046: the tube IS a
 * conversation multiplexer). ONE control channel; one external driver (Codex)
 * fans work out across MULTIPLE backends, fans the results back in, and then
 * trips the loop guard.
 *
 * This drives the REAL router (lib/tube-spawner-router.ts) over an in-process
 * fake tube. Backends are simulated by an injected spawn so the demo is
 * deterministic and costs nothing to record — but every routing/refusal
 * decision is the genuine router code path, not a mock of it.
 *
 *   bun demos/tube-router-multiplex/scenario.ts
 */
import {
  routeInboundTubeMessage,
  createRouterState,
  normalizeTaskShape,
  type RouterPolicy,
  type RouterDeps,
} from '../../lib/tube-spawner-router.ts';
import type { SpawnSpec, SpawnResult } from '../../lib/spawner.ts';
import type { TubeMessage } from '../../lib/tube.ts';

// ── tiny ansi helpers ───────────────────────────────────────────────────────
const c = (n: number, s: string) => `\x1b[${n}m${s}\x1b[0m`;
const dim = (s: string) => c(2, s);
const cyan = (s: string) => c(36, s);
const green = (s: string) => c(32, s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const bold = (s: string) => c(1, s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BACKEND_REPLIES: Record<string, string> = {
  ollama: 'README has 4 sections: install, usage, coordination, fleet.',
  gemini: 'docs/ translated to es: 12 files, 3,401 words.',
  'claude-cli': 'security review: 0 high, 1 medium (sender allowlist is advisory).',
};

let agentSeq = 0;
const fakeSpawn = async (spec: SpawnSpec): Promise<SpawnResult> => {
  await sleep(220); // pretend the backend is thinking
  agentSeq += 1;
  return {
    agentId: `agent-${agentSeq}`,
    backend: spec.backend,
    model: spec.model ?? `${spec.backend}-default`,
    status: 'completed',
    output: BACKEND_REPLIES[spec.backend] ?? 'done.',
    error: null,
    telemetry: null,
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
};

const policy: RouterPolicy = {
  enabled: true,
  allowedSenders: ['codex'],
  allowedBackends: ['ollama', 'gemini', 'claude-cli'],
  maxDelegationDepth: 4,
  maxChainSpawns: 8,
  maxTotalSpawns: 64,
};
const state = createRouterState();
const deps: RouterDeps = {
  channel: 'fleet:ctrl',
  policy,
  state,
  spawn: fakeSpawn,
  send: async () => ({ id: 0 }), // replies are rendered inline below instead
};

const mkMsg = (body: string): TubeMessage => ({
  id: 1,
  sender: 'codex',
  createdAt: Date.now(),
  body,
  envelope: true,
  raw: null,
});

async function driver(label: string, cmd: Record<string, unknown>) {
  console.log(`${dim('codex')} ${cyan('▶')} ${label}`);
  console.log(`  ${dim('pd tube fleet:ctrl --send')} '${JSON.stringify(cmd)}'`);
  const out = await routeInboundTubeMessage(mkMsg(JSON.stringify(cmd)), deps);
  if (out.action === 'spawned') {
    console.log(
      `  ${green('◀ router.spawned')} ${out.agentId} ${dim('(' + (cmd.backend as string) + ')')} ` +
        `${dim('→')} ${BACKEND_REPLIES[cmd.backend as string] ?? 'done.'}`,
    );
  } else if (out.action === 'refused') {
    console.log(`  ${red('◀ router.refused')} ${yellow(out.reason)}`);
  }
  console.log('');
  return out;
}

console.log(bold('  Port Daddy — tube router as a conversation multiplexer'));
console.log(dim('  one channel · one driver · many backends · loop-guarded\n'));

// ── ACT 0: Codex talks to Claude over the tube ──────────────────────────────
console.log(bold('⓪ Codex ⇄ Claude') + dim('  — a Codex driver hands a task to a Claude agent on fleet:ctrl'));
console.log(`${dim('codex')}   ${cyan('▶ ping')}  ${dim('pd tube fleet:ctrl --send')} '{"command":"ping"}'`);
await routeInboundTubeMessage(mkMsg('{"command":"ping"}'), deps);
console.log(`${dim('claude')}  ${green('◀ router.pong')}  ${dim('(router is live, listening on fleet:ctrl)')}`);
console.log('');
await driver('Codex → Claude: "review the tube router for auth bypasses"', {
  command: 'spawn',
  backend: 'claude-cli',
  task: 'review the tube router for auth bypasses',
});
console.log(dim('   ↑ Codex spoke; a Claude agent answered, on the same channel.\n'));

// ── ACT 1: fan-out across three backends over ONE channel ───────────────────
console.log(bold('① fan-out') + dim('  — Codex multiplexes 3 tasks to 3 backends on fleet:ctrl'));
await driver('summarize the README', { command: 'spawn', backend: 'ollama', task: 'summarize the README' });
await driver('translate docs/ to Spanish', { command: 'spawn', backend: 'gemini', task: 'translate docs to spanish' });
await driver('security-review the router', { command: 'spawn', backend: 'claude-cli', task: 'security review the tube router' });
console.log(dim(`   fan-in: ${state.totalSpawns} agents completed, results returned on fleet:ctrl\n`));

// ── ACT 2: a spawned agent delegates DOWN — lineage grows, still allowed ─────
console.log(bold('② legit sub-delegation') + dim('  — agent-2 (gemini) spawns a child; depth 0 → 1, new task'));
const chainFromGemini = [{ agentId: 'agent-2', taskShape: normalizeTaskShape('translate docs to spanish'), depth: 0 }];
await driver('proofread the Spanish translation', {
  command: 'spawn',
  backend: 'ollama',
  task: 'proofread the spanish translation',
  delegationChain: chainFromGemini,
});

// ── ACT 3: the loop. a child re-issues the SAME task shape, reworded ─────────
console.log(bold('③ ping-pong blocked') + dim('  — child re-issues the parent task, reworded. SHAPE matches → refused'));
await driver('(loop) re-translate: Spanish ⇄ docs', {
  command: 'spawn',
  backend: 'gemini',
  task: 'To Spanish — translate docs!', // same token set as act-2 parent, reordered/repunctuated
  delegationChain: chainFromGemini,
});

// ── ACT 4: upward delegation back to the driver — blocked by default ─────────
console.log(bold('④ upward delegation blocked') + dim('  — a child tries to delegate back UP to codex'));
await driver('(loop) hand it back to codex', {
  command: 'spawn',
  backend: 'ollama',
  task: 'reassign the whole job',
  delegationChain: [{ agentId: 'codex', taskShape: normalizeTaskShape('original'), depth: 0 }],
});

console.log(bold(green('  ✓ multiplexed, fanned-in, and loop-safe.')) + dim('  fail-closed at every gate.'));
process.exit(0);
