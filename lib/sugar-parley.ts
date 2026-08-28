/**
 * Sugar-first Parley coordination
 *
 * This module is deliberately a *consumer* of the existing hybrid resolver,
 * claim authority, and automatic Parley admission. It never infers a conflict
 * from a word list or a substring. A card exists only when one semantically
 * reviewed live peer and one exact structural claim overlap point to the same
 * other canonical actor.
 */

import { createHash } from 'node:crypto';
import { asActorId } from './actor-souls.js';
import { AUTOMATIC_PARLEY_DEFAULTS } from './parley.js';
import type {
  ParleyOutcome,
  ParleySummary,
  SettleAutomaticConsensusResult,
} from './parley.js';
import { PARLEY_AUTO_TRIGGER_POLICY, type ParleyAutoTrigger } from './parley-auto-trigger.js';
import {
  CONFLICT_SIGNAL_LIMITS,
  CONFLICT_SIGNAL_PRODUCERS,
  CONFLICT_SIGNAL_SCHEMA_VERSION,
  conflictSignalId,
  shouldConvene,
  type ConflictSignal,
  type ParleyDecision,
} from './parley-trigger.js';
import { DEFAULT_SEMANTIC_REVIEW_THRESHOLD } from './semantic-resolver.js';
import type { WhoisHit } from './whois.js';

export const SUGAR_PARLEY_SCHEMA_VERSION = 1 as const;
export const SUGAR_PARLEY_CARD_LIMIT = 1 as const;
export const SUGAR_PARLEY_NOTE_MAX_CHARS = 2_000;
export const SUGAR_PARLEY_SETTLEMENT_MAX_CHARS = 2_000;

export type SugarParleyActionId = 'work-separately' | 'send-note' | 'resolve-together';
export type SugarParleyPreviewState = 'ready' | 'none' | 'unavailable';
export type SugarParleyConveneState = 'evaluated' | 'fired' | 'replayed' | 'suppressed' | 'failed' | 'rejected';

export interface SugarParleyAction {
  id: SugarParleyActionId;
  label: 'Work separately' | 'Send note' | 'Resolve together';
  enabled: boolean;
  reason: string | null;
}

export interface SugarParleyClaimAddress {
  filePath: string;
  symbolPath: string | null;
  startLine: number | null;
  endLine: number | null;
}

export interface SugarParleyStructuralEvidence {
  address: SugarParleyClaimAddress;
  sourceClaimRef: string;
  peerClaimRef: string;
}

export interface SugarParleySemanticEvidence {
  peerAgentId: string;
  peerActorId: string;
  stage: 'semantic' | 'llm';
  /**
   * The phonebook's candidate-selection label. `bm25` here still underwent
   * cosine reranking and is accepted only when the semantic vector itself
   * clears Sugar's review threshold; it is never a lexical-only fallback.
   */
  resolverStage: 'semantic' | 'bm25' | 'llm';
  score: number;
  similarity: number;
  phrase: string;
  evidenceRef: string;
}

export interface SugarParleyParticipant {
  actorId: string;
  agentId: string;
  sessionId: string;
}

export interface SugarParleyHookContext {
  kind: 'sugar_parley_hook_context';
  schemaVersion: typeof SUGAR_PARLEY_SCHEMA_VERSION;
  parleyId: string;
  cardId: string;
  surface: string;
  evidenceRefs: string[];
  message: string;
}

export interface SugarParleyCard {
  kind: 'sugar_parley_card';
  schemaVersion: typeof SUGAR_PARLEY_SCHEMA_VERSION;
  cardId: string;
  signalId: string;
  surface: string;
  reason: string;
  participants: SugarParleyParticipant[];
  semanticEvidence: SugarParleySemanticEvidence;
  structuralEvidence: SugarParleyStructuralEvidence;
  decision: ParleyDecision;
  bounds: {
    maxParleyRounds: number;
    turnsPerParty: number;
    cooldownMs: number;
  };
  actions: SugarParleyAction[];
}

export type SugarParleyPreview =
  | { state: 'ready'; card: SugarParleyCard }
  | { state: 'none'; reason: string }
  | { state: 'unavailable'; reason: string };

export interface SugarParleyConveningReceipt {
  kind: 'sugar_parley_convening_receipt';
  schemaVersion: typeof SUGAR_PARLEY_SCHEMA_VERSION;
  state: SugarParleyConveneState;
  cardId: string;
  signalId: string;
  parleyId: string | null;
  reason: string;
  hookContext: SugarParleyHookContext | null;
}

export type SugarParleySettlementState = 'awaiting-peer' | 'settled' | 'failed' | 'rejected';

export interface SugarParleySettlementReceipt {
  kind: 'sugar_parley_settlement_receipt';
  schemaVersion: typeof SUGAR_PARLEY_SCHEMA_VERSION;
  state: SugarParleySettlementState;
  parleyId: string;
  proposalId: string | null;
  surface: string | null;
  outcome: ParleyOutcome | null;
  claimUpdates: Array<{ sessionId: string; claimRef: string; released: boolean }>;
  planUpdates: Array<{ sessionId: string; updated: boolean }>;
  remindersSuppressed: boolean;
  replayed: boolean;
  reason: string;
}

export interface SugarParleyPreviewInput {
  sessionId: string;
  actorId: string;
}

export interface SugarParleyConveneInput extends SugarParleyPreviewInput {
  signalId: string;
  harbor: string;
}

export interface SugarParleySettlementInput {
  sessionId: string;
  actorId: string;
  parleyId: string;
  harbor: string;
  summary: string;
  nextStep: string;
}

interface RawSession {
  id: string;
  agentId: string;
  purpose: string;
  status: string;
  /**
   * The daemon-written ADR-0040 identity stamp. Sugar's generated display
   * handle is intentionally not an actor-soul alias, so this is the durable
   * authority that binds a normal `pd begin` session to its minted actor.
   */
  verifiedActorId: string | null;
}

interface RawClaim {
  filePath: string;
  sessionId: string;
  agentId: string | null;
  claimedAt: number;
  symbolPath: string | null;
  startLine: number | null;
  endLine: number | null;
}

interface SessionReader {
  get(sessionId: string): unknown;
  list(options?: Record<string, unknown>): unknown;
  listAllActiveClaims(options?: Record<string, unknown>): unknown;
  releaseFiles?(
    sessionId: string,
    filePaths: string[],
    options?: {
      regions?: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }>;
      agentId?: string | null;
    },
  ): unknown;
  addNote?(sessionId: string, content: string, options?: { type?: string }): unknown;
  getNotes?(sessionId?: string | null, options?: { type?: string; limit?: number }): unknown;
}

interface ActorResolver {
  resolveActor(agentId: string): { actorId: string; soulClass: string };
}

interface WhoisReader {
  search(query: string, options?: { kind?: 'agent'; limit?: number }): Promise<WhoisHit[]>;
}

interface SugarParleyAuthority {
  get(parleyId: string, harbor?: string): ParleySummary | null;
  settleAutomaticConsensus(input: {
    parleyId: string;
    harbor?: string;
    party: string;
    proposalId: string;
    content: string;
    decision: string;
    reason: string;
    evidenceRefs?: string[];
    idempotencyKey?: string;
  }): SettleAutomaticConsensusResult;
}

export interface SugarParleyDeps {
  sessions: SessionReader;
  actorSouls: ActorResolver;
  whois: WhoisReader;
  parleyAutoTrigger: Pick<ParleyAutoTrigger, 'evaluate'>;
  parley?: SugarParleyAuthority;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finitePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function finiteLine(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function parseSession(value: unknown): RawSession | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const agentId = stringField(value.agentId);
  const purpose = stringField(value.purpose);
  const status = stringField(value.status);
  let metadata = value.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const identity = isRecord(metadata) && isRecord(metadata.identity) ? metadata.identity : null;
  const verifiedActorId = identity?.verified === true ? stringField(identity.actorId) : null;
  return id && agentId && purpose && status ? { id, agentId, purpose, status, verifiedActorId } : null;
}

function parseClaim(value: unknown): RawClaim | null {
  if (!isRecord(value)) return null;
  const filePath = stringField(value.filePath);
  const sessionId = stringField(value.sessionId);
  const claimedAt = finitePositiveInt(value.claimedAt);
  if (!filePath || !sessionId || claimedAt === null) return null;
  const agentId = stringField(value.agentId);
  return {
    filePath,
    sessionId,
    agentId,
    claimedAt,
    symbolPath: stringField(value.symbolPath),
    startLine: finiteLine(value.startLine),
    endLine: finiteLine(value.endLine),
  };
}

function parseSessionDetail(value: unknown): RawSession | null {
  if (!isRecord(value) || value.success !== true) return null;
  return parseSession(value.session);
}

function parseClaims(value: unknown): RawClaim[] | null {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.claims)) return null;
  const claims = value.claims.map(parseClaim);
  return claims.every((claim) => claim !== null) ? claims as RawClaim[] : null;
}

function resolveCanonicalActor(actorSouls: ActorResolver, agentId: string): string | null {
  try {
    const resolved = actorSouls.resolveActor(agentId);
    if (!resolved || typeof resolved.actorId !== 'string' || !resolved.actorId.trim()) return null;
    return resolved.soulClass === 'unknown' ? null : resolved.actorId.trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the minted actor that is authoritative for one live session.
 *
 * A Sugar begin mints an actor and intentionally keeps its generated display
 * agent id separate from the actor-soul alias table. We therefore accept the
 * daemon-written session stamp when it round-trips to a known soul; older
 * explicit actor aliases remain supported as the narrow compatibility path.
 * A malformed or unknown stamp fails closed rather than falling through to a
 * caller-controlled display string.
 */
function resolveSessionActor(session: RawSession, actorSouls: ActorResolver): string | null {
  if (session.verifiedActorId) {
    try {
      const resolved = actorSouls.resolveActor(session.verifiedActorId);
      return resolved?.soulClass !== 'unknown' && resolved.actorId === session.verifiedActorId
        ? session.verifiedActorId
        : null;
    } catch {
      return null;
    }
  }
  return resolveCanonicalActor(actorSouls, session.agentId);
}

/**
 * Public for route wiring: delivery and the card builder must use the same
 * session-stamp authority, or ordinary `pd begin` sessions would see a card
 * that automatic Parley admission could not safely convene.
 */
export function resolveSugarParleySessionActor(session: unknown, actorSouls: ActorResolver): string | null {
  const parsed = parseSession(session);
  return parsed ? resolveSessionActor(parsed, actorSouls) : null;
}

function isWholeFileClaim(claim: RawClaim): boolean {
  return claim.symbolPath === null && claim.startLine === null && claim.endLine === null;
}

function claimsOverlap(left: RawClaim, right: RawClaim): boolean {
  if (left.filePath !== right.filePath) return false;
  if (isWholeFileClaim(left) || isWholeFileClaim(right)) return true;
  if (left.symbolPath && right.symbolPath) return left.symbolPath === right.symbolPath;
  if (left.startLine !== null && left.endLine !== null && right.startLine !== null && right.endLine !== null) {
    return left.startLine <= right.endLine && right.startLine <= left.endLine;
  }
  return false;
}

function claimAddress(claim: RawClaim): SugarParleyClaimAddress {
  return {
    filePath: claim.filePath,
    symbolPath: claim.symbolPath,
    startLine: claim.startLine,
    endLine: claim.endLine,
  };
}

function displayAddress(address: SugarParleyClaimAddress): string {
  if (address.symbolPath) return `${address.filePath}#${address.symbolPath}`;
  if (address.startLine !== null || address.endLine !== null) {
    return `${address.filePath}#L${address.startLine ?? '*'}-${address.endLine ?? '*'}`;
  }
  return address.filePath;
}

function claimRef(claim: RawClaim): string {
  return `session-claim:${claim.sessionId}:${displayAddress(claimAddress(claim))}:${claim.claimedAt}`;
}

function stableSurface(address: SugarParleyClaimAddress): string {
  const readable = `session-begin:${displayAddress(address)}`;
  if (readable.length <= CONFLICT_SIGNAL_LIMITS.maxSurfaceChars) return readable;
  const digest = createHash('sha256').update(readable, 'utf8').digest('hex');
  return `session-begin:${digest}`;
}

function evidenceRefForHit(hit: WhoisHit, actorId: string): string {
  return `semantic-peer:${actorId}:${hit.agentId}:${hit.stage}`;
}

function cardId(signalId: string): string {
  const digest = createHash('sha256').update(signalId, 'utf8').digest('hex');
  return `sugar-parley-card:v${SUGAR_PARLEY_SCHEMA_VERSION}:${digest}`;
}

function action(
  id: SugarParleyActionId,
  enabled: boolean,
  reason: string | null = null,
): SugarParleyAction {
  const label = id === 'work-separately'
    ? 'Work separately'
    : id === 'send-note'
      ? 'Send note'
      : 'Resolve together';
  return { id, label, enabled, reason };
}

interface SemanticPeer {
  hit: WhoisHit;
  actorId: string;
}

function reviewedSemanticPeers(
  hits: WhoisHit[],
  currentActorId: string,
  actorSouls: ActorResolver,
  activeSessions: RawSession[],
): SemanticPeer[] {
  const byActor = new Map<string, SemanticPeer>();
  for (const hit of hits) {
    const stage = hit.stage;
    // Whois uses BM25 only to select a bounded candidate set before doing the
    // mandatory cosine rerank. Its result label remains `bm25` when that set
    // was nonempty, so a stage-only filter would discard normal semantic
    // matches with shared vocabulary. Require BOTH independently observed
    // semantic similarity and final score; this never admits a lexical-only
    // exact/BM25 result.
    if ((stage !== 'semantic' && stage !== 'bm25' && stage !== 'llm')
      || !Number.isFinite(hit.score)
      || !Number.isFinite(hit.similarity)
      || hit.score < DEFAULT_SEMANTIC_REVIEW_THRESHOLD
      || hit.similarity < DEFAULT_SEMANTIC_REVIEW_THRESHOLD) {
      continue;
    }
    const directActor = resolveCanonicalActor(actorSouls, hit.agentId);
    const stampedActors = [...new Set(
      activeSessions
        .filter((session) => session.agentId === hit.agentId)
        .map((session) => resolveSessionActor(session, actorSouls))
        .filter((candidate): candidate is string => Boolean(candidate)),
    )].sort();
    // A shared display handle with multiple active stamped souls is ambiguous
    // by design. Do not pick one merely because it matched semantically.
    // A session's daemon-written verified actor stamp is the authoritative
    // identity for normal Sugar work. A display agent may also have an older
    // alias soul of its own; treating that alias as stronger would disconnect
    // an otherwise valid semantic hit from the session and claim that produced
    // it. Multiple distinct stamps remain ambiguous and fail closed.
    const actorId = stampedActors.length === 1
      ? stampedActors[0]
      : stampedActors.length === 0
        ? directActor
        : null;
    if (!actorId || actorId === currentActorId) continue;
    const current = byActor.get(actorId);
    if (!current
      || hit.score > current.hit.score
      || (hit.score === current.hit.score && hit.agentId.localeCompare(current.hit.agentId) < 0)) {
      byActor.set(actorId, { hit, actorId });
    }
  }
  return [...byActor.values()].sort((left, right) => (
    right.hit.score - left.hit.score
    || left.actorId.localeCompare(right.actorId)
    || left.hit.agentId.localeCompare(right.hit.agentId)
  ));
}

function sessionsForActor(
  sessions: RawSession[],
  actorSouls: ActorResolver,
  actorId: string,
): RawSession[] {
  return sessions
    .filter((session) => session.status === 'active')
    .filter((session) => resolveSessionActor(session, actorSouls) === actorId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function allActiveSessions(value: unknown): RawSession[] | null {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map(parseSession);
  return sessions.every((session) => session !== null) ? sessions as RawSession[] : null;
}

function boundedPurpose(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= CONFLICT_SIGNAL_LIMITS.maxReasonChars ? trimmed : null;
}

function buildCard(
  input: SugarParleyPreviewInput,
  sourceSession: RawSession,
  sourceClaim: RawClaim,
  peerSession: RawSession,
  peerClaim: RawClaim,
  peer: SemanticPeer,
): SugarParleyCard {
  const structuralEvidence: SugarParleyStructuralEvidence = {
    address: claimAddress(sourceClaim),
    sourceClaimRef: claimRef(sourceClaim),
    peerClaimRef: claimRef(peerClaim),
  };
  const semanticEvidence: SugarParleySemanticEvidence = {
    peerAgentId: peer.hit.agentId,
    peerActorId: peer.actorId,
    stage: peer.hit.stage === 'semantic' || peer.hit.stage === 'llm' ? peer.hit.stage : 'semantic',
    resolverStage: peer.hit.stage === 'bm25' || peer.hit.stage === 'llm' ? peer.hit.stage : 'semantic',
    score: peer.hit.score,
    similarity: peer.hit.similarity,
    phrase: peer.hit.phrase,
    evidenceRef: evidenceRefForHit(peer.hit, peer.actorId),
  };
  const participants = [
    { actorId: input.actorId, agentId: sourceSession.agentId, sessionId: sourceSession.id },
    { actorId: peer.actorId, agentId: peerSession.agentId, sessionId: peerSession.id },
  ].sort((left, right) => left.actorId.localeCompare(right.actorId));
  const evidenceRefs = canonicalStrings([
    structuralEvidence.sourceClaimRef,
    structuralEvidence.peerClaimRef,
    semanticEvidence.evidenceRef,
  ]);
  const surface = stableSurface(structuralEvidence.address);
  const signal: ConflictSignal = {
    schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
    signalId: conflictSignalId({
      checkpoint: 'session_begin',
      kind: 'task_convergence',
      surface,
      parties: participants.map((participant) => participant.actorId),
      evidenceRefs,
    }),
    kind: 'task_convergence',
    checkpoint: 'session_begin',
    shape: 'contract-net',
    parties: participants.map((participant) => participant.actorId),
    surface,
    magnitude: 1,
    confidence: Math.min(1, Math.max(DEFAULT_SEMANTIC_REVIEW_THRESHOLD, semanticEvidence.similarity)),
    reason: 'A semantically reviewed live peer holds an exact overlapping claim.',
    evidenceRefs,
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence,
      trustTier: 'INTERNAL',
      producedAt: 1,
    },
  };
  const decision = shouldConvene(signal, { mode: 'automatic' });
  const resolveReason = decision.convene
    ? null
    : decision.reason;
  return {
    kind: 'sugar_parley_card',
    schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
    cardId: cardId(signal.signalId),
    signalId: signal.signalId,
    surface,
    reason: signal.reason,
    participants,
    semanticEvidence,
    structuralEvidence,
    decision,
    bounds: {
      maxParleyRounds: 2,
      turnsPerParty: AUTOMATIC_PARLEY_DEFAULTS.roundLimit,
      cooldownMs: PARLEY_AUTO_TRIGGER_POLICY.cooldownMs,
    },
    actions: [
      action('work-separately', true),
      action('send-note', true),
      action('resolve-together', decision.convene, resolveReason),
    ],
  };
}

function signalForCard(card: SugarParleyCard): ConflictSignal {
  const evidenceRefs = canonicalStrings([
    card.structuralEvidence.sourceClaimRef,
    card.structuralEvidence.peerClaimRef,
    card.semanticEvidence.evidenceRef,
  ]);
  const parties = card.participants.map((participant) => participant.actorId).sort();
  return {
    schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
    signalId: card.signalId,
    kind: 'task_convergence',
    checkpoint: 'session_begin',
    shape: 'contract-net',
    parties,
    surface: card.surface,
    magnitude: 1,
    confidence: Math.min(1, Math.max(DEFAULT_SEMANTIC_REVIEW_THRESHOLD, card.semanticEvidence.similarity)),
    reason: card.reason,
    evidenceRefs,
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence,
      trustTier: 'INTERNAL',
      // The origin timestamp is persisted by the automatic authority. The
      // signal identity deliberately excludes this server-owned observation
      // time, so re-reading the same structural evidence is idempotent.
      producedAt: Date.now(),
    },
  };
}

/**
 * Bind automatic Parley delivery to the exact sessions that supplied the
 * freshly re-derived card. A canonical actor is allowed multiple live
 * sessions, but a card's structural evidence is only about one of them.
 */
function resolveCardParty(
  card: SugarParleyCard,
  actorId: string,
  sessions: SessionReader,
  actorSouls: ActorResolver,
) {
  const selected = card.participants.find((participant) => participant.actorId === actorId);
  if (!selected) return null;
  const live = parseSessionDetail(sessions.get(selected.sessionId));
  if (!live
    || live.status !== 'active'
    || live.agentId !== selected.agentId
    || resolveSessionActor(live, actorSouls) !== selected.actorId) {
    return null;
  }
  return {
    actorId: asActorId(selected.actorId),
    inboxTarget: selected.agentId,
    sessionId: selected.sessionId,
    lineageRootSessionId: selected.sessionId,
  };
}

function boundedSettlementText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= SUGAR_PARLEY_SETTLEMENT_MAX_CHARS ? trimmed : null;
}

function canonicalSettlementContent(input: {
  parleyId: string;
  surface: string;
  evidenceRefs: string[];
  summary: string;
  nextStep: string;
}): string {
  // Property order is intentional: the text is both the human-readable
  // settlement and the exact consensus object all parties must acknowledge.
  return JSON.stringify({
    kind: 'sugar_parley_settlement',
    schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
    parleyId: input.parleyId,
    surface: input.surface,
    evidenceRefs: canonicalStrings(input.evidenceRefs),
    claimEffect: 'release_overlapping_claims',
    planEffect: 'append_settlement_completion',
    summary: input.summary,
    nextStep: input.nextStep,
  });
}

function settlementProposalId(content: string): string {
  return `sugar-settlement:v${SUGAR_PARLEY_SCHEMA_VERSION}:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function extractLatestPlan(value: unknown): string | null {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.notes)) return null;
  for (const candidate of [...value.notes].reverse()) {
    if (!isRecord(candidate)) continue;
    const content = stringField(candidate.content) ?? stringField(candidate.note);
    if (content) return content;
  }
  return null;
}

function isSuccessful(value: unknown): boolean {
  return isRecord(value) && value.success === true;
}

/**
 * Coordinates a normal Sugar entry point with the durable Parley substrate.
 * The public preview is read-only. Only `resolveTogether` can admit work, and
 * it re-derives the card before using its signal so a client cannot forge
 * parties, surfaces, or evidence references.
 */
export function createSugarParley(deps: SugarParleyDeps) {
  async function preview(input: SugarParleyPreviewInput): Promise<SugarParleyPreview> {
    const sessionId = stringField(input.sessionId);
    const actorId = stringField(input.actorId);
    if (!sessionId || !actorId) {
      return { state: 'unavailable', reason: 'A canonical session and actor are required for coordination.' };
    }

    const sourceSession = parseSessionDetail(deps.sessions.get(sessionId));
    if (!sourceSession || sourceSession.status !== 'active') {
      return { state: 'unavailable', reason: 'The current session is not an active durable coordination subject.' };
    }
    if (resolveSessionActor(sourceSession, deps.actorSouls) !== actorId) {
      return { state: 'unavailable', reason: 'The current actor is not authorized for that session.' };
    }
    // The semantic question is a property of the durable session, never a
    // caller-supplied phrase. A forged query string must not redirect the
    // matched peer while the actor credential still proves only session access.
    const purpose = boundedPurpose(sourceSession.purpose);
    if (!purpose) {
      return { state: 'unavailable', reason: 'The active session has no bounded recorded purpose for coordination.' };
    }

    const claims = parseClaims(deps.sessions.listAllActiveClaims());
    const sessions = allActiveSessions(deps.sessions.list({ status: 'active', allWorktrees: true, limit: 1_000 }));
    if (!claims || !sessions) {
      return { state: 'unavailable', reason: 'The claim or live-session authority is unavailable.' };
    }
    const sourceClaims = claims.filter((claim) => claim.sessionId === sourceSession.id);
    if (sourceClaims.length === 0) {
      return { state: 'none', reason: 'No active structural claim is available to ground a coordination card.' };
    }

    let semanticHits: WhoisHit[];
    try {
      semanticHits = await deps.whois.search(purpose, { kind: 'agent', limit: 32 });
    } catch {
      return { state: 'unavailable', reason: 'The shared semantic resolver is unavailable; no lexical fallback is permitted.' };
    }
    const peers = reviewedSemanticPeers(semanticHits, actorId, deps.actorSouls, sessions);
    if (peers.length === 0) {
      return { state: 'none', reason: 'No semantically reviewed live peer is relevant enough to coordinate.' };
    }

    for (const peer of peers) {
      // One verified actor may deliberately retain several active sessions.
      // The semantic result names the actor, not an arbitrary earliest session;
      // inspect every current session for that actor so an unrelated older
      // session cannot hide the exact claim overlap that grounds this card.
      for (const peerSession of sessionsForActor(sessions, deps.actorSouls, peer.actorId)) {
        const peerClaims = claims.filter((claim) => claim.sessionId === peerSession.id);
        for (const sourceClaim of sourceClaims) {
          const overlap = peerClaims
            .filter((peerClaim) => claimsOverlap(sourceClaim, peerClaim))
            .sort((left, right) => claimRef(left).localeCompare(claimRef(right)))[0];
          if (!overlap) continue;
          const card = buildCard(input, sourceSession, sourceClaim, peerSession, overlap, peer);
          return card.decision.policyCleared
            ? { state: 'ready', card }
            : { state: 'none', reason: card.decision.reason };
        }
      }
    }

    return { state: 'none', reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.' };
  }

  async function resolveTogether(input: SugarParleyConveneInput): Promise<SugarParleyConveningReceipt> {
    const previewResult = await preview(input);
    if (previewResult.state !== 'ready') {
      return {
        kind: 'sugar_parley_convening_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'rejected',
        cardId: '',
        signalId: stringField(input.signalId) ?? '',
        parleyId: null,
        reason: previewResult.reason,
        hookContext: null,
      };
    }
    const card = previewResult.card;
    if (input.signalId !== card.signalId) {
      return {
        kind: 'sugar_parley_convening_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'rejected',
        cardId: card.cardId,
        signalId: input.signalId,
        parleyId: null,
        reason: 'The coordination card changed; re-read its current evidence before resolving together.',
        hookContext: null,
      };
    }
    const harbor = stringField(input.harbor);
    if (!harbor) {
      return {
        kind: 'sugar_parley_convening_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'rejected',
        cardId: card.cardId,
        signalId: card.signalId,
        parleyId: null,
        reason: 'Resolve together requires a canonical harbor.',
        hookContext: null,
      };
    }
    const result = deps.parleyAutoTrigger.evaluate(signalForCard(card), {
      harbor,
      resolveLiveParty: (candidateActorId) => (
        resolveCardParty(card, candidateActorId, deps.sessions, deps.actorSouls)
      ),
    });
    const state: SugarParleyConveneState = result.state === 'evaluated'
      || result.state === 'fired'
      || result.state === 'replayed'
      || result.state === 'suppressed'
      || result.state === 'failed'
      ? result.state
      : 'failed';
    const hookContext = result.parleyId && (state === 'fired' || state === 'replayed')
      ? {
        kind: 'sugar_parley_hook_context' as const,
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        parleyId: result.parleyId,
        cardId: card.cardId,
        surface: card.surface,
        evidenceRefs: canonicalStrings([
          card.structuralEvidence.sourceClaimRef,
          card.structuralEvidence.peerClaimRef,
          card.semanticEvidence.evidenceRef,
        ]),
        message: 'A bounded Parley is active. Reply in natural language, keep the shared surface in view, and settle only with the typed receipt.',
      }
      : null;
    return {
      kind: 'sugar_parley_convening_receipt',
      schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
      state,
      cardId: card.cardId,
      signalId: card.signalId,
      parleyId: result.parleyId,
      reason: result.reason,
      hookContext,
    };
  }

  /**
   * Record one party's typed settlement. The final matching acknowledgement
   * collapses the automatic Parley transactionally, then applies only the two
   * evidence-bound claim releases and appends a checked plan receipt to the
   * participating sessions. No caller can nominate another session, surface,
   * claim, or raw Parley operation.
   */
  function settle(input: SugarParleySettlementInput): SugarParleySettlementReceipt {
    const unavailable = (reason: string): SugarParleySettlementReceipt => ({
      kind: 'sugar_parley_settlement_receipt',
      schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
      state: 'rejected',
      parleyId: stringField(input.parleyId) ?? '',
      proposalId: null,
      surface: null,
      outcome: null,
      claimUpdates: [],
      planUpdates: [],
      remindersSuppressed: false,
      replayed: false,
      reason,
    });
    if (!deps.parley || !deps.sessions.releaseFiles || !deps.sessions.addNote || !deps.sessions.getNotes) {
      return unavailable('The typed settlement authority is unavailable; no claim or plan mutation was attempted.');
    }
    const sessionId = stringField(input.sessionId);
    const actorId = stringField(input.actorId);
    const parleyId = stringField(input.parleyId);
    const harbor = stringField(input.harbor);
    const summaryText = boundedSettlementText(input.summary);
    const nextStep = boundedSettlementText(input.nextStep);
    if (!sessionId || !actorId || !parleyId || !harbor || !summaryText || !nextStep) {
      return unavailable('A canonical session, actor, harbor, Parley, summary, and next step are required for typed settlement.');
    }
    const sourceSession = parseSessionDetail(deps.sessions.get(sessionId));
    if (!sourceSession || sourceSession.status !== 'active'
      || resolveSessionActor(sourceSession, deps.actorSouls) !== actorId) {
      return unavailable('The current actor is not authorized for the active settlement session.');
    }
    const current = deps.parley.get(parleyId, harbor);
    const automatic = current?.parley.automatic;
    const membership = automatic?.participants.find((participant) => participant.actorId === actorId);
    if (!current || !automatic || automatic.checkpoint !== 'session_begin'
      || automatic.kind !== 'task_convergence' || !membership || membership.sessionId !== sessionId) {
      return unavailable('This actor and session are not members of a bounded Sugar Parley.');
    }
    const evidenceRefs = canonicalStrings(automatic.evidenceRefs);
    const content = canonicalSettlementContent({
      parleyId,
      surface: current.parley.surface,
      evidenceRefs,
      summary: summaryText,
      nextStep,
    });
    const proposalId = settlementProposalId(content);
    let result: SettleAutomaticConsensusResult;
    try {
      result = deps.parley.settleAutomaticConsensus({
        parleyId,
        harbor,
        party: actorId,
        proposalId,
        content,
        decision: content,
        reason: 'All bounded Sugar Parley participants acknowledged the same typed settlement.',
        evidenceRefs,
      });
    } catch (error) {
      return {
        ...unavailable(error instanceof Error ? error.message : 'The typed settlement authority rejected the acknowledgement.'),
        parleyId,
        proposalId,
        surface: current.parley.surface,
      };
    }
    if (!result.settled) {
      return {
        kind: 'sugar_parley_settlement_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'awaiting-peer',
        parleyId,
        proposalId,
        surface: current.parley.surface,
        outcome: result.outcome,
        claimUpdates: [],
        planUpdates: [],
        remindersSuppressed: false,
        replayed: result.replayed,
        reason: 'Typed settlement recorded; it will take effect only when every bounded participant acknowledges this exact receipt.',
      };
    }
    if (result.replayed) {
      return {
        kind: 'sugar_parley_settlement_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'settled',
        parleyId,
        proposalId,
        surface: current.parley.surface,
        outcome: result.outcome,
        claimUpdates: [],
        planUpdates: [],
        remindersSuppressed: true,
        replayed: true,
        reason: 'The typed settlement receipt was already recorded; its bounded Parley remains settled and reminder-suppressed.',
      };
    }

    const claims = parseClaims(deps.sessions.listAllActiveClaims());
    if (!claims) {
      return {
        kind: 'sugar_parley_settlement_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'failed',
        parleyId,
        proposalId,
        surface: current.parley.surface,
        outcome: result.outcome,
        claimUpdates: [],
        planUpdates: [],
        remindersSuppressed: true,
        replayed: false,
        reason: 'The Parley settled, but the active-claim authority could not be read back to apply its typed claim effect.',
      };
    }
    const participantBySession = new Map(
      automatic.participants.map((participant) => [participant.sessionId, participant]),
    );
    const settlementClaims = claims
      .filter((claim) => participantBySession.has(claim.sessionId) && evidenceRefs.includes(claimRef(claim)))
      .sort((left, right) => claimRef(left).localeCompare(claimRef(right)));
    const claimUpdates: Array<{ sessionId: string; claimRef: string; released: boolean }> = [];
    for (const claim of settlementClaims) {
      const participant = participantBySession.get(claim.sessionId)!;
      const release = isWholeFileClaim(claim)
        ? deps.sessions.releaseFiles(claim.sessionId, [claim.filePath], { agentId: claim.agentId ?? participant.inboxTarget })
        : deps.sessions.releaseFiles(claim.sessionId, [], {
          agentId: claim.agentId ?? participant.inboxTarget,
          regions: [{
            path: claim.filePath,
            ...(claim.symbolPath ? { symbolPath: claim.symbolPath } : {}),
            ...(claim.startLine !== null ? { startLine: claim.startLine } : {}),
            ...(claim.endLine !== null ? { endLine: claim.endLine } : {}),
          }],
        });
      claimUpdates.push({
        sessionId: claim.sessionId,
        claimRef: claimRef(claim),
        released: isSuccessful(release),
      });
    }
    const claimFailure = claimUpdates.some((update) => !update.released);
    const planUpdates: Array<{ sessionId: string; updated: boolean }> = [];
    for (const participant of automatic.participants
      .slice()
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))) {
      const existingPlan = extractLatestPlan(deps.sessions.getNotes(participant.sessionId, { type: 'todo_list', limit: 1 }));
      const settlementLine = `- [x] Sugar Parley settlement ${proposalId}: ${nextStep}`;
      const updatedPlan = existingPlan ? `${existingPlan}\n${settlementLine}` : settlementLine;
      const update = updatedPlan.length <= 16_384
        ? deps.sessions.addNote(participant.sessionId, updatedPlan, { type: 'todo_list' })
        : { success: false };
      planUpdates.push({ sessionId: participant.sessionId, updated: isSuccessful(update) });
    }
    const planFailure = planUpdates.some((update) => !update.updated);
    const failed = claimFailure || planFailure;
    return {
      kind: 'sugar_parley_settlement_receipt',
      schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
      state: failed ? 'failed' : 'settled',
      parleyId,
      proposalId,
      surface: current.parley.surface,
      outcome: result.outcome,
      claimUpdates,
      planUpdates,
      remindersSuppressed: true,
      replayed: false,
      reason: failed
        ? 'The Parley settled and reminders are suppressed, but one or more evidence-bound claim or plan updates failed and require recovery.'
        : 'The typed settlement released the evidence-bound overlap, appended checked plan receipts, and suppressed its settled reminder lineage.',
    };
  }

  return { preview, resolveTogether, settle };
}

export type SugarParley = ReturnType<typeof createSugarParley>;
