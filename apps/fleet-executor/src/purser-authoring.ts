/**
 * The purser's test-authoring pipeline, split into steps.
 *
 * WHY THIS MODULE EXISTS. The purser used to author every adversarial test file
 * in ONE call whose contract was a single JSON object carrying whole files as
 * JSON *string values*:
 *
 *     { "files": [ { "path": "...", "contents": "<the entire test file>" } ] }
 *
 * That asks a model to escape every newline, quote and backslash of real source
 * code, inside one response, with no partial credit — and when any of it slipped
 * the purser discarded the lot and degraded to an advisory PASS. A 2026-08-09
 * run recorded exactly that: `test-author output was not the required fenced
 * JSON files block`, `outputLength: 6136`. Six kilobytes of authored tests
 * thrown away over escaping.
 *
 * The fix is structural, not a wider regex. Authoring is now three small steps,
 * each with a contract a model can actually hit:
 *
 *   1. STEEL-MAN (in purser.ts, unchanged) — small JSON. Already reliable.
 *   2. PLAN ({@link parseTestPlan}) — a tiny JSON object of paths + intents.
 *      Same shape and size as the steel-man call, which is the one that works.
 *   3. AUTHOR ({@link authorTestFiles}) — ONE call per planned file, each
 *      returning a RAW FENCED CODE BLOCK. File contents never pass through JSON,
 *      so there is no escaping to get wrong.
 *
 * Two properties follow from the split, and both were impossible before:
 *
 *   - PARTIAL SUCCESS. Three files planned, one malformed ⇒ two real tests get
 *     stacked and the third is named as a failure. The old shape returned zero.
 *   - PER-FILE BUDGET. Each call spends its whole token allowance on one file
 *     instead of N files sharing one cap and truncating mid-string.
 *
 * NOT DONE HERE, deliberately: per-step MODEL tiering. `KNOWN_GOOD_CF_MODELS`
 * in fleet.ts honors exactly one Workers AI id today, so a `plan_model:` /
 * `author_model:` knob would parse, validate, and then resolve to the same
 * model for every step — the half-built shape that map-reduce-invariants.test.ts
 * exists to forbid. Widening the honored set is an operator cost decision, and
 * the step seam this module introduces is what makes it a one-line change when
 * that decision is made: {@link AuthorCall} already takes the step as an
 * argument.
 */

import { stripThinkSpans } from './xo.js';
import type { StackedFile } from './stacked-pr.js';

/**
 * Most files one plan may request. Bounds the fan-out: the authoring step costs
 * one AI call per planned file, so an unbounded plan is an unbounded bill. Set
 * below `MAX_STACKED_FILES` (stacked-pr.ts) so the plan can never propose a set
 * the stacking step would reject wholesale.
 */
export const MAX_PLANNED_FILES = 4;

/** A file the plan step asked for, before it has been written. */
export interface PlannedFile {
  path: string;
  /** What this file is supposed to grill. Empty when the model omitted it. */
  intent: string;
}

/** One authored file that failed, and why — named so the comment can say so. */
export interface AuthorFailure {
  path: string;
  reason: string;
}

export interface AuthoredResult {
  /** Files that came back usable. May be shorter than the plan. */
  files: StackedFile[];
  /** Planned files that did not, each with a reason. */
  failures: AuthorFailure[];
}

/**
 * Issue the authoring call for ONE planned file and return the raw model text.
 *
 * Takes the planned file so a caller can vary model/temperature/prompt per
 * step — the seam that makes per-step tiering a config change rather than a
 * refactor. May throw; {@link authorTestFiles} contains the failure.
 */
export type AuthorCall = (path: string, intent: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Extraction

/** Fenced block with an OPTIONAL, case-insensitive info-string. Global: we scan
 *  every fence in the response, not just the first. */
const FENCE_RE = /```[ \t]*[A-Za-z0-9+#._-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

/**
 * Heuristic for "this looks like source, not an apology". Used ONLY on the
 * unfenced fallback path, where accepting prose would commit a file containing
 * a model's refusal. Deliberately cheap and conservative: real test files are
 * multi-line and contain punctuation that prose does not.
 */
function looksLikeCode(text: string): boolean {
  if (!text.includes('\n')) return false;
  // Keywords must appear SYNTACTICALLY, not as English words.
  //
  // The first version of this check asked for "any of these keywords, plus any
  // of this punctuation", which a refusal satisfies without being code:
  //
  //   "I cannot write this test.
  //    It would need network access (which is unavailable)."
  //
  // `test` matches as a word, `(` matches as punctuation, and the purser
  // commits the model's apology to disk as a .test.ts file — a file that then
  // fails as a merge gate on a PR that did nothing wrong. Raised by the qa bot
  // on #6790; it was right.
  //
  // So a declaration must START a line, or a test/assertion keyword must be
  // CALLED, or the text must carry syntax prose does not: an arrow function or
  // statement-terminating semicolons.
  //
  // The semicolon signal needs TWO of them, on separate lines. One is not
  // evidence of code — English uses the semicolon too, and a refusal that
  // reaches for it walks straight through a single-semicolon check:
  //
  //   "I cannot write this test;
  //    network access is unavailable."
  //
  // which is the same class of defect the qa bot caught above, reopened by a
  // different clause. Real source states more than once; a refusal apologises
  // once. None of the languages this fallback exists for are admitted by the
  // semicolon rule alone — every accepted sample is already carried by the
  // declaration, call, or arrow signal — so requiring a second one costs
  // nothing real and closes the hole.
  const terminatedStatements = text.match(/;[ \t]*$/gm)?.length ?? 0;
  return (
    /^\s*(?:import|export|from|const|let|var|function|func|class|def|package|public|private)\b/m.test(text) ||
    /\b(?:it|test|describe|expect|assert|require)\s*\(/.test(text) ||
    /=>/.test(text) ||
    terminatedStatements >= 2
  );
}

/**
 * Pull a file body out of a model response.
 *
 * Order of attempts, each chosen for a failure actually observed in purser runs:
 *
 *   1. Think spans are stripped FIRST. A reasoning model drafts inside
 *      `<think>…</think>`, so a first-fence-wins reader would happily return a
 *      DISCARDED draft instead of the final answer.
 *   2. The LONGEST fenced block, not the first. Models routinely open with a
 *      one-line illustrative snippet and emit the real file second; first-wins
 *      would commit the snippet as the whole test file — a file that "parsed"
 *      but tested nothing, which is worse than a clean failure.
 *   3. The bare response, only when it {@link looksLikeCode}. Covers the model
 *      that forgets the fence, without ever committing prose to a .ts file.
 *
 * @param output Raw model text.
 * @returns The file body, or null when nothing usable is present.
 */
export function extractCodeFence(output: string): string | null {
  const text = stripThinkSpans(output ?? '');
  if (!text.trim()) return null;

  let best: string | null = null;
  FENCE_RE.lastIndex = 0;
  for (let m = FENCE_RE.exec(text); m !== null; m = FENCE_RE.exec(text)) {
    const body = m[1];
    if (!body.trim()) continue;
    if (best === null || body.length > best.length) best = body;
  }
  if (best !== null) return best;

  const bare = text.trim();
  return looksLikeCode(bare) ? bare : null;
}

// ---------------------------------------------------------------------------
// Plan

function readPlanEntry(value: unknown): PlannedFile | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const path = typeof o.path === 'string' ? o.path.trim() : '';
  if (!path) return null;
  const intent = typeof o.intent === 'string' ? o.intent.trim() : '';
  return { path, intent };
}

/**
 * Parse the PLAN step's output: which files to write and what each must grill.
 *
 * Tolerant in exactly one direction — it drops unusable ENTRIES rather than
 * failing the whole plan, because one malformed entry among four is not a
 * reason to author nothing. A plan with no usable entry at all still returns
 * null, so the caller degrades honestly instead of authoring into the void.
 *
 * @param output Raw model text (fenced JSON, bare JSON, or prose around either).
 * @returns Up to {@link MAX_PLANNED_FILES} planned files, or null if none parse.
 */
export function parseTestPlan(output: string): PlannedFile[] | null {
  const text = stripThinkSpans(output ?? '');
  if (!text.trim()) return null;

  const candidates: string[] = [];
  FENCE_RE.lastIndex = 0;
  for (let m = FENCE_RE.exec(text); m !== null; m = FENCE_RE.exec(text)) {
    if (m[1].trim()) candidates.push(m[1].trim());
  }
  candidates.push(text.trim());
  const open = text.search(/[[{]/);
  if (open !== -1) {
    const close = text[open] === '[' ? ']' : '}';
    const last = text.lastIndexOf(close);
    if (last > open) candidates.push(text.slice(open, last + 1));
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).files
        : undefined;
    if (!Array.isArray(arr)) continue;

    const seen = new Set<string>();
    const out: PlannedFile[] = [];
    for (const item of arr) {
      const entry = readPlanEntry(item);
      if (!entry || seen.has(entry.path)) continue;
      seen.add(entry.path);
      out.push(entry);
      if (out.length >= MAX_PLANNED_FILES) break;
    }
    if (out.length > 0) return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Author

/**
 * Author every planned file, one call each, collecting partial success.
 *
 * SEQUENTIAL on purpose. These calls share one Workers AI account and the
 * purser is not latency-critical; firing four concurrently buys seconds and
 * risks a rate-limit burst that fails files the serial path would have written.
 *
 * Never throws: a call that rejects becomes a named {@link AuthorFailure} so one
 * upstream 502 cannot cost the files that authored cleanly.
 *
 * @param plan Files to write, from {@link parseTestPlan}.
 * @param call Issues one authoring call. See {@link AuthorCall}.
 * @returns Usable files and named failures. `files` may be empty — the caller
 *          must treat that as "authored nothing" and degrade honestly.
 */
export async function authorTestFiles(
  plan: PlannedFile[],
  call: AuthorCall,
): Promise<AuthoredResult> {
  const files: StackedFile[] = [];
  const failures: AuthorFailure[] = [];

  for (const planned of plan) {
    let text: string;
    try {
      text = await call(planned.path, planned.intent);
    } catch (err) {
      failures.push({ path: planned.path, reason: `authoring call failed: ${String(err).slice(0, 200)}` });
      continue;
    }
    const contents = extractCodeFence(text);
    if (contents === null || !contents.trim()) {
      failures.push({ path: planned.path, reason: 'no usable file content in the response' });
      continue;
    }
    files.push({ path: planned.path, contents });
  }

  return { files, failures };
}
