/**
 * Suggestion broker — the detection half of the suggestibility layer (ADR-0039 §Primitive 2).
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
 * without a daemon.
 */

import type { Suggestions, SuggestionKind } from './suggestions.js';

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
 * Whether two line ranges overlap. A null range is a whole-file claim and overlaps
 * everything — identical semantics to `rangesOverlap` in `lib/sessions.ts` (the
 * canonical source; duplicated here as a 4-line pure fn to avoid widening that
 * module's export surface).
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

function claimsCollide(a: ActiveClaim, b: ActiveClaim): boolean {
  // Symbol-path claims collide iff they name the same symbol.
  if (a.symbolPath && b.symbolPath) return a.symbolPath === b.symbolPath;
  // Otherwise fall back to line-range overlap (null = whole file = overlaps all).
  return rangesOverlap(a.startLine, a.endLine, b.startLine, b.endLine);
}

/** Confidence by overlap severity, so the suggestions module's PRIORITY tier
 *  (S5 fix) actually fires for the overlaps that matter. A same-symbol or
 *  whole-file collision is high-severity (a guaranteed edit conflict); a partial
 *  line-range overlap is ordinary. The threshold (0.95) lives in the suggestions
 *  policy — keep HIGH at/above it and NORMAL below. */
const SEVERITY_CONFIDENCE_HIGH = 0.97;
const SEVERITY_CONFIDENCE_NORMAL = 0.9;
function overlapSeverityConfidence(a: ActiveClaim, b: ActiveClaim): number {
  if (a.symbolPath && b.symbolPath && a.symbolPath === b.symbolPath) return SEVERITY_CONFIDENCE_HIGH;
  const wholeFile =
    a.startLine == null || a.endLine == null || b.startLine == null || b.endLine == null;
  return wholeFile ? SEVERITY_CONFIDENCE_HIGH : SEVERITY_CONFIDENCE_NORMAL;
}

/** Stable dedup key for the unordered session pair on a file. */
export function overlapPayloadHash(o: ClaimOverlap): string {
  return `claim-overlap:${o.filePath}:${o.a.sessionId}|${o.b.sessionId}`;
}

/**
 * Pure detector. Given the full set of active claims, return every distinct-session
 * overlap on a shared file. Deterministic and order-independent.
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

function humanMessage(self: ActiveClaim, other: ActiveClaim, filePath: string): string {
  const who = other.agentId ?? other.sessionId;
  const what = other.purpose ? ` (${other.purpose})` : '';
  return `Heads-up: ${who}${what} also holds a claim on ${filePath}. Consider coordinating before you both edit it — pd inbox send, a shared channel, or a parley.`;
}

/**
 * Scan all active claims, detect cross-session overlaps, and surface a
 * `claim-overlap-headsup` to BOTH parties — subject to the suggestions module's
 * cooldown/budget/mute dampers. Re-running over a standing overlap is a no-op until
 * the cooldown lapses. Suppressed surfacings are logged (not dropped) for tuning.
 *
 * Delivery is keyed by `agentId ?? sessionId` — the inbox key is an opaque string,
 * and a session without a registered agentId still gets a queryable record and an
 * inbox entry under its session id.
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
