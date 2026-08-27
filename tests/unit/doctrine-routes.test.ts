import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createDoctrineLedger } from '../../lib/doctrine.js';
import { doctrinePlugin } from '../../routes/doctrine.js';

const common = {
  projectDir: '/repo/port-daddy',
  citations: ['receipt:test:1'],
  credential: 'credential:pd-console',
};

const ledgerCommon = {
  ...common,
  actorId: 'actor:pd-console',
};

function replayContext(replicaId: string) {
  return {
    model: 'fixture-model',
    modelVersion: '2026-08-26',
    harness: 'fixture-harness',
    worktree: 'case13-worktree',
    environment: 'test',
    checkpoint: 'checkpoint:case13',
    replicaId,
  };
}

const actorSouls = {
  verifyCredential(credential: string) {
    return credential === 'credential:pd-console' ? 'actor:pd-console' : null;
  },
  resolveActor(actorId: string) {
    return {
      actorId,
      soulClass: actorId === 'actor:pd-console' ? 'operator' as const : 'unknown' as const,
    };
  },
};

describe('doctrine routes', () => {
  let db: DatabaseInstance;
  let app: ReturnType<typeof Fastify>;
  let doctrineId: string;

  beforeEach(async () => {
    db = initDatabase({ inMemory: true });
    const ledger = createDoctrineLedger(db, { now: () => new Date('2026-08-26T12:00:00.000Z') });
    const episode = ledger.recordEpisode({
      ...ledgerCommon,
      id: 'episode-route',
      decisionClass: 'integration.merge',
      summary: 'CASE-13 source episode',
      historicalAction: 'hold',
      fidelity: 'T5',
    });
    const candidate = ledger.proposeCandidate({
      ...ledgerCommon,
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
      ...ledgerCommon,
      id: 'experiment-route',
      candidateId: candidate.candidateId,
      hypothesis: 'technical evidence determines the choice',
      primaryOutcome: 'merge decision',
      control: 'thread only',
      treatment: 'technical concern',
    });
    ledger.recordTreatmentRun({ ...ledgerCommon, experimentId: experiment.experimentId, arm: 'control', action: 'merge', outcome: 'safe', fidelity: 'matched', replayContext: replayContext('replica:route:control') });
    ledger.recordTreatmentRun({ ...ledgerCommon, experimentId: experiment.experimentId, arm: 'treatment', action: 'hold', outcome: 'defect', fidelity: 'matched', replayContext: replayContext('replica:route:treatment') });
    doctrineId = ledger.admit({
      ...ledgerCommon,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    }).doctrineId;
    app = Fastify();
    await app.register(doctrinePlugin, { deps: { db, actorSouls } });
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
    expect(orders.json().receipt.actorId).toBe('actor:pd-console');

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

  it('harvests recurring exact-class episodes and retires a revision without deleting its detail', async () => {
    const recurrence = await app.inject({
      method: 'POST',
      url: '/doctrine/episodes',
      payload: {
        ...common,
        id: 'episode-route-recurrence',
        decisionClass: 'integration.merge',
        summary: 'A later merge decision separated an administrative review state from technical evidence.',
        historicalAction: 'inspect evidence',
        citations: ['receipt:route:recurrence'],
      },
    });
    expect(recurrence.statusCode).toBe(201);

    const harvest = await app.inject({
      method: 'POST',
      url: '/doctrine/harvests',
      payload: {
        ...common,
        id: 'harvest-route',
        decisionClass: 'integration.merge',
        episodeIds: ['episode-route', 'episode-route-recurrence'],
        summary: 'Two cited integration.merge episodes provide a bounded recurring observation set.',
        citations: ['receipt:route:harvest'],
      },
    });
    expect(harvest.statusCode).toBe(201);
    expect(harvest.json()).toMatchObject({
      success: true,
      advisory: true,
      harvest: { harvestId: 'harvest-route' },
    });

    const frozen = await app.inject({ method: 'GET', url: '/doctrine/harvests/harvest-route' });
    expect(frozen.statusCode).toBe(200);
    expect(frozen.json()).toMatchObject({
      success: true,
      advisory: true,
      harvest: {
        id: 'harvest-route',
        episodeIds: ['episode-route', 'episode-route-recurrence'],
        observations: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'episode-route', historicalAction: 'hold' }),
          expect.objectContaining({ episodeId: 'episode-route-recurrence', historicalAction: 'inspect evidence' }),
        ]),
      },
    });

    const retirement = await app.inject({
      method: 'POST',
      url: `/doctrine/${encodeURIComponent(doctrineId)}/retire`,
      payload: {
        ...common,
        reason: 'This route fixture retires the revision while retaining the evidence chain.',
        citations: ['receipt:route:retirement'],
      },
    });
    expect(retirement.statusCode).toBe(201);
    expect(retirement.json()).toMatchObject({
      success: true,
      advisory: true,
      retirement: { doctrineId },
    });

    const detail = await app.inject({ method: 'GET', url: `/doctrine/${encodeURIComponent(doctrineId)}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      doctrine: { status: 'retired', retirementReason: 'This route fixture retires the revision while retaining the evidence chain.' },
      episode: { id: 'episode-route' },
    });
    const orders = await app.inject({
      method: 'POST',
      url: '/doctrine/orders',
      payload: {
        ...common,
        id: 'retrieval-after-route-retirement',
        decisionId: 'decision-after-route-retirement',
        decisionClass: 'integration.merge',
        citations: ['receipt:route:next-decision'],
      },
    });
    expect(orders.statusCode).toBe(200);
    expect(orders.json().doctrines).toEqual([]);
  });

  it('requires a daemon-minted credential, derives durable identity, and returns a neutral replay-run receipt', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/doctrine/episodes',
      payload: {
        projectDir: '/repo/port-daddy',
        actorId: 'forged:actor',
        citations: ['receipt:forged'],
        id: 'episode-denied',
        decisionClass: 'integration.merge',
        summary: 'This write has no credential.',
        historicalAction: 'hold',
      },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ code: 'IDENTITY_CREDENTIAL_REQUIRED' });

    const written = await app.inject({
      method: 'POST',
      url: '/doctrine/episodes',
      headers: { 'x-actor-credential': 'credential:pd-console' },
      payload: {
        projectDir: common.projectDir,
        citations: common.citations,
        // The daemon verifies the credential and overwrites this unknown
        // self-asserted string; it is never retained as provenance.
        actorId: 'untrusted:body-claim',
        id: 'episode-derived-identity',
        decisionClass: 'integration.merge',
        summary: 'A pdc-compatible body need not provide the durable actor id.',
        historicalAction: 'inspect evidence',
      },
    });
    expect(written.statusCode).toBe(201);
    expect(written.json()).toMatchObject({ episode: { episodeId: 'episode-derived-identity' } });
    const episodes = await app.inject({ method: 'GET', url: '/doctrine/episodes' });
    expect(episodes.json().episodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'episode-derived-identity', actorId: 'actor:pd-console' }),
    ]));

    const run = await app.inject({
      method: 'POST',
      url: '/doctrine/experiments/experiment-route/runs',
      payload: {
        ...common,
        id: 'run-route-neutral',
        arm: 'sham',
        action: 'sham action',
        outcome: 'sham outcome',
        fidelity: 'matched',
        replayContext: replayContext('replica:route:sham'),
      },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({
      success: true,
      run: { runId: 'run-route-neutral', arm: 'sham' },
    });
    expect(run.json()).not.toHaveProperty('treatmentRun');

    const ledger = createDoctrineLedger(db, { now: () => new Date('2026-08-26T12:00:00.000Z') });
    const candidate = ledger.proposeCandidate({
      ...ledgerCommon,
      id: 'candidate-route-derived-reviewer',
      doctrineId: 'doctrine:route:derived-reviewer',
      episodeId: 'episode-route',
      decisionClass: 'integration.merge',
      title: 'Reviewer is server-derived',
      when: 'an admission arrives',
      prefer: 'use the credential principal',
      over: 'trusting a reviewer body claim',
      because: 'attribution is a daemon authority boundary',
    });
    const experiment = ledger.preregisterExperiment({
      ...ledgerCommon,
      id: 'experiment-route-derived-reviewer',
      candidateId: candidate.candidateId,
      hypothesis: 'The route stamps the verified reviewer.',
      primaryOutcome: 'reviewer provenance is non-forgeable',
      control: 'control',
      treatment: 'treatment',
    });
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...ledgerCommon,
        id: `run-route-derived-reviewer-${arm}`,
        experimentId: experiment.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext(`replica:route-derived-reviewer:${arm}`),
      });
    }
    const admitted = await app.inject({
      method: 'POST',
      url: `/doctrine/candidates/${encodeURIComponent(candidate.candidateId)}/admit`,
      payload: {
        ...common,
        experimentId: experiment.experimentId,
        reviewerId: 'forged:reviewer',
      },
    });
    expect(admitted.statusCode).toBe(201);
    const detail = await app.inject({ method: 'GET', url: '/doctrine/doctrine%3Aroute%3Aderived-reviewer' });
    expect(detail.json().doctrine.reviewerId).toBe('actor:pd-console');
  });
});
