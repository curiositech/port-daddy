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
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'treatment',
      action: 'hold and investigate',
      outcome: 'substantive defect identified',
      fidelity: 'matched',
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
    });
    ledger.recordTreatmentRun({
      ...base,
      experimentId: experiment.experimentId,
      arm: 'treatment',
      action: 'merge',
      outcome: 'prompt masking changed unrelated context',
      fidelity: 'mismatched',
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
});
