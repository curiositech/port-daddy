/**
 * Real-runtime (bun:test + bun:sqlite) regression suite for the Agent Cockpit
 * endpoints — "Watch + Grab the Wheel" Phase 0.
 *
 * RUNTIME: bun:test, on purpose. The daemon runs on bun:sqlite, not the
 * jest/better-sqlite3 stack, so per repo policy (feedback_regression_test_under_real_runtime)
 * a route regression must be exercised under the SAME engine + the SAME wiring
 * the live daemon uses: a real `bun:sqlite` Database, the real `createMessaging`
 * broker, the real `createTranscripts` recorder, a real `createAgents` store,
 * and the real `agentCockpitPlugin` mounted on a real Fastify instance listening
 * on a TCP port. The SSE path is then driven over real HTTP with a streaming
 * `fetch` reader — exactly how the operator console consumes it.
 *
 * What it proves:
 *   1. GET /agents/:id/stream is a single SSE feed that MERGES three sources for
 *      ONE agent: lifecycle status (agents channel), steering-channel tube
 *      messages (agent:<id>), and ship-run transcript events — each as a typed
 *      {v,kind,agentId,body,ts} envelope.
 *   2. Events for OTHER agents are filtered out (no cross-talk).
 *   3. Multi-subscriber: two concurrent streams on the same agent each receive
 *      every event (no single-client assumption).
 *   4. POST /agents/:id/interrupt publishes a control.interrupt envelope onto
 *      the agent's steering channel (and so shows up on the live stream as an
 *      agent.tube event), returns 404 for an unknown agent, and never kills.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';

import { createMessaging } from '../../lib/messaging.ts';
import { createTranscripts } from '../../lib/transcripts.ts';
import { createAgents } from '../../lib/agents.ts';
import { createLocks } from '../../lib/locks.ts';
import { CORE_SCHEMA_SQL } from '../../lib/db.ts';
import {
  agentCockpitPlugin,
  agentSteeringChannel,
  decodeAgentChannelEvent,
  extractMessagePayload,
  AGENT_STREAM_ENVELOPE_VERSION,
} from '../../routes/agent-cockpit.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

interface Harness {
  app: FastifyInstance;
  baseUrl: string;
  messaging: ReturnType<typeof createMessaging>;
  transcripts: ReturnType<typeof createTranscripts>;
  agents: ReturnType<typeof createAgents>;
  db: Database;
}

async function startHarness(): Promise<Harness> {
  // bun:sqlite Database — the engine the live daemon actually runs on.
  const db = new Database(':memory:') as unknown as import('better-sqlite3').Database;
  // Canonical core schema (services/agents/messages/...) so the stores' prepared
  // statements bind against the SAME tables the live daemon owns.
  (db as unknown as { exec(sql: string): void }).exec(CORE_SCHEMA_SQL);
  // createAgents prepares a `locks` query at construction, so the locks table
  // (owned by createLocks) must exist first.
  createLocks(db);

  const messaging = createMessaging(db);
  const transcripts = createTranscripts(db);
  const agents = createAgents(db);

  const app = Fastify();
  await app.register(agentCockpitPlugin, {
    deps: {
      logger: { info() {}, error() {} },
      metrics: { errors: 0 },
      agents,
      messaging,
      transcripts,
    },
  } as never);

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind test server');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return { app, baseUrl, messaging, transcripts, agents, db: db as unknown as Database };
}

/**
 * Open an SSE stream and collect parsed envelopes until `predicate` is
 * satisfied (or it times out). Returns the collected envelopes. The reader is
 * aborted on resolution so the connection is cleaned up.
 */
async function collectStream(
  url: string,
  predicate: (envs: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 4000,
): Promise<{ envelopes: Array<Record<string, unknown>>; connectedSeen: boolean }> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.body) throw new Error('no response body for SSE');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const envelopes: Array<Record<string, unknown>> = [];
  let connectedSeen = false;
  let buffer = '';

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), deadline - Date.now()),
        ),
      ]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.includes('event: connected')) connectedSeen = true;
        const lines = frame.split('\n');
        const idLine = lines.find((l) => l.startsWith('id: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const json = dataLine.slice('data: '.length);
        try {
          const parsed = JSON.parse(json);
          if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
            if (idLine) parsed.__sseId = idLine.slice('id: '.length);
            envelopes.push(parsed);
          }
        } catch {
          /* connected/heartbeat frames or partial — ignore */
        }
      }
      if (predicate(envelopes)) break;
    }
  } finally {
    controller.abort();
    try { await reader.cancel(); } catch { /* aborted */ }
  }
  return { envelopes, connectedSeen };
}

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.app.close();
});

// A real transcript row for the agent so transcript events have a subject.
function seedTranscript(h: Harness, agentId: string): string {
  return h.transcripts.start({
    ship: 'test-ship',
    spawned_agent_id: agentId,
    trigger: 'manual',
    backend: 'cli:codex',
    model: 'codex-cli',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helper unit checks (cheap, no server)
// ─────────────────────────────────────────────────────────────────────────────

describe('agent-cockpit pure helpers', () => {
  test('agentSteeringChannel is deterministic agent:<id>', () => {
    expect(agentSteeringChannel('agent-xyz')).toBe('agent:agent-xyz');
  });

  test('extractMessagePayload unwraps the broker MessagePayload', () => {
    expect(extractMessagePayload({ id: 1, channel: 'c', payload: { a: 1 }, sender: null, createdAt: 0 }))
      .toEqual({ a: 1 });
    // Defensive: tolerate a raw payload that is not wrapped.
    expect(extractMessagePayload('hello')).toBe('hello');
  });

  test('decodeAgentChannelEvent parses JSON string + object, rejects non-events', () => {
    expect(decodeAgentChannelEvent(JSON.stringify({ event: 'registered', agentId: 'a1' })))
      .toMatchObject({ event: 'registered', agentId: 'a1' });
    expect(decodeAgentChannelEvent({ event: 'unregistered', agentId: 'a2' }))
      .toMatchObject({ agentId: 'a2' });
    expect(decodeAgentChannelEvent('not json')).toBeNull();
    expect(decodeAgentChannelEvent({ noAgentId: true })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents/:id/stream — merged SSE under the real broker
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /agents/:id/stream — merged live feed', () => {
  test('merges status + tube + transcript for one agent into typed envelopes', async () => {
    const h = harness;
    const agentId = 'agent-watch-1';
    h.agents.register(agentId, { type: 'cli' });
    const txId = seedTranscript(h, agentId);

    const url = `${h.baseUrl}/agents/${agentId}/stream`;

    // Start collecting, then emit one event per source after a tick so the
    // subscription is live.
    const collected = collectStream(
      url,
      (envs) =>
        envs.some((e) => e.kind === 'agent.status') &&
        envs.some((e) => e.kind === 'agent.tube') &&
        envs.some((e) => e.kind === 'agent.transcript'),
    );

    // Give the SSE handler a moment to install its in-memory subscriptions.
    await new Promise((r) => setTimeout(r, 150));

    // Source 1: lifecycle status on the `agents` channel.
    h.messaging.publish('agents', JSON.stringify({ event: 'registered', agentId, timestamp: Date.now() }));
    // Source 2: a tube message on the steering channel.
    h.messaging.publish(agentSteeringChannel(agentId), { kind: 'tube.msg', body: 'hello cockpit' }, { contentType: 'json' });
    // Source 3: a transcript update for this agent.
    h.transcripts.appendMessage(txId, { role: 'assistant', content: 'working on it', timestamp: Date.now() });

    const { envelopes, connectedSeen } = await collected;

    expect(connectedSeen).toBe(true);

    const status = envelopes.find(
      (e) => e.kind === 'agent.status' && (e.body as Record<string, unknown>).event === 'registered',
    );
    const tube = envelopes.find((e) => e.kind === 'agent.tube');
    const transcript = envelopes.find(
      (e) => e.kind === 'agent.transcript' && (e.body as Record<string, unknown>).type === 'update',
    );

    expect(status).toBeDefined();
    expect(tube).toBeDefined();
    expect(transcript).toBeDefined();

    // Envelope contract: { v, kind, agentId, body, ts }.
    for (const e of [status, tube, transcript]) {
      expect(e!.v).toBe(AGENT_STREAM_ENVELOPE_VERSION);
      expect(e!.agentId).toBe(agentId);
      expect(typeof e!.ts).toBe('number');
      expect(typeof e!.__sseId).toBe('string');
      expect((e!.__sseId as string).startsWith(`${agentId}:`)).toBe(true);
      expect('body' in e!).toBe(true);
    }

    expect((status!.body as Record<string, unknown>).event).toBe('registered');
    expect((tube!.body as Record<string, unknown>).body).toBe('hello cockpit');
    expect((transcript!.body as Record<string, unknown>).type).toBe('update');
    expect((transcript!.body as Record<string, unknown>).compliance).toEqual(expect.objectContaining({
      backend: 'cli:codex',
      captureMode: 'live_stream',
      flowState: 'supported',
    }));
  });

  test('sends current agent + latest transcript snapshots immediately on connect', async () => {
    const h = harness;
    const agentId = 'agent-snapshot';
    h.agents.register(agentId, { type: 'cli', status: 'busy' });
    const txId = seedTranscript(h, agentId);
    h.transcripts.appendMessage(txId, {
      role: 'assistant',
      content: 'snapshot already has transcript data',
      timestamp: Date.now(),
      tool_calls: [{ name: 'Read', args: { file: 'routes/agent-cockpit.ts' }, result: 'ok' }],
    });
    h.transcripts.appendOutput(txId, {
      type: 'draft-pr',
      summary: 'draft PR proof artifact',
      url: 'https://github.com/example/port-daddy/pull/999',
    });

    const { envelopes, connectedSeen } = await collectStream(
      `${h.baseUrl}/agents/${agentId}/stream`,
      (envs) =>
        envs.some((e) => e.kind === 'agent.status') &&
        envs.some((e) => e.kind === 'agent.transcript'),
    );

    expect(connectedSeen).toBe(true);
    const status = envelopes.find((e) => e.kind === 'agent.status');
    const transcript = envelopes.find((e) => e.kind === 'agent.transcript');
    expect((status!.body as Record<string, unknown>).event).toBe('snapshot');
    expect((status!.body as Record<string, unknown>).status).toBe('busy');

    const transcriptBody = transcript!.body as {
      type?: string;
      compliance?: Record<string, unknown>;
      entry?: {
        messages?: Array<{ content?: string; tool_calls?: Array<{ name?: string }> }>;
        outputs?: Array<{ summary?: string; type?: string }>;
      };
    };
    expect(transcriptBody.type).toBe('snapshot');
    expect(transcriptBody.compliance).toEqual(expect.objectContaining({
      backend: 'cli:codex',
      flowState: 'supported',
    }));
    expect(transcriptBody.entry?.messages?.some((m) => m.content === 'snapshot already has transcript data')).toBe(true);
    expect(transcriptBody.entry?.messages?.some((m) => m.tool_calls?.some((tc) => tc.name === 'Read'))).toBe(true);
    expect(transcriptBody.entry?.outputs?.some((o) => o.type === 'draft-pr' && o.summary === 'draft PR proof artifact')).toBe(true);
  });

  test('filters out events for OTHER agents (no cross-talk)', async () => {
    const h = harness;
    const mine = 'agent-mine';
    const other = 'agent-other';
    h.agents.register(mine, { type: 'cli' });
    h.agents.register(other, { type: 'cli' });

    const collected = collectStream(
      `${h.baseUrl}/agents/${mine}/stream`,
      (envs) => envs.some((e) => e.kind === 'agent.tube'),
    );
    await new Promise((r) => setTimeout(r, 150));

    // Noise for the other agent — must NOT appear.
    h.messaging.publish('agents', JSON.stringify({ event: 'registered', agentId: other }));
    h.messaging.publish(agentSteeringChannel(other), { kind: 'tube.msg', body: 'not for you' }, { contentType: 'json' });
    // Signal for mine.
    h.messaging.publish(agentSteeringChannel(mine), { kind: 'tube.msg', body: 'for me' }, { contentType: 'json' });

    const { envelopes } = await collected;
    expect(envelopes.every((e) => e.agentId === mine)).toBe(true);
    expect(envelopes.some((e) => (e.body as Record<string, unknown>)?.body === 'not for you')).toBe(false);
    expect(envelopes.some((e) => (e.body as Record<string, unknown>)?.body === 'for me')).toBe(true);
  });

  test('carries visual-task screenshot evidence on the watched agent lane', async () => {
    const h = harness;
    const agentId = 'agent-visual-task';
    h.agents.register(agentId, { type: 'cli' });

    const collected = collectStream(
      `${h.baseUrl}/agents/${agentId}/stream`,
      (envs) => envs.some((e) => (e.body as Record<string, unknown>)?.kind === 'visual-task'),
    );
    await new Promise((r) => setTimeout(r, 150));

    const blobUrl = `/blob/${'b'.repeat(64)}`;
    h.messaging.publish(agentSteeringChannel(agentId), {
      kind: 'visual-task',
      taskId: 'visual-task-proof',
      title: 'Checkout button is clipped',
      image: {
        mimeType: 'image/png',
        blobUrl,
      },
      region: { x: 20, y: 30, width: 220, height: 80, coordinateSpace: 'viewport' },
      channel: { name: 'visual-feedback', messageId: 7 },
    }, { contentType: 'json' });

    const { envelopes } = await collected;
    const visual = envelopes.find((e) => (e.body as Record<string, unknown>)?.kind === 'visual-task');
    expect(visual).toBeDefined();
    expect(visual!.kind).toBe('agent.tube');
    expect((visual!.body as { image?: { blobUrl?: string } }).image?.blobUrl).toBe(blobUrl);
  });

  test('multi-subscriber: two streams on the same agent each receive the event', async () => {
    const h = harness;
    const agentId = 'agent-multi';
    h.agents.register(agentId, { type: 'cli' });
    const url = `${h.baseUrl}/agents/${agentId}/stream`;

    const a = collectStream(url, (envs) => envs.some((e) => e.kind === 'agent.tube'));
    const b = collectStream(url, (envs) => envs.some((e) => e.kind === 'agent.tube'));
    await new Promise((r) => setTimeout(r, 200));

    h.messaging.publish(agentSteeringChannel(agentId), { kind: 'tube.msg', body: 'fanout' }, { contentType: 'json' });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.envelopes.some((e) => e.kind === 'agent.tube')).toBe(true);
    expect(rb.envelopes.some((e) => e.kind === 'agent.tube')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents/:id/interrupt — soft steer
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /agents/:id/interrupt — soft cancel/steer', () => {
  test('publishes a control.interrupt onto the steering channel for a known agent', async () => {
    const h = harness;
    const agentId = 'agent-steer';
    h.agents.register(agentId, { type: 'cli' });

    const res = await fetch(`${h.baseUrl}/agents/${agentId}/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'operator redirect' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.channel).toBe(agentSteeringChannel(agentId));
    expect(data.control.kind).toBe('control.interrupt');
    expect(data.control.reason).toBe('operator redirect');
    expect(typeof data.messageId).toBe('number');

    // The control message must be on the channel (a cooperating loop reads it).
    const msgs = h.messaging.getMessages(agentSteeringChannel(agentId), { limit: 10 }) as {
      messages: Array<{ payload: unknown }>;
    };
    const found = msgs.messages.find((m) => {
      const p = extractMessagePayload(m);
      return p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'control.interrupt';
    });
    expect(found).toBeDefined();
  });

  test('interrupt surfaces on the agent live stream as an agent.tube event', async () => {
    const h = harness;
    const agentId = 'agent-steer-live';
    h.agents.register(agentId, { type: 'cli' });

    const collected = collectStream(
      `${h.baseUrl}/agents/${agentId}/stream`,
      (envs) => envs.some((e) => (e.body as Record<string, unknown>)?.kind === 'control.interrupt'),
    );
    await new Promise((r) => setTimeout(r, 150));

    await fetch(`${h.baseUrl}/agents/${agentId}/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'pause please' }),
    });

    const { envelopes } = await collected;
    const ctl = envelopes.find((e) => (e.body as Record<string, unknown>)?.kind === 'control.interrupt');
    expect(ctl).toBeDefined();
    expect(ctl!.kind).toBe('agent.tube');
    expect((ctl!.body as Record<string, unknown>).reason).toBe('pause please');
  });

  test('returns 404 for an unknown agent and never kills', async () => {
    const h = harness;
    const res = await fetch(`${h.baseUrl}/agents/agent-nope/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  test('reason is optional', async () => {
    const h = harness;
    const agentId = 'agent-noreason';
    h.agents.register(agentId, { type: 'cli' });
    const res = await fetch(`${h.baseUrl}/agents/${agentId}/interrupt`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect('reason' in data.control).toBe(false);
  });
});
