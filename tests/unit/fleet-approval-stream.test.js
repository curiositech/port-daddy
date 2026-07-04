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
    s.enqueue(proposal({ id: 'b', timestamp: 2000, context: { source: 'trigger', messageContent: 'b-content' } }));
    s.enqueue(proposal({ id: 'a', timestamp: 1000, context: { source: 'trigger', messageContent: 'a-content' } }));
    s.enqueue(proposal({ id: 'b', timestamp: 2000, context: { source: 'trigger', messageContent: 'b-content' } })); // replay
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
      claimDurable: (p) => { removed.push(p.id); return true; },
      restoreDurable: () => { throw new Error('must not restore on success'); },
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

  test('approve: FAILED hail keeps the proposal pending, restores the durable record (compensation)', async () => {
    const s = new FleetApprovalStream();
    const restored = [];
    s.configure({
      hail: async () => ({ success: false, error: 'no such agent' }),
      claimDurable: () => true,
      restoreDurable: (p) => { restored.push(p.id); },
    });
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'op');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/no such agent/);
    expect(s.list()).toHaveLength(1); // still pending — operator can retry
    expect(restored).toEqual(['p-1']); // compensating transaction ran
  });

  test('claim ordering: durable record is claimed BEFORE the hail (crash cannot double-spawn)', async () => {
    const s = new FleetApprovalStream();
    const order = [];
    s.configure({
      hail: async () => { order.push('hail'); return { success: true }; },
      claimDurable: () => { order.push('claim'); return true; },
      restoreDurable: () => {},
    });
    s.enqueue(proposal());
    await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'op');
    expect(order).toEqual(['claim', 'hail']);
  });

  test('lost claim race (decided elsewhere / expired) refuses the decision and drops the stale entry', async () => {
    const s = new FleetApprovalStream();
    s.configure({
      hail: async () => { throw new Error('must not hail without a claim'); },
      claimDurable: () => false,
      restoreDurable: () => {},
    });
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'approve' }, 'op');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/already decided|expired/);
    expect(s.list()).toHaveLength(0); // stale entry cleared from the live view
  });

  test('reject: removed without hailing', async () => {
    const s = new FleetApprovalStream();
    const hailed = [];
    s.configure({
      hail: async (p) => { hailed.push(p.id); return { success: true }; },
      claimDurable: () => true,
      restoreDurable: () => {},
    });
    s.enqueue(proposal());
    const outcome = await s.decide({ type: 'human_decision', id: 'p-1', decision: 'reject', feedback: 'nope' }, 'op');
    expect(outcome).toEqual(expect.objectContaining({ type: 'human_gate_resolved', decision: 'reject', detail: 'nope' }));
    expect(hailed).toHaveLength(0);
    expect(s.list()).toHaveLength(0);
  });

  test('unknown id → error', async () => {
    const s = new FleetApprovalStream();
    s.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
    const outcome = await s.decide({ type: 'human_decision', id: 'ghost', decision: 'reject' }, 'op');
    expect(outcome.type).toBe('error');
    expect(outcome.message).toMatch(/unknown/);
  });

  test('content fingerprint dedup: a retried delivery with a fresh uuid does not stack a second gate', () => {
    const s = new FleetApprovalStream();
    s.enqueue(proposal({ id: 'uuid-1' }));
    s.enqueue(proposal({ id: 'uuid-2' })); // same substance, different uuid
    expect(s.list()).toHaveLength(1);
    // Different content is a different gate.
    s.enqueue(proposal({ id: 'uuid-3', context: { source: 'trigger', channel: 'webhook:hooks', messageContent: '{"ping":false}' } }));
    expect(s.list()).toHaveLength(2);
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
      claimDurable: () => true,
      restoreDurable: () => {},
    });
    stream.enqueue(proposal({ id: 'pre-existing', timestamp: 1, context: { source: 'trigger', messageContent: 'pre-existing-content' } }));

    const client = connectAndCollect();
    await client.open;

    // Resync contract: snapshot first, carrying the pre-existing proposal.
    const snapshot = await client.next((e) => e.type === 'snapshot');
    expect(snapshot.proposals.map((p) => p.id)).toEqual(['pre-existing']);

    // Live delta for a new proposal.
    stream.enqueue(proposal({ id: 'live-1', timestamp: 2, context: { source: 'trigger', channel: 'webhook:hooks', messageContent: '{"live":1}' } }));
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
    stream.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
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

// ─── Realtime hardening (websocket-realtime-expert gates) ────────────────────

describe('sendWithBackpressure', () => {
  test('sends when open and drained; closes slow consumers; skips closed sockets', async () => {
    const { sendWithBackpressure } = await import('../../routes/fleet-approvals.js');
    const mk = (readyState, bufferedAmount) => {
      const calls = { sent: [], closed: [] };
      return {
        socket: {
          readyState, OPEN: 1, bufferedAmount,
          send: (d) => calls.sent.push(d),
          close: (code, reason) => calls.closed.push({ code, reason }),
        },
        calls,
      };
    };

    const open = mk(1, 0);
    expect(sendWithBackpressure(open.socket, { type: 'error', message: 'x' })).toBe('sent');
    expect(open.calls.sent).toHaveLength(1);

    const slow = mk(1, 2_000_000);
    expect(sendWithBackpressure(slow.socket, { type: 'error', message: 'x' })).toBe('closed');
    expect(slow.calls.closed[0].code).toBe(1013);
    expect(slow.calls.sent).toHaveLength(0);

    const gone = mk(3, 0);
    expect(sendWithBackpressure(gone.socket, { type: 'error', message: 'x' })).toBe('skipped');
    expect(gone.calls.sent).toHaveLength(0);
    expect(gone.calls.closed).toHaveLength(0);
  });
});

describe('heartbeat (ping/pong liveness)', () => {
  test('a peer that never pongs is terminated within two intervals', async () => {
    setSharedApprovalStream(new FleetApprovalStream());
    const app = Fastify();
    // 60ms heartbeat so the test resolves fast.
    await app.register(fleetApprovalsPlugin, { deps: { logger: { info: () => {} }, heartbeatMs: 60 } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;

    // autoPong:false simulates a dead/zombie peer that stops answering.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/fleet/approvals/stream`, { autoPong: false });
    const closed = new Promise((resolve) => ws.on('close', resolve));
    await new Promise((resolve) => ws.on('open', resolve));
    const start = Date.now();
    await closed;
    // Terminated by the server's liveness sweep — well under a second.
    expect(Date.now() - start).toBeLessThan(1000);

    await app.close();
    setSharedApprovalStream(null);
  });

  test('a live peer (auto-pong) survives many intervals', async () => {
    setSharedApprovalStream(new FleetApprovalStream());
    const app = Fastify();
    await app.register(fleetApprovalsPlugin, { deps: { logger: { info: () => {} }, heartbeatMs: 40 } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/fleet/approvals/stream`); // default autoPong:true
    await new Promise((resolve) => ws.on('open', resolve));
    let closedEarly = false;
    ws.on('close', () => { closedEarly = true; });
    await new Promise((r) => setTimeout(r, 250)); // ~6 heartbeat intervals
    expect(closedEarly).toBe(false);

    ws.terminate();
    await app.close();
    setSharedApprovalStream(null);
  });
});

describe('GET /fleet/approvals/events (SSE fallback)', () => {
  test('streams the snapshot then live deltas as data-only JSON frames', async () => {
    const stream = new FleetApprovalStream();
    setSharedApprovalStream(stream);
    stream.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
    stream.enqueue(proposal({ id: 'sse-pre', timestamp: 1, context: { source: 'trigger', messageContent: 'sse-pre-content' } }));

    const app = Fastify();
    await app.register(fleetApprovalsPlugin, { deps: { logger: { info: () => {} } } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/fleet/approvals/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readUntil = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (predicate(buffer)) return;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      throw new Error(`SSE frame not observed; got: ${buffer.slice(0, 300)}`);
    };

    await readUntil((b) => b.includes('"type":"snapshot"') && b.includes('sse-pre'));
    stream.enqueue(proposal({ id: 'sse-live', timestamp: 2, context: { source: 'trigger', messageContent: 'sse-live-content' } }));
    await readUntil((b) => b.includes('"type":"human_gate_waiting"') && b.includes('sse-live'));

    await reader.cancel();
    await app.close();
    setSharedApprovalStream(null);
  });
});
