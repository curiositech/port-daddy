/**
 * Empirically earned fleet doctrine — the CASE-13 vertical loop.
 *
 * The Harbor event ledger is canonical. This module deliberately owns no
 * mutable doctrine table: every view below is reconstructed from immutable
 * `doctrine-evidence` events. That makes a candidate, experiment, retrieval
 * receipt, agent response, and verified outcome one continuous auditable
 * chain rather than a write-only knowledge store.
 *
 * Doctrine remains advisory. It can inform a decision, never authorize an
 * irreversible action or replace the underlying evidence.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  appendEvent,
  readEvents,
  type AppendResult,
  type HarborPayload,
} from './agent-harbor/event-ledger.js';
import { assertAgainstSchema } from './agent-harbor/schema-validate.js';

export const DOCTRINE_EVENT_KINDS = [
  'decision_episode_recorded',
  'doctrine_candidate_induced',
  'experiment_preregistered',
  'treatment_run_recorded',
  'doctrine_revision_admitted',
  'doctrine_retrieved',
  'doctrine_applied',
  'outcome_recorded',
  'doctrine_contested',
  'doctrine_deprecated',
] as const;

export type DoctrineEvidenceKind = (typeof DOCTRINE_EVENT_KINDS)[number];
export type DoctrineStatus = 'candidate' | 'provisional' | 'established' | 'contested' | 'deprecated';
export type DoctrineApplicationResponse = 'follow' | 'adapt' | 'reject';
export type DoctrineOutcomeVerdict = 'helped' | 'harmed' | 'inconclusive';
export type ReplayFidelity = 'not-run' | 'matched' | 'mismatched';

const DOCTRINE_SCHEMA = 'pd.agent-harbor.doctrine-evidence.v0';

export class DoctrineValidationError extends Error {
  code = 'DOCTRINE_VALIDATION' as const;
}

export class DoctrineNotFoundError extends Error {
  code = 'DOCTRINE_NOT_FOUND' as const;
}

export class DoctrineStateError extends Error {
  code = 'DOCTRINE_STATE' as const;
}

export interface DoctrineProvenance {
  model?: string;
  modelVersion?: string;
  harness?: string;
  worktree?: string;
  environment?: string;
}

export interface DoctrineInputBase {
  projectDir: string;
  actorId: string;
  citations: string[];
  sessionId?: string;
  runId?: string;
  provenance?: DoctrineProvenance;
  occurredAt?: string;
  idempotencyKey?: string;
}

export interface DecisionEpisodeInput extends DoctrineInputBase {
  id?: string;
  decisionClass: string;
  summary: string;
  historicalAction: string;
  alternatives?: string[];
  cues?: string[];
  fidelity?: 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
}

export interface DoctrineCandidateInput extends DoctrineInputBase {
  id?: string;
  doctrineId?: string;
  episodeId: string;
  decisionClass: string;
  title: string;
  when: string;
  prefer: string;
  over: string;
  because: string;
  unless?: string[];
  school?: string;
  skillRefs?: string[];
}

export interface ExperimentInput extends DoctrineInputBase {
  id?: string;
  candidateId: string;
  hypothesis: string;
  primaryOutcome: string;
  control: string;
  treatment: string;
  sham?: string;
  preregisteredAt?: string;
}

export interface TreatmentRunInput extends DoctrineInputBase {
  id?: string;
  experimentId: string;
  arm: 'control' | 'treatment' | 'sham';
  action: string;
  outcome: string;
  fidelity: ReplayFidelity;
  notes?: string;
}

export interface AdmitDoctrineInput extends DoctrineInputBase {
  candidateId: string;
  experimentId: string;
  doctrineId?: string;
  status?: Extract<DoctrineStatus, 'provisional' | 'established'>;
  reviewerId: string;
}

export interface DoctrineRetrieveInput extends DoctrineInputBase {
  id?: string;
  decisionId: string;
  decisionClass: string;
  limit?: number;
}

export interface DoctrineApplicationInput extends DoctrineInputBase {
  id?: string;
  retrievalId: string;
  doctrineId: string;
  response: DoctrineApplicationResponse;
  decision: string;
  note?: string;
}

export interface DoctrineOutcomeInput extends DoctrineInputBase {
  id?: string;
  applicationId: string;
  verdict: DoctrineOutcomeVerdict;
  summary: string;
  verifiedBy: string;
}

export interface DoctrineContestInput extends DoctrineInputBase {
  doctrineId: string;
  reason: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface DecisionEpisode {
  id: string;
  projectDir: string;
  actorId: string;
  citations: string[];
  occurredAt: string;
  decisionClass: string;
  summary: string;
  historicalAction: string;
  alternatives: string[];
  cues: string[];
  fidelity: string;
  provenance: DoctrineProvenance;
}

export interface DoctrineCandidate {
  id: string;
  doctrineId: string | null;
  episodeId: string;
  projectDir: string;
  actorId: string;
  citations: string[];
  occurredAt: string;
  decisionClass: string;
  title: string;
  when: string;
  prefer: string;
  over: string;
  because: string;
  unless: string[];
  school: string | null;
  skillRefs: string[];
  status: DoctrineStatus;
  reviewerId: string | null;
  experimentId: string | null;
  admissionCitations: string[];
  contestedReason: string | null;
}

export interface DoctrineExperiment {
  id: string;
  candidateId: string;
  projectDir: string;
  actorId: string;
  citations: string[];
  occurredAt: string;
  hypothesis: string;
  primaryOutcome: string;
  control: string;
  treatment: string;
  sham: string | null;
  runs: DoctrineTreatmentRun[];
}

export interface DoctrineTreatmentRun {
  id: string;
  experimentId: string;
  arm: 'control' | 'treatment' | 'sham';
  action: string;
  outcome: string;
  fidelity: ReplayFidelity;
  notes: string | null;
  occurredAt: string;
  citations: string[];
}

export interface DoctrineRetrievalReceipt {
  id: string;
  decisionId: string;
  decisionClass: string;
  projectDir: string;
  actorId: string;
  occurredAt: string;
  doctrineIds: string[];
  citations: string[];
}

export interface DoctrineApplication {
  id: string;
  retrievalId: string;
  doctrineId: string;
  projectDir: string;
  actorId: string;
  occurredAt: string;
  response: DoctrineApplicationResponse;
  decision: string;
  note: string | null;
  citations: string[];
}

export interface DoctrineOutcome {
  id: string;
  applicationId: string;
  doctrineId: string;
  projectDir: string;
  actorId: string;
  occurredAt: string;
  verdict: DoctrineOutcomeVerdict;
  summary: string;
  verifiedBy: string;
  citations: string[];
}

export interface DoctrinePacket {
  receipt: DoctrineRetrievalReceipt;
  doctrines: DoctrineCandidate[];
  advisory: true;
  retrievalPolicy: 'structured-exact-decision-class';
}

export interface DoctrineDetail {
  doctrine: DoctrineCandidate;
  episode: DecisionEpisode | null;
  experiment: DoctrineExperiment | null;
  retrievals: DoctrineRetrievalReceipt[];
  applications: DoctrineApplication[];
  outcomes: DoctrineOutcome[];
}

interface DoctrineProjection {
  episodes: Map<string, DecisionEpisode>;
  candidates: Map<string, DoctrineCandidate>;
  experiments: Map<string, DoctrineExperiment>;
  retrievals: Map<string, DoctrineRetrievalReceipt>;
  applications: Map<string, DoctrineApplication>;
  outcomes: Map<string, DoctrineOutcome>;
}

interface CanonicalEvent {
  schema: string;
  eventId: string;
  idempotencyKey: string;
  kind: DoctrineEvidenceKind;
  entityId: string;
  occurredAt: string;
  projectDir: string;
  actorId: string;
  citations: string[];
  sessionId?: string;
  runId?: string;
  provenance?: DoctrineProvenance;
  payload: Record<string, unknown>;
}

export interface DoctrineLedgerOptions {
  now?: () => Date;
}

export interface DoctrineLedger {
  recordEpisode(input: DecisionEpisodeInput): AppendResult & { episodeId: string };
  proposeCandidate(input: DoctrineCandidateInput): AppendResult & { candidateId: string; doctrineId: string };
  preregisterExperiment(input: ExperimentInput): AppendResult & { experimentId: string };
  recordTreatmentRun(input: TreatmentRunInput): AppendResult & { treatmentRunId: string };
  admit(input: AdmitDoctrineInput): AppendResult & { doctrineId: string };
  retrieve(input: DoctrineRetrieveInput): DoctrinePacket;
  recordApplication(input: DoctrineApplicationInput): AppendResult & { applicationId: string };
  recordOutcome(input: DoctrineOutcomeInput): AppendResult & { outcomeId: string };
  contest(input: DoctrineContestInput): AppendResult;
  listCandidates(options?: { status?: DoctrineStatus; projectDir?: string; decisionClass?: string }): DoctrineCandidate[];
  listEpisodes(options?: { projectDir?: string; decisionClass?: string }): DecisionEpisode[];
  getDoctrine(id: string): DoctrineDetail | null;
  getExperiment(id: string): DoctrineExperiment | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  const string = asString(value);
  return string.length > 0 ? string : null;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asProvenance(value: unknown): DoctrineProvenance {
  if (!isRecord(value)) return {};
  const pick = (key: keyof DoctrineProvenance) => asString(value[key]);
  return {
    ...(pick('model') ? { model: pick('model') } : {}),
    ...(pick('modelVersion') ? { modelVersion: pick('modelVersion') } : {}),
    ...(pick('harness') ? { harness: pick('harness') } : {}),
    ...(pick('worktree') ? { worktree: pick('worktree') } : {}),
    ...(pick('environment') ? { environment: pick('environment') } : {}),
  };
}

function requireText(name: string, value: unknown): string {
  const text = asString(value).trim();
  if (!text) throw new DoctrineValidationError(`${name} is required`);
  return text;
}

function requireCitations(value: unknown): string[] {
  const citations = asStrings(value).map((citation) => citation.trim()).filter(Boolean);
  if (citations.length === 0) {
    throw new DoctrineValidationError('at least one immutable receipt, source span, or verification citation is required');
  }
  return [...new Set(citations)];
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function date(value: string | undefined, now: () => Date): string {
  const candidate = value ?? now().toISOString();
  if (Number.isNaN(Date.parse(candidate))) {
    throw new DoctrineValidationError(`occurredAt must be an ISO timestamp, received ${JSON.stringify(candidate)}`);
  }
  return candidate;
}

function eventFromInput(
  kind: DoctrineEvidenceKind,
  entityId: string,
  input: DoctrineInputBase,
  payload: Record<string, unknown>,
  now: () => Date,
): CanonicalEvent {
  const occurredAt = date(input.occurredAt, now);
  return {
    schema: DOCTRINE_SCHEMA,
    eventId: id('doctrine-event'),
    idempotencyKey: input.idempotencyKey ?? `${kind}:${entityId}`,
    kind,
    entityId,
    occurredAt,
    projectDir: requireText('projectDir', input.projectDir),
    actorId: requireText('actorId', input.actorId),
    citations: requireCitations(input.citations),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    payload,
  };
}

function appendDoctrineEvent(db: DatabaseInstance, event: CanonicalEvent): AppendResult {
  // The ledger's stream discriminator protects storage shape. The frozen JSON
  // contract also protects the event-family semantics (including lifecycle
  // kind enum) before a fact becomes durable.
  assertAgainstSchema('doctrine-evidence', event);
  return appendEvent(db, { streamType: 'doctrine-evidence', payload: event as unknown as HarborPayload });
}

/**
 * An append may deduplicate on an idempotency key even when a retried caller
 * generated a fresh local entity ID. Read the canonical, already-ledgered
 * envelope back before returning a receipt so ambiguous retries cannot point
 * callers at an entity that was never written.
 */
function canonicalEventAfterAppend(
  db: DatabaseInstance,
  append: AppendResult,
  fallback: CanonicalEvent,
): CanonicalEvent {
  if (!append.duplicate) return fallback;
  const row = db
    .prepare('SELECT payload_json FROM harbor_events WHERE event_id = ?')
    .get(append.eventId) as { payload_json?: unknown } | undefined;
  if (!row || typeof row.payload_json !== 'string') return fallback;
  try {
    const parsed = JSON.parse(row.payload_json);
    if (
      isRecord(parsed)
      && parsed.schema === DOCTRINE_SCHEMA
      && typeof parsed.entityId === 'string'
      && isRecord(parsed.payload)
    ) {
      return parsed as unknown as CanonicalEvent;
    }
  } catch {
    // The stored ledger event is already validated on admission. If a future
    // reader cannot decode it, retain the locally constructed value rather
    // than turning an idempotent retry into a new write.
  }
  return fallback;
}

function replay(db: DatabaseInstance): DoctrineProjection {
  const projection: DoctrineProjection = {
    episodes: new Map(),
    candidates: new Map(),
    experiments: new Map(),
    retrievals: new Map(),
    applications: new Map(),
    outcomes: new Map(),
  };

  for (const row of readEvents(db, { streamType: 'doctrine-evidence' })) {
    let event: Partial<CanonicalEvent>;
    try {
      const parsed = JSON.parse(row.payload_json);
      if (!isRecord(parsed) || parsed.schema !== DOCTRINE_SCHEMA || !isRecord(parsed.payload)) continue;
      event = parsed as Partial<CanonicalEvent>;
    } catch {
      continue;
    }
    const payload = event.payload!;
    const entityId = asString(event.entityId);
    const occurredAt = asString(event.occurredAt);
    const citations = asStrings(event.citations);
    const projectDir = asString(event.projectDir);
    const actorId = asString(event.actorId);
    const kind = asString(event.kind) as DoctrineEvidenceKind;
    if (!entityId || !occurredAt || !projectDir || !actorId || !DOCTRINE_EVENT_KINDS.includes(kind)) continue;

    if (kind === 'decision_episode_recorded') {
      projection.episodes.set(entityId, {
        id: entityId,
        projectDir,
        actorId,
        citations,
        occurredAt,
        decisionClass: asString(payload.decisionClass),
        summary: asString(payload.summary),
        historicalAction: asString(payload.historicalAction),
        alternatives: asStrings(payload.alternatives),
        cues: asStrings(payload.cues),
        fidelity: asString(payload.fidelity, 'T0'),
        provenance: asProvenance(event.provenance),
      });
      continue;
    }

    if (kind === 'doctrine_candidate_induced') {
      projection.candidates.set(entityId, {
        id: entityId,
        doctrineId: asNullableString(payload.doctrineId),
        episodeId: asString(payload.episodeId),
        projectDir,
        actorId,
        citations,
        occurredAt,
        decisionClass: asString(payload.decisionClass),
        title: asString(payload.title),
        when: asString(payload.when),
        prefer: asString(payload.prefer),
        over: asString(payload.over),
        because: asString(payload.because),
        unless: asStrings(payload.unless),
        school: asNullableString(payload.school),
        skillRefs: asStrings(payload.skillRefs),
        status: 'candidate',
        reviewerId: null,
        experimentId: null,
        admissionCitations: [],
        contestedReason: null,
      });
      continue;
    }

    if (kind === 'experiment_preregistered') {
      projection.experiments.set(entityId, {
        id: entityId,
        candidateId: asString(payload.candidateId),
        projectDir,
        actorId,
        citations,
        occurredAt,
        hypothesis: asString(payload.hypothesis),
        primaryOutcome: asString(payload.primaryOutcome),
        control: asString(payload.control),
        treatment: asString(payload.treatment),
        sham: asNullableString(payload.sham),
        runs: [],
      });
      continue;
    }

    if (kind === 'treatment_run_recorded') {
      const experiment = projection.experiments.get(asString(payload.experimentId));
      if (!experiment) continue;
      const arm = asString(payload.arm) as DoctrineTreatmentRun['arm'];
      if (!['control', 'treatment', 'sham'].includes(arm)) continue;
      experiment.runs.push({
        id: entityId,
        experimentId: experiment.id,
        arm,
        action: asString(payload.action),
        outcome: asString(payload.outcome),
        fidelity: asString(payload.fidelity, 'not-run') as ReplayFidelity,
        notes: asNullableString(payload.notes),
        occurredAt,
        citations,
      });
      continue;
    }

    if (kind === 'doctrine_revision_admitted') {
      const candidate = projection.candidates.get(asString(payload.candidateId));
      if (!candidate) continue;
      candidate.doctrineId = entityId;
      candidate.status = asString(payload.status) === 'established' ? 'established' : 'provisional';
      candidate.reviewerId = asNullableString(payload.reviewerId);
      candidate.experimentId = asNullableString(payload.experimentId);
      candidate.admissionCitations = citations;
      candidate.contestedReason = null;
      continue;
    }

    if (kind === 'doctrine_retrieved') {
      projection.retrievals.set(entityId, {
        id: entityId,
        decisionId: asString(payload.decisionId),
        decisionClass: asString(payload.decisionClass),
        projectDir,
        actorId,
        occurredAt,
        doctrineIds: asStrings(payload.doctrineIds),
        citations,
      });
      continue;
    }

    if (kind === 'doctrine_applied') {
      const response = asString(payload.response) as DoctrineApplicationResponse;
      if (!['follow', 'adapt', 'reject'].includes(response)) continue;
      projection.applications.set(entityId, {
        id: entityId,
        retrievalId: asString(payload.retrievalId),
        doctrineId: asString(payload.doctrineId),
        projectDir,
        actorId,
        occurredAt,
        response,
        decision: asString(payload.decision),
        note: asNullableString(payload.note),
        citations,
      });
      continue;
    }

    if (kind === 'outcome_recorded') {
      const verdict = asString(payload.verdict) as DoctrineOutcomeVerdict;
      if (!['helped', 'harmed', 'inconclusive'].includes(verdict)) continue;
      projection.outcomes.set(entityId, {
        id: entityId,
        applicationId: asString(payload.applicationId),
        doctrineId: asString(payload.doctrineId),
        projectDir,
        actorId,
        occurredAt,
        verdict,
        summary: asString(payload.summary),
        verifiedBy: asString(payload.verifiedBy),
        citations,
      });
      continue;
    }

    if (kind === 'doctrine_contested' || kind === 'doctrine_deprecated') {
      const candidate = [...projection.candidates.values()].find((item) => item.doctrineId === entityId);
      if (!candidate) continue;
      candidate.status = kind === 'doctrine_deprecated' ? 'deprecated' : 'contested';
      candidate.contestedReason = asNullableString(payload.reason);
    }
  }

  return projection;
}

function sorted<T extends { occurredAt: string }>(items: T[]): T[] {
  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function getCandidateByDoctrineId(projection: DoctrineProjection, doctrineId: string): DoctrineCandidate | undefined {
  return [...projection.candidates.values()].find((candidate) => candidate.doctrineId === doctrineId);
}

function experimentHasFidelityGate(experiment: DoctrineExperiment): boolean {
  const hasControl = experiment.runs.some((run) => run.arm === 'control' && run.fidelity === 'matched');
  const hasTreatment = experiment.runs.some((run) => run.arm === 'treatment' && run.fidelity === 'matched');
  return hasControl && hasTreatment;
}

/**
 * Creates the only public doctrine authority. The function is intentionally
 * cheap to construct: the persistent source of truth is Harbor's ledger, and
 * every read rebuilds a small, deterministic projection from it.
 */
export function createDoctrineLedger(db: DatabaseInstance, options: DoctrineLedgerOptions = {}): DoctrineLedger {
  const now = options.now ?? (() => new Date());

  return {
    recordEpisode(input) {
      const episodeId = input.id ?? id('episode');
      const event = eventFromInput('decision_episode_recorded', episodeId, input, {
        decisionClass: requireText('decisionClass', input.decisionClass),
        summary: requireText('summary', input.summary),
        historicalAction: requireText('historicalAction', input.historicalAction),
        alternatives: asStrings(input.alternatives),
        cues: asStrings(input.cues),
        fidelity: input.fidelity ?? 'T0',
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, episodeId: canonical.entityId };
    },

    proposeCandidate(input) {
      const state = replay(db);
      if (!state.episodes.has(requireText('episodeId', input.episodeId))) {
        throw new DoctrineNotFoundError(`decision episode ${input.episodeId} was not found in the doctrine ledger`);
      }
      const candidateId = input.id ?? id('doctrine-candidate');
      const doctrineId = input.doctrineId ?? `doctrine:${candidateId}`;
      const event = eventFromInput('doctrine_candidate_induced', candidateId, input, {
        doctrineId,
        episodeId: input.episodeId,
        decisionClass: requireText('decisionClass', input.decisionClass),
        title: requireText('title', input.title),
        when: requireText('when', input.when),
        prefer: requireText('prefer', input.prefer),
        over: requireText('over', input.over),
        because: requireText('because', input.because),
        unless: asStrings(input.unless),
        school: input.school ?? null,
        skillRefs: asStrings(input.skillRefs),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return {
        ...append,
        candidateId: canonical.entityId,
        doctrineId: asString(canonical.payload.doctrineId, doctrineId),
      };
    },

    preregisterExperiment(input) {
      const state = replay(db);
      if (!state.candidates.has(requireText('candidateId', input.candidateId))) {
        throw new DoctrineNotFoundError(`doctrine candidate ${input.candidateId} was not found`);
      }
      const experimentId = input.id ?? id('doctrine-experiment');
      const event = eventFromInput('experiment_preregistered', experimentId, input, {
        candidateId: input.candidateId,
        hypothesis: requireText('hypothesis', input.hypothesis),
        primaryOutcome: requireText('primaryOutcome', input.primaryOutcome),
        control: requireText('control', input.control),
        treatment: requireText('treatment', input.treatment),
        sham: input.sham ?? null,
        preregisteredAt: input.preregisteredAt ?? date(input.occurredAt, now),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, experimentId: canonical.entityId };
    },

    recordTreatmentRun(input) {
      const state = replay(db);
      if (!state.experiments.has(requireText('experimentId', input.experimentId))) {
        throw new DoctrineNotFoundError(`doctrine experiment ${input.experimentId} was not found`);
      }
      if (!['control', 'treatment', 'sham'].includes(input.arm)) {
        throw new DoctrineValidationError('arm must be control, treatment, or sham');
      }
      if (!['not-run', 'matched', 'mismatched'].includes(input.fidelity)) {
        throw new DoctrineValidationError('fidelity must be not-run, matched, or mismatched');
      }
      const treatmentRunId = input.id ?? id('doctrine-treatment');
      const event = eventFromInput('treatment_run_recorded', treatmentRunId, input, {
        experimentId: input.experimentId,
        arm: input.arm,
        action: requireText('action', input.action),
        outcome: requireText('outcome', input.outcome),
        fidelity: input.fidelity,
        notes: input.notes ?? null,
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, treatmentRunId: canonical.entityId };
    },

    admit(input) {
      const state = replay(db);
      const candidate = state.candidates.get(requireText('candidateId', input.candidateId));
      if (!candidate) throw new DoctrineNotFoundError(`doctrine candidate ${input.candidateId} was not found`);
      const experiment = state.experiments.get(requireText('experimentId', input.experimentId));
      if (!experiment || experiment.candidateId !== candidate.id) {
        throw new DoctrineStateError('admission requires a preregistered experiment belonging to this candidate');
      }
      if (!experimentHasFidelityGate(experiment)) {
        throw new DoctrineStateError(
          'admission requires matched factual control and treatment runs; a prompt-only or unmatched replay cannot establish a doctrine',
        );
      }
      if (input.doctrineId && candidate.doctrineId && input.doctrineId !== candidate.doctrineId) {
        throw new DoctrineStateError(
          'admission cannot replace a candidate doctrineId; record a successor candidate instead of changing history in place',
        );
      }
      const doctrineId = input.doctrineId ?? candidate.doctrineId ?? `doctrine:${candidate.id}`;
      const event = eventFromInput('doctrine_revision_admitted', doctrineId, input, {
        candidateId: candidate.id,
        experimentId: experiment.id,
        reviewerId: requireText('reviewerId', input.reviewerId),
        status: input.status === 'established' ? 'established' : 'provisional',
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, doctrineId: canonical.entityId };
    },

    retrieve(input) {
      const state = replay(db);
      const decisionId = requireText('decisionId', input.decisionId);
      const decisionClass = requireText('decisionClass', input.decisionClass);
      const limit = Math.max(1, Math.min(input.limit ?? 3, 10));
      const doctrines = sorted([...state.candidates.values()]
        .filter((candidate) =>
          candidate.projectDir === input.projectDir
          && candidate.decisionClass === decisionClass
          && (candidate.status === 'provisional' || candidate.status === 'established')
          && candidate.doctrineId,
        ))
        .slice(0, limit);
      const retrievalId = input.id ?? id('doctrine-retrieval');
      const citations = [...new Set([...input.citations, ...doctrines.flatMap((doctrine) => doctrine.admissionCitations)])];
      const event = eventFromInput('doctrine_retrieved', retrievalId, { ...input, citations }, {
        decisionId,
        decisionClass,
        doctrineIds: doctrines.map((doctrine) => doctrine.doctrineId!).filter(Boolean),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      const receipt: DoctrineRetrievalReceipt = {
        id: canonical.entityId,
        decisionId,
        decisionClass,
        projectDir: canonical.projectDir,
        actorId: canonical.actorId,
        occurredAt: canonical.occurredAt,
        doctrineIds: asStrings(canonical.payload.doctrineIds),
        citations: canonical.citations,
      };
      // `append` deliberately remains observable via the returned receipt ID;
      // duplicate reads get the original event id from the ledger but identical
      // decision-time content. A retrieval is evidence, not a cache hit.
      void append;
      return {
        receipt,
        doctrines,
        advisory: true,
        retrievalPolicy: 'structured-exact-decision-class',
      };
    },

    recordApplication(input) {
      const state = replay(db);
      const retrieval = state.retrievals.get(requireText('retrievalId', input.retrievalId));
      if (!retrieval) throw new DoctrineNotFoundError(`retrieval receipt ${input.retrievalId} was not found`);
      const doctrine = getCandidateByDoctrineId(state, requireText('doctrineId', input.doctrineId));
      if (!doctrine || !retrieval.doctrineIds.includes(input.doctrineId)) {
        throw new DoctrineStateError('application must reference a doctrine actually shown in the retrieval receipt');
      }
      if (!['follow', 'adapt', 'reject'].includes(input.response)) {
        throw new DoctrineValidationError('response must be follow, adapt, or reject');
      }
      const applicationId = input.id ?? id('doctrine-application');
      const event = eventFromInput('doctrine_applied', applicationId, input, {
        retrievalId: retrieval.id,
        doctrineId: doctrine.doctrineId,
        response: input.response,
        decision: requireText('decision', input.decision),
        note: input.note ?? null,
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, applicationId: canonical.entityId };
    },

    recordOutcome(input) {
      const state = replay(db);
      const application = state.applications.get(requireText('applicationId', input.applicationId));
      if (!application) throw new DoctrineNotFoundError(`doctrine application ${input.applicationId} was not found`);
      if (!['helped', 'harmed', 'inconclusive'].includes(input.verdict)) {
        throw new DoctrineValidationError('verdict must be helped, harmed, or inconclusive');
      }
      const outcomeId = input.id ?? id('doctrine-outcome');
      const event = eventFromInput('outcome_recorded', outcomeId, input, {
        applicationId: application.id,
        doctrineId: application.doctrineId,
        verdict: input.verdict,
        summary: requireText('summary', input.summary),
        verifiedBy: requireText('verifiedBy', input.verifiedBy),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, outcomeId: canonical.entityId };
    },

    contest(input) {
      const state = replay(db);
      const candidate = getCandidateByDoctrineId(state, requireText('doctrineId', input.doctrineId));
      if (!candidate) throw new DoctrineNotFoundError(`doctrine ${input.doctrineId} was not found`);
      const event = eventFromInput('doctrine_contested', input.doctrineId, input, {
        reason: requireText('reason', input.reason),
        severity: input.severity ?? 'medium',
      }, now);
      return appendDoctrineEvent(db, event);
    },

    listCandidates(options = {}) {
      return sorted([...replay(db).candidates.values()].filter((candidate) =>
        (!options.status || candidate.status === options.status)
        && (!options.projectDir || candidate.projectDir === options.projectDir)
        && (!options.decisionClass || candidate.decisionClass === options.decisionClass),
      ));
    },

    listEpisodes(options = {}) {
      return sorted([...replay(db).episodes.values()].filter((episode) =>
        (!options.projectDir || episode.projectDir === options.projectDir)
        && (!options.decisionClass || episode.decisionClass === options.decisionClass),
      ));
    },

    getDoctrine(doctrineId) {
      const state = replay(db);
      const doctrine = getCandidateByDoctrineId(state, doctrineId);
      if (!doctrine) return null;
      const experiment = doctrine.experimentId ? state.experiments.get(doctrine.experimentId) ?? null : null;
      const retrievals = sorted([...state.retrievals.values()].filter((item) => item.doctrineIds.includes(doctrineId)));
      const applications = sorted([...state.applications.values()].filter((item) => item.doctrineId === doctrineId));
      const applicationIds = new Set(applications.map((item) => item.id));
      const outcomes = sorted([...state.outcomes.values()].filter((item) => applicationIds.has(item.applicationId)));
      return {
        doctrine,
        episode: state.episodes.get(doctrine.episodeId) ?? null,
        experiment,
        retrievals,
        applications,
        outcomes,
      };
    },

    getExperiment(experimentId) {
      return replay(db).experiments.get(experimentId) ?? null;
    },
  };
}
