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
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== 'string' || typeof o.line !== 'number' || typeof o.body !== 'string') {
      return null; // element does not match the Finding schema
    }
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
   * Structured findings parsed from the ship's reduced output. Empty when the
   * ship found nothing; absent on legacy/test results that predate findings.
   */
  findings?: Finding[];
}

export type Conclusion = 'success' | 'failure' | 'neutral';

/**
 * Aggregate ship results into the umbrella check-run conclusion.
 *
 *   failure  — any BLOCKING ship returned BLOCK or errored
 *   neutral  — all blocking ships passed, but a non-blocking ship objected
 *   success  — all blocking ships passed and no non-blocking objection
 *
 * Errors on a blocking ship are treated as BLOCK (fail-closed): we never let a
 * gate-keeper's failure silently pass a merge.
 */
export function aggregateConclusion(results: ShipResult[]): Conclusion {
  const blockingFailure = results.some(
    r => r.blocking && (r.errored || r.verdict === 'BLOCK'),
  );
  if (blockingFailure) return 'failure';

  const advisoryObjection = results.some(
    r => !r.blocking && (r.verdict === 'BLOCK' || r.errored),
  );
  if (advisoryObjection) return 'neutral';

  return 'success';
}
