/**
 * Bounded text capture for the human-facing run-page transcript.
 *
 * The run page (apps/relay/src/fleet-run-page.ts) is asked to show the FULL
 * prompt + response text of every model call, not just a length — "do NOT
 * silently drop content". There is no object-storage binding (R2) provisioned
 * for this Worker (see wrangler.deploy.toml: only AI/KV/D1 are bound), so the
 * only place to persist call text today is the same `fleet_run_steps.detail`
 * JSON blob that already carries chunk metadata. D1 rows are generously sized
 * (2MB/row) and MAP/REDUCE calls are themselves bounded (MAP_CHUNK_CHAR_LIMIT =
 * 12,000 input chars; MAX_OUTPUT_TOKENS = 2048 output tokens, ~8-12KB of text),
 * so a single call's prompt+response is normally 20-30KB — comfortably inside
 * one row. {@link TRANSCRIPT_TEXT_CAP} is a defensive backstop for the one case
 * that is NOT bounded by those constants: `chunkDiff` deliberately emits an
 * oversized single-file diff as ONE whole chunk when a file exceeds the MAP
 * budget (see execute.ts's chunkDiff doc), so a very large generated/vendored
 * file could otherwise blow past a sane per-row size.
 *
 * `capText` never lies about what happened: `truncated`/`length` are always
 * returned, so a capped call is reported honestly on the page ("truncated;
 * N chars total") rather than silently shortened. Below the cap — the normal
 * case given the budgets above — nothing is cut at all.
 */

/** Per-field cap (prompt, response, or system-prompt text), in characters. */
export const TRANSCRIPT_TEXT_CAP = 24_000;

export interface CappedText {
  /** The text, capped to at most `cap` characters. */
  text: string;
  /** True iff the original text exceeded `cap` and was cut. */
  truncated: boolean;
  /** The ORIGINAL (pre-cap) length, always reported even when truncated. */
  length: number;
}

/** Cap `text` to `cap` characters (default {@link TRANSCRIPT_TEXT_CAP}), honestly. */
export function capText(text: string, cap: number = TRANSCRIPT_TEXT_CAP): CappedText {
  const value = text ?? '';
  const length = value.length;
  if (length <= cap) return { text: value, truncated: false, length };
  return { text: value.slice(0, cap), truncated: true, length };
}
