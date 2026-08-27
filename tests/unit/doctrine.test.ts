import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import {
  createDoctrineLedger,
  DoctrineStateError,
  type DoctrineInputBase,
} from '../../lib/doctrine.js';
import { readEvents } from '../../lib/agent-harbor/event-ledger.js';

const NOW = new Date('2026-08-26T12:00:00.000Z');
const base: DoctrineInputBase = {
  projectDir: '/repo/port-daddy',
  actorId: 'agent:steward',
  citations: ['receipt:case13:timeline'],
  provenance: { model: 'test-model', harness: 'fixture', worktree: 'case13' },
};

describe('empirically earned fleet doctrine', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  function makeLedger() {
    return createDoctrineLedger(db, { now: () => NOW });
  }

  function replayContext(replicaId: string, overrides: Partial<Record<string, string>> = {}) {
    return {
      model: 'fixture-model',
      modelVersion: '2026-08-26',
      harness: 'fixture-harness',
      worktree: 'case13-worktree',
      environment: 'test',
      checkpoint: 'checkpoint:case13',
      replicaId,
      ...overrides,
    };
  }

  function seedCandidate() {
    const ledger = makeLedger();
    const episode = ledger.recordEpisode({
      ...base,
      id: 'episode_case13',
      decisionClass: 'integration.merge',
      summary: 'A Steward held a merge because an automated review thread remained unresolved.',
      historicalAction: 'hold',
      alternatives: ['merge', 'inspect evidence', 'resolve thread'],
      cues: ['unresolved bot thread', 'green CI'],
      fidelity: 'T5',
    });
    const candidate = ledger.proposeCandidate({
      ...base,
      id: 'candidate_case13',
      doctrineId: 'doctrine:integration:independent-evidence',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      title: 'Independent evidence outranks administrative review state',
      when: 'an integration decision has an unresolved review artifact',
      prefer: 'inspect independent technical evidence before blocking or merging',
      over: 'treating the unresolved thread itself as dispositive',
      because: 'technical objections and administrative state have different predictive value',
      unless: ['the review artifact is independently verified as a substantive objection'],
      school: 'evidence',
      skillRefs: ['port-daddy-agent-skill'],
    });
    return { ledger, episode, candidate };
  }

  function admitCandidate(ledger: ReturnType<typeof makeLedger>, candidateId: string, prefix: string) {
    const experiment = ledger.preregisterExperiment({
      ...base,
      id: `experiment_${prefix}`,
      candidateId,
      hypothesis: `${prefix} candidate is tested with factual evidence`,
      primaryOutcome: 'decision quality',
      control: `${prefix} control`,
      treatment: `${prefix} treatment`,
    });
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        id: `run_${prefix}_${arm}`,
        experimentId: experiment.experimentId,
        arm,
        action: `${prefix} ${arm} action`,
        outcome: `${prefix} ${arm} outcome`,
        fidelity: 'matched',
        replayContext: replayContext(`replica:${prefix}:${arm}`),
      });
    }
    return ledger.admit({
      ...base,
      idempotencyKey: `admit:${prefix}`,
      candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    });
  }

  it('closes the CASE-13 cycle with a retrieval receipt, response, and verified outcome', () => {
    const { ledger, candidate } = seedCandidate();
    const experiment = ledger.preregisterExperiment({
      ...base,
      id: 'experiment_case13',
      candidateId: candidate.candidateId,
      hypothesis: 'Decision changes with independent technical evidence, not merely thread state.',
      primaryOutcome: 'merge/hold decision and defect detection',
      control: 'technical concern absent; review thread unresolved',
      treatment: 'technical concern present; review thread resolved',
      sham: 'technical concern absent; review thread resolved',
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'control',
      action: 'merge',
      outcome: 'no substantive concern found',
      fidelity: 'matched',
      replayContext: replayContext('replica:case13:control'),
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'treatment',
      action: 'hold and investigate',
      outcome: 'substantive defect identified',
      fidelity: 'matched',
      replayContext: replayContext('replica:case13:treatment'),
    });
    const admission = ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    });

    const packet = ledger.retrieve({
      ...base,
      id: 'retrieval_case13',
      actorId: 'agent:steward-next-run',
      decisionId: 'decision_next_merge',
      decisionClass: 'integration.merge',
      citations: ['receipt:next-merge:decision-context'],
    });
    expect(packet.advisory).toBe(true);
    expect(packet.retrievalPolicy).toBe('structured-exact-decision-class');
    expect(packet.doctrines.map((item) => item.doctrineId)).toEqual([admission.doctrineId]);

    const application = ledger.recordApplication({
      ...base,
      id: 'application_case13',
      retrievalId: packet.receipt.id,
      doctrineId: admission.doctrineId,
      response: 'follow',
      decision: 'inspect the comment’s technical claim, then merge if it is disproven',
      citations: ['receipt:next-merge:investigation'],
    });
    ledger.recordOutcome({
      ...base,
      id: 'outcome_case13',
      applicationId: application.applicationId,
      verdict: 'helped',
      summary: 'The team avoided a ritual block and retained a technical-evidence check.',
      verifiedBy: 'receipt:next-merge:CI-and-review',
      citations: ['receipt:next-merge:CI-and-review'],
    });

    const detail = ledger.getDoctrine(admission.doctrineId);
    expect(detail?.episode?.id).toBe('episode_case13');
    expect(detail?.experiment?.runs).toHaveLength(2);
    expect(detail?.retrievals.map((item) => item.id)).toEqual(['retrieval_case13']);
    expect(detail?.applications.map((item) => item.response)).toEqual(['follow']);
    expect(detail?.outcomes.map((item) => item.verdict)).toEqual(['helped']);

    const kinds = readEvents(db, { streamType: 'doctrine-evidence' }).map((event) => event.kind);
    expect(kinds).toEqual([
      'decision_episode_recorded',
      'doctrine_candidate_induced',
      'experiment_preregistered',
      'treatment_run_recorded',
      'treatment_run_recorded',
      'doctrine_revision_admitted',
      'doctrine_retrieved',
      'doctrine_applied',
      'outcome_recorded',
    ]);
  });

  it('refuses to promote a prompt-only or unmatched counterfactual', () => {
    const { ledger, candidate } = seedCandidate();
    const experiment = ledger.preregisterExperiment({
      ...base,
      candidateId: candidate.candidateId,
      hypothesis: 'A thread-state-only perturbation explains the historical hold.',
      primaryOutcome: 'merge/hold decision',
      control: 'historical replay',
      treatment: 'masked prompt replay',
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'control',
      action: 'hold',
      outcome: 'replay diverged before the decision',
      fidelity: 'mismatched',
      replayContext: replayContext('replica:unmatched:control'),
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'treatment',
      action: 'merge',
      outcome: 'prompt masking changed unrelated context',
      fidelity: 'mismatched',
      replayContext: replayContext('replica:unmatched:treatment'),
    });
    expect(() => ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(DoctrineStateError);
  });

  it('returns the original durable entity on an idempotent retry', () => {
    const ledger = makeLedger();
    const input = {
      ...base,
      idempotencyKey: 'case13:episode:ambiguous-retry',
      decisionClass: 'integration.merge',
      summary: 'An interrupted caller retries a CASE-13 episode write.',
      historicalAction: 'hold',
    };
    const first = ledger.recordEpisode(input);
    const retry = ledger.recordEpisode(input);

    expect(retry.duplicate).toBe(true);
    expect(retry.episodeId).toBe(first.episodeId);
    expect(readEvents(db, { streamType: 'doctrine-evidence' })).toHaveLength(1);
  });

  it('makes contradiction a visible lifecycle event instead of erasing the prior claim', () => {
    const { ledger, candidate } = seedCandidate();
    const experiment = ledger.preregisterExperiment({
      ...base,
      candidateId: candidate.candidateId,
      hypothesis: 'independent evidence is discriminative',
      primaryOutcome: 'decision quality',
      control: 'control',
      treatment: 'treatment',
    });
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        experimentId: experiment.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext(`replica:contradiction:${arm}`),
      });
    }
    const admitted = ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    });
    expect(() => ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      doctrineId: 'doctrine:rewritten-history',
      reviewerId: 'agent:admiralty',
    })).toThrow(/cannot replace a candidate doctrineId/);
    ledger.contest({
      ...base,
      doctrineId: admitted.doctrineId,
      reason: 'A verified contrary merge showed an administrative signal was the relevant cue.',
      severity: 'high',
      citations: ['receipt:contradiction:1'],
    });
    expect(ledger.getDoctrine(admitted.doctrineId)?.doctrine.status).toBe('contested');
    expect(ledger.listCandidates({ status: 'contested' })).toHaveLength(1);
  });

  it('harvests recurring exact-class evidence and supersedes only through an explicitly cited successor', () => {
    const { ledger, episode, candidate } = seedCandidate();
    const oldRevision = admitCandidate(ledger, candidate.candidateId, 'case13-old');
    const recurrence = ledger.recordEpisode({
      ...base,
      id: 'episode_case13_recurrence',
      decisionClass: 'integration.merge',
      summary: 'A later Steward checked technical evidence before treating an unresolved review artifact as blocking.',
      historicalAction: 'inspect evidence before holding',
      alternatives: ['block on thread state', 'merge without inspection'],
      cues: ['unresolved review artifact', 'green CI', 'technical claim inspected'],
      fidelity: 'T5',
      citations: ['receipt:case13:recurrence'],
    });
    const harvest = ledger.harvest({
      ...base,
      id: 'harvest_case13_recurring_merges',
      decisionClass: 'integration.merge',
      episodeIds: [episode.episodeId, recurrence.episodeId],
      summary: 'Two cited integration.merge episodes show review state and independent technical evidence must be distinguished.',
      citations: ['receipt:case13:harvest-review'],
    });
    const frozen = ledger.getHarvest(harvest.harvestId);
    expect(frozen).toMatchObject({
      id: 'harvest_case13_recurring_merges',
      decisionClass: 'integration.merge',
      episodeIds: ['episode_case13', 'episode_case13_recurrence'],
    });
    expect(frozen?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ episodeId: 'episode_case13', citations: ['receipt:case13:timeline'] }),
      expect.objectContaining({ episodeId: 'episode_case13_recurrence', citations: ['receipt:case13:recurrence'] }),
    ]));
    expect(() => ledger.harvest({
      ...base,
      id: 'harvest_case13_wrong_project',
      projectDir: '/repo/another-project',
      decisionClass: 'integration.merge',
      episodeIds: [episode.episodeId, recurrence.episodeId],
      summary: 'This must fail because harvests never cross project scope.',
      citations: ['receipt:case13:wrong-project'],
    })).toThrow(/share the caller projectDir/);
    expect(() => ledger.harvest({
      ...base,
      id: 'harvest_case13_wrong_class',
      decisionClass: 'release.deploy',
      episodeIds: [episode.episodeId, recurrence.episodeId],
      summary: 'This must fail because a harvest is exact-decision-class only.',
      citations: ['receipt:case13:wrong-class'],
    })).toThrow(/exact structured decisionClass/);

    const successorCandidate = ledger.proposeCandidate({
      ...base,
      id: 'candidate_case13_revision_two',
      doctrineId: 'doctrine:integration:independent-evidence:v2',
      episodeId: recurrence.episodeId,
      harvestId: harvest.harvestId,
      supersedesDoctrineId: oldRevision.doctrineId,
      decisionClass: 'integration.merge',
      title: 'Independent technical evidence is a conditional merge cue',
      when: 'a review artifact remains unresolved but its technical claim can be independently inspected',
      prefer: 'inspect the claim and weigh evidence directly',
      over: 'treating an administrative review state as a complete veto',
      because: 'the harvest distinguishes recurring technical and administrative signals',
      citations: ['receipt:case13:revision-candidate'],
    });
    const successor = admitCandidate(ledger, successorCandidate.candidateId, 'case13-new');
    const supersessionInput = {
      ...base,
      doctrineId: oldRevision.doctrineId,
      successorDoctrineId: successor.doctrineId,
      reason: 'The recurring harvest supports a narrower evidence-first revision.',
      citations: ['receipt:case13:supersession'],
    };
    const supersession = ledger.supersede(supersessionInput);
    const supersessionRetry = ledger.supersede(supersessionInput);

    expect(supersession).toMatchObject({
      doctrineId: oldRevision.doctrineId,
      successorDoctrineId: successor.doctrineId,
    });
    expect(supersessionRetry.duplicate).toBe(true);
    const oldDetail = ledger.getDoctrine(oldRevision.doctrineId);
    expect(oldDetail?.doctrine).toMatchObject({
      status: 'retired',
      supersededByDoctrineId: successor.doctrineId,
      retirementReason: 'The recurring harvest supports a narrower evidence-first revision.',
    });
    expect(oldDetail?.successor?.doctrineId).toBe(successor.doctrineId);
    expect(ledger.getDoctrine(successor.doctrineId)).toMatchObject({
      doctrine: {
        doctrineId: successor.doctrineId,
        harvestId: harvest.harvestId,
        supersedesDoctrineId: oldRevision.doctrineId,
        status: 'provisional',
      },
      harvest: {
        id: harvest.harvestId,
        observations: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'episode_case13' }),
          expect.objectContaining({ episodeId: 'episode_case13_recurrence' }),
        ]),
      },
      supersededDoctrine: { doctrineId: oldRevision.doctrineId, status: 'retired' },
      successor: null,
    });

    const orders = ledger.retrieve({
      ...base,
      id: 'retrieval_after_case13_supersession',
      decisionId: 'decision_after_case13_supersession',
      decisionClass: 'integration.merge',
      citations: ['receipt:case13:next-decision'],
    });
    expect(orders.doctrines.map((item) => item.doctrineId)).toEqual([successor.doctrineId]);
    expect(orders.doctrines.map((item) => item.doctrineId)).not.toContain(oldRevision.doctrineId);
    expect(readEvents(db, { streamType: 'doctrine-evidence' }).map((event) => event.kind)).toContain('doctrine_harvested');
    expect(readEvents(db, { streamType: 'doctrine-evidence' }).map((event) => event.kind)).toContain('doctrine_superseded');
  });

  it('refuses to retire an active revision through an unlinked successor, while direct retirement preserves history', () => {
    const { ledger, candidate } = seedCandidate();
    const active = admitCandidate(ledger, candidate.candidateId, 'unlinked-old');
    const unlinkedCandidate = ledger.proposeCandidate({
      ...base,
      id: 'candidate_unlinked_successor',
      doctrineId: 'doctrine:integration:unlinked-successor',
      episodeId: 'episode_case13',
      decisionClass: 'integration.merge',
      title: 'A different merge heuristic without a predecessor link',
      when: 'an unrelated merge context appears',
      prefer: 'inspect a separate signal',
      over: 'the old heuristic',
      because: 'this fixture exercises the invalid supersession gate',
      citations: ['receipt:case13:unlinked-successor'],
    });
    const unlinked = admitCandidate(ledger, unlinkedCandidate.candidateId, 'unlinked-new');

    expect(() => ledger.supersede({
      ...base,
      doctrineId: active.doctrineId,
      successorDoctrineId: unlinked.doctrineId,
      reason: 'This must fail because no structural predecessor citation exists.',
      citations: ['receipt:case13:invalid-supersession'],
    })).toThrow(/explicitly cites/);
    expect(ledger.getDoctrine(active.doctrineId)?.doctrine.status).toBe('provisional');

    const retirementInput = {
      ...base,
      doctrineId: active.doctrineId,
      reason: 'The active revision is retired pending a properly linked successor.',
      citations: ['receipt:case13:manual-retirement'],
    };
    const retirement = ledger.retire(retirementInput);
    const retirementRetry = ledger.retire(retirementInput);
    expect(retirement.duplicate).toBe(false);
    expect(retirementRetry.duplicate).toBe(true);
    expect(ledger.getDoctrine(active.doctrineId)?.doctrine).toMatchObject({
      status: 'retired',
      retirementReason: 'The active revision is retired pending a properly linked successor.',
    });
    const orders = ledger.retrieve({
      ...base,
      id: 'retrieval_after_manual_retirement',
      decisionId: 'decision_after_manual_retirement',
      decisionClass: 'integration.merge',
      citations: ['receipt:case13:post-retirement-decision'],
    });
    expect(orders.doctrines.map((item) => item.doctrineId)).toEqual([unlinked.doctrineId]);
    expect(readEvents(db, { streamType: 'doctrine-evidence' }).map((event) => event.kind)).toContain('doctrine_retired');
  });

  it('keeps episode, candidate, doctrine, and experiment identities immutable while preserving canonical retries', () => {
    const ledger = makeLedger();
    const episodeInput = {
      ...base,
      id: 'episode-immutable',
      idempotencyKey: 'episode:immutable:one',
      decisionClass: 'integration.merge',
      summary: 'The original immutable episode.',
      historicalAction: 'inspect evidence',
    };
    const episode = ledger.recordEpisode(episodeInput);
    expect(ledger.recordEpisode(episodeInput)).toMatchObject({ duplicate: true, episodeId: episode.episodeId });
    expect(() => ledger.recordEpisode({
      ...episodeInput,
      summary: 'A changed body cannot reuse the original episode idempotency key.',
    })).toThrow(/idempotencyKey.*conflicts/);
    expect(() => ledger.recordEpisode({
      ...episodeInput,
      idempotencyKey: 'episode:immutable:conflict',
      summary: 'A conflicting rewrite must not replace the factual episode.',
    })).toThrow(/already exists/);

    const candidateInput = {
      ...base,
      id: 'candidate-immutable',
      idempotencyKey: 'candidate:immutable:one',
      doctrineId: 'doctrine:immutable',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      title: 'Immutable identity test',
      when: 'a factual episode exists',
      prefer: 'preserve entity identity',
      over: 'overwrite a prior entity',
      because: 'the ledger is append-only',
    };
    const candidate = ledger.proposeCandidate(candidateInput);
    expect(ledger.proposeCandidate(candidateInput)).toMatchObject({ duplicate: true, candidateId: candidate.candidateId });
    expect(() => ledger.proposeCandidate({
      ...candidateInput,
      title: 'A changed body cannot reuse the original candidate idempotency key.',
    })).toThrow(/idempotencyKey.*conflicts/);
    expect(() => ledger.proposeCandidate({
      ...candidateInput,
      idempotencyKey: 'candidate:immutable:conflict',
      title: 'Conflicting candidate rewrite',
    })).toThrow(/already exists/);
    expect(() => ledger.proposeCandidate({
      ...candidateInput,
      id: 'candidate-different-id',
      idempotencyKey: 'candidate:immutable:doctrine-conflict',
    })).toThrow(/doctrineId/);

    const generatedCandidateInput = {
      ...base,
      idempotencyKey: 'candidate:generated:canonical-retry',
      doctrineId: 'doctrine:generated-canonical-retry',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      title: 'Generated candidate identity remains retry-safe.',
      when: 'the caller lost a candidate-write response',
      prefer: 'return the canonical candidate',
      over: 'inventing another candidate id',
      because: 'idempotency is a durable receipt contract',
    };
    const generatedCandidate = ledger.proposeCandidate(generatedCandidateInput);
    expect(ledger.proposeCandidate(generatedCandidateInput)).toMatchObject({
      duplicate: true,
      candidateId: generatedCandidate.candidateId,
      doctrineId: generatedCandidate.doctrineId,
    });

    const experimentInput = {
      ...base,
      id: 'experiment-immutable',
      idempotencyKey: 'experiment:immutable:one',
      candidateId: candidate.candidateId,
      hypothesis: 'An identity cannot be replaced in place.',
      primaryOutcome: 'conflict is rejected',
      control: 'original identity',
      treatment: 'conflicting rewrite',
    };
    const experiment = ledger.preregisterExperiment(experimentInput);
    expect(ledger.preregisterExperiment(experimentInput)).toMatchObject({ duplicate: true, experimentId: experiment.experimentId });
    expect(() => ledger.preregisterExperiment({
      ...experimentInput,
      hypothesis: 'A changed body cannot reuse the original experiment idempotency key.',
    })).toThrow(/idempotencyKey.*conflicts/);
    expect(() => ledger.preregisterExperiment({
      ...experimentInput,
      idempotencyKey: 'experiment:immutable:conflict',
      hypothesis: 'A conflicting experiment rewrite must fail.',
    })).toThrow(/already exists/);

    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        id: `run-doctrine-immutable-${arm}`,
        experimentId: experiment.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext(`replica:doctrine-immutable:${arm}`),
      });
    }
    const admissionInput = {
      ...base,
      idempotencyKey: 'doctrine:immutable:one',
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    };
    expect(ledger.admit(admissionInput)).toMatchObject({ duplicate: false, doctrineId: candidate.doctrineId });
    expect(ledger.admit(admissionInput)).toMatchObject({ duplicate: true, doctrineId: candidate.doctrineId });
    expect(() => ledger.admit({
      ...admissionInput,
      reviewerId: 'agent:changed-reviewer',
    })).toThrow(/idempotencyKey.*conflicts/);
  });

  it('requires matching structured factual contexts and independent replicas before a provisional admission', () => {
    const { ledger, candidate } = seedCandidate();
    const sameReplica = ledger.preregisterExperiment({
      ...base,
      id: 'experiment-same-replica',
      candidateId: candidate.candidateId,
      hypothesis: 'Same replica must not masquerade as independent factual evidence.',
      primaryOutcome: 'admission remains blocked',
      control: 'control',
      treatment: 'treatment',
    });
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        id: `run-same-replica-${arm}`,
        experimentId: sameReplica.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext('replica:not-independent'),
      });
    }
    expect(() => ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: sameReplica.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(/distinct replicaIds/);

    const contextMismatch = ledger.preregisterExperiment({
      ...base,
      id: 'experiment-context-mismatch',
      candidateId: candidate.candidateId,
      hypothesis: 'Mismatched replay contexts must not be treated as a factual pair.',
      primaryOutcome: 'admission remains blocked',
      control: 'control',
      treatment: 'treatment',
    });
    ledger.recordTreatmentRun({
      ...base,
      id: 'run-context-control',
      experimentId: contextMismatch.experimentId,
      arm: 'control',
      action: 'control',
      outcome: 'control',
      fidelity: 'matched',
      replayContext: replayContext('replica:context:control'),
    });
    ledger.recordTreatmentRun({
      ...base,
      id: 'run-context-treatment',
      experimentId: contextMismatch.experimentId,
      arm: 'treatment',
      action: 'treatment',
      outcome: 'treatment',
      fidelity: 'matched',
      replayContext: replayContext('replica:context:treatment', { checkpoint: 'checkpoint:different' }),
    });
    expect(() => ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: contextMismatch.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(/matching replay contexts/);
    expect(() => ledger.recordTreatmentRun({
      ...base,
      id: 'run-missing-context',
      experimentId: contextMismatch.experimentId,
      arm: 'sham',
      action: 'sham',
      outcome: 'sham',
      fidelity: 'matched',
      replayContext: {} as any,
    })).toThrow(/replayContext requires/);
  });

  it('admits first-cycle evidence provisionally only and never reactivates contested or retired doctrine', () => {
    const { ledger, candidate } = seedCandidate();
    const experiment = ledger.preregisterExperiment({
      ...base,
      id: 'experiment-first-cycle',
      candidateId: candidate.candidateId,
      hypothesis: 'One matched factual pair is only a provisional finding.',
      primaryOutcome: 'provisional status',
      control: 'control',
      treatment: 'treatment',
    });
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        id: `run-first-cycle-${arm}`,
        experimentId: experiment.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext(`replica:first-cycle:${arm}`),
      });
    }
    expect(() => ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
      status: 'established',
    })).toThrow(/provisional only/);
    const admitted = ledger.admit({
      ...base,
      idempotencyKey: 'admit:first-cycle',
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    });
    expect(ledger.getDoctrine(admitted.doctrineId)?.doctrine.status).toBe('provisional');
    ledger.contest({
      ...base,
      doctrineId: admitted.doctrineId,
      reason: 'A later result contests the first-cycle finding.',
    });
    expect(() => ledger.admit({
      ...base,
      idempotencyKey: 'admit:contested-reactivation',
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(/cannot be admitted or reactivated/);
    ledger.retire({
      ...base,
      doctrineId: admitted.doctrineId,
      reason: 'The contested first-cycle finding is retired pending a successor.',
    });
    expect(() => ledger.admit({
      ...base,
      idempotencyKey: 'admit:retired-reactivation',
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(/cannot be admitted or reactivated/);
  });

  it('binds every referenced doctrine edge to one projectDir and exposes preregistration before admission', () => {
    const { ledger, episode, candidate } = seedCandidate();
    expect(() => ledger.proposeCandidate({
      ...base,
      id: 'candidate-cross-project',
      projectDir: '/repo/other-project',
      doctrineId: 'doctrine:cross-project',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      title: 'Cross-project candidate',
      when: 'never',
      prefer: 'never',
      over: 'never',
      because: 'cross-project evidence is invalid',
    })).toThrow(/must exactly match/);
    expect(() => ledger.preregisterExperiment({
      ...base,
      id: 'experiment-cross-project',
      projectDir: '/repo/other-project',
      candidateId: candidate.candidateId,
      hypothesis: 'Cross-project experiment',
      primaryOutcome: 'rejected',
      control: 'control',
      treatment: 'treatment',
    })).toThrow(/experiment projectDir/);

    const experiment = ledger.preregisterExperiment({
      ...base,
      id: 'experiment-project-binding',
      candidateId: candidate.candidateId,
      hypothesis: 'All referenced evidence stays in one project.',
      primaryOutcome: 'no cross-project laundering',
      control: 'control',
      treatment: 'treatment',
    });
    expect(ledger.getDoctrine(candidate.doctrineId)?.experiment?.id).toBe(experiment.experimentId);
    expect(ledger.getDoctrine(candidate.doctrineId)?.experiments.map((item) => item.id)).toEqual([experiment.experimentId]);
    expect(() => ledger.recordTreatmentRun({
      ...base,
      id: 'run-cross-project',
      projectDir: '/repo/other-project',
      experimentId: experiment.experimentId,
      arm: 'control',
      action: 'control',
      outcome: 'control',
      fidelity: 'matched',
      replayContext: replayContext('replica:cross-project'),
    })).toThrow(/treatment run projectDir/);
    for (const arm of ['control', 'treatment'] as const) {
      ledger.recordTreatmentRun({
        ...base,
        id: `run-project-binding-${arm}`,
        experimentId: experiment.experimentId,
        arm,
        action: arm,
        outcome: arm,
        fidelity: 'matched',
        replayContext: replayContext(`replica:project-binding:${arm}`),
      });
    }
    expect(() => ledger.admit({
      ...base,
      projectDir: '/repo/other-project',
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    })).toThrow(/admission projectDir/);
    const admitted = ledger.admit({
      ...base,
      candidateId: candidate.candidateId,
      experimentId: experiment.experimentId,
      reviewerId: 'agent:admiralty',
    });
    expect(ledger.retrieve({
      ...base,
      id: 'retrieval-other-project',
      projectDir: '/repo/other-project',
      decisionId: 'decision-other-project',
      decisionClass: 'integration.merge',
    }).doctrines).toEqual([]);
    const receipt = ledger.retrieve({
      ...base,
      id: 'retrieval-project-binding',
      decisionId: 'decision-project-binding',
      decisionClass: 'integration.merge',
    });
    expect(() => ledger.recordApplication({
      ...base,
      id: 'application-cross-project',
      projectDir: '/repo/other-project',
      retrievalId: receipt.receipt.id,
      doctrineId: admitted.doctrineId,
      response: 'follow',
      decision: 'follow',
    })).toThrow(/application projectDir/);
    const application = ledger.recordApplication({
      ...base,
      id: 'application-project-binding',
      retrievalId: receipt.receipt.id,
      doctrineId: admitted.doctrineId,
      response: 'follow',
      decision: 'follow',
    });
    expect(() => ledger.recordOutcome({
      ...base,
      id: 'outcome-cross-project',
      projectDir: '/repo/other-project',
      applicationId: application.applicationId,
      verdict: 'helped',
      summary: 'cross-project outcome',
      verifiedBy: 'receipt:cross-project',
    })).toThrow(/outcome projectDir/);
    expect(() => ledger.contest({
      ...base,
      projectDir: '/repo/other-project',
      doctrineId: admitted.doctrineId,
      reason: 'cross-project contest',
    })).toThrow(/contest must be recorded/);
    const successorCandidate = ledger.proposeCandidate({
      ...base,
      id: 'candidate-project-binding-successor',
      doctrineId: 'doctrine:project-binding-successor',
      episodeId: episode.episodeId,
      decisionClass: 'integration.merge',
      supersedesDoctrineId: admitted.doctrineId,
      title: 'A linked successor stays in the same project.',
      when: 'later evidence narrows the old advice',
      prefer: 'the scoped successor',
      over: 'the old revision',
      because: 'supersession has a durable cited edge',
    });
    const successor = admitCandidate(ledger, successorCandidate.candidateId, 'project-binding-successor');
    expect(() => ledger.supersede({
      ...base,
      projectDir: '/repo/other-project',
      doctrineId: admitted.doctrineId,
      successorDoctrineId: successor.doctrineId,
      reason: 'cross-project supersession',
    })).toThrow(/caller exact projectDir/);
    expect(() => ledger.retire({
      ...base,
      projectDir: '/repo/other-project',
      doctrineId: admitted.doctrineId,
      reason: 'cross-project retirement',
    })).toThrow(/retirement must be recorded/);
  });

  it('replays an idempotent retrieval from its canonical stored receipt instead of today’s active set', () => {
    const { ledger, candidate } = seedCandidate();
    const admitted = admitCandidate(ledger, candidate.candidateId, 'canonical-retrieval');
    const input = {
      ...base,
      id: 'retrieval-canonical',
      idempotencyKey: 'retrieve:canonical',
      decisionId: 'decision-canonical',
      decisionClass: 'integration.merge',
    };
    const first = ledger.retrieve(input);
    expect(first.doctrines.map((item) => item.doctrineId)).toEqual([admitted.doctrineId]);
    ledger.retire({
      ...base,
      doctrineId: admitted.doctrineId,
      reason: 'Retired after the original decision-time receipt was recorded.',
    });
    const retry = ledger.retrieve(input);
    expect(retry.receipt.id).toBe(first.receipt.id);
    expect(retry.doctrines.map((item) => item.doctrineId)).toEqual([admitted.doctrineId]);
    expect(retry.doctrines[0]?.status).toBe('retired');
    expect(() => ledger.retrieve({
      ...input,
      id: 'retrieval-conflicting-idempotency',
      decisionId: 'decision-conflicting',
    })).toThrow(/idempotencyKey may only retry/);
  });
});
