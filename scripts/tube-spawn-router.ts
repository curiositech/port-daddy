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
 *        [--allow-sender codex] [--allow-backend ollama] \
 *        [--default-backend ollama] [--identity pd:fleet:tube] \
 *        [--max-timeout-ms 600000] [--poll-ms 1500]
 *
 *   Then, from anywhere (e.g. a Codex session):
 *     pd tube <channel> --send '{"command":"ping"}'
 *     pd tube <channel> --send '{"command":"spawn","backend":"ollama","task":"summarize the README"}'
 *   ...and listen for the {"kind":"router.spawned",...} reply on the same channel.
 */
import { decodeMessage, send, type TubeClient } from '../lib/tube.js';
import { routeInboundTubeMessage, type RouterPolicy } from '../lib/tube-spawner-router.js';
import type { SpawnSpec, SpawnResult } from '../lib/spawner.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';

// Resolve via the single source of truth (PORT_DADDY_URL → port file → default),
// not a hardcoded literal. The default port lives only in shared/daemon-discovery.
const URL = getDaemonTcpUrl();

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
};
const pollMs = flag('poll-ms') ? Number(flag('poll-ms')) : 1500;

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
    const outcome = await routeInboundTubeMessage(m, { spawn, send: sendReply, channel, policy });
    if (outcome.action !== 'ignored') {
      console.error(`[tube-spawn-router] id=${m.id} sender=${m.sender} -> ${outcome.action}` +
        ('reason' in outcome ? ` (${outcome.reason})` : '') +
        ('agentId' in outcome ? ` agent=${outcome.agentId}` : '') +
        ('error' in outcome ? ` err=${outcome.error}` : ''));
    }
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
