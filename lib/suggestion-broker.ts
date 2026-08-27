/**
 * Suggestion broker — durable projections for the suggestibility layer
 * (ADR-0039 §Primitive 2).
 *
 * This slice ships exactly one detector: `claim-overlap-headsup`. When two *distinct*
 * active sessions hold overlapping claims on the same file, both agents get a durable
 * suggestion delivered to their inbox (surfaced by `pd attention`). This is the
 * deterministic, NLP-free floor of the layer — no embeddings, no model call — and it
 * is the exact signal that, on 2026-05-19, three agents on one dispatch-coordination
 * surface discovered only by accident, after the duplicate work was done.
 *
 * It promotes the inline git-shim soft-claim warning (ADR-0037 §Layer 1) into a
 * durable, queryable, dismissible record. The richer "same surface without a literal
 * claim overlap" case needs the semantic classifier (Primitive 1) and lands next.
 *
 * The same overlap pairs this detector emits are what parley (ADR-0055) consumes as
 * its T1 trigger — coaching here, compulsion there, one signal.
 *
 * Split into a pure detector (`detectClaimOverlaps`, trivially unit-testable) and an
 * IO orchestrator (`runOverlapScan`, deps injected) so the matching logic is verified
 * without a daemon. Symbol-claim advice deliberately does not add another detector:
 * `surfaceSymbolConflictAdvice` only projects the conflicts already returned by the
 * shipped symbol-claim evaluator into this same durable suggestion + inbox path.
 */

import type { Suggestions, SuggestionKind } from './suggestions.js';
import type { SymbolConflict } from './symbol-claims.js';
import {
  classifyClaimTreeTrouble,
  renderClaimTreeTroubleMermaid,
  type ClaimTreeTroubleFinding,
} from './claim-tree-trouble.js';

/** One active claim, as returned by `sessions.listAllActiveClaims().claims`. */
export interface ActiveClaim {
  filePath: string;
  sessionId: string;
  purpose: string;
  agentId: string | null;
  phase: string;
  claimedAt: number;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  repoId?: string;
  worldKind?: string;
  worldId?: string;
}

/** A detected overlap between two distinct sessions on one file. The *pair* is
 *  unordered — (A,B) and (B,A) collapse to one ClaimOverlap with `a` the
 *  lexicographically smaller sessionId, so the dedup key is stable across scans.
 *  Note this still yields TWO suggestions per overlap — one delivered to each
 *  agent (each sees the other as the counterpart); only the dedup key is shared. */
export interface ClaimOverlap {
  filePath: string;
  a: ActiveClaim;
  b: ActiveClaim;
}

const OVERLAP_KIND: SuggestionKind = 'claim-overlap-headsup';
const CLAIM_TREE_TROUBLE_KIND: SuggestionKind = 'claim-tree-trouble';

/**
 * Wire-format version of the nudge payload. This object crosses boundaries
 * (broker → agent inbox → `pd nudge` CLI → `list_nudges` MCP tool) and, per the
 * parley continuity model, may be read after the producing process is gone — so
 * it needs an explicit version to survive schema drift.
 *
 * Compatibility policy: consumers MUST ignore unknown fields and tolerate a
 * missing `v` (treat absent as 1, the pre-versioning shape). Bump only on a
 * BREAKING change (a removed/retyped field); additive fields do not bump. The
 * producer always stamps the current version; the reader adapts.
 */
export const SUGGESTION_PAYLOAD_VERSION = 1 as const;

/**
 * Decide whether two line ranges overlap. A null range is a whole-file claim and
 * overlaps everything. The design intent matches `rangesOverlap` in
 * `lib/sessions.ts`; this small pure copy avoids widening that module's API solely
 * for the suggestion projection.
 *
 * @param startA - Inclusive start of the first range, or null for a whole file.
 * @param endA - Inclusive end of the first range, or null for a whole file.
 * @param startB - Inclusive start of the second range, or null for a whole file.
 * @param endB - Inclusive end of the second range, or null for a whole file.
 * @returns True when the ranges share at least one line or either is whole-file.
 */
export function rangesOverlap(
  startA: number | null,
  endA: number | null,
  startB: number | null,
  endB: number | null,
): boolean {
  if (startA == null || endA == null || startB == null || endB == null) return true;
  return startA <= endB && endA >= startB;
}

/**
 * Compare two claims using the existing declared-claim semantics. The purpose is
 * deterministic overlap detection: exact symbol paths take precedence, otherwise
 * line-range overlap decides.
 *
 * @param a - First active claim.
 * @param b - Second active claim on the same file.
 * @returns True when the claims occupy the same declared surface.
 */
function claimsCollide(a: ActiveClaim, b: ActiveClaim): boolean {
  // Symbol-path claims collide iff they name the same symbol.
  if (a.symbolPath && b.symbolPath) return a.symbolPath === b.symbolPath;
  // Otherwise fall back to line-range overlap (null = whole file = overlaps all).
  return rangesOverlap(a.startLine, a.endLine, b.startLine, b.endLine);
}

const SEVERITY_CONFIDENCE_HIGH = 0.97;
const SEVERITY_CONFIDENCE_NORMAL = 0.9;

/**
 * Map overlap shape to confidence so the suggestions module's PRIORITY tier
 * actually fires for the overlaps that matter. The design keeps same-symbol and
 * whole-file collisions above the policy threshold while partial ranges stay normal.
 *
 * @param a - First overlapping claim.
 * @param b - Second overlapping claim.
 * @returns Confidence compatible with the existing suggestion priority policy.
 */
function overlapSeverityConfidence(a: ActiveClaim, b: ActiveClaim): number {
  if (a.symbolPath && b.symbolPath && a.symbolPath === b.symbolPath) return SEVERITY_CONFIDENCE_HIGH;
  const wholeFile =
    a.startLine == null || a.endLine == null || b.startLine == null || b.endLine == null;
  return wholeFile ? SEVERITY_CONFIDENCE_HIGH : SEVERITY_CONFIDENCE_NORMAL;
}

/**
 * Build the stable dedup key for an unordered session pair. The intent is that a
 * scan sees one standing overlap regardless of input order.
 *
 * @param o - Canonically ordered overlap pair.
 * @returns Stable payload hash consumed by the existing cooldown machinery.
 */
export function overlapPayloadHash(o: ClaimOverlap): string {
  return `claim-overlap:${o.filePath}:${o.a.sessionId}|${o.b.sessionId}`;
}

/**
 * Detect every distinct-session overlap on a shared file. The design is pure,
 * deterministic, and order-independent so matching behavior can be verified without
 * database or daemon state.
 *
 * @param claims - Full set of active declared file or region claims.
 * @returns Canonically ordered overlap pairs.
 */
export function detectClaimOverlaps(claims: ActiveClaim[]): ClaimOverlap[] {
  const byFile = new Map<string, ActiveClaim[]>();
  for (const c of claims) {
    const arr = byFile.get(c.filePath);
    if (arr) arr.push(c);
    else byFile.set(c.filePath, [c]);
  }

  const out: ClaimOverlap[] = [];
  for (const [filePath, fileClaims] of byFile) {
    for (let i = 0; i < fileClaims.length; i++) {
      for (let j = i + 1; j < fileClaims.length; j++) {
        const x = fileClaims[i];
        const y = fileClaims[j];
        if (x.sessionId === y.sessionId) continue; // a session never overlaps itself
        if (!claimsCollide(x, y)) continue;
        const [a, b] = x.sessionId < y.sessionId ? [x, y] : [y, x];
        out.push({ filePath, a, b });
      }
    }
  }
  return out;
}

/** Inbox surface this broker delivers through (subset of `lib/agent-inbox.ts`). */
export interface BrokerInbox {
  send(
    agentId: string,
    content: unknown,
    options?: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary' },
  ): { success: boolean; messageId?: number; error?: string };
}

/** Optional activity firehose for tuning telemetry (subset of `lib/activity.ts`). */
export interface BrokerActivityLog {
  log(type: string, detail?: Record<string, unknown>): unknown;
}

export interface SessionsClaimSource {
  listAllActiveClaims(options?: Record<string, unknown>): { success: boolean; claims: ActiveClaim[]; count: number };
}

export interface RunOverlapScanDeps {
  sessions: SessionsClaimSource;
  suggestions: Suggestions;
  inbox: BrokerInbox;
  activityLog?: BrokerActivityLog;
  /** Pending nudges older than this are expired (status='expired') at the start of
   *  each scan, so a stale overlap that was never acted on can re-surface. Defaults
   *  to DEFAULT_STALE_NUDGE_MS; pass 0/Infinity-ish to disable by sweeping nothing. */
  staleNudgeMs?: number;
}

/** A pending nudge unacted for this long is swept to 'expired' before each scan. */
export const DEFAULT_STALE_NUDGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OverlapScanResult {
  overlaps: number;
  surfaced: number;
  suppressed: number;
  delivered: number;
}

export interface ClaimTreeTroubleScanResult {
  pairs: number;
  surfaced: number;
  suppressed: number;
  delivered: number;
}

/** The symbol-claim attempt whose authoritative conflict result should become advice. */
export interface SymbolConflictAdviceInput {
  sessionId: string;
  agentId?: string | null;
  purpose?: string | null;
  conflicts: SymbolConflict[];
}

/** Injected existing delivery surfaces; conflict detection intentionally is not a dependency. */
export interface SymbolConflictAdviceDeps {
  suggestions: Suggestions;
  inbox: BrokerInbox;
  activityLog?: BrokerActivityLog;
}

/** Counts make the projection observable without changing the symbol-claim HTTP contract. */
export interface SymbolConflictAdviceResult {
  conflicts: number;
  surfaced: number;
  suppressed: number;
  delivered: number;
}

const SYMBOL_CONFLICT_CONFIDENCE = {
  blocking: 0.99,
  warning: 0.9,
  info: 0.75,
} as const;

/**
 * Explain the conflict using only the claim evaluator's returned evidence. This is
 * intentionally a formatter, not a classifier: the reason retains the authoritative
 * conflict type and both declared claim types so no second conflict engine can drift.
 *
 * @param conflict - Conflict emitted by the shipped symbol-claim evaluator.
 * @param holderLabel - Stable human label for the existing holder.
 * @returns A concise reason suitable for inbox rendering and parley initiation.
 */
function symbolConflictReason(conflict: SymbolConflict, holderLabel: string): string {
  const chain = conflict.chain?.length ? ` via ${conflict.chain.join(' -> ')}` : '';
  return `${conflict.type} conflict: requested ${conflict.a.type} on ${conflict.a.filePath}#${conflict.a.symbolPath} conflicts with ${holderLabel}'s ${conflict.b.type} claim on ${conflict.b.filePath}#${conflict.b.symbolPath}${chain}`;
}

/**
 * Produce a stable cooldown key for one request/holder/conflict tuple. The intent is
 * to suppress repeated claim retries while allowing distinct symbols, holders, or
 * conflict types to surface independently.
 *
 * @param input - Requesting session and its authoritative conflict result.
 * @param conflict - One conflict from the result.
 * @returns Stable suggestion payload hash used by the existing cooldown machinery.
 */
function symbolConflictPayloadHash(input: SymbolConflictAdviceInput, conflict: SymbolConflict): string {
  return [
    'symbol-conflict',
    input.sessionId,
    conflict.otherSessionId,
    conflict.type,
    conflict.severity,
    `${conflict.a.filePath}#${conflict.a.symbolPath}:${conflict.a.type}`,
    `${conflict.b.filePath}#${conflict.b.symbolPath}:${conflict.b.type}`,
  ].join(':');
}

/**
 * Project authoritative symbol-claim conflicts into the existing durable suggestion
 * store and agent inbox consumed by `pd attention`. The design is intentionally
 * one-way: this function never inspects claims, predicts conflicts, or changes the
 * claim verdict. It only preserves the evaluator's severity, holder/session, reason,
 * file/symbol, available dependency chain, and sanctioned parley/handoff actions.
 *
 * @param deps - Existing suggestion, inbox, and optional activity-log surfaces.
 * @param input - Requesting session plus conflicts returned by `symbolClaims.claim`.
 * @returns Projection counts for telemetry and focused tests.
 */
export function surfaceSymbolConflictAdvice(
  deps: SymbolConflictAdviceDeps,
  input: SymbolConflictAdviceInput,
): SymbolConflictAdviceResult {
  let surfaced = 0;
  let suppressed = 0;
  let delivered = 0;
  const requester = input.agentId?.trim() || input.sessionId;

  for (const conflict of input.conflicts) {
    const holder = conflict.otherAgentId?.trim() || conflict.otherSessionId;
    const reason = symbolConflictReason(conflict, holder);
    const surface = `${conflict.a.filePath}#${conflict.a.symbolPath}`;
    const handoffMessage = `Please hand off or sequence work on ${surface}. ${reason}.`;
    const payload = {
      v: SUGGESTION_PAYLOAD_VERSION,
      kind: OVERLAP_KIND,
      source: 'symbol-claim-flow',
      disposition: conflict.severity === 'blocking' ? 'blocked' : 'advisory',
      severity: conflict.severity,
      confidence: conflict.confidence,
      reason,
      surface: {
        filePath: conflict.a.filePath,
        symbolPath: conflict.a.symbolPath,
      },
      requester: {
        sessionId: input.sessionId,
        agentId: input.agentId ?? null,
        purpose: input.purpose ?? null,
        claim: conflict.a,
      },
      holder: {
        sessionId: conflict.otherSessionId,
        agentId: conflict.otherAgentId ?? null,
        claim: conflict.b,
      },
      dependencyContext: conflict.chain?.length
        ? { conflictType: conflict.type, chain: conflict.chain }
        : null,
      action: {
        kind: 'parley-or-handoff',
        parley: {
          label: 'Open a parley',
          command: 'pd',
          argv: [
            'parley', 'call',
            '--surface', surface,
            '--reason', reason,
            '--with', `${requester},${holder}`,
            '--as', requester,
          ],
        },
        handoff: {
          label: 'Request a handoff',
          command: 'pd',
          argv: ['inbox', 'send', holder, handoffMessage, '--agent', requester],
        },
      },
      message: `${conflict.severity.toUpperCase()}: ${reason}. Open a parley or request a handoff before proceeding.`,
    };

    const result = deps.suggestions.create({
      agentId: requester,
      kind: OVERLAP_KIND,
      payload,
      payloadHash: symbolConflictPayloadHash(input, conflict),
      confidence: SYMBOL_CONFLICT_CONFIDENCE[conflict.severity],
    });

    if (!result.created) {
      suppressed++;
      deps.activityLog?.log('symbol_conflict_advice.suppressed', {
        agentId: requester,
        holderSessionId: conflict.otherSessionId,
        severity: conflict.severity,
        reason: result.reason,
        filePath: conflict.a.filePath,
        symbolPath: conflict.a.symbolPath,
      });
      continue;
    }

    surfaced++;
    const sent = deps.inbox.send(requester, payload, { from: 'suggestion-broker', type: 'suggestion' });
    if (sent.success) delivered++;
    deps.activityLog?.log('symbol_conflict_advice.surfaced', {
      agentId: requester,
      holderSessionId: conflict.otherSessionId,
      severity: conflict.severity,
      suggestionId: result.suggestion.id,
      filePath: conflict.a.filePath,
      symbolPath: conflict.a.symbolPath,
      delivered: sent.success,
    });
  }

  return { conflicts: input.conflicts.length, surfaced, suppressed, delivered };
}

/**
 * Render the human summary for a declared-claim overlap. Its purpose is a compact
 * attention preview; the structured payload remains the durable source for actions.
 *
 * @param self - Recipient's own claim.
 * @param other - Counterparty claim.
 * @param filePath - Shared file surface.
 * @returns Concise coordination guidance for inbox display.
 */
function humanMessage(self: ActiveClaim, other: ActiveClaim, filePath: string): string {
  const who = other.agentId ?? other.sessionId;
  const what = other.purpose ? ` (${other.purpose})` : '';
  return `Heads-up: ${who}${what} also holds a claim on ${filePath}. Consider coordinating before you both edit it — pd inbox send, a shared channel, or a parley.`;
}

/**
 * Scan all active claims, detect cross-session overlaps, and surface a
 * `claim-overlap-headsup` to BOTH parties — subject to the suggestions module's
 * cooldown/budget/mute dampers. Re-running over a standing overlap is a no-op until
 * the cooldown lapses. The design logs suppressed surfacings instead of dropping
 * them so tuning retains evidence without turning overlap detection into inbox spam.
 *
 * Delivery is keyed by `agentId ?? sessionId` — the inbox key is an opaque string,
 * and a session without a registered agentId still gets a queryable record and an
 * inbox entry under its session id.
 *
 * @param deps - Existing sessions, suggestions, inbox, and optional telemetry surfaces.
 * @returns Counts for overlaps, surfaced/suppressed suggestions, and deliveries.
 */
export function runOverlapScan(deps: RunOverlapScanDeps): OverlapScanResult {
  const { sessions, suggestions, inbox, activityLog } = deps;

  // Sweep stale, never-acted nudges to 'expired' first, so an overlap that aged
  // out can re-surface (an expired row no longer anchors the create() cooldown).
  const staleMs = deps.staleNudgeMs ?? DEFAULT_STALE_NUDGE_MS;
  const expired = suggestions.expireStale(staleMs);
  if (expired > 0) activityLog?.log('suggestion.expired_sweep', { count: expired });

  const claimsRes = sessions.listAllActiveClaims();
  const claims = claimsRes.success ? claimsRes.claims : [];
  const overlaps = detectClaimOverlaps(claims);

  let surfaced = 0;
  let suppressed = 0;
  let delivered = 0;

  for (const o of overlaps) {
    const payloadHash = overlapPayloadHash(o);
    // Surface to each side, with that side as "you" and the other as "other".
    for (const [self, other] of [
      [o.a, o.b],
      [o.b, o.a],
    ] as [ActiveClaim, ActiveClaim][]) {
      const deliveryKey = self.agentId ?? self.sessionId;
      const payload = {
        v: SUGGESTION_PAYLOAD_VERSION,
        kind: OVERLAP_KIND,
        filePath: o.filePath,
        you: {
          sessionId: self.sessionId,
          agentId: self.agentId,
          purpose: self.purpose,
          range: { startLine: self.startLine, endLine: self.endLine, symbolPath: self.symbolPath },
        },
        other: {
          sessionId: other.sessionId,
          agentId: other.agentId,
          purpose: other.purpose,
          range: { startLine: other.startLine, endLine: other.endLine, symbolPath: other.symbolPath },
        },
        message: humanMessage(self, other, o.filePath),
      };

      const res = suggestions.create({
        agentId: deliveryKey,
        kind: OVERLAP_KIND,
        payload,
        payloadHash,
        confidence: overlapSeverityConfidence(self, other),
      });

      if (!res.created) {
        suppressed++;
        activityLog?.log('suggestion.suppressed', {
          agentId: deliveryKey,
          kind: OVERLAP_KIND,
          reason: res.reason,
          filePath: o.filePath,
        });
        continue;
      }

      surfaced++;
      const sent = inbox.send(deliveryKey, payload, { from: 'suggestion-broker', type: 'suggestion' });
      if (sent.success) delivered++;
      activityLog?.log('suggestion.surfaced', {
        agentId: deliveryKey,
        kind: OVERLAP_KIND,
        suggestionId: res.suggestion.id,
        filePath: o.filePath,
        otherSession: other.sessionId,
        delivered: sent.success,
      });
    }
  }

  return { overlaps: overlaps.length, surfaced, suppressed, delivered };
}

function sameWorld(a: ActiveClaim, b: ActiveClaim): boolean {
  return Boolean(a.repoId && b.repoId && a.worldKind && b.worldKind && a.worldId && b.worldId)
    && a.repoId === b.repoId
    && a.worldKind === b.worldKind
    && a.worldId === b.worldId;
}

function hasPrecision(claim: ActiveClaim): boolean {
  return Boolean(claim.symbolPath || (claim.startLine != null && claim.endLine != null));
}

function activePhase(claim: ActiveClaim): boolean {
  return claim.phase !== 'completed' && claim.phase !== 'abandoned';
}

function troubleConfidence(finding: ClaimTreeTroubleFinding): number {
  switch (finding.state) {
    case 'COORDINATE': return 0.97;
    case 'RESCUE': return 0.92;
    case 'VERIFY': return 0.84;
    case 'INSPECT': return 0.8;
    case 'RECONCILE': return 0.8;
    case 'WATCH': return 0.72;
    case 'PROCEED': return 0.5;
  }
}

/**
 * Project the claim forest into durable, Mermaid-carrying agent advice. Unlike
 * the legacy overlap heads-up, this is a stateful explanation: the agent sees
 * the exact finite-state outcome, evidence boundary, and next action.
 */
export function runClaimTreeTroubleScan(deps: RunOverlapScanDeps): ClaimTreeTroubleScanResult {
  const claimsRes = deps.sessions.listAllActiveClaims();
  const claims = claimsRes.success ? claimsRes.claims : [];
  const pairs: Array<[ActiveClaim, ActiveClaim]> = [];
  const byPath = new Map<string, ActiveClaim[]>();
  for (const claim of claims) {
    if (!claim.filePath) continue;
    const siblings = byPath.get(claim.filePath) ?? [];
    for (const other of siblings) if (other.sessionId !== claim.sessionId) pairs.push([other, claim]);
    siblings.push(claim);
    byPath.set(claim.filePath, siblings);
  }

  let surfaced = 0;
  let suppressed = 0;
  let delivered = 0;
  for (const [a, b] of pairs) {
    for (const [self, other] of [[a, b], [b, a]] as Array<[ActiveClaim, ActiveClaim]>) {
      const finding = classifyClaimTreeTrouble({
        sourceComplete: Boolean(self.filePath && self.sessionId && other.sessionId),
        worldComparable: sameWorld(self, other),
        counterpartActive: activePhase(other),
        claimFresh: true, // current active forest rows are the available freshness authority in this slice
        directOverlap: claimsCollide(self, other),
        precisionKnown: hasPrecision(self) && hasPrecision(other),
        dependencyReachable: false, // dependency projection will populate this evidence field when available
      });
      if (finding.state === 'PROCEED') continue;
      const deliveryKey = self.agentId ?? self.sessionId;
      const payload = {
        v: SUGGESTION_PAYLOAD_VERSION,
        kind: CLAIM_TREE_TROUBLE_KIND,
        state: finding.state,
        filePath: self.filePath,
        you: { sessionId: self.sessionId, agentId: self.agentId, purpose: self.purpose, range: { startLine: self.startLine, endLine: self.endLine, symbolPath: self.symbolPath } },
        other: { sessionId: other.sessionId, agentId: other.agentId, purpose: other.purpose, range: { startLine: other.startLine, endLine: other.endLine, symbolPath: other.symbolPath } },
        evidence: { worldComparable: sameWorld(self, other), directOverlap: claimsCollide(self, other), precisionKnown: hasPrecision(self) && hasPrecision(other) },
        action: finding.action,
        message: `${finding.state}: ${finding.reason}. ${finding.action}.`,
        mermaid: renderClaimTreeTroubleMermaid({ filePath: self.filePath, selfSessionId: self.sessionId, otherSessionId: other.sessionId, state: finding.state }),
      };
      const result = deps.suggestions.create({
        agentId: deliveryKey,
        kind: CLAIM_TREE_TROUBLE_KIND,
        payload,
        payloadHash: `claim-tree-trouble:${finding.state}:${self.filePath}:${[self.sessionId, other.sessionId].sort().join('|')}`,
        confidence: troubleConfidence(finding),
      });
      if (!result.created) {
        suppressed++;
        deps.activityLog?.log('claim_tree_trouble.suppressed', { agentId: deliveryKey, state: finding.state, filePath: self.filePath, reason: result.reason });
        continue;
      }
      surfaced++;
      const sent = deps.inbox.send(deliveryKey, payload, { from: 'suggestion-broker', type: 'suggestion' });
      if (sent.success) delivered++;
      deps.activityLog?.log('claim_tree_trouble.surfaced', { agentId: deliveryKey, state: finding.state, filePath: self.filePath, suggestionId: result.suggestion.id, delivered: sent.success });
    }
  }
  return { pairs: pairs.length, surfaced, suppressed, delivered };
}
