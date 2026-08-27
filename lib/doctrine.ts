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
  'doctrine_harvested',
  'doctrine_candidate_induced',
  'experiment_preregistered',
  'treatment_run_recorded',
  'doctrine_revision_admitted',
  'doctrine_retrieved',
  'doctrine_applied',
  'outcome_recorded',
  'doctrine_contested',
  'doctrine_superseded',
  'doctrine_retired',
] as const;

export type DoctrineEvidenceKind = (typeof DOCTRINE_EVENT_KINDS)[number];
export type DoctrineStatus = 'candidate' | 'provisional' | 'established' | 'contested' | 'retired';
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

/**
 * The reproducibility envelope for one factual replay arm.  This is kept on
 * the arm itself rather than inferred from a caller's narrative or from the
 * ambient event provenance: admission compares the two factual arms directly.
 */
export interface DoctrineReplayContext {
  model: string;
  modelVersion: string;
  harness: string;
  worktree: string;
  environment: string;
  checkpoint: string;
  /** Immutable identifier for the independently executed replay replica. */
  replicaId: string;
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
  /**
   * Optional recurring-episode harvest that freezes the observations this
   * candidate generalizes from. The candidate's anchor episode must belong to
   * it, so this link cannot silently launder unrelated evidence.
   */
  harvestId?: string;
  /**
   * Optional prior revision whose boundary this candidate is intended to
   * refine. Supersession itself is a later, separate immutable event.
   */
  supersedesDoctrineId?: string;
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
  /** Required for factual arms so admission can compare actual replay conditions. */
  replayContext: DoctrineReplayContext;
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

/**
 * A bounded offline harvest is not an inference engine. It merely freezes a
 * recurring, exact-decision-class observation set already present in the
 * Harbor ledger, together with the citations that make those observations
 * inspectable later.
 */
export interface DoctrineHarvestInput extends DoctrineInputBase {
  id?: string;
  decisionClass: string;
  episodeIds: string[];
  summary: string;
}

export interface DoctrineSupersedeInput extends DoctrineInputBase {
  doctrineId: string;
  successorDoctrineId: string;
  reason: string;
}

export interface DoctrineRetireInput extends DoctrineInputBase {
  doctrineId: string;
  reason: string;
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

export interface DoctrineHarvestObservation {
  episodeId: string;
  occurredAt: string;
  summary: string;
  historicalAction: string;
  alternatives: string[];
  cues: string[];
  fidelity: string;
  citations: string[];
}

export interface DoctrineHarvest {
  id: string;
  projectDir: string;
  actorId: string;
  citations: string[];
  occurredAt: string;
  decisionClass: string;
  summary: string;
  episodeIds: string[];
  observations: DoctrineHarvestObservation[];
}

export interface DoctrineCandidate {
  id: string;
  doctrineId: string | null;
  episodeId: string;
  harvestId: string | null;
  supersedesDoctrineId: string | null;
  supersededByDoctrineId: string | null;
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
  retirementReason: string | null;
  retiredAt: string | null;
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
  projectDir: string;
  actorId: string;
  arm: 'control' | 'treatment' | 'sham';
  action: string;
  outcome: string;
  fidelity: ReplayFidelity;
  /** Null only for historical events written before replay-context enforcement. */
  replayContext: DoctrineReplayContext | null;
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
  harvest: DoctrineHarvest | null;
  /** The cited predecessor when this is a candidate/new revision. */
  supersededDoctrine: DoctrineCandidate | null;
  /** The active replacement when this revision was superseded. */
  successor: DoctrineCandidate | null;
  /** All preregistered experiments for this candidate, including pre-admission work. */
  experiments: DoctrineExperiment[];
  experiment: DoctrineExperiment | null;
  retrievals: DoctrineRetrievalReceipt[];
  applications: DoctrineApplication[];
  outcomes: DoctrineOutcome[];
}

interface DoctrineProjection {
  episodes: Map<string, DecisionEpisode>;
  harvests: Map<string, DoctrineHarvest>;
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
  harvest(input: DoctrineHarvestInput): AppendResult & { harvestId: string };
  proposeCandidate(input: DoctrineCandidateInput): AppendResult & { candidateId: string; doctrineId: string };
  preregisterExperiment(input: ExperimentInput): AppendResult & { experimentId: string };
  recordTreatmentRun(input: TreatmentRunInput): AppendResult & { runId: string };
  admit(input: AdmitDoctrineInput): AppendResult & { doctrineId: string };
  retrieve(input: DoctrineRetrieveInput): DoctrinePacket;
  recordApplication(input: DoctrineApplicationInput): AppendResult & { applicationId: string };
  recordOutcome(input: DoctrineOutcomeInput): AppendResult & { outcomeId: string };
  contest(input: DoctrineContestInput): AppendResult;
  supersede(input: DoctrineSupersedeInput): AppendResult & { doctrineId: string; successorDoctrineId: string };
  retire(input: DoctrineRetireInput): AppendResult & { doctrineId: string };
  listCandidates(options?: { status?: DoctrineStatus; projectDir?: string; decisionClass?: string }): DoctrineCandidate[];
  listEpisodes(options?: { projectDir?: string; decisionClass?: string }): DecisionEpisode[];
  listHarvests(options?: { projectDir?: string; decisionClass?: string }): DoctrineHarvest[];
  getDoctrine(id: string): DoctrineDetail | null;
  getExperiment(id: string): DoctrineExperiment | null;
  getHarvest(id: string): DoctrineHarvest | null;
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

function asReplayContext(value: unknown): DoctrineReplayContext | null {
  if (!isRecord(value)) return null;
  const context = {
    model: asString(value.model).trim(),
    modelVersion: asString(value.modelVersion).trim(),
    harness: asString(value.harness).trim(),
    worktree: asString(value.worktree).trim(),
    environment: asString(value.environment).trim(),
    checkpoint: asString(value.checkpoint).trim(),
    replicaId: asString(value.replicaId).trim(),
  };
  return Object.values(context).every(Boolean) ? context : null;
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

function requireReplayContext(value: unknown): DoctrineReplayContext {
  const replayContext = asReplayContext(value);
  if (!replayContext) {
    throw new DoctrineValidationError(
      'replayContext requires model, modelVersion, harness, worktree, environment, checkpoint, and replicaId for every factual replay arm',
    );
  }
  return replayContext;
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

/**
 * Idempotency returns the original append only for the same semantic request.
 * Harbor's generic key index deliberately cannot compare schema-specific
 * doctrine payloads, so the doctrine boundary rejects a changed body that
 * tries to reuse a prior key. Event IDs and server-chosen timestamps are
 * intentionally excluded: a transport retry can generate both anew.
 */
function stableDoctrineJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableDoctrineJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableDoctrineJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function sameDoctrineRequest(
  left: CanonicalEvent,
  right: CanonicalEvent,
  allowCanonicalEntityRemap = false,
): boolean {
  const leftRequest: Record<string, unknown> = { ...left };
  const rightRequest: Record<string, unknown> = { ...right };
  delete leftRequest.eventId;
  delete leftRequest.occurredAt;
  delete rightRequest.eventId;
  delete rightRequest.occurredAt;
  if (allowCanonicalEntityRemap) {
    delete leftRequest.entityId;
    delete rightRequest.entityId;
  }
  return stableDoctrineJson(leftRequest) === stableDoctrineJson(rightRequest);
}

function appendDoctrineEvent(
  db: DatabaseInstance,
  event: CanonicalEvent,
  options: { allowCanonicalEntityRemap?: boolean } = {},
): AppendResult {
  // The ledger's stream discriminator protects storage shape. The frozen JSON
  // contract also protects the event-family semantics (including lifecycle
  // kind enum) before a fact becomes durable.
  assertAgainstSchema('doctrine-evidence', event);
  const existing = doctrineEventForIdempotency(db, event.idempotencyKey);
  // Retrieval retries intentionally read the old receipt rather than rebuilding
  // current advice, and are validated against their decision tuple in `retrieve`.
  if (
    existing
    && event.kind !== 'doctrine_retrieved'
    && !sameDoctrineRequest(existing, event, options.allowCanonicalEntityRemap)
  ) {
    throw new DoctrineStateError(
      `idempotencyKey ${JSON.stringify(event.idempotencyKey)} conflicts with its immutable ${existing.kind} request`,
    );
  }
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

function asCanonicalDoctrineEvent(value: unknown): CanonicalEvent | null {
  if (!isRecord(value) || value.schema !== DOCTRINE_SCHEMA || !isRecord(value.payload)) return null;
  const kind = asString(value.kind) as DoctrineEvidenceKind;
  if (!DOCTRINE_EVENT_KINDS.includes(kind)) return null;
  const entityId = asString(value.entityId);
  const idempotencyKey = asString(value.idempotencyKey);
  const projectDir = asString(value.projectDir);
  if (!entityId || !idempotencyKey || !projectDir) return null;
  return value as unknown as CanonicalEvent;
}

function doctrineEvents(db: DatabaseInstance): CanonicalEvent[] {
  return readEvents(db, { streamType: 'doctrine-evidence' })
    .flatMap((row): CanonicalEvent[] => {
      try {
        const event = asCanonicalDoctrineEvent(JSON.parse(row.payload_json));
        return event ? [event] : [];
      } catch {
        return [];
      }
    });
}

function doctrineEventForIdempotency(db: DatabaseInstance, idempotencyKey: string): CanonicalEvent | null {
  return doctrineEvents(db).find((event) => event.idempotencyKey === idempotencyKey) ?? null;
}

/**
 * A doctrine entity is born exactly once.  The generic Harbor idempotency
 * index protects replays by key, but it intentionally cannot know that a
 * fresh request tried to reuse a semantic candidate/episode/experiment id
 * under a *different* key.  This narrow check closes that identity hole while
 * preserving the canonical retry path: the same kind + entity + project +
 * idempotency key returns the existing immutable event.
 */
function assertImmutableEntityWrite(
  db: DatabaseInstance,
  kind: DoctrineEvidenceKind,
  entityId: string,
  input: DoctrineInputBase,
  projectDir: string,
  entityExists: boolean,
  label: string,
  allowCanonicalEntityRemap = false,
): boolean {
  const idempotencyKey = input.idempotencyKey ?? `${kind}:${entityId}`;
  const events = doctrineEvents(db);
  const byIdempotency = events.find((event) => event.idempotencyKey === idempotencyKey);
  if (byIdempotency) {
    if (
      byIdempotency.kind === kind
      && byIdempotency.projectDir === projectDir
      && (byIdempotency.entityId === entityId || allowCanonicalEntityRemap)
    ) {
      return true;
    }
    throw new DoctrineStateError(
      `idempotencyKey ${JSON.stringify(idempotencyKey)} already belongs to immutable ${byIdempotency.kind} ${byIdempotency.entityId}`,
    );
  }
  if (entityExists || events.some((event) => event.kind === kind && event.entityId === entityId)) {
    throw new DoctrineStateError(
      `${label} ${JSON.stringify(entityId)} already exists; create a successor or a new entity instead of rewriting immutable evidence`,
    );
  }
  return false;
}

function replay(db: DatabaseInstance): DoctrineProjection {
  const projection: DoctrineProjection = {
    episodes: new Map(),
    harvests: new Map(),
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
      // An entity is immutable at birth.  First write wins during replay too,
      // so a malformed historical duplicate cannot rewrite the factual base.
      if (projection.episodes.has(entityId)) continue;
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

    if (kind === 'doctrine_harvested') {
      if (projection.harvests.has(entityId)) continue;
      const observations = Array.isArray(payload.observations)
        ? payload.observations.flatMap((observation): DoctrineHarvestObservation[] => {
          if (!isRecord(observation)) return [];
          const episodeId = asString(observation.episodeId);
          if (!episodeId) return [];
          return [{
            episodeId,
            occurredAt: asString(observation.occurredAt),
            summary: asString(observation.summary),
            historicalAction: asString(observation.historicalAction),
            alternatives: asStrings(observation.alternatives),
            cues: asStrings(observation.cues),
            fidelity: asString(observation.fidelity, 'T0'),
            citations: asStrings(observation.citations),
          }];
        })
        : [];
      projection.harvests.set(entityId, {
        id: entityId,
        projectDir,
        actorId,
        citations,
        occurredAt,
        decisionClass: asString(payload.decisionClass),
        summary: asString(payload.summary),
        episodeIds: asStrings(payload.episodeIds),
        observations,
      });
      continue;
    }

    if (kind === 'doctrine_candidate_induced') {
      if (projection.candidates.has(entityId)) continue;
      projection.candidates.set(entityId, {
        id: entityId,
        doctrineId: asNullableString(payload.doctrineId),
        episodeId: asString(payload.episodeId),
        harvestId: asNullableString(payload.harvestId),
        supersedesDoctrineId: asNullableString(payload.supersedesDoctrineId),
        supersededByDoctrineId: null,
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
        retirementReason: null,
        retiredAt: null,
      });
      continue;
    }

    if (kind === 'experiment_preregistered') {
      if (projection.experiments.has(entityId)) continue;
      const candidateId = asString(payload.candidateId);
      const candidate = projection.candidates.get(candidateId);
      // A preregistration is evidence for one candidate in one project.  Do
      // not let a malformed historical event manufacture a cross-project link.
      if (!candidate || candidate.projectDir !== projectDir) continue;
      projection.experiments.set(entityId, {
        id: entityId,
        candidateId,
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
      if (!experiment || experiment.projectDir !== projectDir || experiment.runs.some((run) => run.id === entityId)) continue;
      const arm = asString(payload.arm) as DoctrineTreatmentRun['arm'];
      if (!['control', 'treatment', 'sham'].includes(arm)) continue;
      experiment.runs.push({
        id: entityId,
        experimentId: experiment.id,
        projectDir,
        actorId,
        arm,
        action: asString(payload.action),
        outcome: asString(payload.outcome),
        fidelity: asString(payload.fidelity, 'not-run') as ReplayFidelity,
        replayContext: asReplayContext(payload.replayContext),
        notes: asNullableString(payload.notes),
        occurredAt,
        citations,
      });
      continue;
    }

    if (kind === 'doctrine_revision_admitted') {
      const candidate = projection.candidates.get(asString(payload.candidateId));
      const experiment = projection.experiments.get(asString(payload.experimentId));
      if (
        !candidate
        || !experiment
        || candidate.projectDir !== projectDir
        || experiment.projectDir !== projectDir
        || experiment.candidateId !== candidate.id
        || candidate.status !== 'candidate'
        || candidate.experimentId !== null
        || (candidate.doctrineId !== null && candidate.doctrineId !== entityId)
      ) continue;
      candidate.doctrineId = entityId;
      // One factual pair is a first-cycle observation, never a promotion to
      // established doctrine.  Later recurrence/transfer evidence needs its
      // own explicit gate rather than a caller-provided status string.
      candidate.status = 'provisional';
      candidate.reviewerId = asNullableString(payload.reviewerId);
      candidate.experimentId = asNullableString(payload.experimentId);
      candidate.admissionCitations = citations;
      candidate.contestedReason = null;
      candidate.retirementReason = null;
      candidate.retiredAt = null;
      continue;
    }

    if (kind === 'doctrine_retrieved') {
      if (projection.retrievals.has(entityId)) continue;
      const decisionClass = asString(payload.decisionClass);
      const doctrineIds = asStrings(payload.doctrineIds).filter((doctrineId) => {
        const candidate = getCandidateByDoctrineId(projection, doctrineId);
        return candidate?.projectDir === projectDir && candidate.decisionClass === decisionClass;
      });
      projection.retrievals.set(entityId, {
        id: entityId,
        decisionId: asString(payload.decisionId),
        decisionClass,
        projectDir,
        actorId,
        occurredAt,
        doctrineIds,
        citations,
      });
      continue;
    }

    if (kind === 'doctrine_applied') {
      if (projection.applications.has(entityId)) continue;
      const response = asString(payload.response) as DoctrineApplicationResponse;
      if (!['follow', 'adapt', 'reject'].includes(response)) continue;
      const retrievalId = asString(payload.retrievalId);
      const doctrineId = asString(payload.doctrineId);
      const retrieval = projection.retrievals.get(retrievalId);
      const doctrine = getCandidateByDoctrineId(projection, doctrineId);
      if (
        !retrieval
        || !doctrine
        || retrieval.projectDir !== projectDir
        || doctrine.projectDir !== projectDir
        || !retrieval.doctrineIds.includes(doctrineId)
      ) continue;
      projection.applications.set(entityId, {
        id: entityId,
        retrievalId,
        doctrineId,
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
      if (projection.outcomes.has(entityId)) continue;
      const verdict = asString(payload.verdict) as DoctrineOutcomeVerdict;
      if (!['helped', 'harmed', 'inconclusive'].includes(verdict)) continue;
      const applicationId = asString(payload.applicationId);
      const doctrineId = asString(payload.doctrineId);
      const application = projection.applications.get(applicationId);
      const doctrine = getCandidateByDoctrineId(projection, doctrineId);
      if (
        !application
        || !doctrine
        || application.projectDir !== projectDir
        || doctrine.projectDir !== projectDir
        || application.doctrineId !== doctrineId
      ) continue;
      projection.outcomes.set(entityId, {
        id: entityId,
        applicationId,
        doctrineId,
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

    if (kind === 'doctrine_contested') {
      const candidate = [...projection.candidates.values()].find((item) => item.doctrineId === entityId);
      if (!candidate || candidate.projectDir !== projectDir) continue;
      if (!['provisional', 'established'].includes(candidate.status)) continue;
      candidate.status = 'contested';
      candidate.contestedReason = asNullableString(payload.reason);
      continue;
    }

    if (kind === 'doctrine_superseded') {
      const candidate = [...projection.candidates.values()].find((item) => item.doctrineId === entityId);
      const successorDoctrineId = asNullableString(payload.successorDoctrineId);
      const successor = successorDoctrineId ? getCandidateByDoctrineId(projection, successorDoctrineId) : undefined;
      if (
        !candidate
        || !successor
        || candidate.projectDir !== projectDir
        || successor.projectDir !== projectDir
        || candidate.decisionClass !== successor.decisionClass
        || successor.supersedesDoctrineId !== entityId
        || !['provisional', 'established'].includes(candidate.status)
      ) continue;
      candidate.status = 'retired';
      candidate.supersededByDoctrineId = successorDoctrineId;
      candidate.retirementReason = asNullableString(payload.reason);
      candidate.retiredAt = occurredAt;
      continue;
    }

    if (kind === 'doctrine_retired') {
      const candidate = [...projection.candidates.values()].find((item) => item.doctrineId === entityId);
      if (
        !candidate
        || candidate.projectDir !== projectDir
        || !['provisional', 'established', 'contested'].includes(candidate.status)
      ) continue;
      candidate.status = 'retired';
      candidate.retirementReason = asNullableString(payload.reason);
      candidate.retiredAt = occurredAt;
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

function factualContextsMatch(left: DoctrineReplayContext, right: DoctrineReplayContext): boolean {
  return left.model === right.model
    && left.modelVersion === right.modelVersion
    && left.harness === right.harness
    && left.worktree === right.worktree
    && left.environment === right.environment
    && left.checkpoint === right.checkpoint;
}

function experimentHasFidelityGate(experiment: DoctrineExperiment): boolean {
  const factualControls = experiment.runs.filter(
    (run): run is DoctrineTreatmentRun & { replayContext: DoctrineReplayContext } =>
      run.arm === 'control' && run.fidelity === 'matched' && run.replayContext !== null,
  );
  const factualTreatments = experiment.runs.filter(
    (run): run is DoctrineTreatmentRun & { replayContext: DoctrineReplayContext } =>
      run.arm === 'treatment' && run.fidelity === 'matched' && run.replayContext !== null,
  );
  return factualControls.some((control) => factualTreatments.some((treatment) =>
    control.replayContext.replicaId !== treatment.replayContext.replicaId
      && factualContextsMatch(control.replayContext, treatment.replayContext),
  ));
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
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const episodeId = input.id ?? id('episode');
      assertImmutableEntityWrite(
        db,
        'decision_episode_recorded',
        episodeId,
        input,
        projectDir,
        state.episodes.has(episodeId),
        'decision episode',
        input.id === undefined,
      );
      const event = eventFromInput('decision_episode_recorded', episodeId, input, {
        decisionClass: requireText('decisionClass', input.decisionClass),
        summary: requireText('summary', input.summary),
        historicalAction: requireText('historicalAction', input.historicalAction),
        alternatives: asStrings(input.alternatives),
        cues: asStrings(input.cues),
        fidelity: input.fidelity ?? 'T0',
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, episodeId: canonical.entityId };
    },

    harvest(input) {
      const state = replay(db);
      const decisionClass = requireText('decisionClass', input.decisionClass);
      const projectDir = requireText('projectDir', input.projectDir);
      const episodeIds = [...new Set(asStrings(input.episodeIds).map((episodeId) => episodeId.trim()).filter(Boolean))];
      if (episodeIds.length < 2) {
        throw new DoctrineValidationError(
          'harvest requires at least two distinct recurring decision episodes; one episode is an observation, not a harvested pattern',
        );
      }
      const episodes = episodeIds.map((episodeId) => {
        const episode = state.episodes.get(episodeId);
        if (!episode) throw new DoctrineNotFoundError(`decision episode ${episodeId} was not found in the doctrine ledger`);
        if (episode.projectDir !== projectDir || episode.decisionClass !== decisionClass) {
          throw new DoctrineStateError(
            'harvest episodes must share the caller projectDir and the exact structured decisionClass; cross-class aggregation is not a doctrine experiment',
          );
        }
        return episode;
      });
      const citations = [...new Set([
        ...requireCitations(input.citations),
        ...episodes.flatMap((episode) => episode.citations),
      ])];
      const harvestId = input.id ?? id('doctrine-harvest');
      assertImmutableEntityWrite(
        db,
        'doctrine_harvested',
        harvestId,
        input,
        projectDir,
        state.harvests.has(harvestId),
        'doctrine harvest',
        input.id === undefined,
      );
      const observations: DoctrineHarvestObservation[] = episodes.map((episode) => ({
        episodeId: episode.id,
        occurredAt: episode.occurredAt,
        summary: episode.summary,
        historicalAction: episode.historicalAction,
        alternatives: [...episode.alternatives],
        cues: [...episode.cues],
        fidelity: episode.fidelity,
        citations: [...episode.citations],
      }));
      const event = eventFromInput('doctrine_harvested', harvestId, { ...input, citations }, {
        decisionClass,
        summary: requireText('summary', input.summary),
        episodeIds,
        observations,
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, harvestId: canonical.entityId };
    },

    proposeCandidate(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const decisionClass = requireText('decisionClass', input.decisionClass);
      const episodeId = requireText('episodeId', input.episodeId);
      const episode = state.episodes.get(episodeId);
      if (!episode) throw new DoctrineNotFoundError(`decision episode ${episodeId} was not found in the doctrine ledger`);
      if (episode.projectDir !== projectDir || episode.decisionClass !== decisionClass) {
        throw new DoctrineStateError(
          'candidate projectDir and decisionClass must exactly match its cited decision episode',
        );
      }
      const harvest = input.harvestId
        ? state.harvests.get(requireText('harvestId', input.harvestId))
        : undefined;
      if (input.harvestId && !harvest) {
        throw new DoctrineNotFoundError(`doctrine harvest ${input.harvestId} was not found`);
      }
      if (harvest && (
        harvest.projectDir !== projectDir
        || harvest.decisionClass !== decisionClass
        || !harvest.episodeIds.includes(episodeId)
      )) {
        throw new DoctrineStateError(
          'candidate harvest must have the same projectDir and exact decisionClass and include the candidate anchor episode',
        );
      }
      const predecessor = input.supersedesDoctrineId
        ? getCandidateByDoctrineId(state, requireText('supersedesDoctrineId', input.supersedesDoctrineId))
        : undefined;
      if (input.supersedesDoctrineId && !predecessor) {
        throw new DoctrineNotFoundError(`superseded doctrine ${input.supersedesDoctrineId} was not found`);
      }
      if (predecessor && (
        predecessor.projectDir !== projectDir
        || predecessor.decisionClass !== decisionClass
      )) {
        throw new DoctrineStateError(
          'a successor candidate must cite a predecessor from the same projectDir and exact decisionClass',
        );
      }
      const candidateId = input.id ?? id('doctrine-candidate');
      const doctrineId = input.doctrineId ?? `doctrine:${candidateId}`;
      const canonicalRetry = assertImmutableEntityWrite(
        db,
        'doctrine_candidate_induced',
        candidateId,
        input,
        projectDir,
        state.candidates.has(candidateId),
        'doctrine candidate',
        input.id === undefined,
      );
      const existingDoctrine = getCandidateByDoctrineId(state, doctrineId);
      if (!canonicalRetry && existingDoctrine && existingDoctrine.id !== candidateId) {
        throw new DoctrineStateError(
          `doctrineId ${JSON.stringify(doctrineId)} already belongs to immutable candidate ${existingDoctrine.id}`,
        );
      }
      const citations = [...new Set([
        ...requireCitations(input.citations),
        ...(harvest?.citations ?? []),
        ...(predecessor?.citations ?? []),
        ...(predecessor?.admissionCitations ?? []),
      ])];
      const event = eventFromInput('doctrine_candidate_induced', candidateId, { ...input, citations }, {
        doctrineId,
        episodeId,
        harvestId: harvest?.id ?? null,
        supersedesDoctrineId: predecessor?.doctrineId ?? null,
        decisionClass,
        title: requireText('title', input.title),
        when: requireText('when', input.when),
        prefer: requireText('prefer', input.prefer),
        over: requireText('over', input.over),
        because: requireText('because', input.because),
        unless: asStrings(input.unless),
        school: input.school ?? null,
        skillRefs: asStrings(input.skillRefs),
      }, now);
      const append = appendDoctrineEvent(db, event, {
        allowCanonicalEntityRemap: input.id === undefined,
      });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return {
        ...append,
        candidateId: canonical.entityId,
        doctrineId: asString(canonical.payload.doctrineId, doctrineId),
      };
    },

    preregisterExperiment(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const candidateId = requireText('candidateId', input.candidateId);
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new DoctrineNotFoundError(`doctrine candidate ${input.candidateId} was not found`);
      }
      if (candidate.projectDir !== projectDir) {
        throw new DoctrineStateError('experiment projectDir must exactly match its candidate projectDir');
      }
      const experimentId = input.id ?? id('doctrine-experiment');
      assertImmutableEntityWrite(
        db,
        'experiment_preregistered',
        experimentId,
        input,
        projectDir,
        state.experiments.has(experimentId),
        'doctrine experiment',
        input.id === undefined,
      );
      const event = eventFromInput('experiment_preregistered', experimentId, input, {
        candidateId,
        hypothesis: requireText('hypothesis', input.hypothesis),
        primaryOutcome: requireText('primaryOutcome', input.primaryOutcome),
        control: requireText('control', input.control),
        treatment: requireText('treatment', input.treatment),
        sham: input.sham ?? null,
        preregisteredAt: input.preregisteredAt ?? date(input.occurredAt, now),
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, experimentId: canonical.entityId };
    },

    recordTreatmentRun(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const experimentId = requireText('experimentId', input.experimentId);
      const experiment = state.experiments.get(experimentId);
      if (!experiment) {
        throw new DoctrineNotFoundError(`doctrine experiment ${input.experimentId} was not found`);
      }
      if (experiment.projectDir !== projectDir) {
        throw new DoctrineStateError('treatment run projectDir must exactly match its preregistered experiment projectDir');
      }
      if (!['control', 'treatment', 'sham'].includes(input.arm)) {
        throw new DoctrineValidationError('arm must be control, treatment, or sham');
      }
      if (!['not-run', 'matched', 'mismatched'].includes(input.fidelity)) {
        throw new DoctrineValidationError('fidelity must be not-run, matched, or mismatched');
      }
      const replayContext = requireReplayContext(input.replayContext);
      const runId = input.id ?? id('doctrine-run');
      assertImmutableEntityWrite(
        db,
        'treatment_run_recorded',
        runId,
        input,
        projectDir,
        experiment.runs.some((run) => run.id === runId),
        'doctrine replay run',
        input.id === undefined,
      );
      const event = eventFromInput('treatment_run_recorded', runId, input, {
        experimentId,
        arm: input.arm,
        action: requireText('action', input.action),
        outcome: requireText('outcome', input.outcome),
        fidelity: input.fidelity,
        replayContext,
        notes: input.notes ?? null,
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, runId: canonical.entityId };
    },

    admit(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const candidate = state.candidates.get(requireText('candidateId', input.candidateId));
      if (!candidate) throw new DoctrineNotFoundError(`doctrine candidate ${input.candidateId} was not found`);
      const experiment = state.experiments.get(requireText('experimentId', input.experimentId));
      if (!experiment || experiment.candidateId !== candidate.id) {
        throw new DoctrineStateError('admission requires a preregistered experiment belonging to this candidate');
      }
      if (candidate.projectDir !== projectDir || experiment.projectDir !== projectDir) {
        throw new DoctrineStateError('admission projectDir must exactly match both its candidate and preregistered experiment');
      }
      if (input.status === 'established') {
        throw new DoctrineStateError(
          'first-cycle admission is provisional only; recurrence and transfer evidence require a later explicit promotion gate',
        );
      }
      if (input.doctrineId && candidate.doctrineId && input.doctrineId !== candidate.doctrineId) {
        throw new DoctrineStateError(
          'admission cannot replace a candidate doctrineId; record a successor candidate instead of changing history in place',
        );
      }
      const doctrineId = input.doctrineId ?? candidate.doctrineId ?? `doctrine:${candidate.id}`;
      const admissionIdempotencyKey = input.idempotencyKey ?? `doctrine_revision_admitted:${doctrineId}`;
      const priorAdmission = doctrineEventForIdempotency(db, admissionIdempotencyKey);
      const canonicalAdmissionRetry = priorAdmission?.kind === 'doctrine_revision_admitted'
        && priorAdmission.projectDir === projectDir
        && priorAdmission.entityId === doctrineId;
      // Terminal revisions are historical evidence, not candidates waiting to
      // be retried. Preserve the original admission receipt only for its exact
      // canonical retry; every fresh write must create a successor instead.
      if (!canonicalAdmissionRetry && (candidate.status === 'contested' || candidate.status === 'retired')) {
        throw new DoctrineStateError(
          'a contested or retired doctrine remains immutable historical evidence and cannot be admitted or reactivated',
        );
      }
      const canonicalRetry = assertImmutableEntityWrite(
        db,
        'doctrine_revision_admitted',
        doctrineId,
        input,
        projectDir,
        candidate.experimentId !== null,
        'doctrine admission',
      );
      if (!canonicalRetry && candidate.status !== 'candidate') {
        if (candidate.status === 'contested' || candidate.status === 'retired') {
          throw new DoctrineStateError(
            'a contested or retired doctrine remains immutable historical evidence and cannot be admitted or reactivated',
          );
        }
        throw new DoctrineStateError('this candidate has already been admitted; retry the original idempotency key or create a successor candidate');
      }
      if (!experimentHasFidelityGate(experiment)) {
        throw new DoctrineStateError(
          'admission requires matched factual control and treatment runs with matching replay contexts and distinct replicaIds; a prompt-only or unmatched replay cannot establish a doctrine',
        );
      }
      const event = eventFromInput('doctrine_revision_admitted', doctrineId, input, {
        candidateId: candidate.id,
        experimentId: experiment.id,
        reviewerId: requireText('reviewerId', input.reviewerId),
        status: 'provisional',
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, doctrineId: canonical.entityId };
    },

    retrieve(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const decisionId = requireText('decisionId', input.decisionId);
      const decisionClass = requireText('decisionClass', input.decisionClass);
      const limit = Math.max(1, Math.min(input.limit ?? 3, 10));
      const retrievalId = input.id ?? id('doctrine-retrieval');
      const idempotencyKey = input.idempotencyKey ?? `doctrine_retrieved:${retrievalId}`;
      const canonicalRetry = doctrineEventForIdempotency(db, idempotencyKey);
      if (
        canonicalRetry
        && canonicalRetry.kind === 'doctrine_retrieved'
        && canonicalRetry.projectDir === projectDir
        && (
          asString(canonicalRetry.payload.decisionId) !== decisionId
          || asString(canonicalRetry.payload.decisionClass) !== decisionClass
        )
      ) {
        throw new DoctrineStateError(
          'a retrieval idempotencyKey may only retry the same projectDir, decisionId, and exact decisionClass receipt',
        );
      }
      assertImmutableEntityWrite(
        db,
        'doctrine_retrieved',
        retrievalId,
        input,
        projectDir,
        state.retrievals.has(retrievalId),
        'doctrine retrieval receipt',
        input.id === undefined,
      );
      const doctrines = sorted([...state.candidates.values()]
        .filter((candidate) =>
          candidate.projectDir === projectDir
          && candidate.decisionClass === decisionClass
          && (candidate.status === 'provisional' || candidate.status === 'established')
          && candidate.doctrineId,
        ))
        .slice(0, limit);
      const citations = [...new Set([...input.citations, ...doctrines.flatMap((doctrine) => doctrine.admissionCitations)])];
      const event = eventFromInput('doctrine_retrieved', retrievalId, { ...input, citations }, {
        decisionId,
        decisionClass,
        limit,
        doctrineIds: doctrines.map((doctrine) => doctrine.doctrineId!).filter(Boolean),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      const canonicalDoctrineIds = asStrings(canonical.payload.doctrineIds);
      const canonicalDoctrines = canonicalDoctrineIds.flatMap((doctrineId) => {
        const doctrine = getCandidateByDoctrineId(state, doctrineId);
        return doctrine ? [doctrine] : [];
      });
      const receipt: DoctrineRetrievalReceipt = {
        id: canonical.entityId,
        decisionId: asString(canonical.payload.decisionId),
        decisionClass: asString(canonical.payload.decisionClass),
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
        doctrines: canonicalDoctrines,
        advisory: true,
        retrievalPolicy: 'structured-exact-decision-class',
      };
    },

    recordApplication(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const retrieval = state.retrievals.get(requireText('retrievalId', input.retrievalId));
      if (!retrieval) throw new DoctrineNotFoundError(`retrieval receipt ${input.retrievalId} was not found`);
      const doctrine = getCandidateByDoctrineId(state, requireText('doctrineId', input.doctrineId));
      if (!doctrine || !retrieval.doctrineIds.includes(input.doctrineId)) {
        throw new DoctrineStateError('application must reference a doctrine actually shown in the retrieval receipt');
      }
      if (retrieval.projectDir !== projectDir || doctrine.projectDir !== projectDir) {
        throw new DoctrineStateError('application projectDir must exactly match both its retrieval receipt and shown doctrine');
      }
      if (!['follow', 'adapt', 'reject'].includes(input.response)) {
        throw new DoctrineValidationError('response must be follow, adapt, or reject');
      }
      const applicationId = input.id ?? id('doctrine-application');
      assertImmutableEntityWrite(
        db,
        'doctrine_applied',
        applicationId,
        input,
        projectDir,
        state.applications.has(applicationId),
        'doctrine application',
        input.id === undefined,
      );
      const event = eventFromInput('doctrine_applied', applicationId, input, {
        retrievalId: retrieval.id,
        doctrineId: doctrine.doctrineId,
        response: input.response,
        decision: requireText('decision', input.decision),
        note: input.note ?? null,
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, applicationId: canonical.entityId };
    },

    recordOutcome(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const application = state.applications.get(requireText('applicationId', input.applicationId));
      if (!application) throw new DoctrineNotFoundError(`doctrine application ${input.applicationId} was not found`);
      const doctrine = getCandidateByDoctrineId(state, application.doctrineId);
      if (!doctrine || application.projectDir !== projectDir || doctrine.projectDir !== projectDir) {
        throw new DoctrineStateError('outcome projectDir must exactly match its application and applied doctrine');
      }
      if (!['helped', 'harmed', 'inconclusive'].includes(input.verdict)) {
        throw new DoctrineValidationError('verdict must be helped, harmed, or inconclusive');
      }
      const outcomeId = input.id ?? id('doctrine-outcome');
      assertImmutableEntityWrite(
        db,
        'outcome_recorded',
        outcomeId,
        input,
        projectDir,
        state.outcomes.has(outcomeId),
        'doctrine outcome',
        input.id === undefined,
      );
      const event = eventFromInput('outcome_recorded', outcomeId, input, {
        applicationId: application.id,
        doctrineId: application.doctrineId,
        verdict: input.verdict,
        summary: requireText('summary', input.summary),
        verifiedBy: requireText('verifiedBy', input.verifiedBy),
      }, now);
      const append = appendDoctrineEvent(db, event, { allowCanonicalEntityRemap: input.id === undefined });
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, outcomeId: canonical.entityId };
    },

    contest(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const candidate = getCandidateByDoctrineId(state, requireText('doctrineId', input.doctrineId));
      if (!candidate) throw new DoctrineNotFoundError(`doctrine ${input.doctrineId} was not found`);
      if (candidate.projectDir !== projectDir) {
        throw new DoctrineStateError('contest must be recorded in the doctrine projectDir');
      }
      if (candidate.status === 'retired') {
        throw new DoctrineStateError('a retired doctrine remains historical evidence and cannot be moved back into another lifecycle state');
      }
      if (!['provisional', 'established'].includes(candidate.status)) {
        throw new DoctrineStateError('only an admitted active doctrine can be contested');
      }
      const event = eventFromInput('doctrine_contested', input.doctrineId, input, {
        reason: requireText('reason', input.reason),
        severity: input.severity ?? 'medium',
      }, now);
      return appendDoctrineEvent(db, event);
    },

    supersede(input) {
      const state = replay(db);
      const projectDir = requireText('projectDir', input.projectDir);
      const doctrineId = requireText('doctrineId', input.doctrineId);
      const successorDoctrineId = requireText('successorDoctrineId', input.successorDoctrineId);
      if (doctrineId === successorDoctrineId) {
        throw new DoctrineValidationError('a doctrine cannot supersede itself');
      }
      const predecessor = getCandidateByDoctrineId(state, doctrineId);
      if (!predecessor) throw new DoctrineNotFoundError(`doctrine ${doctrineId} was not found`);
      const successor = getCandidateByDoctrineId(state, successorDoctrineId);
      if (!successor) throw new DoctrineNotFoundError(`successor doctrine ${successorDoctrineId} was not found`);
      const duplicateRetry = predecessor.status === 'retired'
        && predecessor.supersededByDoctrineId === successorDoctrineId;
      if (!duplicateRetry && !['provisional', 'established'].includes(predecessor.status)) {
        throw new DoctrineStateError('only an active provisional or established doctrine can be superseded');
      }
      if (!duplicateRetry && !['provisional', 'established'].includes(successor.status)) {
        throw new DoctrineStateError('a successor must already be an active provisional or established doctrine');
      }
      if (
        predecessor.projectDir !== successor.projectDir
        || predecessor.projectDir !== projectDir
        || predecessor.decisionClass !== successor.decisionClass
        || successor.supersedesDoctrineId !== doctrineId
      ) {
        throw new DoctrineStateError(
          'supersession requires an active successor that explicitly cites this doctrine and shares the caller exact projectDir and decisionClass',
        );
      }
      const event = eventFromInput('doctrine_superseded', doctrineId, input, {
        successorDoctrineId,
        reason: requireText('reason', input.reason),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return {
        ...append,
        doctrineId: canonical.entityId,
        successorDoctrineId: asString(canonical.payload.successorDoctrineId, successorDoctrineId),
      };
    },

    retire(input) {
      const state = replay(db);
      const doctrineId = requireText('doctrineId', input.doctrineId);
      const doctrine = getCandidateByDoctrineId(state, doctrineId);
      if (!doctrine) throw new DoctrineNotFoundError(`doctrine ${doctrineId} was not found`);
      const duplicateRetry = doctrine.status === 'retired' && doctrine.supersededByDoctrineId === null;
      if (!duplicateRetry && !['provisional', 'established', 'contested'].includes(doctrine.status)) {
        throw new DoctrineStateError('only an admitted or contested doctrine can be retired; candidate evidence is already inactive');
      }
      if (doctrine.projectDir !== requireText('projectDir', input.projectDir)) {
        throw new DoctrineStateError('retirement must be recorded in the doctrine projectDir');
      }
      const event = eventFromInput('doctrine_retired', doctrineId, input, {
        reason: requireText('reason', input.reason),
      }, now);
      const append = appendDoctrineEvent(db, event);
      const canonical = canonicalEventAfterAppend(db, append, event);
      return { ...append, doctrineId: canonical.entityId };
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

    listHarvests(options = {}) {
      return sorted([...replay(db).harvests.values()].filter((harvest) =>
        (!options.projectDir || harvest.projectDir === options.projectDir)
        && (!options.decisionClass || harvest.decisionClass === options.decisionClass),
      ));
    },

    getDoctrine(doctrineId) {
      const state = replay(db);
      const doctrine = getCandidateByDoctrineId(state, doctrineId);
      if (!doctrine) return null;
      // Candidate→experiment linkage is usable before admission too: a
      // preregistration is already real evidence even though `experimentId`
      // on the candidate is reserved for the eventual admission event.
      const experiments = sorted([...state.experiments.values()].filter((item) => item.candidateId === doctrine.id));
      const experiment = doctrine.experimentId
        ? state.experiments.get(doctrine.experimentId) ?? experiments[0] ?? null
        : experiments[0] ?? null;
      const retrievals = sorted([...state.retrievals.values()].filter((item) => item.doctrineIds.includes(doctrineId)));
      const applications = sorted([...state.applications.values()].filter((item) => item.doctrineId === doctrineId));
      const applicationIds = new Set(applications.map((item) => item.id));
      const outcomes = sorted([...state.outcomes.values()].filter((item) => applicationIds.has(item.applicationId)));
      return {
        doctrine,
        episode: state.episodes.get(doctrine.episodeId) ?? null,
        harvest: doctrine.harvestId ? state.harvests.get(doctrine.harvestId) ?? null : null,
        supersededDoctrine: doctrine.supersedesDoctrineId
          ? getCandidateByDoctrineId(state, doctrine.supersedesDoctrineId) ?? null
          : null,
        successor: doctrine.supersededByDoctrineId
          ? getCandidateByDoctrineId(state, doctrine.supersededByDoctrineId) ?? null
          : null,
        experiments,
        experiment,
        retrievals,
        applications,
        outcomes,
      };
    },

    getExperiment(experimentId) {
      return replay(db).experiments.get(experimentId) ?? null;
    },

    getHarvest(harvestId) {
      return replay(db).harvests.get(harvestId) ?? null;
    },
  };
}
