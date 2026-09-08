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
import { createContinuationStore } from '../../lib/continuation-runtime.js';
import { createTranscripts } from '../../lib/transcripts.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { createContextContinuityCoordinator } from '../../lib/agent-harbor/context-continuity.js';
import { createSessions } from '../../lib/sessions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { resolveWriteIdentity, stampIdentityMetadata } from '../../lib/identity-write-boundary.js';
import { agentHarborPlugin } from '../../routes/agent-harbor.js';
import { getEffectiveContextWindow } from '../../lib/context-window-tracker.js';
import { resolveModel } from '../../lib/model-registry.js';

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

function buildApp(db, sse = {}, { withoutRequestIp = false, requestIp } = {}) {
  const app = Fastify();
  if (withoutRequestIp || requestIp !== undefined) {
    // Fastify normally supplies a string, but the local-only authority gate
    // must still fail closed if an adapter/proxy leaves that metadata absent or malformed.
    app.addHook('onRequest', (request, _reply, done) => {
      Object.defineProperty(request, 'ip', {
        configurable: true,
        value: withoutRequestIp ? undefined : requestIp,
      });
      done();
    });
  }
  const episodicMemory = createEpisodicMemory(db);
  const sessions = createSessions(db);
  const actorSouls = createTestActorSouls(db);
  const providerSessionBindings = new Map();
  const interactiveProviderSessionBinding = {
    resolve: jest.fn(({ provider, providerSessionId }) => (
      provider === 'claude' ? providerSessionBindings.get(providerSessionId) ?? null : null
    )),
  };
  const interactiveContextUsageWitness = { measure: jest.fn(() => null) };
  const interactiveToolPairWitness = {
    coverage: jest.fn(({ provider, sessionId, observationId }) => ({
      witness: 'daemon-adapter',
      status: 'complete',
      provider,
      sessionId,
      observationId,
      coveredThroughLedgerSeq: 0,
      coverageRef: 'route-test-complete-tool-pairs',
    })),
  };
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
    episodicMemory,
    gitleaksRunner: () => ({ findings: [] }),
    sessions,
    actorSouls,
    interactiveProviderSessionBinding,
    interactiveContextUsageWitness,
    interactiveToolPairWitness,
    metrics: { errors: 0 },
    logger: { info: jest.fn(), error: jest.fn() },
  };
  app.register(agentHarborPlugin, { deps, sse });
  return {
    app,
    deps,
    episodicMemory,
    sessions,
    actorSouls,
    providerSessionBindings,
    interactiveProviderSessionBinding,
    interactiveContextUsageWitness,
    interactiveToolPairWitness,
  };
}

function startInteractivePlanSession({
  sessions,
  actorSouls,
  providerSessionBindings,
  actor = mintTestActor(actorSouls),
  agentId = NODE_ID,
  note = '- [ ] Continue only from the cited plan',
} = {}) {
  const verdict = resolveWriteIdentity({
    souls: actorSouls,
    credential: actor.credential,
    assertedAgentId: null,
    route: 'POST /agent-harbor/interactive-context-pressure',
    requireIdentity: true,
  });
  if (!verdict.ok) throw new Error('test actor credential did not resolve');
  const started = sessions.start('interactive context plan', {
    agentId,
    project: 'port-daddy',
    worktreeId: 'route-test-worktree',
    metadata: stampIdentityMetadata(null, verdict),
  });
  if (!started.success) throw new Error(started.error);
  const noted = sessions.addNote(started.id, note, { type: 'todo_list' });
  if (!noted.success) throw new Error(noted.error);
  const providerSessionId = `claude-provider-${started.id}`;
  providerSessionBindings?.set(providerSessionId, { planSessionId: started.id });
  return { actor, sessionId: started.id, providerSessionId };
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
  let sessions;
  let actorSouls;
  let providerSessionBindings;
  let interactiveProviderSessionBinding;
  let interactiveContextUsageWitness;
  let interactiveToolPairWitness;

  beforeEach(async () => {
    db = initDatabase({ inMemory: true });
    seed(db);
    projectPending(db);
    ({
      app,
      deps,
      sessions,
      actorSouls,
      providerSessionBindings,
      interactiveProviderSessionBinding,
      interactiveContextUsageWitness,
      interactiveToolPairWitness,
    } = buildApp(db, { pollMs: 40, heartbeatMs: 200 }));
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

  describe('GET /agent-harbor/context-continuity', () => {
    test('projects verified context pressure and packet evidence for FleetBar', async () => {
      const coordinator = createContextContinuityCoordinator(db);
      coordinator.record({
        agentNodeId: NODE_ID,
        sessionId: SESSION_ID,
        runId: 'route-context-run',
        transcriptId: 'route-context-transcript',
        sourceAdapter: 'cli:codex',
        model: 'gpt-5',
        project: 'port-daddy',
        projectDir: '/repo',
        workdir: '/repo',
        windowTokens: 1_000,
        daemonUsedTokensEstimate: 950,
        adapterUsedTokensEstimate: 900,
        estimateMode: 'estimated',
        measuredAt: '2026-08-23T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-harbor/context-continuity?limit=10',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: 1,
        counts: { observed: 1, packetReady: 1, successorRequired: 1 },
        items: [{
          agentNodeId: NODE_ID,
          sessionId: SESSION_ID,
          readiness: 'successor-required',
          pressure: {
            band: 'critical',
            action: 'require_compaction_or_successor',
            strategy: 'max-daemon-and-adapter',
          },
          packet: { validatorPassed: true },
        }],
      });

      const matching = await app.inject({
        method: 'GET',
        url: '/agent-harbor/context-continuity?projectDir=%2Frepo',
      });
      const foreign = await app.inject({
        method: 'GET',
        url: '/agent-harbor/context-continuity?projectDir=%2Fother',
      });
      expect(matching.json().counts.observed).toBe(1);
      expect(foreign.json().counts.observed).toBe(0);
    });
  });

  describe('POST /agent-harbor/interactive-context-pressure', () => {
    function daemonMeasurement(tokensUsed = 850, effectiveMax = 1_000, measurementRef = 'route-test-measurement:1') {
      interactiveContextUsageWitness.measure.mockReturnValue({
        witness: 'daemon-adapter',
        model: 'claude-test',
        daemonUsedTokensEstimate: tokensUsed,
        windowTokens: effectiveMax,
        measurementRef,
      });
    }

    function requestPayload(providerSessionId, overrides = {}) {
      return {
        provider: 'claude',
        hookTrigger: 'manual',
        agentNodeId: NODE_ID,
        providerSessionId,
        ...overrides,
      };
    }

    test('fails closed before parsing or writing when request IP metadata is unavailable', async () => {
      const { app: noIpApp } = buildApp(db, {}, { withoutRequestIp: true });
      await noIpApp.ready();
      try {
        const response = await noIpApp.inject({
          method: 'POST',
          url: '/agent-harbor/interactive-context-pressure',
          payload: requestPayload('provider-session-without-ip'),
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_REMOTE_UNAVAILABLE' });
        expect(readEvents(db, { streamType: 'transcript-event' })
          .map((row) => row.kind)).not.toContain('context_pressure');
      } finally {
        await noIpApp.close();
      }
    });

    test.each([
      ['an empty string', ''],
      ['a non-string object', { forwarded: '127.0.0.1' }],
    ])('fails closed before parsing or writing when request IP metadata is %s', async (_label, requestIp) => {
      const { app: malformedIpApp } = buildApp(db, {}, { requestIp });
      await malformedIpApp.ready();
      try {
        const response = await malformedIpApp.inject({
          method: 'POST',
          url: '/agent-harbor/interactive-context-pressure',
          payload: requestPayload(`provider-session-${_label.replace(/\s+/g, '-')}`),
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_REMOTE_UNAVAILABLE' });
        expect(readEvents(db, { streamType: 'transcript-event' })
          .map((row) => row.kind)).not.toContain('context_pressure');
      } finally {
        await malformedIpApp.close();
      }
    });

    test('binds a credentialed hook to its durable plan session and returns only a bounded receipt', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement();

      const response = await app.inject({
        method: 'POST',
        url: '/agent-harbor/interactive-context-pressure',
        headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schema: 'pd.agent-harbor.interactive-context-pressure-result.v0',
        status: 'recorded',
        directive: { decision: 'allow', plan: 'checkpointed', riskyWork: 'restricted' },
        receipt: {
          pressure: 0.85,
          packet: { validatorPassed: true },
          handoff: 'not-projected',
        },
      });
      expect(response.payload.length).toBeLessThan(2_048);
      expect(response.payload).not.toContain('transcriptExcerpts');
      expect(response.payload).not.toContain('bootstrap');

      const pressure = readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .find((row) => row.kind === 'context_pressure');
      expect(pressure).toBeTruthy();
      const envelope = JSON.parse(pressure.payload_json).payloadJson.contextEnvelope;
      expect(envelope).toMatchObject({
        sessionId: plan.sessionId,
        agentNodeId: NODE_ID,
        usedTokensEstimate: 850,
        windowTokens: 1_000,
      });
    });

    test('refreshes Claude context pressure at turn start before packet issuance', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement(600, 1_000, 'claude-turn-start:1');

      const response = await app.inject({
        method: 'POST',
        url: '/agent-harbor/interactive-context-pressure',
        headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { hookTrigger: 'turn' }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'recorded',
        directive: {
          decision: 'allow',
          plan: 'checkpointed',
          riskyWork: 'allowed',
          continuation: 'normal',
          reason: expect.stringContaining('Prepare and checkpoint `pd plan`'),
        },
        receipt: {
          pressure: 0.6,
          packet: null,
          handoff: 'not-requested',
          replayed: false,
        },
      });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .map((row) => row.kind)).not.toContain('compaction_packet');
    });

    test('replays an unchanged Claude turn from the durable fallback rather than its own receipts', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      // Do not install an in-process adapter witness. The bounded fallback
      // estimates only provider-work rows, then must ignore its subsequently
      // written plan/coverage/context rows when deriving the next watermark.
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: {
          eventId: `evt_durable_fallback_${plan.sessionId}`,
          sessionId: plan.sessionId,
          agentNodeId: NODE_ID,
          sequence: 1,
          occurredAt: '2026-08-27T12:00:00.000Z',
          schemaVersion: 1,
          kind: 'operator_message',
          visibility: 'operator',
          payloadJson: { content: 'x'.repeat(300_000) },
        },
      });

      const first = await app.inject({
        method: 'POST',
        url: '/agent-harbor/interactive-context-pressure',
        headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { hookTrigger: 'turn' }),
      });
      const second = await app.inject({
        method: 'POST',
        url: '/agent-harbor/interactive-context-pressure',
        headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { hookTrigger: 'turn' }),
      });

      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        status: 'recorded',
        receipt: { packet: null, replayed: false },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({
        status: 'recorded',
        receipt: { packet: null, replayed: true },
      });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'context_pressure')).toHaveLength(1);
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'compaction_packet')).toHaveLength(0);
    });

    test('the daemon-default dependency shape reports provider-session-unbound without creating a record', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      deps.interactiveProviderSessionBinding = null; // server.ts supplies no binding until an adapter owns one.
      daemonMeasurement();

      const response = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'provider-session-unbound',
        capability: { provider: 'claude', preCompact: 'supported' },
        directive: { continuation: 'normal' },
        receipt: null,
        error: { code: 'INTERACTIVE_PROVIDER_SESSION_UNBOUND' },
      });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .map((row) => row.kind)).not.toContain('context_pressure');
    });

    test('does not let a stale ambient plan claim override the daemon provider-session binding', async () => {
      const providerA = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      const staleAmbientPlan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings, actor: providerA.actor });
      daemonMeasurement();

      const smuggled = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: providerA.actor.headers,
        payload: requestPayload(providerA.providerSessionId, { planCheckpoint: { sessionId: staleAmbientPlan.sessionId } }),
      });
      expect(smuggled.statusCode).toBe(400);
      expect(smuggled.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_REJECTED' });

      const bound = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: providerA.actor.headers,
        payload: requestPayload(providerA.providerSessionId),
      });
      expect(bound.statusCode).toBe(200);
      expect(bound.json()).toMatchObject({ status: 'recorded' });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: providerA.sessionId })
        .map((row) => row.kind)).toContain('context_pressure');
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: staleAmbientPlan.sessionId })
        .map((row) => row.kind)).not.toContain('context_pressure');
    });

    test('rejects missing or forged actor credentials before writing a context event', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement();
      const before = readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId }).length;

      const missing = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure',
        payload: requestPayload(plan.providerSessionId),
      });
      const forged = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure',
        headers: { 'x-actor-credential': 'forged.not-a-secret' },
        payload: requestPayload(plan.providerSessionId),
      });

      expect(missing.statusCode).toBe(401);
      expect(missing.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
      expect(forged.statusCode).toBe(401);
      expect(forged.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })).toHaveLength(before);
    });

    test('rejects a different soul even when it uses the same display agent handle', async () => {
      const owner = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings, agentId: NODE_ID });
      const intruder = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings, agentId: NODE_ID });
      daemonMeasurement();

      const response = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure',
        headers: intruder.actor.headers,
        payload: requestPayload(owner.providerSessionId),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_AUTHORITY_REJECTED' });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: owner.sessionId })
        .map((row) => row.kind)).not.toContain('context_pressure');
    });

    test('rejects caller-supplied usage, plan session claims, and unsupported provider claims', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement();
      const providerUsage = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { providerNativeUsage: { usedTokensEstimate: 999 } }),
      });
      const rawUsage = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { windowTokens: 1_000 }),
      });
      const malformedPlan = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId, { planCheckpoint: 'not-an-object' }),
      });
      const unsupported = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure',
        payload: { provider: 'not-a-provider' },
      });

      for (const response of [providerUsage, rawUsage, malformedPlan, unsupported]) {
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_REJECTED' });
      }
    });

    test('rejects every non-envelope field before auth or any ledger write', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement();
      const before = readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId }).length;
      for (const payload of [
        requestPayload(plan.providerSessionId, { transcript: 'raw predecessor text' }),
        requestPayload(plan.providerSessionId, { plan: 'smuggled plan text' }),
        requestPayload(plan.providerSessionId, { bufferedOutputRef: { id: 'private-blob' } }),
        requestPayload(plan.providerSessionId, { futureUncheckedField: true }),
      ]) {
        const response = await app.inject({
          method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers, payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: 'INTERACTIVE_CONTEXT_REJECTED' });
      }
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })).toHaveLength(before);
    });

    test('reports measurement unavailable rather than accepting a hook estimate', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      const response = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'measurement-unavailable',
        directive: { continuation: 'normal' },
        receipt: null,
      });
    });

    test('resolves the daemon-only Claude fallback through the canonical model tier', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          eventId: 'evt_daemon_only_interactive_measurement',
          sessionId: plan.sessionId,
          sequence: 1,
          kind: 'assistant_message',
          payloadJson: { content: 'Daemon-owned evidence for the bounded fallback.' },
        }),
      });

      const response = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'recorded' });
      const pressure = readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .find((row) => row.kind === 'context_pressure');
      const envelope = JSON.parse(pressure.payload_json).payloadJson.contextEnvelope;
      const expectedModel = resolveModel({ backend: 'anthropic', tier: 'mid' });
      expect(envelope).toMatchObject({
        model: expectedModel,
        windowTokens: getEffectiveContextWindow(expectedModel),
      });
    });

    test('withholds a packet by default when no in-process tool-pair witness is wired', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement();
      deps.interactiveToolPairWitness = null;

      const response = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'rejected',
        error: { code: 'TOOL_PAIR_COVERAGE_UNAVAILABLE' },
        directive: { continuation: 'packet-withheld' },
        receipt: null,
      });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .map((row) => row.kind)).not.toContain('compaction_packet');
    });

    test('evolves a server-derived observation when the trusted measurement rises, but replays an exact retry', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      daemonMeasurement(850, 1_000);
      const first = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      daemonMeasurement(950, 1_000);
      const elevated = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      const retry = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      expect(first.json()).toMatchObject({ status: 'recorded', receipt: { pressure: 0.85, replayed: false } });
      expect(elevated.json()).toMatchObject({
        status: 'recorded',
        directive: { continuation: 'governed-successor' },
        receipt: { pressure: 0.95, replayed: false },
      });
      expect(retry.json()).toMatchObject({ status: 'recorded', receipt: { pressure: 0.95, replayed: true } });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'context_pressure')).toHaveLength(2);
    });

    test('distinguishes a later daemon measurement watermark at unchanged usage and replays only its exact retry', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings });
      let coverageWatermark = 1;
      interactiveToolPairWitness.coverage.mockImplementation(({ provider, sessionId, observationId }) => ({
        witness: 'daemon-adapter',
        status: 'complete',
        provider,
        sessionId,
        observationId,
        coveredThroughLedgerSeq: coverageWatermark,
        coverageRef: `route-test-tool-pairs:${coverageWatermark}`,
      }));

      daemonMeasurement(850, 1_000, 'adapter-observation:1');
      const first = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      // A later tool-pair witness may have the same rounded token estimate.
      // Its daemon-owned observation watermark, rather than a provider payload
      // timestamp, makes this a distinct compaction boundary.
      coverageWatermark = 2;
      daemonMeasurement(850, 1_000, 'adapter-observation:2');
      const later = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      const retry = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });

      expect(first.json()).toMatchObject({ status: 'recorded', receipt: { replayed: false } });
      expect(later.json()).toMatchObject({ status: 'recorded', receipt: { replayed: false } });
      expect(retry.json()).toMatchObject({ status: 'recorded', receipt: { replayed: true } });
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'context_pressure')).toHaveLength(2);
      expect(readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'compaction_packet')).toHaveLength(2);
    });

    test('uses a revised durable pd plan as a new packet authority at unchanged pressure', async () => {
      const plan = startInteractivePlanSession({ sessions, actorSouls, providerSessionBindings, note: '- [ ] Original plan authority' });
      daemonMeasurement(850, 1_000);
      const first = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      expect(first.statusCode).toBe(200);
      const updated = sessions.addNote(plan.sessionId, '- [ ] Revised plan authority', { type: 'todo_list' });
      expect(updated.success).toBe(true);
      const second = await app.inject({
        method: 'POST', url: '/agent-harbor/interactive-context-pressure', headers: plan.actor.headers,
        payload: requestPayload(plan.providerSessionId),
      });
      expect(second.statusCode).toBe(200);
      expect(first.json().receipt.replayed).toBe(false);
      expect(second.json().receipt.replayed).toBe(false);
      const packets = readEvents(db, { streamType: 'transcript-event', sessionId: plan.sessionId })
        .filter((row) => row.kind === 'compaction_packet');
      expect(packets).toHaveLength(2);
      expect(JSON.parse(packets[1].payload_json).payloadJson.identity.operatorInstructions)
        .toEqual(['- [ ] Revised plan authority']);
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
          projection: 'governed-mission',
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

    test('rehydrates the mission artifact and current PR checks on the same snapshot', async () => {
      await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope(),
      });
      const start = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: gatewayEnvelope({
          envelopeId: 'surface_gateway_pd_console_start_artifact',
          correlationId: 'corr_pd_console_start_artifact',
          operation: 'work-intent.start',
          idempotencyKey: 'pd-console:start:work_intent_pd_console_test_1',
          payload: gatewayEnvelope().payload,
        }),
      });
      const dispatchId = start.json().execution.dispatchId;
      deps.dispatchQueue.start(dispatchId);
      deps.dispatchQueue.settle({
        id: dispatchId,
        state: 'settled',
        resultArtifact: 'https://github.com/port-daddy/port-daddy/pull/123',
      });
      deps.missionArtifactStatus = jest.fn(async () => ({
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        failingChecks: [],
        pendingChecks: ['visual-artifact'],
        unresolvedThreads: 0,
        threadsUnknown: false,
        fetchError: null,
      }));

      const query = gatewayEnvelope({
        envelopeId: 'surface_gateway_pd_console_query_artifact',
        mode: 'query',
        operation: 'work-intent.list',
        idempotencyKey: null,
        payload: { limit: 1, includeArtifactStatus: true },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/agent-harbor/surface-gateway',
        payload: query,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data[0].execution).toMatchObject({
        dispatchId,
        state: 'settled',
        resultArtifact: 'https://github.com/port-daddy/port-daddy/pull/123',
        artifactStatus: {
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          pendingChecks: ['visual-artifact'],
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

  describe('GET /harness-adapters/continuation-matrix', () => {
    test('separates catalog mechanics from durable spawn and handoff witnesses', async () => {
      const now = Date.now();
      const transcripts = createTranscripts(db);
      const transcriptId = transcripts.start({
        id: 'tx-harness-matrix-codex',
        ship: 'spawn:cli:codex',
        spawned_agent_id: 'spawned-harness-matrix',
        trigger: 'manual',
        backend: 'cli:codex',
        model: 'gpt-test',
        started_at: now - 1_000,
      });
      transcripts.finalize(transcriptId, { status: 'completed', ended_at: now });

      const continuationStore = createContinuationStore(db, {
        ownerId: 'harness-matrix-route-test',
        now: () => now,
      });
      const accepted = continuationStore.accept({
        idempotencyKey: 'harness-matrix-route-handoff',
        sourceEpisodeId: 1,
        sourceCapsuleId: 'capsule-harness-matrix',
        mode: 'handoff',
        sourceAdapter: 'claude-code',
        sourceSessionId: '11111111-1111-4111-8111-111111111111',
        targetAdapter: 'codex-cli',
        requestedBackend: 'cli:codex',
        effectiveBackend: 'cli:codex',
        promptHash: 'a'.repeat(64),
      });
      continuationStore.markCompleted(accepted.receipt.id, {
        successorRunId: 'spawned-successor',
        successorSessionId: '22222222-2222-4222-8222-222222222222',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/harness-adapters/continuation-matrix',
      });

      expect(response.statusCode).toBe(200);
      const report = response.json().data;
      expect(report).toMatchObject({
        schema: 'pd.agent-harbor.harness-continuation-matrix.v0',
        evidencePolicy: {
          numericBadgeGranted: false,
          selfReportCanAdvance: false,
          discoveryProvesRuntime: false,
        },
        summary: {
          adapterFamilies: 17,
          paths: 289,
          nativePaths: 4,
          handoffPaths: 285,
          witnessedPaths: 1,
        },
      });
      expect(report.adapters.find((row) => row.family === 'codex-cli').predicates.spawn).toMatchObject({
        status: 'witnessed',
        basis: 'durable-transcript',
        witnessId: transcriptId,
        freshness: 'fresh',
      });
      expect(report.adapters.find((row) => row.family === 'codex-cli').predicates['live-interaction']).toMatchObject({
        status: 'unverified',
      });
      expect(report.compatibility.find((cell) => (
        cell.sourceFamily === 'claude-code' && cell.targetFamily === 'codex-cli'
      ))).toMatchObject({
        autoMode: 'handoff',
        witness: expect.objectContaining({
          status: 'witnessed',
          basis: 'continuation-receipt',
        }),
      });
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
