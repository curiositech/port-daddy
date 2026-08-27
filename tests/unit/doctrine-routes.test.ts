import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createDoctrineLedger } from '../../lib/doctrine.js';
import { doctrinePlugin } from '../../routes/doctrine.js';

const common = {
  projectDir: '/repo/port-daddy',
  actorId: 'agent:test',
  citations: ['receipt:test:1'],
};

describe('doctrine routes', () => {
  let db: DatabaseInstance;
  let app: ReturnType<typeof Fastify>;
  let doctrineId: string;

  beforeEach(async () => {
    db = initDatabase({ inMemory: true });
    const ledger = createDoctrineLedger(db, { now: () => new Date('2026-08-26T12:00:00.000Z') });
    const episode = ledger.recordEpisode({
      ...common,
      id: 'episode-route',
      decisionClass: 'integration.merge',
      summary: 'CASE-13 source episode',
      historicalAction: 'hold',
      fidelity: 'T5',
    });
    const candidate = ledger.proposeCandidate({
      ...common,
      id: 'candidate-route',
      doctrineId: 'doctrine:route',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      title: 'Evidence over ritual',
      when: 'review state and technical evidence disagree',
      prefer: 'inspect the technical evidence',
      over: 'blocking only on thread state',
      because: 'administrative state is not a defect signal',
    });
    const experiment = ledger.preregisterExperiment({
      ...common,
      id: 'experiment-route',
      candidateId: candidate.candidateId,
      hypothesis: 'technical evidence determines the choice',
      primaryOutcome: 'merge decision',
      control: 'thread only',
      treatment: 'technical concern',
    });
    ledger.recordTreatmentRun({ ...common, experimentId: experiment.experimentId, arm: 'control', action: 'merge', outcome: 'safe', fidelity: 'matched' });
    ledger.recordTreatmentRun({ ...common, experimentId: experiment.experimentId, arm: 'treatment', action: 'hold', outcome: 'defect', fidelity: 'matched' });
    doctrineId = ledger.admit({
      ...common,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    }).doctrineId;
    app = Fastify();
    await app.register(doctrinePlugin, { deps: { db } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
  });

  it('returns advisory orders, persists a receipt, then accepts application and outcome read-back', async () => {
    const orders = await app.inject({
      method: 'POST',
      url: '/doctrine/orders',
      payload: {
        ...common,
        actorId: 'agent:next-steward',
        id: 'retrieval-route',
        decisionId: 'decision-route',
        decisionClass: 'integration.merge',
        citations: ['receipt:next-decision'],
      },
    });
    expect(orders.statusCode).toBe(200);
    expect(orders.json()).toMatchObject({
      success: true,
      advisory: true,
      retrievalPolicy: 'structured-exact-decision-class',
      receipt: { id: 'retrieval-route', doctrineIds: [doctrineId] },
    });

    const application = await app.inject({
      method: 'POST',
      url: '/doctrine/retrievals/retrieval-route/application',
      payload: {
        ...common,
        id: 'application-route',
        doctrineId,
        response: 'adapt',
        decision: 'inspect the technical claim and resolve the administrative thread separately',
        citations: ['receipt:application'],
      },
    });
    expect(application.statusCode).toBe(201);

    const outcome = await app.inject({
      method: 'POST',
      url: '/doctrine/applications/application-route/outcome',
      payload: {
        ...common,
        id: 'outcome-route',
        verdict: 'helped',
        summary: 'The technical evidence was checked without a ritual block.',
        verifiedBy: 'receipt:CI',
        citations: ['receipt:CI'],
      },
    });
    expect(outcome.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/doctrine/${encodeURIComponent(doctrineId)}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      success: true,
      applications: [{ id: 'application-route', response: 'adapt' }],
      outcomes: [{ id: 'outcome-route', verdict: 'helped' }],
    });
  });

  it('rejects a retrieval response for a doctrine that was never shown', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/doctrine/retrievals/not-a-receipt/application',
      payload: {
        ...common,
        doctrineId,
        response: 'follow',
        decision: 'merge',
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatch(/retrieval receipt/);
  });
});
