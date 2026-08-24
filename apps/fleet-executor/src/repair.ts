/**
 * CONTRACT REPAIR — in-run self-healing for broken ship output.
 *
 * WHY THIS EXISTS (the 2026-08-19 fleet-wide red, the morning after the
 * broken-ship doctrine landed): the doctrine is correct — a ship that returns
 * no usable output or a malformed block is broken, and a broken ship fails the
 * run. But the FIRST line of defense against a broken ship must be the fleet
 * healing itself, not the PR author eating a red check. The cheap Workers AI
 * tiers the ships run on emit contract-violating output at a steady stochastic
 * rate (a missing FLEET-VERDICT line, an unfenced JSON body, a truncated
 * block). Failing the run on the first bad sample punished every open PR for
 * the fleet's own dice rolls.
 *
 * THE DESIGN: when a ship's output fails its contract, the executor makes up
 * to two bounded REPAIR attempts before declaring the ship broken:
 *
 *   1. SAME MODEL, repair prompt — the model is shown its own prior output,
 *      told exactly which contract test it failed, and asked to re-emit ONLY
 *      the contract format. Most no-contract-signal failures are formatting
 *      slips, and one explicit reminder recovers them.
 *   2. ESCALATION MODEL — if the same model fails twice, one attempt on a
 *      stronger, known-good tier ({@link REPAIR_ESCALATION_MODEL}). A model
 *      that cannot format is not asked a third time.
 *
 * Both attempts are validated by the CALLER's own parser (the `validate`
 * callback) — repair never gets to decide for itself that it succeeded, the
 * same zero-trust posture as everywhere else in the executor. If neither
 * attempt validates, the ship is genuinely broken and the broken-ship
 * doctrine takes over (see src/adjudicator.ts for what happens next).
 *
 * Cost bound: at most 2 extra model calls per broken contract site, only on
 * runs that would otherwise have FAILED. Usage is accumulated through the
 * caller's own metrics hook so repair spend is metered like any other call.
 */

/**
 * The escalation tier for a second repair attempt. A known-good Workers AI id
 * (already used as the ships' own fallback tier in pd-fleet.yml) — never
 * derived from config, so a typo elsewhere cannot route repair to a model
 * that silently returns blank.
 */
export const REPAIR_ESCALATION_MODEL = '@cf/openai/gpt-oss-120b';

/** One repair attempt's audit row, recorded verbatim in the transcript. */
export interface RepairAttempt {
  model: string;
  /** Whether the caller's validator accepted this attempt's output. */
  ok: boolean;
  /** Post-strip output length, for forensics without re-running the model. */
  outputLength: number;
}

/** Outcome of {@link repairContractOutput}. */
export interface RepairOutcome {
  /** The healed output when `healed`, else the last attempt's raw output. */
  text: string;
  healed: boolean;
  /** Which model healed it ('' when not healed). */
  healedBy: string;
  attempts: RepairAttempt[];
}

/**
 * A single model call the caller provides — signature-compatible with both
 * execute.ts's ai plumbing and purser.ts's purserAiCall, so repair stays a
 * pure orchestration module with no AI/env imports of its own (and is
 * therefore trivially unit-testable).
 */
export type RepairModelCall = (model: string, system: string, user: string) => Promise<string>;

/**
 * Build the repair prompt: name the failure, restate the contract, forbid
 * anything but the contract format.
 *
 * DESIGN: the prior output is included so the model can salvage its own
 * substance (findings it already identified, proposals it already drafted)
 * rather than re-reviewing from scratch — repair recovers WORK, not just
 * formatting. The contract text comes from the caller (the same
 * buildOutputContract / ideationOutputContract / purser prompt fragment the
 * ship was originally given), so repair can never drift from the real
 * contract.
 *
 * @param shipLabel e.g. `pd-lookout` — keeps stub routing and transcripts legible.
 * @param contract The verbatim output-contract text the ship must satisfy.
 * @param reason Which contract test the prior output failed.
 * @returns The system prompt for a repair call.
 */
export function buildRepairSystemPrompt(shipLabel: string, contract: string, reason: string): string {
  return (
    `You are ${shipLabel}, in CONTRACT REPAIR mode. Your previous response ` +
    `failed its output contract: ${reason}.\n\n` +
    `Re-emit your previous response's SUBSTANCE in EXACTLY the contract format ` +
    `below, and output NOTHING else — no preamble, no commentary, no reasoning.\n\n` +
    `${contract}`
  );
}

/**
 * Attempt to repair contract-violating ship output. See the module doc for
 * motivation and the two-attempt design.
 *
 * @param opts.shipLabel Display label (e.g. `pd-lookout`) for prompts/audit.
 * @param opts.model The ship's own model — attempt 1 runs here.
 * @param opts.contract Verbatim output-contract text to restate.
 * @param opts.priorOutput The broken output being repaired.
 * @param opts.reason Which contract test failed (rendered into the prompt).
 * @param opts.call The caller's model-call function (carries env/metrics).
 * @param opts.validate The caller's OWN parser/classifier — the only judge of
 *   whether an attempt healed. Repair never self-certifies.
 * @param opts.abortOnError Optional fail-fast classifier for errors that are
 *   not model/transport failures (for example, a superseded PR head). Matching
 *   errors propagate immediately and never trigger another repair call.
 * @param opts.escalationModel Override for tests; defaults to
 *   {@link REPAIR_ESCALATION_MODEL}.
 * @returns The outcome; `healed: false` means the broken-ship doctrine applies.
 */
export async function repairContractOutput(opts: {
  shipLabel: string;
  model: string;
  contract: string;
  priorOutput: string;
  reason: string;
  call: RepairModelCall;
  validate: (text: string) => boolean;
  abortOnError?: (error: unknown) => boolean;
  escalationModel?: string;
}): Promise<RepairOutcome> {
  const escalation = opts.escalationModel ?? REPAIR_ESCALATION_MODEL;
  const system = buildRepairSystemPrompt(opts.shipLabel, opts.contract, opts.reason);
  const user =
    `## Your previous (contract-violating) response\n\n${opts.priorOutput || '(empty)'}\n\n` +
    `Re-emit it in the contract format now.`;

  // Attempt 1 on the ship's own model; attempt 2 escalates. Deduplicated when
  // the ship already runs ON the escalation tier — no point asking it twice.
  const models = opts.model === escalation ? [opts.model] : [opts.model, escalation];

  const attempts: RepairAttempt[] = [];
  for (const model of models) {
    let text = '';
    try {
      text = await opts.call(model, system, user);
    } catch (error) {
      if (opts.abortOnError?.(error)) throw error;
      // A transport error during repair is just a failed attempt — the run's
      // own error handling (broken-ship doctrine) is the caller's job.
      text = '';
    }
    const ok = !!text && opts.validate(text);
    attempts.push({ model, ok, outputLength: text.length });
    if (ok) return { text, healed: true, healedBy: model, attempts };
  }
  return {
    text: attempts.length ? opts.priorOutput : opts.priorOutput,
    healed: false,
    healedBy: '',
    attempts,
  };
}
