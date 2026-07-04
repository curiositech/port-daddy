// tests/unit/fleet-approval-stream.test.js
//
// The ADR-0093 L2 approval loop, live: FleetApprovalStream semantics plus a
// REAL WebSocket round-trip against the Fastify route (snapshot on connect,
// delta broadcast, human_decision → hail → human_gate_resolved).
//
// Non-trivial properties pinned:
//   - Fail-closed: decisions are refused until the daemon configures the
//     stream's actions; a failed hail KEEPS the proposal pending (an
//     approve that didn't spawn must not silently vanish).
//   - Replay-safe enqueue (same id twice = once).
//   - A broken subscriber cannot starve the others.
//   - The WS protocol is typed end-to-end: snapshot → waiting → resolved,
//     and malformed client frames get an error, not a crash.

import { jest } from '@jest/globals';
import Fastify from 'fastify';
import WebSocket from 'ws';

const { FleetApprovalStream, getSharedApprovalStream, setSharedApprovalStream } =
  await import('../../lib/fleet/approval-stream.js');
const { fleetApprovalsPlugin } = await import('../../routes/fleet-approvals.js');

function proposal(overrides = {}) {
  return {
    id: 'p-1',
    project: 'test-fleet',
    agent: 'hook-agent',
    trigger: 'webhook:hooks',
    tier: 'ANONYMOUS_EXTERNAL',
    reason: 'requires approval',
    safeTools: ['read', 'grep', 'glob'],
    context: { source: 'trigger', channel: 'webhook:hooks', messageContent: '{"ping":true}' },
    timestamp: 1000,
    ...overrides,
  };
}

// ─── Stream semantics ────────────────────────────────────────────────────────

describe('FleetApprovalStream', () => {
  test('enqueue is replay-safe and list() is timestamp-ordered', () => {
    const s = new FleetApprovalStream();
    s.enqueue(proposal({ id: 'b', timestamp: 2000 }));
    s.enqueue(proposal({ id: 'a', timestamp: 1000 }));
    s.enqueue(proposal({ id: 'b', timestamp: 2000 })); // replay
    expect(s.list().map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('fail-closed: decisions refused until actions are configured', async () => {
    const s = new FleetApprovalStream();
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'test');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/not configured/);
    expect(s.list()).toHaveLength(1); // proposal kept
  });

  test('approve: hail succeeds → resolved + removed + durable dropped', async () => {
    const s = new FleetApprovalStream();
    const hailed = [];
    const removed = [];
    s.configure({
      hail: async (p) => { hailed.push(p.id); return { success: true }; },
      removeDurable: (p) => removed.push(p.id),
    });
    s.enqueue(proposal());
    const events = [];
    s.subscribe((e) => events.push(e));

    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'op');
    expect(outcome).toEqual(expect.objectContaining({ type: 'human_gate_resolved', decision: 'approve', resolvedBy: 'op' }));
    expect(hailed).toEqual(['p-1']);
    expect(removed).toEqual(['p-1']);
    expect(s.list()).toHaveLength(0);
    expect(events.map((e) => e.type)).toContain('human_gate_resolved');
  });

  test('approve: FAILED hail keeps the proposal pending and broadcasts an error', async () => {
    const s = new FleetApprovalStream();
    s.configure({
      hail: async () => ({ success: false, error: 'no such agent' }),
      removeDurable: () => { throw new Error('must not remove on failed hail'); },
    });
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'op');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/no such agent/);
    expect(s.list()).toHaveLength(1); // still pending — operator can retry
  });

  test('reject: removed without hailing', async () => {
    const s = new FleetApprovalStream();
    const hailed = [];
    s.configure({
      hail: async (p) => { hailed.push(p.id); return { success: true }; },
      removeDurable: () => {},
    });
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'reject', feedback: 'nope' }, 'op');
    expect(outcome).toEqual(expect.objectContaining({ type: 'human_gate_resolved', decision: 'reject', detail: 'nope' }));
    expect(hailed).toHaveLength(0);
    expect(s.list()).toHaveLength(0);
  });

  test('unknown id → error', async () => {
    const s = new FleetApprovalStream();
    s.configure({ hail: async () => ({ success: true }), removeDurable: () => {} });
    const outcome = await s.decide({ type: 'human_decision', id: 'ghost', decision: 'reject' }, 'op');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/unknown/);
  });

  test('a throwing subscriber does not starve the others', () => {
    const s = new FleetApprovalStream();
    const seen = [];
    s.subscribe(() => { throw new Error('broken pipe'); });
    s.subscribe((e) => seen.push(e.type));
    s.enqueue(proposal());
    expect(seen).toEqual(['human_gate_waiting']);
  });
});

// ─── WebSocket route (real socket round-trip) ────────────────────────────────

describe('GET /fleet/approvals/stream (WebSocket)', () => {
  let app;
  let url;

  beforeEach(async () => {
    setSharedApprovalStream(new FleetApprovalStream());
    app = Fastify();
    await app.register(fleetApprovalsPlugin, { deps: { logger: { info: () => {} } } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    url = `ws://127.0.0.1:${address.port}/fleet/approvals/stream`;
  });

  const clients = [];

  afterEach(async () => {
    for (const ws of clients.splice(0)) ws.terminate();
    await app.close();
    setSharedApprovalStream(null);
  });

  function connectAndCollect() {
    const ws = new WebSocket(url);
    clients.push(ws);
    const events = [];
    const waiters = [];
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      for (const w of [...waiters]) {
        if (w.pred(event)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(event);
        }
      }
    });
    const next = (pred) => new Promise((resolve, reject) => {
      const existing = events.find(pred);
      if (existing) return resolve(existing);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('timed out waiting for event')), 5000);
    });
    const open = new Promise((resolve) => ws.on('open', resolve));
    return { ws, events, next, open };
  }

  test('snapshot on connect, waiting delta on enqueue, approve round-trip resolves', async () => {
    const stream = getSharedApprovalStream();
    const hailed = [];
    stream.configure({
      hail: async (p) => { hailed.push(p.agent); return { success: true }; },
      removeDurable: () => {},
    });
    stream.enqueue(proposal({ id: 'pre-existing', timestamp: 1 }));

    const client = connectAndCollect();
    await client.open;

    // Resync contract: snapshot first, carrying the pre-existing proposal.
    const snapshot = await client.next((e) => e.type === 'snapshot');
    expect(snapshot.proposals.map((p) => p.id)).toEqual(['pre-existing']);

    // Live delta for a new proposal.
    stream.enqueue(proposal({ id: 'live-1', timestamp: 2 }));
    const waiting = await client.next((e) => e.type === 'human_gate_waiting');
    expect(waiting.proposal.id).toBe('live-1');

    // Human decision over the SAME socket → hail runs → resolution broadcast.
    client.ws.send(JSON.stringify({ type: 'human_decision', id: 'live-1', decision: 'approve' }));
    const resolved = await client.next((e) => e.type === 'human_gate_resolved' && e.id === 'live-1');
    expect(resolved.decision).toBe('approve');
    expect(hailed).toEqual(['hook-agent']);
    expect(stream.list().map((p) => p.id)).toEqual(['pre-existing']);

    client.ws.close();
  });

  test('malformed client frame → typed error, socket survives', async () => {
    const client = connectAndCollect();
    await client.open;
    await client.next((e) => e.type === 'snapshot');
    client.ws.send('not json at all');
    const err = await client.next((e) => e.type === 'error');
    expect(err.message).toMatch(/malformed/);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close();
  });

  test('REST fallbacks: list + decision', async () => {
    const stream = getSharedApprovalStream();
    stream.configure({ hail: async () => ({ success: true }), removeDurable: () => {} });
    stream.enqueue(proposal({ id: 'rest-1' }));

    const list = await app.inject({ method: 'GET', url: '/fleet/approvals' });
    expect(list.json().proposals.map((p) => p.id)).toEqual(['rest-1']);

    const bad = await app.inject({
      method: 'POST', url: '/fleet/approvals/rest-1/decision', payload: { decision: 'maybe' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST', url: '/fleet/approvals/rest-1/decision', payload: { decision: 'reject', feedback: 'not now' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().resolved.decision).toBe('reject');

    const gone = await app.inject({
      method: 'POST', url: '/fleet/approvals/rest-1/decision', payload: { decision: 'approve' },
    });
    expect(gone.statusCode).toBe(404);
  });
});
