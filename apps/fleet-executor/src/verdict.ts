/**
 * Ship verdict contract.
 *
 * Every ship ends its output with a machine-readable line:
 *
 *     FLEET-VERDICT: PASS
 *     FLEET-VERDICT: BLOCK
 *
 * Parsing is last-line-wins: scan from the bottom up and return the first
 * verdict found. Case-insensitive, whitespace-tolerant.
 */

export type Verdict = 'PASS' | 'BLOCK';

const VERDICT_RE = /^\s*FLEET-VERDICT:\s*(PASS|BLOCK)\s*$/i;

// ---------------------------------------------------------------------------
// Structured findings (machine-readable, for inline GitHub reviews)

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A single line-level finding emitted by a ship. Ships render these as a fenced
 * `json` array BEFORE their FLEET-VERDICT line so the executor can post them as
 * inline GitHub review comments.
 */
export interface Finding {
  /** Relative repo path, e.g. "src/fleet.ts". */
  path: string;
  /** 1-indexed line number in the file (GitHub's REST review API expects this). */
  line: number;
  severity: Severity;
  /** Human-readable finding text. */
  body: string;
}

// First fenced ```json … ``` block. Non-greedy body; tolerant of trailing
// whitespace before the closing fence.
const FINDINGS_BLOCK_RE = /```json\s*\n([\s\S]*?)\n?```/;

function coerceSeverity(value: unknown): Severity {
  const s = String(value ?? 'LOW').toUpperCase();
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MED') return 'MEDIUM';
  return 'LOW';
}

/**
 * Parse the structured findings block from a ship's output.
 *
 * Return contract (drives fail-closed behavior in execute.ts):
 *   - No ```json block at all            → `[]`   (the ship simply found nothing)
 *   - A ```json block that parses to an
 *     array of well-formed findings      → `Finding[]`
 *   - A ```json block that is malformed
 *     JSON, or not an array, or has a
 *     bad element shape                   → `null` (PARSE FAILURE → errored)
 *
 * A `null` here is treated by the caller as `errored: true`: a blocking ship
 * that emits a corrupt findings block fails the gate; an advisory one does not.
 */
export function parseShipFindings(output: string): Finding[] | null {
  if (!output) return [];
  const m = FINDINGS_BLOCK_RE.exec(output);
  if (!m) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return null; // malformed JSON inside the fence
  }
  if (!Array.isArray(parsed)) return null;

  const findings: Finding[] = [];
  // Dedup by path|line|body. Single-chunk diffs skip the REDUCE manager entirely
  // (execute.ts), so its "deduplicate findings" instruction never runs — a model
  // that emits the same finding twice (the 2026-07-07 line-68/86 duplicate)
  // would otherwise reach the operator twice. Dedup deterministically here so
  // both the MAP and REDUCE paths are covered.
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== 'string' || typeof o.line !== 'number' || typeof o.body !== 'string') {
      return null; // element does not match the Finding schema
    }
    // Separator is the six-character ESCAPE \u0000, never a literal NUL byte.
    // A raw NUL makes git classify this file as binary -- no line diff, no
    // blame, and grep skips it silently. verdict.ts was in exactly that state
    // until this commit, so a change to it rendered as `Bin 7463 -> 9147 bytes`.
    const key = `${o.path}\u0000${o.line}\u0000${o.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      path: o.path,
      line: o.line,
      severity: coerceSeverity(o.severity),
      body: o.body,
    });
  }
  return findings;
}

/**
 * Extract the last FLEET-VERDICT verdict from ship output.
 * Returns null if no parseable verdict line is present.
 */
export function parseVerdict(output: string): Verdict | null {
  if (!output) return null;
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = VERDICT_RE.exec(lines[i]);
    if (m) return m[1].toUpperCase() as Verdict;
  }
  return null;
}

/**
 * Resolve a ship's effective verdict given its blocking flag (fail-closed).
 *
 * - Blocking ship, no parseable verdict  → BLOCK (absence of PASS is objection)
 * - Non-blocking ship, no parseable verdict → PASS (advisory; can't block)
 * - Otherwise → the parsed verdict.
 */
export function resolveVerdict(output: string, blocking: boolean): Verdict {
  const parsed = parseVerdict(output);
  if (parsed) return parsed;
  return blocking ? 'BLOCK' : 'PASS';
}

export interface ShipResult {
  ship: string;
  blocking: boolean;
  /** Effective verdict after fail-closed resolution. */
  verdict: Verdict;
  /**
   * Whether the ship's job errored: a transport/AI failure OR an unparseable
   * (malformed) findings block. Either way the aggregator keys on this for the
   * fail-closed gate.
   */
  errored: boolean;
  /**
   * Bounded, redacted cause for an errored ship. This survives checkpoints and
   * feeds the transcript/check summary; it must never contain prompts, request
   * bodies, credentials, or a stack trace.
   */
  failureReason?: string;
  /**
   * The ship produced NO USABLE OUTPUT — see src/usable-output.ts. This is a
   * third outcome, distinct from both PASS and BLOCK: the ship ran, but what
   * came back satisfied nothing its contract asked for, so it reviewed nothing.
   *
   * It is kept SEPARATE from `errored` on purpose. `errored` means the ship's
   * job crashed or emitted a corrupt block; `noUsableOutput` means it completed
   * and said nothing usable. They gate identically (both are BROKEN-SHIP states
   * and fail the run — see {@link aggregateConclusion}) but they read
   * differently to an operator, and conflating them is how the original bug —
   * "PASS · clean" for a ship that returned nothing — stayed invisible.
   */
  noUsableOutput?: boolean;
  /**
   * Whether this ship saw the reviewable source it was asked to judge.
   *
   * Absent means complete coverage (the common path). `partial` means one or
   * more intact source files could not fit the model request or the bounded
   * MAP cap omitted later chunks; `none` means the diff contained only derived
   * artifacts / terminal evidence and no source was sent to a model. Neither
   * state may render as a clean PASS in the required GitHub check.
   */
  reviewCoverage?: 'partial' | 'none';
  /** Bounded human-readable explanation for an incomplete review. */
  reviewCoverageReason?: string;
  /**
   * Structured findings parsed from the ship's reduced output. Empty when the
   * ship found nothing; absent on legacy/test results that predate findings.
   */
  findings?: Finding[];
  /**
   * Set by the adjudicator (src/adjudicator.ts) when a BROKEN result's fault
   * was judged FLEET-WIDE — the same ship is breaking across other PRs, so
   * gating THIS author on it would punish the one party who cannot fix it.
   * An adjudicated breakage resolves `neutral` (never success) with a tracked
   * issue; absent, a broken result fails the run per the doctrine.
   */
  brokenAdjudicated?: BrokenAdjudication;
}

/** The adjudicator's verdict that a breakage is the fleet's, not the PR's. */
export interface BrokenAdjudication {
  /** Only fleet-scope exists today; the field keeps future scopes explicit. */
  scope: 'fleet';
  /** Human-legible evidence, e.g. "broken on 4 other PR(s) in the last 72h". */
  reason: string;
  /** The deduplicated `fleet:broken-ship` tracking issue, when filing worked. */
  issueNumber?: number;
}

export type Conclusion = 'success' | 'failure' | 'neutral';

/**
 * The GitHub review event the fleet should submit for this outcome.
 *
 * **Why this is not always COMMENT.** Every fleet review used to post as
 * `COMMENT`, on the reasoning that gating belongs to the check run. In practice
 * that made the review surface lie by omission: a blocking ship could find ten
 * real defects and the PR still showed no reviewer objecting, only a red check
 * that people learn to scroll past. "Advisory" is not what a blocking ship is.
 *
 * REQUEST_CHANGES is reserved for the case where it is both TRUE and
 * ACTIONABLE:
 *
 *   - a BLOCKING ship returned BLOCK — its own judgement, not an infrastructure
 *     failure; and
 *   - it produced at least one HIGH finding — so the request points at
 *     something specific.
 *
 * A blocking ship that ERRORED or returned nothing usable also fails the check
 * closed, but it does NOT request changes: demanding changes while naming no
 * defect is unactionable, and it would train authors to dismiss the signal
 * exactly as they learned to dismiss the check.
 *
 * APPROVE is deliberately never returned. A clean run is not a substitute for
 * human review, and emitting APPROVE could satisfy a branch-protection review
 * requirement — turning a passing bot into a merge authorisation nobody
 * granted it.
 */
export function reviewEventFor(results: ShipResult[]): 'COMMENT' | 'REQUEST_CHANGES' {
  const rejecting = results.some(
    r =>
      r.blocking &&
      r.verdict === 'BLOCK' &&
      !r.errored &&
      r.noUsableOutput !== true &&
      (r.findings ?? []).some(f => String(f.severity).toUpperCase() === 'HIGH'),
  );
  return rejecting ? 'REQUEST_CHANGES' : 'COMMENT';
}

/**
 * Aggregate ship results into the umbrella check-run conclusion.
 *
 *   failure  — any BLOCKING ship returned BLOCK; OR any ship AT ALL — advisory
 *              included — errored or produced no usable output (a BROKEN ship)
 *   neutral  — every ship ran intact, all blocking ships passed, but a
 *              non-blocking ship objected (advisory judgment stays advisory)
 *   success  — every ship ran intact, all blocking ships passed, no advisory
 *              objection
 *
 * Errors on a blocking ship are treated as BLOCK (fail-closed): we never let a
 * gate-keeper's failure silently pass a merge.
 *
 * THE BROKEN-SHIP DOCTRINE (operator ruling, 2026-08-19). "Advisory" scopes a
 * ship's JUDGMENT, not its machinery. An advisory ship saying BLOCK is an
 * opinion the operator chose not to gate on — that stays `neutral`. But an
 * advisory ship that errored, returned no usable output, or emitted a
 * malformed block did not render an opinion at all: the fleet itself is
 * broken, and a fleet run that silently tolerates its own broken ships trains
 * everyone to ignore the fleet. Earlier doctrine resolved these to `neutral`
 * ("advisory paths fail open"), and the observable result was an entire run —
 * pd-spark, pd-lookout, pd-spider returning nothing usable, pd-snipe emitting
 * a malformed proposal block — sailing past the merge gate with nobody forced
 * to fix anything. A broken ship now FAILS the run, whatever its blocking
 * flag, so the breakage gets fixed in the diff that surfaced it instead of
 * accumulating as tolerated rot.
 *
 * NO USABLE OUTPUT (src/usable-output.ts) is one of the broken-ship states:
 * absence of a review is not approval, and it is not "advisory silence"
 * either — it is a ship that reviewed nothing, and it fails the run.
 *
 * THE ADJUDICATION AMENDMENT (2026-08-19, the morning the doctrine deployed
 * and reddened every open PR at once): a broken ship still fails the run —
 * UNLESS the adjudicator (src/adjudicator.ts) has judged the breakage a
 * FLEET-WIDE fault, evidenced by the same ship breaking across other PRs. An
 * adjudicated breakage resolves `neutral`, never `success`: the fault stays
 * visible on the check, the summary, and the run page, is tracked in ONE
 * deduplicated issue, and pages the operator on first declaration — it gates
 * the FLEET (who can fix it) instead of each PR author (who cannot). A broken
 * ship with no adjudication — including when no evidence was available —
 * fails the run exactly as before: without proof of an epidemic, the doctrine
 * applies unmodified. A broken ship's verdict word is a fail-closed
 * convention, not a judgment, so it never counts as a BLOCK on its own.
 */
export function aggregateConclusion(results: ShipResult[]): Conclusion {
  const isBroken = (r: ShipResult) => r.errored || r.noUsableOutput === true;

  const brokenUnadjudicated = results.some(r => isBroken(r) && r.brokenAdjudicated == null);
  const blockingJudgmentBlock = results.some(
    r => r.blocking && r.verdict === 'BLOCK' && !isBroken(r),
  );
  if (brokenUnadjudicated || blockingJudgmentBlock) return 'failure';

  const advisoryObjection = results.some(r => !r.blocking && r.verdict === 'BLOCK' && !isBroken(r));
  const adjudicatedBreakage = results.some(r => isBroken(r) && r.brokenAdjudicated != null);
  const incompleteCoverage = results.some(r => r.reviewCoverage === 'partial' || r.reviewCoverage === 'none');
  if (advisoryObjection || adjudicatedBreakage || incompleteCoverage) return 'neutral';

  return 'success';
}
