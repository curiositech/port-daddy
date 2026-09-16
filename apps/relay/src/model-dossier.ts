/**
 * The Model Dossier — the fleet's reviewed Workers AI model board, as a
 * product surface.
 *
 * WHY THIS EXISTS (operator directive, 2026-08-22, PR #9249): the model
 * research that recalibrated the fleet's own tiers — verified prices, served
 * context windows, independent coding-agent evidence, per-role verdicts —
 * was living only in a repo skill reference and a review artifact. But the
 * people who most need it are signed-in operators DESIGNING a fleet on the
 * Shipwright page, picking a `model:` for each ship. This module makes the
 * dossier canonical data: the Shipwright page renders it as a board, the
 * Shipwright's own system prompt recommends from it (replacing the stale
 * hardcoded "qwen for general work" folklore), and the fleet-executor's
 * admission-contract suite asserts parity with its live rate/context tables
 * so this copy can never quietly drift from what the executor actually
 * honors and meters (the repo's fixture-parity rule: no second
 * implementation without a shared asserted fixture).
 *
 * The data itself lives in model-dossier.json — JSON so the fleet-executor
 * test suite can read the identical bytes with no cross-package TS coupling.
 */

import dossier from './model-dossier.json';

/** One reviewed model: identity, verified economics, and the fleet's verdict. */
export interface DossierModel {
  /** Exact Workers AI id — what goes in pd-fleet.yml `model:`. */
  id: string;
  /** Human name for the board. */
  name: string;
  /** Cost/capability tier label (e.g. "cheap agentic", "code frontier"). */
  tier: string;
  /** 'adopted' = carries a live fleet assignment; 'bench' = honored + pin-able. */
  verdict: 'adopted' | 'bench';
  inputUsdPerM: number;
  outputUsdPerM: number;
  contextTokens: number;
  /** One-line evidence/fit note, shown verbatim on the board and in the prompt. */
  note: string;
  /** Current Port Daddy fleet assignments (empty for bench models). */
  assignments: string[];
}

/** A named exclusion — a documented ruling, never a silent omission. */
export interface DossierExclusion {
  id: string;
  reason: string;
}

export interface ModelDossier {
  verifiedAt: string;
  sources: string;
  models: DossierModel[];
  excluded: DossierExclusion[];
}

/**
 * The canonical dossier. Typed via the interface (not `typeof json`) so a
 * malformed edit to the JSON fails the relay typecheck/tests here rather
 * than rendering garbage on the operator surface.
 */
export const MODEL_DOSSIER: ModelDossier = dossier as ModelDossier;

/**
 * Compact per-model line for prompts and text surfaces.
 *
 * Why one shared formatter: the board's numbers must read identically on the
 * page, in the Shipwright's system prompt, and in any transcript quoting it —
 * two formatters is how a price gets rounded differently in two places and
 * someone files a bug about which one lies.
 *
 * @param m the dossier entry
 * @returns e.g. `'@cf/zai-org/glm-4.7-flash' — $0.06/$0.40 per M, 131k ctx: …`
 */
export function dossierLine(m: DossierModel): string {
  const ctx =
    m.contextTokens >= 1_000_000
      ? `${Math.round(m.contextTokens / 1_000_000)}M`
      : `${Math.round(m.contextTokens / 1000)}k`;
  const assigned = m.assignments.length ? ` (fleet: ${m.assignments.join(', ')})` : '';
  return `'${m.id}' — $${m.inputUsdPerM}/$${m.outputUsdPerM} per M in/out, ${ctx} ctx: ${m.note}${assigned}`;
}

/**
 * The MODEL BOARD block for the Shipwright's system prompt.
 *
 * Design: the Shipwright must recommend `model:` ids from this list and no
 * other — a hallucinated or deprecated id in an emitted pd-fleet.yml would
 * be silently remapped (or silently blank) on the executor. Keeping the
 * board inside the prompt, generated from the same JSON the page renders,
 * is what retires the hardcoded model folklore this replaced.
 *
 * @returns a prompt fragment listing every honored model grouped by verdict
 */
export function modelBoardPromptFragment(): string {
  const adopted = MODEL_DOSSIER.models.filter(m => m.verdict === 'adopted');
  const bench = MODEL_DOSSIER.models.filter(m => m.verdict === 'bench');
  return [
    `THE MODEL BOARD (verified ${MODEL_DOSSIER.verifiedAt} — prices from Cloudflare's live pricing page, context = served window). Every \`model:\` id you emit MUST come from this board, quoted exactly; any other id is silently remapped or blank on the executor. Recommend by role fit and price, and say why:`,
    `Proven in the Port Daddy fleet:`,
    ...adopted.map(m => `  - ${dossierLine(m)}`),
    `Also honored (pin-able, no fleet assignment yet):`,
    ...bench.map(m => `  - ${dossierLine(m)}`),
  ].join('\n');
}
