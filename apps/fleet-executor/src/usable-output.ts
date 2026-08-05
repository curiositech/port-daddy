/**
 * "No usable output" — the third ship outcome, distinct from PASS and BLOCK.
 *
 * WHY THIS EXISTS (the 2026-08-04 green-theater postmortem, run
 * `run:3a8aee50-9046-11f1-9d73-4cf5ca0facd1` on PR #4725): a ship whose model
 * returned nothing the contract asked for was folded into the SAME outcome as a
 * ship that read the diff and found no problems. `parseShipFindings` returns
 * `[]` both when a reviewer explicitly emitted an empty findings array ("I
 * looked, nothing here") AND when the response contained no findings block at
 * all ("I never answered"). Downstream — `resolveVerdict`, `buildSummary`, and
 * the relay's `shipOutcome` — could not tell those apart, so the second case
 * rendered as **"PASS · clean"**. A reviewer that reviewed nothing was reported
 * as having reviewed the diff and found no problems. That is green theater: it
 * silently devalues every honest green check in the fleet.
 *
 * The fix is to name the state. {@link classifyShipOutput} decides whether a
 * ship's reduced output carries *anything* its contract asked for; when it does
 * not, the executor records a `ship-no-output` transcript step and returns a
 * result flagged {@link ShipResult.noUsableOutput}, which the aggregator and the
 * run page treat as its own outcome — never as a pass.
 *
 * ## How the threshold is derived (no magic numbers)
 *
 * Two independent tests, both read off the ship contracts in `execute.ts`
 * (`buildOutputContract`) and `proposals.ts` (`ideationOutputContract`):
 *
 * 1. **Contract-signal test (primary).** Each contract names the elements a
 *    ship must emit. For a REVIEWER the mandatory element is the trailing
 *    `FLEET-VERDICT:` line — the contract states the findings block itself may
 *    be omitted ("If you have no findings, emit an empty array `[]` (or omit
 *    the block)"), so a verdict line OR a findings fence counts as an answer.
 *    For an IDEATION ship the contract mandates BOTH a fenced JSON array (empty
 *    when there is nothing to propose) and a verdict line, so either one is
 *    accepted as a signal that the ship engaged with its contract. Output
 *    carrying NONE of its contract's elements has answered nothing, no matter
 *    how many characters of prose it spent doing so.
 *
 * 2. **Contract-floor test (belt and braces).** The floor is not a tuned
 *    number: it is `MIN_REVIEWER_CONTRACT_OUTPUT.length` /
 *    `MIN_IDEATION_CONTRACT_OUTPUT.length`, computed at module load from the
 *    literal shortest strings that can satisfy each contract (19 and 34 chars
 *    respectively at the time of writing). An output shorter than the shortest
 *    legal answer provably is not a legal answer, so it is rejected even if a
 *    regex happened to match a fragment of it. Change the contract and the
 *    floor moves with it — there is nothing to keep in sync by hand.
 *
 * Both tests run against the output with `<think>…</think>` reasoning spans
 * stripped ({@link stripThinkSpans} in `xo.ts`, reused here rather than
 * reimplemented) and whitespace trimmed. A reasoning model that spends its
 * whole budget thinking and emits no answer must not be credited with the
 * length of its own deliberation.
 *
 * ## What this deliberately does NOT flag
 *
 * A contract-MINIMAL reply — ```` ```json\n[]\n```\nFLEET-VERDICT: PASS ```` —
 * is an affirmative statement ("I read the diff and found nothing"), so it
 * stays a clean PASS. Note for future forensics: that string is exactly 34
 * characters, the same length both `pd-code-reviewer` and `pd-snipe` recorded
 * in the run above, so those two ships most likely emitted a contract-minimal
 * reply rather than an empty one. The bug was never that 34 chars is too few;
 * it was that the executor had no way to tell a minimal answer from no answer,
 * and resolved the ambiguity in favor of green.
 */

import { stripThinkSpans } from './xo.js';

/**
 * The shortest output that can satisfy the REVIEWER contract: the mandatory
 * trailing verdict line, with the findings block omitted (which
 * `buildOutputContract` explicitly permits).
 */
const MIN_REVIEWER_CONTRACT_OUTPUT = 'FLEET-VERDICT: PASS';

/**
 * The shortest output that can satisfy the IDEATION contract: a fenced empty
 * proposals array plus the mandatory verdict line
 * (`ideationOutputContract` requires both).
 */
const MIN_IDEATION_CONTRACT_OUTPUT = '```json\n[]\n```\nFLEET-VERDICT: PASS';

/**
 * Char floor for a reviewer ship's output, derived from the contract rather
 * than tuned. Shorter than this cannot carry the mandatory verdict line.
 */
export const MIN_REVIEWER_OUTPUT_CHARS = MIN_REVIEWER_CONTRACT_OUTPUT.length;

/**
 * Char floor for an ideation ship's output, derived from the contract rather
 * than tuned. Shorter than this cannot carry a proposals array AND a verdict.
 */
export const MIN_IDEATION_OUTPUT_CHARS = MIN_IDEATION_CONTRACT_OUTPUT.length;

/** Any `FLEET-VERDICT: PASS|BLOCK` line (mirrors verdict.ts, line-anchored). */
const VERDICT_SIGNAL_RE = /^[ \t]*FLEET-VERDICT:[ \t]*(PASS|BLOCK)[ \t]*$/im;

/** Any fenced ```json block — the carrier for findings AND proposals. */
const JSON_FENCE_SIGNAL_RE = /```json\s*\n[\s\S]*?```/;

/** Why a ship's output could not be used. Rendered verbatim to the operator. */
export type NoUsableOutputReason =
  /** Nothing at all came back (or only `<think>` spans came back). */
  | 'empty'
  /** Shorter than the shortest string that could satisfy the ship's contract. */
  | 'below-contract-floor'
  /** Long enough, but carrying no element the ship's contract asked for. */
  | 'no-contract-signal';

/** Verdict of {@link classifyShipOutput}. */
export type ShipOutputUsability =
  | { usable: true; strippedLength: number }
  | { usable: false; reason: NoUsableOutputReason; strippedLength: number };

/** Human sentence for a reason code — used in transcripts and the run page. */
const REASON_TEXT: Record<NoUsableOutputReason, string> = {
  empty: 'the model returned no text at all',
  'below-contract-floor':
    'the model returned less text than the shortest possible valid answer',
  'no-contract-signal':
    'the model returned text carrying no verdict and no structured block',
};

/**
 * One honest English sentence describing a no-usable-output outcome, suitable
 * for a check-run summary, a transcript title, or the run page.
 *
 * @param shipLabel How to name the ship, e.g. `pd-code-reviewer`.
 * @param reason Which of the {@link NoUsableOutputReason} tests failed.
 * @returns A sentence that never claims the ship reviewed anything.
 */
export function describeNoUsableOutput(shipLabel: string, reason: NoUsableOutputReason): string {
  return `${shipLabel} returned no usable output — nothing was reviewed (${REASON_TEXT[reason]}).`;
}

/**
 * Decide whether a ship's reduced output can be used at all.
 *
 * Applies the two contract-derived tests documented at the top of this module,
 * in order: emptiness, then the contract floor, then the contract-signal test.
 * The input is stripped of `<think>` reasoning spans and trimmed first, so a
 * model that spent its whole output budget deliberating and never answered is
 * classified on what it actually said, not on how long it thought.
 *
 * This function is deliberately conservative — it only reports `usable: false`
 * when the output satisfies NOTHING its contract asked for. A minimal but valid
 * answer (an empty findings array plus a verdict line) is usable and remains an
 * honest clean PASS; the caller must not upgrade it to an objection.
 *
 * @param output The ship's reduced output text (post-MAP/REDUCE), possibly ''.
 * @param opts.ideation True for ideation-class ships (spark/spider/lookout/
 *   snipe), which speak the proposals contract rather than the findings one.
 * @returns A discriminated {@link ShipOutputUsability}; `strippedLength` is the
 *   post-strip character count, recorded in the transcript so an operator can
 *   audit the decision without re-running the model.
 */
export function classifyShipOutput(
  output: string,
  opts: { ideation: boolean },
): ShipOutputUsability {
  const substance = stripThinkSpans(output ?? '');
  const strippedLength = substance.length;

  if (strippedLength === 0) return { usable: false, reason: 'empty', strippedLength };

  const floor = opts.ideation ? MIN_IDEATION_OUTPUT_CHARS : MIN_REVIEWER_OUTPUT_CHARS;
  if (strippedLength < floor) {
    return { usable: false, reason: 'below-contract-floor', strippedLength };
  }

  // Contract-signal test. Both classes accept either mandatory element as proof
  // the ship engaged: a reviewer may legally omit the findings fence, and an
  // ideation ship that emitted a proposals array but dropped its (always-PASS,
  // never-gating) verdict line has still proposed real work.
  const hasVerdict = VERDICT_SIGNAL_RE.test(substance);
  const hasJsonBlock = JSON_FENCE_SIGNAL_RE.test(substance);
  if (!hasVerdict && !hasJsonBlock) {
    return { usable: false, reason: 'no-contract-signal', strippedLength };
  }

  return { usable: true, strippedLength };
}
