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
  /** Whether the ship's job errored (transport/AI failure). */
  errored: boolean;
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
