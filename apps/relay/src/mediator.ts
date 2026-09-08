/**
 * X4 MEDIATOR — the reserved `pd-mediator` seat's FIRST REAL BODY
 * (docs/proposals/relay-grand-plan.md §X4 second half; `mediator-body`,
 * first slice only). Built on the X4 v1 parley artifact in src/parleys.ts.
 *
 * v1 reserved a tier-labeled `pd-mediator` observer row on every parley and
 * gave it NO behavior. This slice gives it exactly ONE behavior, chosen to be
 * the smallest thing that is genuinely useful to an operator reading a parley:
 *
 *   **an OBSERVATION** — a short, neutral note recorded on the mediator's own
 *   observer row summarizing the positions taken so far and where they
 *   diverge. It is written when a parley is convened and again after each
 *   position is signed, and it is the mediator's ONLY output.
 *
 * ── WHY SO LITTLE ────────────────────────────────────────────────────────────
 * This is the feature where over-automation is dangerous. A mediator that can
 * nudge an outcome is not a mediator, it is an unaccountable party — and the
 * whole value of a parley is that the artifact records what HUMANS (and their
 * registered daemons) signed. So the design principle here is inverted from
 * most features: the interesting question is not "what else could it do?" but
 * "what is it structurally incapable of doing?". The answers, enforced in
 * code at the write sites rather than by convention:
 *
 *   - It CANNOT SIGN. Its seat is `is_party = 0`, and the only write this
 *     module can make ({@link recordMediatorObservation} in db.ts) is an
 *     UPDATE that sets `position` alone and whose WHERE clause pins
 *     `party_kind = 'mediator' AND is_party = 0 AND signed_at IS NULL`. It has
 *     no code path that can touch `stance` or `signed_at` — not "does not",
 *     CANNOT: the SET list does not name those columns.
 *   - It CANNOT BE A PARTY. `resolvePartySpec` (parleys.ts) rejects the
 *     reserved id at convene time, so no parley can ever be created where the
 *     mediator's accept is required.
 *   - It CANNOT CAUSE OR BLOCK AGREEMENT. Agreement is computed by
 *     `countUnacceptedParties`, which filters `is_party = 1`. An observer row
 *     is invisible to that query in both directions — its presence can never
 *     hold a parley open, and its absence can never close one.
 *   - It CANNOT EXTEND A DEADLINE or change state. This module never touches
 *     the `parleys` table at all; `deadline_at`, `state`, and `resolved_at`
 *     are unreachable from here.
 *   - It CANNOT ALTER ANOTHER PARTY'S POSITION. Its UPDATE's WHERE clause
 *     pins `party_kind = 'mediator'`; a human's or daemon's row cannot match.
 *
 * The mediator READS every position (that is the job — summarizing divergence
 * requires seeing the positions) and WRITES only its own row. Read-many,
 * write-one is the entire capability.
 *
 * ── ORDERING (why observation runs last) ─────────────────────────────────────
 * Callers invoke this AFTER the state machine has already resolved. That is
 * deliberate: even if this module were compromised or its model hung, the
 * parley's outcome is already durably decided before the mediator is asked for
 * an opinion. The observation is strictly a postscript on a settled fact.
 *
 * ── MODEL POLICY ─────────────────────────────────────────────────────────────
 * Workers AI ONLY (`env.AI`, `@cf/` ids), config-swappable via the
 * PARLEY_MEDIATOR_MODEL var, with a non-`@cf/` override REJECTED exactly as
 * `resolveXoModel` does — see {@link resolveMediatorModel}. There is no
 * Anthropic path, no Claude Code path, and no external runner: the mediator's
 * body is a single `env.AI.run` call and nothing else.
 *
 * ── FAIL-OPEN AND HONEST ─────────────────────────────────────────────────────
 * Every failure mode — binding absent, model error, timeout, empty or garbage
 * output, D1 write failure — leaves the parley COMPLETELY unaffected and
 * records nothing. The surfaces then say the mediator had nothing to add,
 * which is true, rather than inventing a summary or hiding the seat. A
 * mediator outage must never be able to stall or corrupt an agreement, so the
 * only honest default is silence. {@link observeParley} therefore never
 * throws and never rejects: it returns a {@link MediatorOutcome} describing
 * what happened, for tests and callers to assert on.
 *
 * ── OPT-IN ───────────────────────────────────────────────────────────────────
 * Default OFF. The relay's analogue of the fleet's `xo:` / `squidEvents:`
 * per-tenant consent keys is the PARLEY_MEDIATOR var (see
 * {@link mediatorEnabled}) — an operator must switch it on deliberately, and
 * until they do, not one token is spent and the seat behaves exactly as the
 * honest v1 it shipped as.
 *
 * DEFERRED, explicitly, and NOT implemented here (grand-plan §X4 second half):
 * agent-first summons and daemon refuse/escalate (D11); the human
 * Approve/Modify/Reject gate before irreversible actions; Helm-configured
 * default outcomes on expiry; receipt_sig / parley receipts as merge currency;
 * parley channel turns; symbol-level conflict prediction and auto-convening.
 */

import { CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';
import type { Env } from './types.js';
import {
  listParleyPositions,
  recordMediatorObservation,
  type ParleyPositionRow,
  type ParleyRow,
} from './db.js';

// ── Policy constants ─────────────────────────────────────────────────────────

/**
 * Committed default model. A small instruct model is the right pick: the task
 * is a two-sentence neutral summary of text the caller already supplies, not
 * reasoning, and a cheap model keeps a per-signature call affordable enough
 * that the honest answer to "should this be async?" stays "no".
 */
export const DEFAULT_MEDIATOR_MODEL = CF_ROLE_MODELS.mediator;

/** Hard cap on a recorded observation — this is a margin note, not an essay. */
export const MAX_OBSERVATION_CHARS = 600;

/** Cap on any single position text quoted into the prompt (prompt-bloat guard). */
const PROMPT_FIELD_CHAR_LIMIT = 400;

/** Ceiling on model output tokens; generous for ~600 chars, bounded for cost. */
const OBSERVATION_MAX_TOKENS = 320;

/**
 * Shortest believable observation. Below this the output is a stub ("N/A",
 * "OK", a stray bracket) rather than a summary, and recording it would be
 * worse than silence — an operator would read the seat as having spoken.
 */
const MIN_OBSERVATION_CHARS = 24;

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Is the mediator's body switched on for this relay?
 *
 * Design intent: this is the relay-side analogue of the fleet's per-tenant
 * `xo:` / `squidEvents:` consent keys — an explicit, affirmative opt-in that
 * defaults to OFF. The reasoning is the same one that governs those keys:
 * spending an operator's model budget, and attaching machine-authored text to
 * an artifact whose entire value is that humans signed it, are both things a
 * deployment must CHOOSE, never inherit. An unset or misspelled var therefore
 * resolves to off rather than on, so the failure mode of a config typo is a
 * silent v1 parley, not a surprise robot commentator.
 *
 * Only the exact string `on` enables it; every other value (including `true`,
 * `1`, and `yes`) is off, so the switch reads unambiguously in a diff of
 * wrangler.deploy.toml rather than depending on a truthiness convention.
 *
 * @param env Worker env carrying the optional PARLEY_MEDIATOR plaintext var.
 * @returns True only when an operator has explicitly set PARLEY_MEDIATOR=on.
 */
export function mediatorEnabled(env: Env): boolean {
  return env.PARLEY_MEDIATOR?.trim().toLowerCase() === 'on';
}

/**
 * Resolve the mediator's Workers AI model id from the optional
 * PARLEY_MEDIATOR_MODEL var.
 *
 * Why a guard rather than trusting the var: the hard constraint on this
 * feature is Workers AI ONLY — never Anthropic, never Claude Code, never an
 * external runner — and that constraint has to survive a config edit made by
 * someone who has not read this file. A foreign id (`claude-…`, `gpt-…`,
 * `anthropic/…`) must not be able to route the mediator off Workers AI, and on
 * Workers AI a nonexistent id does not reliably error — it can yield an empty
 * response that would silently read as "the mediator had nothing to add". So
 * only a `@cf/` id is honored; anything else falls back to the committed
 * default. This mirrors `resolveXoModel` in apps/fleet-executor/src/xo.ts
 * exactly, on purpose: one idiom, one guarantee, in both workers.
 *
 * @param configured The PARLEY_MEDIATOR_MODEL plaintext var (may be undefined/blank).
 * @returns The configured id when it is a `@cf/` model, else {@link DEFAULT_MEDIATOR_MODEL}.
 */
export function resolveMediatorModel(configured: string | undefined): string {
  if (typeof configured === 'string' && configured.trim().startsWith('@cf/')) {
    return configured.trim();
  }
  return DEFAULT_MEDIATOR_MODEL;
}

// ── Outcome ──────────────────────────────────────────────────────────────────

/**
 * What one mediation attempt did — the honest, enumerated result.
 *
 * Motivation: a boolean would collapse "switched off" and "the model failed"
 * into the same answer, and those are very different facts for an operator
 * debugging why a seat is silent. Every value here is a distinct, true
 * statement about the world, and NONE of them implies the parley changed —
 * the parley is untouched in all six cases.
 *
 *  - `disabled`      — PARLEY_MEDIATOR is not `on`; nothing was attempted.
 *  - `unconfigured`  — no `[ai]` binding on this relay; nothing was attempted.
 *  - `no-seat`       — this parley has no mediator observer row (should not
 *                      happen for parleys convened by this codebase; treated
 *                      as an honest no-op rather than an error).
 *  - `model-failed`  — the Workers AI call threw; nothing was recorded.
 *  - `write-failed`  — the model answered, but D1 threw on the note write.
 *                      Distinct from `model-failed` on purpose: the two have
 *                      different causes and different operator responses, and
 *                      an outcome that collapsed them would send whoever reads
 *                      it hunting the wrong dependency.
 *  - `nothing-to-add`— the model answered emptily or with garbage; nothing was
 *                      recorded, and the surfaces say exactly that.
 *  - `recorded`      — an observation was written to the mediator's own row.
 */
export type MediatorOutcome =
  | 'disabled'
  | 'unconfigured'
  | 'no-seat'
  | 'model-failed'
  | 'write-failed'
  | 'nothing-to-add'
  | 'recorded';

/** What prompted this observation — used only to frame the prompt's ask. */
export type MediatorTrigger = 'convened' | 'signed';

// ── Prompt construction ──────────────────────────────────────────────────────

/** Clamp one free-text field before it enters a prompt (bloat + cost guard). */
function clamp(text: string, limit = PROMPT_FIELD_CHAR_LIMIT): string {
  const t = text.trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 1)}…`;
}

/**
 * The mediator's system prompt — a neutrality contract, written as a refusal
 * list rather than a role description.
 *
 * Design rationale: telling a model "be neutral" is a wish; telling it the
 * specific sentences it must not produce is a specification. The prompt is
 * belt to the code's braces — the model CANNOT change an outcome no matter
 * what it emits, because its output only ever lands in a `position` column on
 * an `is_party = 0` row — but a model that recommends an outcome would still
 * produce text an operator could mistake for authority, and that is a real
 * harm even when the state machine is untouched. So the prompt forbids
 * recommending, judging, predicting, and advising, and asks only for the two
 * things that are safely factual: what each party said, and where they differ.
 */
export const MEDIATOR_SYSTEM_PROMPT = [
  'You are the harbor MEDIATOR observing a multi-party agreement (a "parley").',
  'You are an OBSERVER with no vote. You cannot sign, and nothing you write changes the outcome.',
  '',
  'Write 1-3 short sentences of plain prose that:',
  '  1. summarize the positions the parties have actually taken so far, and',
  '  2. name concretely where those positions diverge (or say they do not yet diverge).',
  '',
  'You MUST NOT: recommend an outcome; say who is right; advise anyone to accept or reject;',
  'predict what will happen; propose a compromise; or address any party directly.',
  'Describe only what is on the record. If a party has not signed, say so plainly.',
  'No preamble, no headings, no bullet points, no markdown. Prose only.',
].join('\n');

/**
 * Build the user-turn prompt describing one parley's current record.
 *
 * Exported for testing: the prompt is the mediator's entire input surface, so
 * asserting on it directly is how we prove the model is shown the positions
 * and nothing else — no session tokens, no other harbors' parleys, no user
 * emails, no relay secrets. The blast radius of the AI call is exactly this
 * string, and keeping it inspectable is the point.
 *
 * @param parley The parley artifact (subject and state are quoted; ids are not).
 * @param positions Every seat on the parley, named parties and observers alike.
 * @param trigger Whether this observation follows a convene or a signature.
 * @returns The user message text for the Workers AI call.
 */
export function buildObservationPrompt(
  parley: Pick<ParleyRow, 'subject' | 'state' | 'proposer_label'>,
  positions: ParleyPositionRow[],
  trigger: MediatorTrigger,
): string {
  const parties = positions.filter((p) => p.is_party === 1);
  const lines = parties.map((p) => {
    const who = `${clamp(p.party_label, 80)} (${p.party_kind})`;
    if (p.signed_at === null || p.stance === null) return `- ${who}: has NOT signed yet.`;
    const text = p.position ? ` Their stated position: "${clamp(p.position)}"` : ' They gave no position text.';
    return `- ${who}: signed ${p.stance}.${text}`;
  });
  const framing =
    trigger === 'convened'
      ? 'This parley was just convened; no one has signed yet unless noted below.'
      : 'A party has just signed. Summarize the record as it now stands.';
  return [
    `Subject under negotiation: "${clamp(parley.subject)}"`,
    `Proposed by: ${clamp(parley.proposer_label, 80)}`,
    `Current state: ${parley.state}`,
    framing,
    '',
    'The record:',
    ...lines,
  ].join('\n');
}

// ── Output sanitation ────────────────────────────────────────────────────────

/**
 * Turn raw model output into something safe to record, or reject it entirely.
 *
 * Philosophy: the model is an untrusted text source, exactly like a GitHub
 * account name or a user-supplied position — it just happens to be one the
 * relay itself invoked. Three things follow, and this function does all three.
 *
 * First, reasoning spans: some Workers AI models narrate `<think>…</think>`
 * before answering, and recording that narration would attach a machine's
 * musings to a signed artifact. They are stripped (including the orphan-tag
 * shapes truncation produces), matching `stripThinkSpans` in the executor.
 *
 * Second, shape: control characters and newlines are flattened to single
 * spaces so a note cannot smuggle layout into a table cell, and the result is
 * capped at {@link MAX_OBSERVATION_CHARS}.
 *
 * Third — and this is the one that matters — REJECTION IS A FIRST-CLASS
 * OUTCOME. Empty output, a stub, or leftover markup returns null, and null
 * means nothing is written at all. The alternative (recording a degraded
 * string) would make the seat look like it spoke when it did not, which is
 * precisely the dishonesty the fail-open rule exists to prevent.
 *
 * Note what this function does NOT do: it does not HTML-escape. Escaping is
 * the renderer's job and happens at every render site through `esc()`; doing
 * it here as well would double-escape and would also wrongly imply the stored
 * value is safe to interpolate raw somewhere else. Stored hostile, rendered
 * escaped — the same contract as every other free-text column.
 *
 * @param raw The model's response text (may be undefined, empty, or garbage).
 * @returns A recordable observation, or null when there is nothing honest to record.
 */
export function sanitizeObservation(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;

  // Strip reasoning spans, including the orphan-tag shapes truncation leaves.
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const orphanClose = text.indexOf('</think>');
  if (orphanClose !== -1) text = text.slice(orphanClose + '</think>'.length);
  const orphanOpen = text.indexOf('<think>');
  if (orphanOpen !== -1) text = text.slice(0, orphanOpen);

  // Flatten control characters and collapse whitespace to a single line.
  text = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip a leading label the model may prepend despite the prompt.
  text = text.replace(/^(observation|summary|note)\s*[:\-—]\s*/i, '').trim();

  if (text.length < MIN_OBSERVATION_CHARS) return null;
  // Output that is mostly markup rather than prose is garbage, not a summary.
  if (!/[a-z]{3}/i.test(text)) return null;

  return text.length <= MAX_OBSERVATION_CHARS
    ? text
    : `${text.slice(0, MAX_OBSERVATION_CHARS - 1)}…`;
}

// ── The body ─────────────────────────────────────────────────────────────────

/**
 * Ask the mediator to observe one parley, and record its note if it has one.
 *
 * This is the mediator's ENTIRE body. It reads the parley's positions, asks
 * Workers AI for a neutral summary, and — only on success — writes that
 * summary to the mediator's own observer row. It cannot reach any other write.
 *
 * Why it never throws: callers invoke this from inside the convene and respond
 * paths, after those paths have already durably resolved the parley's state.
 * If a model outage could propagate an exception up, a mediator failure would
 * turn a successful signature into a 500 and the operator would reasonably
 * believe their signature did not land — the artifact and the transcript would
 * disagree. So every failure is caught and converted into a
 * {@link MediatorOutcome}, and the caller is free to ignore the return value
 * entirely. Fail-open is not politeness here; it is the only way the parley's
 * durability survives a dependency the parley does not need.
 *
 * Why it reads positions itself instead of taking them as an argument: the
 * caller may have signed a position moments ago, and the observation should
 * describe the record as it actually stands in D1, not a snapshot taken before
 * the write. Reading here also puts the read BEHIND the opt-in gates below, so
 * the shipped default (mediator OFF) costs the convene and respond paths
 * nothing at all — not a token, and not a D1 round-trip.
 *
 * @param env Worker env — supplies the optional `AI` binding, `DB`, and config vars.
 * @param parley The parley to observe (subject/state/proposer are quoted into the prompt).
 * @param trigger Whether this follows a convene or a signature (frames the prompt only).
 * @returns The honest outcome of the attempt; the parley is unchanged in every case.
 */
export async function observeParley(
  env: Env,
  parley: Pick<ParleyRow, 'id' | 'subject' | 'state' | 'proposer_label'>,
  trigger: MediatorTrigger,
): Promise<MediatorOutcome> {
  // Both gates precede the D1 read on purpose — see the note above. Reordering
  // these buys a wasted round-trip on every convene and every signature for
  // every operator who never switched the mediator on.
  if (!mediatorEnabled(env)) return 'disabled';
  const ai = env.AI;
  if (!ai) return 'unconfigured';

  let positions: ParleyPositionRow[];
  try {
    positions = await listParleyPositions(env.DB, parley.id);
  } catch {
    // Fail-open on the read for the same reason as the write below: the
    // signature that triggered this is already durable.
    return 'write-failed';
  }
  // No observer seat ⇒ nothing this module is allowed to write to. Honest no-op.
  if (!positions.some((p) => p.party_kind === 'mediator' && p.is_party === 0)) return 'no-seat';

  const model = resolveMediatorModel(env.PARLEY_MEDIATOR_MODEL) as Parameters<typeof ai.run>[0];
  let raw: string | undefined;
  try {
    const res = (await ai.run(model, {
      messages: [
        { role: 'system', content: MEDIATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildObservationPrompt(parley, positions, trigger) },
      ],
      max_tokens: OBSERVATION_MAX_TOKENS,
    })) as { response?: string };
    raw = res?.response;
  } catch {
    // Model unreachable, rate-limited, or erroring: the parley is untouched
    // and the surfaces will say the mediator had nothing to add.
    return 'model-failed';
  }

  const note = sanitizeObservation(raw);
  if (note === null) return 'nothing-to-add';

  try {
    const wrote = await recordMediatorObservation(env.DB, { parleyId: parley.id, note });
    return wrote ? 'recorded' : 'nothing-to-add';
  } catch {
    // A D1 hiccup on the note write is also fail-open: the signature that
    // triggered this observation is already durable and stays that way. It
    // reports as `write-failed`, NOT `model-failed` — the model did its job
    // here, and an operator reading this outcome should look at D1.
    return 'write-failed';
  }
}
