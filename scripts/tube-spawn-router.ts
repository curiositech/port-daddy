#!/usr/bin/env bun
/**
 * Runnable tube→spawner bridge (ADR-aligned with lib/tube-spawner-router.ts).
 *
 * Lets an external session (Codex/ChatGPT, another agent, a human) DRIVE the
 * fleet over `pd tube`: it listens on a control channel, and when an AUTHORIZED
 * sender posts a JSON command it spawns an agent via the daemon `/spawn` route
 * and posts the result back on the channel.
 *
 * FAIL-CLOSED. Disabled unless `--enable` is passed. Restrict who can drive it
 * with `--allow-sender` and what they can launch with `--allow-backend`.
 *
 *   Usage:
 *     bun scripts/tube-spawn-router.ts <channel> --enable \
 *        [--allow-sender codex] [--allow-backend ollama --allow-backend gemini] \
 *        [--default-backend ollama] [--identity pd:fleet:tube] \
 *        [--max-timeout-ms 600000] [--poll-ms 1500] \
 *        [--max-delegation-depth 4] [--max-chain-spawns 8] \
 *        [--allow-upward-delegation]   # NOT recommended — opens a loop class
 *
 *   Multi-backend: --allow-backend may repeat; a per-message `backend` field
 *   picks among the allowed set (claude, claude-cli, gemini, groq, cloudflare,
 *   openai, codex, ollama, ...), validated fail-closed against that set.
 *
 *   Then, from anywhere (e.g. a Codex session):
 *     pd tube <channel> --send '{"command":"ping"}'
 *     pd tube <channel> --send '{"command":"spawn","backend":"gemini","task":"summarize the README"}'
 *   ...and listen for the {"kind":"router.spawned",...} reply on the same channel.
 *
 *   Delegation/loop safety: every spawn carries a `delegationChain`. A spawned
 *   agent that itself runs this router inherits the chain (PD_DELEGATION_CHAIN)
 *   and the router refuses spawns that exceed depth/budget, repeat a task SHAPE
 *   (structural, not keyword), or delegate UP to an ancestor (blocked by default).
 */
import { decodeMessage, send, type TubeClient } from '../lib/tube.js';
import {
  routeInboundTubeMessage,
  inboundChainFromEnv,
  parseDelegationChain,
  createRouterState,
  type RouterPolicy,
} from '../lib/tube-spawner-router.js';
import type { SpawnSpec, SpawnResult } from '../lib/spawner.js';
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';

// Resolve via the single source of truth (PORT_DADDY_URL → port file → default),
// not a hardcoded literal. The default port lives only in shared/daemon-discovery.
const URL = resolveDaemonUrl();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function multi(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const channel = process.argv[2];
if (!channel || channel.startsWith('--')) {
  console.error('usage: bun scripts/tube-spawn-router.ts <channel> --enable [...]');
  process.exit(2);
}

const selfSender = `tube-router/${channel}`;
const policy: RouterPolicy = {
  enabled: has('enable'),
  allowedSenders: multi('allow-sender').length ? multi('allow-sender') : undefined,
  allowedBackends: (multi('allow-backend').length
    ? multi('allow-backend')
    : undefined) as RouterPolicy['allowedBackends'],
  defaultBackend: flag('default-backend') as SpawnSpec['backend'] | undefined,
  defaultIdentity: flag('identity'),
  maxTimeoutMs: flag('max-timeout-ms') ? Number(flag('max-timeout-ms')) : undefined,
  maxDelegationDepth: flag('max-delegation-depth') ? Number(flag('max-delegation-depth')) : undefined,
  maxChainSpawns: flag('max-chain-spawns') ? Number(flag('max-chain-spawns')) : undefined,
  maxTotalSpawns: flag('max-total-spawns') ? Number(flag('max-total-spawns')) : undefined,
  allowUpwardDelegation: has('allow-upward-delegation'),
};
// One shared fan-out accumulator for the lifetime of this router process.
const routerState = createRouterState();
const pollMs = flag('poll-ms') ? Number(flag('poll-ms')) : 1500;

// If THIS router process was itself spawned by a parent router, it inherits a
// delegation chain via PD_DELEGATION_CHAIN. We PREPEND that inherited lineage to
// every inbound spawn command so a child cannot escape its branch's loop limits
// by simply omitting (or under-reporting) `delegationChain` on the wire — the
// inherited prefix is authoritative and always wins over caller-supplied lineage.
const inheritedChain = inboundChainFromEnv();
if (inheritedChain.length) {
  console.error(
    `[tube-spawn-router] inherited delegation chain depth=${inheritedChain.length} ` +
      `(this router is itself a spawned agent; child spawns extend this branch)`,
  );
}

/** Force-prepend the inherited chain onto a raw spawn command body (fail-closed). */
function withInheritedLineage(body: string): string {
  if (!inheritedChain.length) return body;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return body; // not JSON — router will treat as not-a-command anyway
  }
  if (!obj || typeof obj !== 'object' || (obj as { command?: unknown }).command !== 'spawn') {
    return body;
  }
  // The inherited prefix is authoritative. Any caller-supplied chain is appended
  // AFTER it (still subject to validation), never allowed to replace it.
  const supplied = parseDelegationChain((obj as { delegationChain?: unknown }).delegationChain);
  obj.delegationChain = [...inheritedChain, ...supplied];
  return JSON.stringify(obj);
}

// Minimal TubeClient over the daemon's /msg surface.
const client: TubeClient = {
  async publish(ch, payload, opts) {
    const res = await fetch(`${URL}/msg/${encodeURIComponent(ch)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload, sender: opts?.sender }),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; id?: number; error?: string };
    return { ok: res.ok && json.success !== false, id: json.id, error: json.error };
  },
  async getMessages(ch, opts) {
    const qs = new URLSearchParams();
    if (opts?.after) qs.set('after', String(opts.after));
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const res = await fetch(`${URL}/msg/${encodeURIComponent(ch)}${qs.toString() ? '?' + qs : ''}`);
    const json = (await res.json().catch(() => ({}))) as { messages?: unknown[]; error?: string };
    return { ok: res.ok, messages: (json.messages ?? []) as never[], error: json.error };
  },
};

// Spawn via the daemon route (so the agent runs in the daemon's spawner, with
// its bonds/cost/telemetry wiring), returning a SpawnResult.
async function spawn(spec: SpawnSpec): Promise<SpawnResult> {
  const res = await fetch(`${URL}/spawn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(spec),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string } & Partial<SpawnResult>;
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `/spawn failed (${res.status})`);
  }
  return json as SpawnResult;
}

const sendReply = (ch: string, body: string) => send(ch, body, client, { sender: selfSender });

console.error(
  `[tube-spawn-router] channel=${channel} enabled=${policy.enabled} ` +
    `senders=${policy.allowedSenders?.join(',') ?? '(any)'} ` +
    `backends=${(policy.allowedBackends as string[] | undefined)?.join(',') ?? '(default set)'} ` +
    `daemon=${URL}`,
);
if (!policy.enabled) {
  console.error('[tube-spawn-router] NOT enabled — pass --enable to act on commands. Exiting.');
  process.exit(0);
}

let after = 0;
// Start at the channel tail so we don't replay history on startup.
{
  const seed = await client.getMessages(channel, { limit: 1000 });
  for (const row of seed.messages) {
    const m = decodeMessage(row as never);
    if (m.id > after) after = m.id;
  }
}
console.error(`[tube-spawn-router] listening (tail id=${after}). Ctrl+C to stop.`);

// eslint-disable-next-line no-constant-condition
while (true) {
  const { messages } = await client.getMessages(channel, { after, limit: 100 });
  for (const row of messages) {
    const m = decodeMessage(row as never);
    if (m.id > after) after = m.id;
    if (m.sender === selfSender) continue; // never route our own posts
    // Stamp inherited lineage onto the body before routing so loop limits cannot
    // be reset by a child omitting its chain (no-op when this router is a root).
    const stamped = { ...m, body: withInheritedLineage(m.body) };
    const outcome = await routeInboundTubeMessage(stamped, {
      spawn,
      send: sendReply,
      channel,
      policy,
      state: routerState,
    });
    if (outcome.action !== 'ignored') {
      console.error(`[tube-spawn-router] id=${m.id} sender=${m.sender} -> ${outcome.action}` +
        ('reason' in outcome ? ` (${outcome.reason})` : '') +
        ('agentId' in outcome ? ` agent=${outcome.agentId}` : '') +
        ('error' in outcome ? ` err=${outcome.error}` : ''));
    }
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
