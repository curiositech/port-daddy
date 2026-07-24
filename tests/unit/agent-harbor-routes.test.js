/**
 * Agent Harbor route tests (binder ch09 endpoint family; work order C-routes).
 *
 * fastify.inject fixtures against seeded projections (C1 ledger +
 * projections). Gates covered:
 *   - GET /agent-nodes serves the roster projection with a freshness envelope;
 *   - stale projections are LABELED in the envelope (?refresh=false) and the
 *     default read-through catch-up clears the label;
 *   - GET /agent-nodes/:id joins roster + compliance + costs + receipts +
 *     files, and 404s honestly for unknown nodes;
 *   - GET /sessions/:id/events pages history with a sequence cursor
 *     (rest-api-design: never unbounded) and live-tails over SSE with
 *     Last-Event-ID replay (server-sent-events-vs-websockets gates: no-cache,
 *     X-Accel-Buffering: no, id: on every event, replay buffer real);
 *   - GET /receipts/:id verifies the per-session hash chain and the receipt's
 *     committed transcript head against the ledger;
 *   - GET /compliance/:agentNodeId exposes daemon-witnessed compliance;
 *   - GET /agent-harbor/surface-gateway/capabilities exposes the shared
 *     command/query/event contract discovery projection;
 *   - tolerant reader: unknown payload fields and unknown query params never
 *     break a response.
 */
import { jest } from '@jest/globals';
import Fastify from 'fastify';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import { appendEvent, readEvents } from '../../lib/agent-harbor/event-ledger.js';
import { projectPending } from '../../lib/agent-harbor/projections.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { agentHarborPlugin } from '../../routes/agent-harbor.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));
}

const NODE_ID = 'agent_node_01JZFIX0001';
const SESSION_ID = 'session_01JZFIX0001';

function transcript(overrides) {
  return {
    eventId: `evt_${String(overrides.sequence)}`,
    sessionId: SESSION_ID,
    agentNodeId: NODE_ID,
    occurredAt: '2026-07-05T12:00:00.000Z',
    schemaVersion: 1,
    kind: 'assistant_message',
    visibility: 'operator',
    payloadJson: {},
    ...overrides,
  };
}

/** Seed a realistic run: node fact, run fact, transcript, costs, probe, receipt. */
function seed(db) {
  appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
  appendEvent(db, { streamType: 'agent-run', payload: fixture('agent-run') });
  appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 1, kind: 'session_started' }) });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      sequence: 2,
      kind: 'file_write',
      payloadJson: { path: 'lib/auth.ts', absolutePath: '/repo/lib/auth.ts' },
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      sequence: 3,
      kind: 'unknown_future_kind', // tolerant reader: unknown kinds are rows like any other
      payloadJson: { someFutureField: { nested: true } },
      aWholeUnknownTopLevelField: 'preserved',
    }),
  });
  appendEvent(db, { streamType: 'cost-accrual-event', payload: fixture('cost-accrual-event') });
  appendEvent(db, { streamType: 'compliance-probe-result', payload: fixture('compliance-probe-result') });
  appendEvent(db, { streamType: 'work-receipt', payload: fixture('work-receipt') });
}

function buildApp(db, sse = {}) {
  const app = Fastify();
  const dispatchQueue = createDispatchQueue({ db });
  const dispatchWorker = {
    poll: jest.fn(async () => {
      const proposed = dispatchQueue.list({ state: 'proposed', limit: 1 })[0];
      if (!proposed) return 0;
      dispatchQueue.claim({
        id: proposed.id,
        worktreePath: `/tmp/${proposed.id}`,
        branch: `work/${proposed.slug}`,
        sessionId: `session-${proposed.id}`,
        workerActorId: 'daemon:test-worker',
      });
      return 1;
    }),
  };
  const deps = {
    db,
    workIntentService: createWorkIntentService({
      db,
      now: () => new Date('2026-07-12T18:00:00.000Z'),
      uuid: () => 'route-test-uuid',
    }),
    dispatchQueue,
    dispatchWorker,
    metrics: { errors: 0 },
    logger: { info: jest.fn(), error: jest.fn() },
  };
  app.register(agentHarborPlugin, { deps, sse });
  return { app, deps };
}

function gatewayEnvelope(overrides = {}) {
  const idempotencyKey = overrides.idempotencyKey ?? 'pd-console:work:test-1';
  return {
    schema: 'pd.agent-harbor.surface-gateway.v0',
    envelopeId: 'surface_gateway_pd_console_test_1',
    correlationId: 'corr_pd_console_test_1',
    surface: 'pd-console',
    direction: 'surface-to-daemon',
    mode: 'command',
    noun: 'WorkIntent',
    operation: 'work-intent.capture',
    issuedBy: 'pd-console:operator:local',
    issuedAt: '2026-07-12T17:59:59.000Z',
    idempotencyKey,
    payload: {
      schema: 'pd.agent-harbor.work-intent.v0',
      intentId: 'work_intent_pd_console_test_1',
      idempotencyKey,
      source: {
        kind: 'console',
        surface: 'pd-console',
        actorId: 'operator:local',
      },
      goal: { text: 'Unify the operator work path' },
      constraints: {
        placement: 'local-only',
        maxCostUsd: 10,
        parallelism: 'planner-decides',
        reviewRequired: true,
        destructiveActions: 'human-approval',
      },
      startPolicy: 'queued',
      attachExisting: false,
      operator: 'operator:local',
      status: 'captured',
      createdAt: '2026-07-12T17:59:59.000Z',
    },
    ...overrides,
  };
}

describe('agent-harbor routes', () => {
  let db;
  let app;
  let deps;

  beforeEach(async () => {
    db = initDatabase({ inMemory: true });
    seed(db);
    projectPending(db);
    ({ app, deps } = buildApp(db, { pollMs: 40, heartbeatMs: 200 }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
  });

  describe('GET /agent-harbor/surface-gateway/capabilities', () => {
    test('exposes the shared surface gateway contract projection', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/agent-harbor/surface-gateway/capabilities',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        schema: 'pd.agent-harbor.surface-gateway.capability-projection.v0',
        routeIntegration: {
          mounted: true,
          path: '/agent-harbor/surface-gateway/capabilities',
        },
        idempotency: {
          command: 'explicit-key-required',
          query: 'not-required',
          event: 'explicit-key-or-derived-payload-key',
        },
      });
      expect(body.surfaces).toEqual(['pd-console', 'fleetbar', 'scout', 'cli', 'mcp']);
      expect(body.directions).toEqual(['surface-to-daemon', 'daemon-to-surface', 'surface-local']);
      expect(body.modes).toEqual(['command', 'query', 'event']);
      expect(body.nouns).toEqual([
        'WorkIntent',
        'WorkPlan',
        'AgentNode',
        'AgentRun',
        'Body',
        'ControlCommand',
        'TranscriptEvent',
        'CapabilityDecision',
        'WorkReceipt',
        'BerthTarget',
      ]);
      for (const legacy of ['Spawn', 'Dispatch', 'Sortie', 'Nightshift']) {
        expect(body.nouns).not.toContain(legacy);
      }
      expect(body.busTargets).toEqual(['hot-bus', 'cool-bus']);
      expect(body.authority.command).toEqual(['canCommand', 'freshProjection', 'allowDecision']);
      expect(body.authority.query).toEqual(['canQuery']);
      expect(body.authority.daemonToSurfaceEvent).toEqual(['canSubscribeEvents']);
    });
  });

  describe('POST /agent-harbor/surface-gateway (WorkIntent)', () => {
    test('captures exactly one WorkIntent and initial WorkPlan, with no launch side effect', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope(),
      });
      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({
        schema: 'pd.agent-harbor.surface-gateway.command-receipt.v0',
        status: 'accepted',
        duplicate: false,
        intent: {
          intentId: 'work_intent_pd_console_test_1',
          source: { kind: 'console', surface: 'pd-console' },
        },
        plan: {
          planId: 'work_plan_pd_console_test_1',
          intentId: 'work_intent_pd_console_test_1',
          state: 'intent-captured',
          shape: 'unshaped',
          nodeSpecs: [],
          requiresApproval: true,
        },
        nextAction: { code: 'WORK_PLANNER_REQUIRED' },
      });

      const second = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope(),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ status: 'confirmed', duplicate: true });

      expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
      expect(readEvents(db, { streamType: 'work-plan' })).toHaveLength(1);
      expect(readEvents(db, { streamType: 'agent-node' })).toHaveLength(1); // seeded fixture only
      expect(readEvents(db, { streamType: 'agent-run' })).toHaveLength(1); // seeded fixture only
      expect(deps.dispatchQueue.list({ state: 'all' })).toHaveLength(0);
      expect(deps.dispatchWorker.poll).not.toHaveBeenCalled();
    });

    test('starts a captured WorkIntent through the daemon worker and returns an idempotent runtime receipt', async () => {
      await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope(),
      });
      const start = gatewayEnvelope({
        envelopeId: 'surface_gateway_pd_console_start_1',
        correlationId: 'corr_pd_console_start_1',
        operation: 'work-intent.start',
        idempotencyKey: 'pd-console:start:work_intent_pd_console_test_1',
        payload: gatewayEnvelope().payload,
      });

      const first = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: start,
      });
      const retry = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: start,
      });

      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({
        status: 'accepted',
        duplicate: false,
        intent: { intentId: 'work_intent_pd_console_test_1' },
        execution: {
          projection: 'dispatches-compatibility',
          state: 'claimed',
          launchedThisTick: 1,
        },
        nextAction: { code: 'WORK_RUNTIME_STARTED' },
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ status: 'confirmed', duplicate: true });
      expect(retry.json().execution.dispatchId).toBe(first.json().execution.dispatchId);
      expect(deps.dispatchQueue.list({ state: 'all' })).toHaveLength(1);
      expect(deps.dispatchWorker.poll).toHaveBeenCalledTimes(1);
      expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
      expect(readEvents(db, { streamType: 'work-plan' })).toHaveLength(1);
    });

    test('queries the durable snapshot through the same gateway', async () => {
      await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope(),
      });
      const query = gatewayEnvelope({
        envelopeId: 'surface_gateway_pd_console_query_1',
        mode: 'query',
        operation: 'work-intent.get',
        idempotencyKey: null,
        payload: { intentId: 'work_intent_pd_console_test_1' },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: query,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schema: 'pd.agent-harbor.surface-gateway.query-result.v0',
        data: {
          intent: { intentId: 'work_intent_pd_console_test_1' },
          plan: { planId: 'work_plan_pd_console_test_1', state: 'intent-captured' },
        },
      });
    });

    test('rejects legacy provenance and mismatched idempotency without writing', async () => {
      const legacy = gatewayEnvelope();
      legacy.payload.source = { kind: 'compat', legacyVerb: 'conjure', surface: 'pd-console' };
      const legacyResponse = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: legacy,
      });
      expect(legacyResponse.statusCode).toBe(400);
      expect(legacyResponse.json().code).toBe('WORK_INTENT_SOURCE_REJECTED');

      const mismatch = gatewayEnvelope();
      mismatch.payload.idempotencyKey = 'different-key';
      const mismatchResponse = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: mismatch,
      });
      expect(mismatchResponse.statusCode).toBe(400);
      expect(mismatchResponse.json().code).toBe('WORK_INTENT_IDEMPOTENCY_MISMATCH');
      expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(0);
      expect(readEvents(db, { streamType: 'work-plan' })).toHaveLength(0);
    });

    test('rejects provider selection from pd-console', async () => {
      const request = gatewayEnvelope();
      request.payload.provider = 'claude';
      const response = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: request,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('WORK_INTENT_PROVIDER_AUTHORITY_REJECTED');
      expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(0);
    });

    test('rejects malformed payloads and frontend-authored runtime nodes', async () => {
      const malformed = gatewayEnvelope();
      malformed.payload.goal = { text: '   ' };
      const malformedResponse = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: malformed,
      });
      expect(malformedResponse.statusCode).toBe(400);
      expect(malformedResponse.json().code).toBe('WORK_INTENT_PAYLOAD_REJECTED');

      const materialized = gatewayEnvelope();
      materialized.payload.nodeSpecs = [{ nodeId: 'frontend-invented-node' }];
      const materializedResponse = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: materialized,
      });
      expect(materializedResponse.statusCode).toBe(400);
      expect(materializedResponse.json().code).toBe(
        'WORK_INTENT_MATERIALIZATION_AUTHORITY_REJECTED',
      );
      expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(0);
      expect(readEvents(db, { streamType: 'work-plan' })).toHaveLength(0);
    });
  });

  describe('GET /agent-nodes (roster)', () => {
    test('serves the roster projection with a fresh envelope', async () => {
      const res = await app.inject({ method: 'GET', url: '/agent-nodes' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projection).toMatchObject({ name: 'roster', stale: false });
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        agent_node_id: NODE_ID,
        identity: 'port-daddy:contrib:auth-test-fix',
        compliance_level: 'C2', // witness-valid probe granted C2
        official_mode: 'official',
      });
    });

    test('labels a stale projection when refresh is declined, and default read catches up', async () => {
      appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 4 }) });

      const staleRes = await app.inject({ method: 'GET', url: '/agent-nodes?refresh=false' });
      expect(staleRes.json().projection.stale).toBe(true);

      const freshRes = await app.inject({ method: 'GET', url: '/agent-nodes' });
      expect(freshRes.json().projection.stale).toBe(false);
      expect(freshRes.json().projection.lastLedgerSeq).toBe(freshRes.json().projection.headSeq);
    });

    test('ignores unknown query params (tolerant reader)', async () => {
      const res = await app.inject({ method: 'GET', url: '/agent-nodes?futureParam=yes&other=1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });
  });

  describe('GET /agent-nodes/:id (detail join)', () => {
    test('joins roster, compliance, costs, receipts, and files touched', async () => {
      const res = await app.inject({ method: 'GET', url: `/agent-nodes/${NODE_ID}` });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.node.agent_node_id).toBe(NODE_ID);
      expect(data.compliance).toMatchObject({ agent_node_id: NODE_ID, witness_valid: 1 });
      expect(data.costs.length).toBeGreaterThan(0);
      expect(data.receipts).toHaveLength(1);
      expect(data.receipts[0].receipt_id).toBe('receipt_01JZFIX0001');
      expect(data.filesTouched.some((f) => f.path === 'lib/auth.ts')).toBe(true);
    });

    test('404s with a typed code for an unknown node', async () => {
      const res = await app.inject({ method: 'GET', url: '/agent-nodes/agent_node_NOPE' });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('AGENT_NODE_NOT_FOUND');
    });
  });

  describe('GET /agent-nodes/:id/files', () => {
    test('returns the files-touched projection for the node', async () => {
      const res = await app.inject({ method: 'GET', url: `/agent-nodes/${NODE_ID}/files` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projection.name).toBe('files-touched');
      const write = body.data.find((f) => f.touch_kind === 'write');
      expect(write).toMatchObject({ path: 'lib/auth.ts', absolute_path: '/repo/lib/auth.ts' });
    });
  });

  describe('GET /sessions/:id/events (paged history)', () => {
    test('pages the transcript timeline with a sequence cursor', async () => {
      const first = await app.inject({ method: 'GET', url: `/sessions/${SESSION_ID}/events?limit=2` });
      expect(first.statusCode).toBe(200);
      const page1 = first.json();
      expect(page1.data).toHaveLength(2);
      expect(page1.cursor.hasMore).toBe(true);
      expect(page1.data.map((r) => r.sequence)).toEqual([1, 2]);

      const second = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/events?limit=2&afterSequence=${page1.cursor.nextAfterSequence}`,
      });
      const page2 = second.json();
      expect(page2.data.map((r) => r.sequence)).toEqual([3]);
      expect(page2.cursor.hasMore).toBe(false);
    });

    test('unknown transcript kinds ride through the timeline (tolerant reader)', async () => {
      const res = await app.inject({ method: 'GET', url: `/sessions/${SESSION_ID}/events` });
      const kinds = res.json().data.map((r) => r.kind);
      expect(kinds).toContain('unknown_future_kind');
    });

    test('returns an empty page (not an error) for an unknown session', async () => {
      const res = await app.inject({ method: 'GET', url: '/sessions/session_NOPE/events' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  describe('GET /sessions/:id/events (SSE live tail)', () => {
    /**
     * inject() cannot exercise a hijacked reply, so the SSE contract is
     * verified over a real socket: connect, read the replay, append a new
     * ledger event, and watch the poll loop deliver it live.
     */
    test('streams replay + live events with SSE headers, id: fields, and Last-Event-ID resume', async () => {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address();

      const collect = (headers = {}) =>
        new Promise((resolve, reject) => {
          const chunks = [];
          const req = http.get(
            {
              host: '127.0.0.1',
              port,
              path: `/sessions/${SESSION_ID}/events`,
              headers: { accept: 'text/event-stream', ...headers },
            },
            (res) => {
              res.on('data', (c) => chunks.push(c.toString('utf8')));
              // Close after the live event window; the route must clean up on close.
              setTimeout(() => {
                req.destroy();
                resolve({ res, body: chunks.join('') });
              }, 350);
            },
          );
          req.on('error', (err) => (err.code === 'ECONNRESET' ? resolve({ res: null, body: chunks.join('') }) : reject(err)));
          // Live event lands after the initial replay has been written.
          setTimeout(() => {
            appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 9, kind: 'live_event' }) });
          }, 100);
        });

      const { res, body } = await collect();
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['x-accel-buffering']).toBe('no'); // the proxy-buffering trap, defused
      expect(body).toContain('retry: 5000');
      expect(body).toContain('id: evt_1'); // replay carries id: for Last-Event-ID
      expect(body).toContain('event: caught-up');
      expect(body).toContain('"kind":"live_event"'); // live tail delivered by the poll loop
      expect(body).toContain('id: evt_9');

      // Reconnect with Last-Event-ID: only events after evt_2 are replayed.
      const resumed = await collect({ 'last-event-id': 'evt_2' });
      expect(resumed.body).not.toContain('id: evt_1');
      expect(resumed.body).not.toContain('id: evt_2');
      expect(resumed.body).toContain('id: evt_3');
    });
  });

  describe('GET /costs', () => {
    test('returns cost summaries, filterable by agentNodeId', async () => {
      const res = await app.inject({ method: 'GET', url: `/costs?agentNodeId=${NODE_ID}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projection.name).toBe('costs');
      expect(body.data).toHaveLength(1);
      expect(body.data[0].agent_node_id).toBe(NODE_ID);
      expect(body.data[0].total_estimated_usd).toBeCloseTo(0.22);

      const miss = await app.inject({ method: 'GET', url: '/costs?agentNodeId=agent_node_NOPE' });
      expect(miss.json().data).toEqual([]);
    });
  });

  describe('GET /receipts/:id (hash-chain verification)', () => {
    test('verifies chain intactness and honestly fails a mismatched transcript head', async () => {
      // The fixture receipt commits to sha256:bbbb, which is NOT the real
      // ledger head — verification must say so instead of rubber-stamping.
      const res = await app.inject({ method: 'GET', url: '/receipts/receipt_01JZFIX0001' });
      expect(res.statusCode).toBe(200);
      const { verification } = res.json().data;
      expect(verification.chainIntact).toBe(true);
      expect(verification.headHashMatch).toBe(false);
      expect(verification.verified).toBe(false);
      expect(verification.receiptHeadHash).toBe('sha256:bbbb');
      expect(verification.ledgerHeadHash).toMatch(/^sha256:/);
    });

    test('verifies a receipt whose committed head matches the ledger chain head', async () => {
      const events = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION_ID });
      const trueHead = events[events.length - 1].content_hash;
      appendEvent(db, {
        streamType: 'work-receipt',
        payload: {
          ...fixture('work-receipt'),
          receiptId: 'receipt_TRUEHEAD',
          provenance: { ...fixture('work-receipt').provenance, transcriptHeadHash: trueHead },
        },
      });
      const res = await app.inject({ method: 'GET', url: '/receipts/receipt_TRUEHEAD' });
      const { verification } = res.json().data;
      expect(verification.chainIntact).toBe(true);
      expect(verification.headHashMatch).toBe(true);
      expect(verification.verified).toBe(true);
    });

    test('404s with a typed code for an unknown receipt', async () => {
      const res = await app.inject({ method: 'GET', url: '/receipts/receipt_NOPE' });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('RECEIPT_NOT_FOUND');
    });
  });

  describe('GET /compliance/:agentNodeId', () => {
    test('exposes the daemon-witnessed compliance record', async () => {
      const res = await app.inject({ method: 'GET', url: `/compliance/${NODE_ID}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projection.name).toBe('compliance');
      expect(body.data).toMatchObject({
        agent_node_id: NODE_ID,
        witness_valid: 1,
        asserted_level: 'C2',
      });
    });

    test('404s when no probe has been recorded', async () => {
      const res = await app.inject({ method: 'GET', url: '/compliance/agent_node_NOPE' });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('COMPLIANCE_NOT_FOUND');
    });
  });

  describe('error accounting', () => {
    test('read routes never mutated metrics.errors on the happy path', async () => {
      await app.inject({ method: 'GET', url: '/agent-nodes' });
      await app.inject({ method: 'GET', url: '/costs' });
      expect(deps.metrics.errors).toBe(0);
    });
  });
});
