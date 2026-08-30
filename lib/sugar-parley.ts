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
import {
  AUTOMATIC_PARLEY_DEFAULTS,
  SUGAR_PARLEY_SCHEMA_VERSION,
  createSugarParleyHookContext,
  sugarParleyCardId,
} from './parley.js';
import type {
  ParleyOutcome,
  ParleySummary,
  SettleAutomaticConsensusInput,
  SugarParleyHookContext,
  SettleAutomaticConsensusResult,
  SugarParleySettledReceipt,
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
import {
  activeClaimAddress,
  activeClaimEvidenceRef,
  activeClaimScope,
  detectClaimOverlaps,
  formatActiveClaimAddress,
  type ActiveClaim,
} from './suggestion-broker.js';
import {
  type SugarParleySettlementInput as SessionSugarParleySettlementInput,
  type SugarParleySettlementResult as SessionSugarParleySettlementResult,
} from './sessions.js';
import { isReviewedSemanticWhoisHit, type WhoisHit } from './whois.js';

export { SUGAR_PARLEY_SCHEMA_VERSION } from './parley.js';
export type { SugarParleyHookContext } from './parley.js';
export const SUGAR_PARLEY_CARD_LIMIT = 1 as const;
export const SUGAR_PARLEY_NOTE_MAX_CHARS = 2_000;
export const SUGAR_PARLEY_SETTLEMENT_MAX_CHARS = 2_000;
/** The final canonical agreement is a Parley turn, so it has this hard cap. */
export const SUGAR_PARLEY_SETTLEMENT_CONTENT_MAX_CHARS = 16_384;

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

export type SugarParleySettlementAcknowledgementState = 'awaiting-peer' | 'rejected' | 'failed' | 'replayed';

/**
 * A response to an acknowledgement attempt, never a terminal settlement.
 * The terminal receipt kind is reserved for a fully committed `settled`
 * outcome and is delivered to both bounded parties from the Parley outbox.
 */
export interface SugarParleySettlementAcknowledgement {
  kind: 'sugar_parley_settlement_acknowledgement';
  schemaVersion: typeof SUGAR_PARLEY_SCHEMA_VERSION;
  state: SugarParleySettlementAcknowledgementState;
  parleyId: string;
  proposalId: string | null;
  surface: string | null;
  outcome: ParleyOutcome | null;
  remindersSuppressed: boolean;
  replayed: boolean;
  reason: string;
}

export type SugarParleySettlementReceipt = SugarParleySettledReceipt | SugarParleySettlementAcknowledgement;

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

interface RawClaim extends ActiveClaim {
  sessionFileId: number | null;
}

interface SessionReader {
  get(sessionId: string): unknown;
  list(options?: Record<string, unknown>): unknown;
  listAllActiveClaims(options?: Record<string, unknown>): unknown;
  getNotes?(sessionId?: string | null, options?: { type?: string; limit?: number }): unknown;
  applySugarParleySettlement?(input: SessionSugarParleySettlementInput): SessionSugarParleySettlementResult;
}

interface ActorResolver {
  resolveActor(agentId: string): { actorId: string; soulClass: string };
}

interface WhoisReader {
  search(
    query: string,
    options?: { kind?: 'agent'; limit?: number; semanticReview?: boolean },
  ): Promise<WhoisHit[]>;
}

interface SugarParleyAuthority {
  get(parleyId: string, harbor?: string): ParleySummary | null;
  settleAutomaticConsensus(input: SettleAutomaticConsensusInput): SettleAutomaticConsensusResult;
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

/**
 * Parse the canonical one-based, inclusive session-claim line coordinate.
 *
 * Symbol-index exports add one to tree-sitter's zero-based rows before they
 * become claim data, and the broker renders those values as human-facing
 * `#Lstart-end` evidence. Zero is therefore a parser-internal row, not a
 * valid persisted claim line; malformed, negative, or fractional values are
 * rejected by the claim parser rather than being silently shifted or widened.
 *
 * @param value - Untrusted claim coordinate from the sessions projection.
 * @returns A positive one-based integer, or null when no canonical line exists.
 */
function finiteLine(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/**
 * Preserve the distinction between an intentionally omitted whole-file range
 * and a malformed range received from an authority projection.
 *
 * Session claims use one-based, inclusive coordinates. `null` / `undefined`
 * mean that the original claim intentionally named the whole file; a supplied
 * `0`, negative number, fractional number, or non-number must instead reject
 * the claim. Treating a malformed coordinate as absent would widen it into a
 * whole-file overlap and could manufacture a Sugar card from bad evidence.
 *
 * @param value - Untrusted optional coordinate from the sessions projection.
 * @returns Whether the value is canonical, plus its one-based line or null.
 */
function parseOptionalClaimLine(value: unknown): { valid: boolean; line: number | null } {
  if (value === null || value === undefined) return { valid: true, line: null };
  const line = finiteLine(value);
  return line === null ? { valid: false, line: null } : { valid: true, line };
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
  const startLine = parseOptionalClaimLine(value.startLine);
  const endLine = parseOptionalClaimLine(value.endLine);
  if (!startLine.valid || !endLine.valid) return null;
  const agentId = stringField(value.agentId);
  return {
    filePath,
    repoId: stringField(value.repoId),
    worldKind: stringField(value.worldKind),
    worldId: stringField(value.worldId),
    sessionId,
    agentId,
    sessionFileId: finitePositiveInt(value.sessionFileId) ?? finitePositiveInt(value.legacySessionFileId),
    purpose: stringField(value.purpose) ?? '',
    phase: stringField(value.phase) ?? 'in_progress',
    claimedAt,
    symbolPath: stringField(value.symbolPath),
    symbol: stringField(value.symbol),
    startLine: startLine.line,
    endLine: endLine.line,
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

/**
 * Resolve the minted actor that is authoritative for one live session.
 *
 * A Sugar begin mints an actor and intentionally keeps its generated display
 * agent id separate from the actor-soul alias table. We therefore accept the
 * daemon-written session stamp when it round-trips to the same known soul.
 * A malformed, absent, or unknown stamp fails closed: a display handle is
 * transport metadata and must never become session authority.
 */
function resolveSessionActor(session: RawSession, actorSouls: ActorResolver): string | null {
  if (!session.verifiedActorId) return null;
  try {
    const resolved = actorSouls.resolveActor(session.verifiedActorId);
    return resolved?.soulClass !== 'unknown' && resolved.actorId === session.verifiedActorId
      ? session.verifiedActorId
      : null;
  } catch {
    return null;
  }
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

function claimRef(claim: RawClaim): string {
  return activeClaimEvidenceRef(claim);
}

function stableSurface(claim: RawClaim): string {
  const address = formatActiveClaimAddress(claim);
  const scope = activeClaimScope(claim);
  // The broker's exact repo/world/file scope is part of the automatic Parley
  // identity as well as its overlap decision. A readable address alone would
  // let the same two actors on another worktree share a cooldown lineage.
  // Keep the human address legible while appending an unambiguous digest of
  // the canonical scope/address tuple for storage, caps, and cooldowns.
  const identity = JSON.stringify([scope.repoId, scope.worldKind, scope.worldId, address]);
  const scopeDigest = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
  const readable = `session-begin:${address} [${scope.repoId}/${scope.worldKind}/${scope.worldId}]@${scopeDigest}`;
  if (readable.length <= CONFLICT_SIGNAL_LIMITS.maxSurfaceChars) return readable;
  const digest = createHash('sha256').update(identity, 'utf8').digest('hex');
  return `session-begin:${digest}`;
}

function evidenceRefForHit(hit: WhoisHit, actorId: string): string {
  return `semantic-peer:${actorId}:${hit.agentId}:${hit.stage}`;
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

interface SugarParleyCardDerivation {
  card: SugarParleyCard;
  signal: ConflictSignal;
}

/** The private derivation retains the server-only signal while public preview stays card-only. */
type SugarParleyDerivationResult =
  | { state: 'ready'; card: SugarParleyCard; signal: ConflictSignal }
  | { state: 'none'; reason: string }
  | { state: 'unavailable'; reason: string };

function reviewedSemanticPeers(
  hits: WhoisHit[],
  currentActorId: string,
  actorSouls: ActorResolver,
  activeSessions: RawSession[],
): SemanticPeer[] {
  const byActor = new Map<string, SemanticPeer>();
  for (const hit of hits) {
    // This is the same reviewed-hit policy used by ordinary `pd begin` peer
    // suggestions. A lexical candidate may reach whois's reranker, but Sugar
    // only acts once the canonical result itself is semantic or LLM-reviewed.
    if (!isReviewedSemanticWhoisHit(hit)) {
      continue;
    }
    const stampedActors = [...new Set(
      activeSessions
        .filter((session) => session.agentId === hit.agentId)
        .map((session) => resolveSessionActor(session, actorSouls))
        .filter((candidate): candidate is string => Boolean(candidate)),
    )].sort();
    // A Whois display handle is only a candidate selector. It becomes a
    // Parley party only when exactly one ACTIVE session with that same handle
    // carries a verified actor stamp. Resolving the display alias directly
    // would let a stale/ambiguous phonebook row nominate an unrelated session
    // for a mutable automatic convening.
    const actorId = stampedActors.length === 1 ? stampedActors[0] : null;
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
): SugarParleyCardDerivation {
  const structuralEvidence: SugarParleyStructuralEvidence = {
    address: activeClaimAddress(sourceClaim),
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
  const surface = stableSurface(sourceClaim);
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
      // Observation time is deliberately server-owned and excluded from the
      // stable signal identity; automatic admission still rejects stale
      // replays before any bounded Parley is created.
      producedAt: Date.now(),
    },
  };
  const decision = shouldConvene(signal, { mode: 'automatic' });
  const resolveReason = decision.convene
    ? null
    : decision.reason;
  return {
    card: {
      kind: 'sugar_parley_card',
      schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
      cardId: sugarParleyCardId(signal.signalId),
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
    },
    signal,
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
  const content = JSON.stringify({
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
  return content.length <= SUGAR_PARLEY_SETTLEMENT_CONTENT_MAX_CHARS ? content : '';
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

/**
 * Coordinates a normal Sugar entry point with the durable Parley substrate.
 * The public preview is read-only. Only `resolveTogether` can admit work, and
 * it re-derives the card before using its signal so a client cannot forge
 * parties, surfaces, or evidence references.
 */
export function createSugarParley(deps: SugarParleyDeps) {
  /**
   * Re-derive the card and its server-only signal from live canonical state.
   * The purpose is to make Resolve together consume a fresh authority result,
   * while a preview can safely expose only the human-facing card.
   *
   * @param input - Credential-derived current session and actor identity.
   * @returns A card plus private signal, or an explicit non-admission result.
   */
  async function derive(input: SugarParleyPreviewInput): Promise<SugarParleyDerivationResult> {
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
    // Claim collision semantics are canonical in the suggestion broker. Sugar
    // only intersects that already-defined structural truth with whois's
    // semantically reviewed peer list; it is not a second overlap detector.
    const claimsByEvidenceRef = new Map(claims.map((claim) => [claimRef(claim), claim]));
    const structuralOverlaps = detectClaimOverlaps(claims)
      .filter((overlap) => overlap.a.sessionId === sourceSession.id || overlap.b.sessionId === sourceSession.id)
      .map((overlap) => {
        const source = overlap.a.sessionId === sourceSession.id ? overlap.a : overlap.b;
        const peer = overlap.a.sessionId === sourceSession.id ? overlap.b : overlap.a;
        return {
          source: claimsByEvidenceRef.get(activeClaimEvidenceRef(source)),
          peer: claimsByEvidenceRef.get(activeClaimEvidenceRef(peer)),
        };
      })
      .filter((overlap): overlap is { source: RawClaim; peer: RawClaim } => Boolean(overlap.source && overlap.peer))
      .sort((left, right) => (
        claimRef(left.peer).localeCompare(claimRef(right.peer))
        || claimRef(left.source).localeCompare(claimRef(right.source))
      ));
    let semanticHits: WhoisHit[];
    try {
      semanticHits = await deps.whois.search(purpose, {
        kind: 'agent',
        limit: 32,
        // Sugar can convene a bounded Parley from this result, so it requests
        // the shared vector review even when two peers chose identical words.
        semanticReview: true,
      });
    } catch {
      return { state: 'unavailable', reason: 'The shared semantic resolver is unavailable; no lexical fallback is permitted.' };
    }
    const peers = reviewedSemanticPeers(semanticHits, actorId, deps.actorSouls, sessions);
    if (peers.length === 0) {
      return { state: 'none', reason: 'No semantically reviewed live peer is relevant enough to coordinate.' };
    }
    if (structuralOverlaps.length === 0) {
      return { state: 'none', reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.' };
    }

    for (const peer of peers) {
      for (const peerSession of sessionsForActor(sessions, deps.actorSouls, peer.actorId)) {
        const overlap = structuralOverlaps.find((candidate) => candidate.peer.sessionId === peerSession.id);
        if (!overlap) continue;
        const derived = buildCard(input, sourceSession, overlap.source, peerSession, overlap.peer, peer);
        const { card } = derived;
        return card.decision.policyCleared
          ? { state: 'ready', card, signal: derived.signal }
          : { state: 'none', reason: card.decision.reason };
      }
    }

    return { state: 'none', reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.' };
  }

  async function preview(input: SugarParleyPreviewInput): Promise<SugarParleyPreview> {
    const derived = await derive(input);
    return derived.state === 'ready'
      ? { state: 'ready', card: derived.card }
      : derived;
  }

  async function resolveTogether(input: SugarParleyConveneInput): Promise<SugarParleyConveningReceipt> {
    const derived = await derive(input);
    if (derived.state !== 'ready') {
      return {
        kind: 'sugar_parley_convening_receipt',
        schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
        state: 'rejected',
        cardId: '',
        signalId: stringField(input.signalId) ?? '',
        parleyId: null,
        reason: derived.reason,
        hookContext: null,
      };
    }
    const { card, signal } = derived;
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
    const result = deps.parleyAutoTrigger.evaluate(signal, {
      harbor,
      origin: 'sugar-parley',
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
      ? createSugarParleyHookContext({
        parleyId: result.parleyId,
        signalId: card.signalId,
        surface: card.surface,
        evidenceRefs: [
          card.structuralEvidence.sourceClaimRef,
          card.structuralEvidence.peerClaimRef,
          card.semanticEvidence.evidenceRef,
        ],
      })
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
    const acknowledgement = (
      state: SugarParleySettlementAcknowledgementState,
      reason: string,
      fields: Partial<Omit<SugarParleySettlementAcknowledgement, 'kind' | 'schemaVersion' | 'state' | 'reason'>> = {},
    ): SugarParleySettlementAcknowledgement => ({
      kind: 'sugar_parley_settlement_acknowledgement',
      schemaVersion: SUGAR_PARLEY_SCHEMA_VERSION,
      state,
      parleyId: stringField(input.parleyId) ?? '',
      proposalId: null,
      surface: null,
      outcome: null,
      remindersSuppressed: false,
      replayed: false,
      reason,
      ...fields,
    });
    if (!deps.parley || !deps.sessions.applySugarParleySettlement || !deps.sessions.getNotes) {
      return acknowledgement('rejected', 'The typed settlement authority is unavailable; no claim or plan mutation was attempted.');
    }
    const sessionId = stringField(input.sessionId);
    const actorId = stringField(input.actorId);
    const parleyId = stringField(input.parleyId);
    const harbor = stringField(input.harbor);
    const summaryText = boundedSettlementText(input.summary);
    const nextStep = boundedSettlementText(input.nextStep);
    if (!sessionId || !actorId || !parleyId || !harbor || !summaryText || !nextStep) {
      return acknowledgement('rejected', 'A canonical session, actor, harbor, Parley, summary, and next step are required for typed settlement.');
    }
    const sourceSession = parseSessionDetail(deps.sessions.get(sessionId));
    if (!sourceSession || sourceSession.status !== 'active'
      || resolveSessionActor(sourceSession, deps.actorSouls) !== actorId) {
      return acknowledgement('rejected', 'The current actor is not authorized for the active settlement session.', { parleyId });
    }
    const current = deps.parley.get(parleyId, harbor);
    const automatic = current?.parley.automatic;
    const membership = automatic?.participants.find((participant) => participant.actorId === actorId);
    if (!current || !automatic || automatic.origin !== 'sugar-parley'
      || automatic.checkpoint !== 'session_begin'
      || automatic.kind !== 'task_convergence' || !membership || membership.sessionId !== sessionId) {
      return acknowledgement('rejected', 'This actor and session are not members of a bounded Sugar Parley.', { parleyId });
    }
    const evidenceRefs = canonicalStrings(automatic.evidenceRefs);
    const content = canonicalSettlementContent({
      parleyId,
      surface: current.parley.surface,
      evidenceRefs,
      summary: summaryText,
      nextStep,
    });
    if (!content) {
      return acknowledgement('rejected', `The canonical settlement exceeds ${SUGAR_PARLEY_SETTLEMENT_CONTENT_MAX_CHARS} characters.`, {
        parleyId,
        surface: current.parley.surface,
      });
    }
    const proposalId = settlementProposalId(content);
    const claims = parseClaims(deps.sessions.listAllActiveClaims());
    if (!claims) {
      return acknowledgement('rejected', 'The active-claim authority could not be read for this settlement.', {
        parleyId,
        proposalId,
        surface: current.parley.surface,
      });
    }
    const participantBySession = new Map(
      automatic.participants.map((participant) => [participant.sessionId, participant]),
    );
    const selectedClaims = claims
      .filter((claim) => participantBySession.has(claim.sessionId)
        && evidenceRefs.includes(claimRef(claim)))
      .sort((left, right) => claimRef(left).localeCompare(claimRef(right)));
    const selectedSessionIds = new Set(selectedClaims.map((claim) => claim.sessionId));
    const expectedSessionIds = [...participantBySession.keys()].sort();
    if (selectedClaims.length !== expectedSessionIds.length
      || selectedSessionIds.size !== expectedSessionIds.length
      || expectedSessionIds.some((id) => !selectedSessionIds.has(id))
      || selectedClaims.some((claim) => claim.sessionFileId === null
        || claim.agentId === null
        || claim.agentId !== participantBySession.get(claim.sessionId)!.inboxTarget)) {
      return acknowledgement('rejected', 'The evidence no longer resolves to one exact active claim for every bounded participant.', {
        parleyId,
        proposalId,
        surface: current.parley.surface,
      });
    }
    const settlementClaims: SessionSugarParleySettlementInput['claims'] = selectedClaims.map((claim) => ({
      sessionId: claim.sessionId,
      agentId: claim.agentId!,
      sessionFileId: claim.sessionFileId!,
      claimRef: claimRef(claim),
    }));
    const settlementLine = `- [x] Sugar Parley settlement ${proposalId}: ${nextStep}`;
    const plans: SessionSugarParleySettlementInput['plans'] = automatic.participants
      .slice()
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map((participant) => {
        const existingPlan = extractLatestPlan(deps.sessions.getNotes!(participant.sessionId, { type: 'todo_list', limit: 1 }));
        const contentForPlan = existingPlan ? `${existingPlan}\n${settlementLine}` : settlementLine;
        return {
          sessionId: participant.sessionId,
          agentId: participant.inboxTarget,
          content: contentForPlan,
          type: 'todo_list' as const,
        };
      });
    if (plans.some((plan) => plan.content.length > SUGAR_PARLEY_SETTLEMENT_CONTENT_MAX_CHARS)) {
      return acknowledgement('rejected', `A settlement plan receipt exceeds ${SUGAR_PARLEY_SETTLEMENT_CONTENT_MAX_CHARS} characters.`, {
        parleyId,
        proposalId,
        surface: current.parley.surface,
      });
    }
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
        finalize: () => {
          const effects = deps.sessions.applySugarParleySettlement!({
            claims: settlementClaims,
            plans,
          });
          if (!effects.success) {
            throw new Error(`Sugar settlement effects did not commit: ${effects.code}: ${effects.error}`);
          }
          return {
            claimUpdates: effects.claimUpdates.map((update) => ({
              sessionId: update.sessionId,
              claimRef: update.claimRef,
              released: update.released,
            })),
            planUpdates: effects.planUpdates.map((update) => ({
              sessionId: update.sessionId,
              updated: update.updated,
            })),
            reason: 'The typed settlement released the exact evidence-bound claims, appended checked plan receipts, and suppressed its settled reminder lineage.',
          };
        },
      });
    } catch (error) {
      return acknowledgement('failed', error instanceof Error ? error.message : 'The typed settlement could not commit.', {
        parleyId,
        proposalId,
        surface: current.parley.surface,
      });
    }
    if (!result.settled) {
      return acknowledgement('awaiting-peer', 'Typed settlement recorded; it will take effect only when every bounded participant acknowledges this exact settlement.', {
        parleyId,
        proposalId,
        surface: current.parley.surface,
        outcome: result.outcome,
        replayed: result.replayed,
      });
    }
    if (result.replayed || !result.settlementReceipt) {
      return acknowledgement('replayed', 'The typed settlement was already settled. Read the durable inbox receipt rather than treating this retry as a new terminal receipt.', {
        parleyId,
        proposalId,
        surface: current.parley.surface,
        outcome: result.outcome,
        remindersSuppressed: true,
        replayed: true,
      });
    }
    return result.settlementReceipt;
  }

  return { preview, resolveTogether, settle };
}

export type SugarParley = ReturnType<typeof createSugarParley>;
