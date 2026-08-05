/**
 * XO — the fleet's synthesis officer (Workers AI ONLY).
 *
 * Two duties, one officer, both strictly ADVISORY and strictly fail-open:
 *
 *   1. EDITOR PASS (idea curation). The ideation ships (spark, spider, lookout,
 *      snipe) propose forward work; today those proposals are deduplicated only
 *      by cosine similarity in ideas-store.ts. The XO adds an editorial layer:
 *      before novel ideas are finalized (comment render / issue creation / D1
 *      storage), it reads the new batch PLUS the most recent already-tracked
 *      idea titles/rationales (bounded at {@link XO_RECENT_IDEAS_LIMIT}) and
 *      returns a strict-JSON edit list — merge these two, rewrite this title,
 *      drop this as a duplicate, keep the rest. Cosine dedup remains as the
 *      cheap pre-filter AND as the fallback when the XO fails.
 *
 *   2. ADVISORY-FINDINGS TRIAGE. After ship verdicts are aggregated, the XO
 *      judges which ADVISORY (non-blocking) findings are genuinely worth doing
 *      FOR THIS PR and returns a ranked shortlist with one-line justifications,
 *      rendered as an "XO's orders" section on the review comment. The rest are
 *      summarized as a count, never hidden. The check CONCLUSION is untouched.
 *
 * HARD CONSTRAINTS this module encodes:
 *   - Workers AI only: the model is `env.AI` with a `@cf/` id (default
 *     {@link DEFAULT_XO_MODEL}, overridable via the XO_MODEL plaintext var;
 *     a non-`@cf/` override is IGNORED — see {@link resolveXoModel}).
 *   - Fail-open everywhere: a model error, timeout, or malformed output NEVER
 *     loses a proposal, NEVER changes a check conclusion, NEVER blocks a run.
 *     Every entry point either returns the caller's input unchanged or ''.
 *   - The default model (deepseek-r1 distill) emits `<think>…</think>`
 *     reasoning spans; {@link stripThinkSpans} removes them before parsing.
 */

import type { Proposal } from './proposals.js';
import type { Severity, ShipResult } from './verdict.js';
import { extractAiText } from './ai-response.js';

// ---------------------------------------------------------------------------
// Constants

/**
 * Default XO model. A Workers AI `@cf/` reasoning model — the operator's
 * standing order is Workers AI ONLY (never the Anthropic API in product code).
 */
export const DEFAULT_XO_MODEL = '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';

/** How many recently tracked ideas the editor pass shows the model (context cap). */
export const XO_RECENT_IDEAS_LIMIT = 30;

/** Maximum items on the triage shortlist — the XO demands, it does not re-list. */
export const XO_MAX_ORDERS = 5;

/** Cap on advisory findings fed to the triage prompt (context cap). */
export const XO_MAX_ADVISORIES = 40;

/**
 * Output-token cap for XO calls. Higher than the ships' 2048 because the
 * default deepseek-r1 distill spends output tokens on `<think>` reasoning
 * BEFORE the JSON answer — a tight cap would truncate mid-think and yield
 * nothing parseable (which fails open, but wastes the call).
 */
const XO_MAX_OUTPUT_TOKENS = 4096;

/** Cap on any single text field interpolated into an XO prompt or render. */
const XO_FIELD_CHAR_LIMIT = 400;

// ---------------------------------------------------------------------------
// Model + text plumbing

/**
 * Resolve the XO's Workers AI model id from the optional XO_MODEL var.
 *
 * Why a guard instead of trusting the var: the operator's hard constraint is
 * Workers AI ONLY, and a nonexistent/foreign model id on Workers AI does not
 * error — it yields an empty response the parser reads as "XO declined". Only a
 * `@cf/` id is honored so a typo'd or non-Cloudflare override can never route
 * the XO off Workers AI or silently blank it.
 *
 * @param configured The XO_MODEL plaintext var (may be undefined/blank).
 * @returns The configured id when it is a `@cf/` model, else {@link DEFAULT_XO_MODEL}.
 */
export function resolveXoModel(configured: string | undefined): string {
  if (typeof configured === 'string' && configured.trim().startsWith('@cf/')) {
    return configured.trim();
  }
  return DEFAULT_XO_MODEL;
}

/**
 * Strip deepseek-style `<think>…</think>` reasoning spans from model output.
 *
 * Why: the default XO model narrates its chain-of-thought inside think tags
 * before answering; the JSON contract lives OUTSIDE those spans, and reasoning
 * text routinely contains braces/fences that would defeat naive JSON extraction.
 * Handles all three real-world shapes: complete spans (removed), an orphan
 * CLOSING tag (r1 templates sometimes open the think block for the model, so
 * output starts mid-think — everything up to and including `</think>` is
 * dropped), and an orphan OPENING tag (output truncated mid-think — everything
 * from `<think>` on is dropped).
 *
 * @param raw The raw model output text.
 * @returns The output with reasoning spans removed, trimmed.
 */
export function stripThinkSpans(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const orphanClose = text.indexOf('</think>');
  if (orphanClose !== -1) text = text.slice(orphanClose + '</think>'.length);
  const orphanOpen = text.indexOf('<think>');
  if (orphanOpen !== -1) text = text.slice(0, orphanOpen);
  return text.trim();
}

/**
 * Extract the JSON payload from XO output: think spans stripped, then the first
 * fenced ```json block if present, else the widest `[`…`]` / `{`…`}` slice.
 *
 * Why so tolerant: reasoning models pad their answers with prose even when told
 * "strict JSON only". Since every XO parse failure falls back to existing
 * behavior anyway, tolerance here only ever RECOVERS value — it can't corrupt
 * anything, because the extracted candidate must still fully JSON.parse and
 * pass shape validation downstream.
 *
 * @param raw The raw model output text.
 * @returns The parsed JSON value, or null when nothing parseable was found.
 */
function extractXoJson(raw: string): unknown | null {
  const text = stripThinkSpans(raw);
  if (!text) return null;

  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1].trim());
  candidates.push(text);
  const firstBracket = text.search(/[[{]/);
  if (firstBracket !== -1) {
    const open = text[firstBracket];
    const close = open === '[' ? ']' : '}';
    const last = text.lastIndexOf(close);
    if (last > firstBracket) candidates.push(text.slice(firstBracket, last + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next, wider candidate
    }
  }
  return null;
}

/**
 * Collapse a model/finding string to one bounded line for prompts and renders.
 *
 * Why: XO prompt context is a budget and the "XO's orders" section must stay
 * scannable — a multi-paragraph finding body would drown the one-line order
 * format and blow the comment cap.
 *
 * @param text Arbitrary (possibly multi-line) text.
 * @returns One whitespace-collapsed line, capped at {@link XO_FIELD_CHAR_LIMIT} chars.
 */
function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > XO_FIELD_CHAR_LIMIT
    ? `${collapsed.slice(0, XO_FIELD_CHAR_LIMIT - 1)}…`
    : collapsed;
}

/**
 * Workers AI call options for XO calls: a stable session-affinity key so the
 * XO's identical system-prompt prefix hits the prompt cache across runs, plus
 * optional AI Gateway routing — the same design as execute.ts::aiOptions, kept
 * local so xo.ts stays a leaf module with no execute.ts import cycle.
 *
 * @param gatewayId Optional Cloudflare AI Gateway id (env.AI_GATEWAY_ID).
 * @returns The options object passed as the third argument to `ai.run`.
 */
function xoAiOptions(
  gatewayId: string | undefined,
): { extraHeaders: Record<string, string>; gateway?: { id: string } } {
  const opts: { extraHeaders: Record<string, string>; gateway?: { id: string } } = {
    extraHeaders: { 'x-session-affinity': 'pd-fleet-xo' },
  };
  if (gatewayId) opts.gateway = { id: gatewayId };
  return opts;
}

// ---------------------------------------------------------------------------
// Duty 1: EDITOR PASS (idea dedupe/merge)

/** The edit operations the XO editor may return. */
export type XoEditOp = 'keep' | 'drop' | 'retitle' | 'merge';

/**
 * One edit in the XO editor's returned list. `index` addresses the 0-based
 * position in the proposal batch shown to the model. `merge` folds the
 * `absorb`ed proposals' evidence into the survivor at `index`; `retitle` and
 * `merge` may rewrite `title`/`rationale`; `drop` removes the proposal
 * (optionally naming the existing idea it duplicates, for the transcript).
 */
export interface XoEdit {
  op: XoEditOp;
  index: number;
  title?: string;
  rationale?: string;
  duplicateOf?: string;
  absorb?: number[];
}

const XO_EDIT_OPS: ReadonlySet<string> = new Set<XoEditOp>(['keep', 'drop', 'retitle', 'merge']);

/**
 * Parse the XO editor's strict-JSON edit list from raw model output.
 *
 * Why tri-state-like strictness (whole-list rejection): this mirrors
 * parseProposals/parseShipFindings — one malformed element means the model did
 * not hold the contract, and a half-trusted edit list could silently drop the
 * wrong idea. Rejecting the WHOLE list is the safe move because the caller's
 * fallback is "apply no edits", which by construction loses nothing.
 *
 * @param raw The raw model output (think spans are stripped internally).
 * @returns The validated edit list, or null when the output is malformed
 *          (no JSON, not an array, or any element off-contract).
 */
export function parseXoEditList(raw: string): XoEdit[] | null {
  const parsed = extractXoJson(raw);
  if (!Array.isArray(parsed)) return null;

  const edits: XoEdit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.op !== 'string' || !XO_EDIT_OPS.has(o.op)) return null;
    if (typeof o.index !== 'number' || !Number.isInteger(o.index) || o.index < 0) return null;
    if (o.title != null && typeof o.title !== 'string') return null;
    if (o.rationale != null && typeof o.rationale !== 'string') return null;
    if (o.duplicateOf != null && typeof o.duplicateOf !== 'string') return null;
    let absorb: number[] | undefined;
    if (o.absorb != null) {
      if (!Array.isArray(o.absorb)) return null;
      absorb = [];
      for (const a of o.absorb) {
        if (typeof a !== 'number' || !Number.isInteger(a) || a < 0) return null;
        absorb.push(a);
      }
    }
    edits.push({
      op: o.op as XoEditOp,
      index: o.index,
      ...(typeof o.title === 'string' && o.title.trim() ? { title: o.title.trim() } : {}),
      ...(typeof o.rationale === 'string' && o.rationale.trim()
        ? { rationale: o.rationale.trim() }
        : {}),
      ...(typeof o.duplicateOf === 'string' && o.duplicateOf.trim()
        ? { duplicateOf: o.duplicateOf.trim() }
        : {}),
      ...(absorb ? { absorb } : {}),
    });
  }
  return edits;
}

/**
 * Apply a validated XO edit list to a proposal batch. Pure and defensive.
 *
 * Design: NOTHING is lost by accident. Every proposal the edit list does not
 * explicitly drop or absorb survives unchanged (an absent edit means "keep"),
 * out-of-range indices are ignored, a merge survivor keeps its own
 * action/prompt/files (only title/rationale may be rewritten and evidence is
 * unioned in), and self-absorption is a no-op. Only an explicit, in-range
 * `drop`/`absorb` removes an idea — that is an editorial decision the model
 * made under contract, not a parsing accident.
 *
 * @param proposals The parsed proposal batch (0-indexed as shown to the model).
 * @param edits The validated edit list from {@link parseXoEditList}.
 * @returns The curated proposal list (order preserved, dropped/absorbed removed).
 */
export function applyXoEdits(proposals: Proposal[], edits: XoEdit[]): Proposal[] {
  const out: Array<Proposal | null> = proposals.map(p => ({ ...p, evidence: [...p.evidence] }));
  /**
   * Is `i` a real position in the batch? Guards every model-provided index so
   * a hallucinated index degrades to a no-op — the design rule that no edit
   * may remove an idea by accident.
   * @param i A 0-based index from the edit list.
   * @returns True when the index addresses an existing proposal slot.
   */
  const inRange = (i: number): boolean => i >= 0 && i < out.length;

  for (const e of edits) {
    if (!inRange(e.index)) continue;
    const target = out[e.index];
    switch (e.op) {
      case 'keep':
        break;
      case 'drop':
        out[e.index] = null;
        break;
      case 'retitle':
        if (!target) break;
        if (e.title) target.title = e.title;
        if (e.rationale) target.rationale = e.rationale;
        break;
      case 'merge': {
        if (!target) break;
        for (const a of e.absorb ?? []) {
          if (!inRange(a) || a === e.index) continue;
          const absorbed = out[a];
          if (!absorbed) continue;
          for (const ev of absorbed.evidence) {
            if (!target.evidence.includes(ev)) target.evidence.push(ev);
          }
          out[a] = null;
        }
        if (e.title) target.title = e.title;
        if (e.rationale) target.rationale = e.rationale;
        break;
      }
    }
  }
  return out.filter((p): p is Proposal => p !== null);
}

/**
 * Build the XO editor's system prompt (the JSON edit-list contract).
 *
 * Why a fixed, byte-stable prompt: it is the cacheable prefix (session
 * affinity routes it to the same instance), and the `XO EDITOR` marker gives
 * tests and transcripts a reliable way to recognize the call.
 *
 * @returns The system prompt string.
 */
function buildEditorSystemPrompt(): string {
  return (
    'You are the fleet XO (executive officer) on XO EDITOR duty. You curate a ' +
    'batch of NEW ideation proposals before they are filed as tracked ideas, ' +
    'judging them against each other and against the recently tracked ideas ' +
    'you are shown. Merge near-duplicates, rewrite vague titles, drop ' +
    'anything already tracked, keep what is genuinely novel.\n\n' +
    'Return STRICT JSON ONLY — a single array of edit objects, one decision ' +
    'per proposal index (an unmentioned index is kept as-is):\n\n' +
    '```json\n' +
    '[\n' +
    '  {"op": "keep", "index": 0},\n' +
    '  {"op": "retitle", "index": 1, "title": "<sharper imperative title>"},\n' +
    '  {"op": "drop", "index": 2, "duplicateOf": "<existing idea title it duplicates>"},\n' +
    '  {"op": "merge", "index": 3, "absorb": [4], "title": "<optional combined title>", "rationale": "<optional combined rationale>"}\n' +
    ']\n' +
    '```\n\n' +
    'Rules: `index`/`absorb` are 0-based positions in the NEW proposals list. ' +
    'A `merge` keeps proposal `index` and folds the `absorb`ed ones into it. ' +
    'Drop a proposal ONLY when it truly duplicates a tracked idea or another ' +
    'proposal. When in doubt, keep. No prose outside the JSON array.'
  );
}

/**
 * Build the XO editor's user message: the numbered new-proposal batch plus the
 * bounded recently-tracked-ideas list.
 *
 * Why bounded fields: prompt context is a cost and a truncation risk; titles
 * plus one-line rationales are what an editor needs to judge duplication —
 * full evidence/files payloads are not.
 *
 * @param proposals The new proposal batch, in index order.
 * @param recentIdeas Recently tracked canonical ideas (title + rationale).
 * @returns The user message string.
 */
function buildEditorUserMessage(
  proposals: Proposal[],
  recentIdeas: Array<{ title: string; rationale: string }>,
): string {
  const batch = proposals
    .map(
      (p, i) =>
        `${i}. [${p.action}] ${oneLine(p.title)}\n   rationale: ${oneLine(p.rationale)}` +
        (p.evidence.length ? `\n   evidence: ${p.evidence.slice(0, 6).join(', ')}` : ''),
    )
    .join('\n');
  const tracked =
    recentIdeas.length === 0
      ? '(none tracked yet)'
      : recentIdeas
          .map(r => `- ${oneLine(r.title)}: ${oneLine(r.rationale)}`)
          .join('\n');
  return `## New proposals (0-indexed)\n${batch}\n\n## Recently tracked ideas (do not re-file)\n${tracked}`;
}

/** Outcome of one editor pass — the curated batch plus how it was reached. */
export interface XoEditorOutcome {
  /** The curated proposals (identical to the input when `applied` is false). */
  proposals: Proposal[];
  /** True when a valid edit list was parsed and applied. */
  applied: boolean;
  /** Number of edits in the applied list (0 when not applied). */
  editCount: number;
  /** 'applied', or the human-legible fallback reason for the transcript. */
  reason: string;
}

/**
 * Run the XO editor pass over a batch of new ideation proposals.
 *
 * FAIL-OPEN by design and by contract: any model error, empty response, or
 * malformed edit list returns the ORIGINAL proposals untouched with
 * `applied: false` — the caller then proceeds exactly as today (cosine dedup
 * in ideas-store.ts remains the pre-filter and the fallback), so an XO outage
 * can never lose an idea or change any behavior. Never throws.
 *
 * @param opts.ai The Workers AI binding (env.AI — the ONLY model surface).
 * @param opts.model The `@cf/` model id (from {@link resolveXoModel}).
 * @param opts.proposals The new proposal batch to curate.
 * @param opts.recentIdeas Recently tracked ideas for duplicate judgment
 *        (already bounded by the caller; may be empty).
 * @param opts.gatewayId Optional AI Gateway id for cost/latency logging.
 * @returns The {@link XoEditorOutcome} — curated batch or the input unchanged.
 */
export async function runXoEditorPass(opts: {
  ai: Ai;
  model: string;
  proposals: Proposal[];
  recentIdeas: Array<{ title: string; rationale: string }>;
  gatewayId?: string;
}): Promise<XoEditorOutcome> {
  const { ai, model, proposals, recentIdeas } = opts;
  if (proposals.length === 0) {
    return { proposals, applied: false, editCount: 0, reason: 'no proposals to edit' };
  }
  try {
    const res = await ai.run(
      model as Parameters<typeof ai.run>[0],
      {
        messages: [
          { role: 'system', content: buildEditorSystemPrompt() },
          { role: 'user', content: buildEditorUserMessage(proposals, recentIdeas) },
        ],
        max_tokens: XO_MAX_OUTPUT_TOKENS,
      },
      xoAiOptions(opts.gatewayId),
    );
    const { text } = extractAiText(res);
    const edits = parseXoEditList(text);
    if (edits === null) {
      return { proposals, applied: false, editCount: 0, reason: 'malformed XO edit list' };
    }
    return {
      proposals: applyXoEdits(proposals, edits),
      applied: true,
      editCount: edits.length,
      reason: 'applied',
    };
  } catch (err) {
    return {
      proposals,
      applied: false,
      editCount: 0,
      reason: `XO editor error: ${String(err).slice(0, 200)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Duty 2: ADVISORY-FINDINGS TRIAGE

/** One advisory finding, tagged with the (non-blocking) ship that raised it. */
export interface AdvisoryRef {
  ship: string;
  path: string;
  line: number;
  severity: Severity;
  body: string;
}

/**
 * Collect the ADVISORY findings from a run's ship results — findings raised by
 * NON-BLOCKING ships only.
 *
 * Why only non-blocking ships: blocking ships' findings already gate the merge
 * and get the operator's attention by force; the triage problem is the advisory
 * pile that is easy to ignore wholesale. The XO curates that pile — it never
 * touches anything with gate power.
 *
 * @param results The run's per-ship results (verdict.ts ShipResult).
 * @returns The advisory findings in ship order, tagged with their ship name.
 */
export function collectAdvisoryFindings(results: ShipResult[]): AdvisoryRef[] {
  const out: AdvisoryRef[] = [];
  for (const r of results) {
    if (r.blocking) continue;
    for (const f of r.findings ?? []) {
      out.push({ ship: r.ship, path: f.path, line: f.line, severity: f.severity, body: f.body });
    }
  }
  return out;
}

/** One triage order: the advisory finding's index plus a one-line justification. */
export interface XoOrder {
  index: number;
  why: string;
}

/**
 * Parse the XO triage output: `{"orders":[{"index":n,"why":"…"}]}` (a bare
 * array is also accepted) into a validated, deduplicated, ranked shortlist.
 *
 * Why per-element filtering here (unlike the editor's whole-list rejection): a
 * triage order is purely additive — an invalid index simply can't be rendered,
 * while the valid ones still carry value. Nothing downstream is mutated by an
 * order, so partial acceptance is safe. A structurally malformed payload (no
 * JSON / wrong shape) still returns null so the caller falls back to the
 * unchanged comment.
 *
 * @param raw The raw model output (think spans are stripped internally).
 * @param advisoryCount Number of advisory findings shown (index upper bound).
 * @returns At most {@link XO_MAX_ORDERS} validated orders (possibly empty —
 *          the XO may demand nothing), or null when the payload is malformed.
 */
export function parseXoOrders(raw: string, advisoryCount: number): XoOrder[] | null {
  const parsed = extractXoJson(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { orders?: unknown }).orders)
      ? ((parsed as { orders: unknown[] }).orders)
      : null;
  if (list === null) return null;

  const seen = new Set<number>();
  const orders: XoOrder[] = [];
  for (const item of list) {
    if (orders.length >= XO_MAX_ORDERS) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.index !== 'number' || !Number.isInteger(o.index)) continue;
    if (o.index < 0 || o.index >= advisoryCount || seen.has(o.index)) continue;
    if (typeof o.why !== 'string' || !o.why.trim()) continue;
    seen.add(o.index);
    orders.push({ index: o.index, why: o.why.trim() });
  }
  return orders;
}

/**
 * Render the "XO's orders" markdown section from a validated shortlist.
 *
 * Design: the section is loudly labeled ADVISORY (the check conclusion is
 * untouched by construction — this is comment text only), each order is one
 * scannable line pointing at the exact finding, and the non-demanded remainder
 * is summarized as a COUNT rather than hidden, so the XO curates attention
 * without destroying information. Deterministic: same inputs → same bytes.
 *
 * @param orders The validated shortlist from {@link parseXoOrders}.
 * @param advisories The full advisory set the indices refer to.
 * @returns The markdown section ('' only when there were no advisories at all).
 */
export function renderXoOrdersSection(orders: XoOrder[], advisories: AdvisoryRef[]): string {
  const total = advisories.length;
  if (total === 0) return '';
  /**
   * English plural suffix, so the rendered counts read naturally ("1 finding" /
   * "2 findings") — the section's purpose is operator legibility.
   * @param n The count being described.
   * @returns 's' when plural, '' when singular.
   */
  const plural = (n: number): string => (n === 1 ? '' : 's');
  const head = "### ⚓ XO's orders (advisory — the check conclusion is unchanged)";

  if (orders.length === 0) {
    return (
      `${head}\n\n` +
      `The XO triaged ${total} advisory finding${plural(total)} and demands none for this PR. ` +
      `All remain listed in each ship's comment.`
    );
  }

  const items = orders.map((o, i) => {
    const a = advisories[o.index];
    return (
      `${i + 1}. \`${a.path}:${a.line}\` **${a.severity}** [pd-${a.ship}] ` +
      `${oneLine(a.body)}\n   — ${oneLine(o.why)}`
    );
  });
  const rest = total - orders.length;
  const restLine =
    rest > 0
      ? `\n\n${rest} other advisory finding${plural(rest)} reviewed and not demanded — ` +
        `see each ship's comment.`
      : '';
  return (
    `${head}\n\n` +
    `Of ${total} advisory finding${plural(total)}, the XO demands these for this PR:\n\n` +
    `${items.join('\n')}${restLine}`
  );
}

/**
 * Build the XO triage system prompt (the JSON orders contract).
 *
 * Why the explicit "verdicts are final" framing: the model must understand its
 * output is attention-routing, not gating — it should judge relevance to THIS
 * diff, severity honesty, and actionability, and demand few things, not
 * everything.
 *
 * @returns The system prompt string.
 */
function buildTriageSystemPrompt(): string {
  return (
    'You are the fleet XO (executive officer) on XO TRIAGE duty. Ship verdicts ' +
    'are already final and you NEVER change them. You receive the ADVISORY ' +
    '(non-blocking) findings raised on one PR. Judge which are genuinely worth ' +
    'doing FOR THIS PR: relevant to the actual diff, honestly severe, and ' +
    `actionable now. Demand at most ${XO_MAX_ORDERS}; fewer is better. ` +
    'Ignore findings that are speculative, off-diff, or severity-inflated.\n\n' +
    'Return STRICT JSON ONLY:\n\n' +
    '```json\n' +
    '{"orders": [{"index": 0, "why": "<one-line justification>"}]}\n' +
    '```\n\n' +
    '`index` is the 0-based finding index from the list you are shown. If ' +
    'nothing is worth demanding, return {"orders": []}. No prose outside the JSON.'
  );
}

/**
 * Build the XO triage user message: changed paths plus the indexed advisory
 * findings list.
 *
 * Why changed paths are included: "relevance to the diff" is the XO's first
 * judgment criterion, and the path list is the cheapest faithful summary of
 * the diff that fits the context budget.
 *
 * @param advisories The advisory findings (already capped by the caller).
 * @param changedPaths The PR's changed file paths.
 * @returns The user message string.
 */
function buildTriageUserMessage(advisories: AdvisoryRef[], changedPaths: string[]): string {
  const paths = changedPaths.slice(0, 60).join('\n') || '(unknown)';
  const list = advisories
    .map(
      (a, i) =>
        `${i}. [pd-${a.ship}] ${a.severity} \`${a.path}:${a.line}\` — ${oneLine(a.body)}`,
    )
    .join('\n');
  return `## Changed files in this PR\n${paths}\n\n## Advisory findings (0-indexed)\n${list}`;
}

/**
 * Run the XO triage and return the rendered "XO's orders" section for the
 * review comment.
 *
 * FAIL-OPEN by design: any model error, empty response, or malformed orders
 * payload returns '' — the caller then posts the review comment EXACTLY as it
 * would today, and the check conclusion is never consulted, let alone changed.
 * Never throws. A valid-but-empty shortlist still renders (the XO reviewed the
 * pile and demands nothing — that judgment is information, not a failure).
 *
 * @param opts.ai The Workers AI binding (env.AI — the ONLY model surface).
 * @param opts.model The `@cf/` model id (from {@link resolveXoModel}).
 * @param opts.advisories The advisory findings (capped internally at
 *        {@link XO_MAX_ADVISORIES}).
 * @param opts.changedPaths The PR's changed file paths (diff-relevance signal).
 * @param opts.gatewayId Optional AI Gateway id for cost/latency logging.
 * @returns The markdown section to append, or '' (no advisories / XO failure).
 */
export async function xoOrdersSection(opts: {
  ai: Ai;
  model: string;
  advisories: AdvisoryRef[];
  changedPaths: string[];
  gatewayId?: string;
}): Promise<string> {
  const advisories = opts.advisories.slice(0, XO_MAX_ADVISORIES);
  if (advisories.length === 0) return '';
  try {
    const res = await opts.ai.run(
      opts.model as Parameters<typeof opts.ai.run>[0],
      {
        messages: [
          { role: 'system', content: buildTriageSystemPrompt() },
          { role: 'user', content: buildTriageUserMessage(advisories, opts.changedPaths) },
        ],
        max_tokens: XO_MAX_OUTPUT_TOKENS,
      },
      xoAiOptions(opts.gatewayId),
    );
    const { text } = extractAiText(res);
    const orders = parseXoOrders(text, advisories.length);
    if (orders === null) return '';
    return renderXoOrdersSection(orders, advisories);
  } catch {
    return '';
  }
}
