/**
 * Per-ship attempt checkpoints — a retried delivery RESUMES instead of
 * restarting.
 *
 * The dead-letter class that survived #7377 (CPU ceiling) and #7849 (MAP
 * memory bounds) is an uncatchable platform kill: the isolate is terminated
 * mid-run, no catch block fires, and the queue redelivers. Before this module,
 * every retry re-ran EVERY ship from ship one — identical model spend, four
 * times over, each attempt marching into the same kill (run 103e3650 on
 * PR #7279, 2026-08-20: "4 delivery attempt(s) recorded a start marker but no
 * failure"). A kill that cannot be caught cannot be prevented by tuning; the
 * only robust posture is to make retries MONOTONIC — attempt N+1 starts where
 * attempt N died, so each attempt does strictly less work and the run
 * converges even when the ceiling never moves.
 *
 * Mechanism: after each ship completes, its {@link ShipResult} is written as a
 * `ship-checkpoint` row in `fleet_run_steps`, parked in its own seq band above
 * the delivery-failure (1M) and attempt-marker (2M) bands so the Transcript
 * recorder's seq-0 restart on redelivery can never overwrite it. The runId is
 * already deterministic per delivery (`run:<deliveryId>`), so retries — and
 * DLQ replays of the same delivery — can revalidate predecessors against the
 * current trusted Fleet policy, contract, graft, prompt, and mediator orders,
 * then reconstruct
 * only matching ships without re-running them. A NEW push is a new delivery
 * and a new runId: checkpoints never leak across heads.
 *
 * Every write and read here is BEST-EFFORT and never throws: a checkpoint
 * failure degrades to exactly the pre-checkpoint behaviour (the ship re-runs),
 * and a corrupt row is ignored rather than trusted — re-running a ship is
 * always safe; resuming a fabricated verdict is not.
 */

import type { ExecutorEnv } from './env.js';
import type { ShipConfig } from './fleet.js';
import type { Finding, ShipResult, Verdict } from './verdict.js';

/** `fleet_run_steps.kind` for a completed ship's checkpointed result. */
export const SHIP_CHECKPOINT_KIND = 'ship-checkpoint';

/**
 * Persisted checkpoint wire format. Versionless rows and older binding
 * versions predate one or more trusted review inputs and must re-run rather
 * than masquerade as a current clean result under a changed review contract.
 */
export const SHIP_CHECKPOINT_SCHEMA_VERSION = 3;

/** Current shape of the trusted inputs a checkpoint must prove it reviewed. */
export const SHIP_CHECKPOINT_BINDING_VERSION = 3;

/**
 * Opaque, deterministic witness of the authoritative policy and live PR input
 * that shaped a completed ship result. These hashes deliberately contain no
 * contract, diff, or skill text: checkpoint rows are durable operator evidence,
 * not another copy of a potentially large prompt.
 */
export interface ShipCheckpointBinding {
  bindingVersion: typeof SHIP_CHECKPOINT_BINDING_VERSION;
  shipConfigSha256: string;
  contractSha256: string;
  graftSha256: string;
  systemPromptSha256: string;
  reviewInputSha256: string;
  /** Exact mediator reinjection that shaped user-visible ship context, or an explicit absence sentinel. */
  mediatorOrdersSha256: string;
}

/** Why a retained row was deliberately not allowed to resume. */
export type CheckpointInvalidationReason =
  | 'trusted-binding-mismatch'
  | 'non-resumable-result';

/**
 * Exact pull-request evidence that can shape a ship's user prompt or execution
 * path. It intentionally excludes installation credentials and other runtime
 * plumbing, but includes every live PR field exposed to reviewer/Purser logic.
 */
export interface CheckpointReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  isFork: boolean;
  files: ReadonlyArray<{
    filename: string;
    status: string;
    patch?: string;
    additions: number;
    deletions: number;
  }>;
  diff: string;
  diffBytes: number;
  diffTruncated: boolean;
  filesTruncated: boolean;
}

/**
 * Seq floor for checkpoint rows — its own band above the failure (1M) and
 * attempt-marker (2M) bands, for the same reason those have bands: the
 * Transcript recorder restarts seq at 0 on every delivery and INSERT OR
 * REPLACEs, so anything that must SURVIVE a redelivery has to live where a
 * fresh attempt's seqs can never reach.
 */
export const SHIP_CHECKPOINT_SEQ_BASE = 3_000_000;

const VALID_VERDICTS: ReadonlySet<string> = new Set(['PASS', 'BLOCK']);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['HIGH', 'MEDIUM', 'LOW']);
const MAX_REVIEW_COVERAGE_REASON_CHARS = 2_048;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const ABSENT_CONTRACT_DIGEST = 'absent';
/** No Modify order was present for this delivery when the checkpoint was written. */
const ABSENT_MEDIATOR_ORDERS_DIGEST = 'absent';

/**
 * Digest text as lower-case SHA-256 with an algorithm prefix.
 *
 * The prefix makes a persisted checkpoint self-describing and prevents a
 * future hashing migration from comparing unlike opaque strings as though
 * they were the same proof.
 *
 * @param value Exact UTF-8 text to bind.
 * @returns A versioned SHA-256 digest string.
 */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Normalize a trigger's set-like string form before hashing it.
 *
 * YAML key order must not invalidate a checkpoint, while a real change to the
 * effective trigger must. The parser already validates values; this only makes
 * scalar and singleton-array representations of the same trigger equivalent.
 *
 * @param trigger Parsed Fleet trigger declaration.
 * @returns Stable sorted trigger names.
 */
function normalizedTriggers(trigger: ShipConfig['trigger']): string[] {
  return [...new Set(Array.isArray(trigger) ? trigger : [trigger])].sort();
}

/**
 * Render the parsed effective ship configuration as a fixed-order semantic
 * tuple rather than serializing YAML or an object whose key insertion order is
 * accidental. Every field here can alter whether or how a ship reviews.
 *
 * @param ship Parsed trusted ship configuration.
 * @returns Stable JSON-ready tuple of review-relevant policy fields.
 */
function semanticShipConfigTuple(ship: ShipConfig): readonly unknown[] {
  return [
    'fleet-ship-config-v1',
    ship.name,
    normalizedTriggers(ship.trigger),
    ship.prompt,
    ship.cfModel,
    ship.cfMapModel ?? null,
    ship.cfPlanModel ?? null,
    ship.cfAuthorModel ?? null,
    ship.temperature,
    ship.role,
    ship.telos,
    ship.blocking,
    ship.needsExecution,
    ship.ideation,
    ship.purser,
    ship.blockWithoutSandbox,
    ship.testPaths,
    ship.graft,
  ];
}

/**
 * Digest the exact live PR projection supplied to Fleet review work.
 *
 * A GitHub PR description may be edited without changing its head SHA or
 * delivery id. The head alone therefore cannot prove an old model verdict saw
 * the same title, body, file inventory, or diff that a resumed run would use.
 * This fixed-order tuple is intentionally lossless for the fields passed into
 * reviewer and Purser prompt/execution paths; preserving file order also
 * preserves the rendered changed-file index order.
 *
 * @param input Live PR evidence used by the current delivery.
 * @returns A digest suitable for a per-ship checkpoint binding.
 */
export async function createCheckpointReviewInputSha256(
  input: CheckpointReviewInput,
): Promise<string> {
  return sha256(JSON.stringify([
    'fleet-review-input-v1',
    input.owner,
    input.repo,
    input.prNumber,
    input.title,
    input.body,
    input.headSha,
    input.headRef,
    input.baseSha,
    input.baseRef,
    input.isFork,
    input.files.map(file => [
      file.filename,
      file.status,
      file.patch ?? null,
      file.additions,
      file.deletions,
    ]),
    input.diff,
    input.diffBytes,
    input.diffTruncated,
    input.filesTruncated,
  ]));
}

/**
 * Bind a checkpoint to the exact trusted policy and prompt snapshot that
 * generated it.
 *
 * The system prompt includes the ship contract and grafted skill text. Keeping
 * the component hashes too makes a mismatch auditable without persisting raw
 * prompt material. A confirmed absent contract uses its own sentinel; an
 * unavailable contract is never passed here because the executor retries it.
 *
 * @param ship Parsed trusted Fleet configuration for one ship.
 * @param contract Exact trusted contract text, or null only for HTTP 404.
 * @param graftText Exact trusted graft prefix used for this attempt.
 * @param systemPrompt Exact system prompt handed to the model.
 * @param reviewInputSha256 Digest of the exact live PR input projection.
 * @param mediatorOrders Exact consumed Modify-order context, or '' when none was present.
 * @returns Deterministic checkpoint binding for persistence and comparison.
 */
export async function createShipCheckpointBinding(
  ship: ShipConfig,
  contract: string | null,
  graftText: string,
  systemPrompt: string,
  reviewInputSha256: string,
  mediatorOrders = '',
): Promise<ShipCheckpointBinding> {
  if (!SHA256_RE.test(reviewInputSha256)) {
    throw new Error('checkpoint review input digest must be a SHA-256 value');
  }
  const [shipConfigSha256, contractSha256, graftSha256, systemPromptSha256, mediatorOrdersSha256] = await Promise.all([
    sha256(JSON.stringify(semanticShipConfigTuple(ship))),
    contract === null ? Promise.resolve(ABSENT_CONTRACT_DIGEST) : sha256(contract),
    sha256(graftText),
    sha256(systemPrompt),
    mediatorOrders === '' ? Promise.resolve(ABSENT_MEDIATOR_ORDERS_DIGEST) : sha256(mediatorOrders),
  ]);
  return {
    bindingVersion: SHIP_CHECKPOINT_BINDING_VERSION,
    shipConfigSha256,
    contractSha256,
    graftSha256,
    systemPromptSha256,
    reviewInputSha256,
    mediatorOrdersSha256,
  };
}

/**
 * Validate one persisted binding before any checkpoint result can be reused.
 *
 * @param value Untrusted JSON field from durable storage.
 * @returns A typed binding only when every digest has the current shape.
 */
function parseShipCheckpointBinding(value: unknown): ShipCheckpointBinding | null {
  if (!value || typeof value !== 'object') return null;
  const binding = value as Record<string, unknown>;
  if (binding.bindingVersion !== SHIP_CHECKPOINT_BINDING_VERSION) return null;
  if (typeof binding.shipConfigSha256 !== 'string' || !SHA256_RE.test(binding.shipConfigSha256)) {
    return null;
  }
  if (
    typeof binding.contractSha256 !== 'string' ||
    (binding.contractSha256 !== ABSENT_CONTRACT_DIGEST && !SHA256_RE.test(binding.contractSha256))
  ) {
    return null;
  }
  if (typeof binding.graftSha256 !== 'string' || !SHA256_RE.test(binding.graftSha256)) return null;
  if (typeof binding.systemPromptSha256 !== 'string' || !SHA256_RE.test(binding.systemPromptSha256)) {
    return null;
  }
  if (typeof binding.reviewInputSha256 !== 'string' || !SHA256_RE.test(binding.reviewInputSha256)) {
    return null;
  }
  if (
    typeof binding.mediatorOrdersSha256 !== 'string' ||
    (binding.mediatorOrdersSha256 !== ABSENT_MEDIATOR_ORDERS_DIGEST &&
      !SHA256_RE.test(binding.mediatorOrdersSha256))
  ) {
    return null;
  }
  return {
    bindingVersion: SHIP_CHECKPOINT_BINDING_VERSION,
    shipConfigSha256: binding.shipConfigSha256,
    contractSha256: binding.contractSha256,
    graftSha256: binding.graftSha256,
    systemPromptSha256: binding.systemPromptSha256,
    reviewInputSha256: binding.reviewInputSha256,
    mediatorOrdersSha256: binding.mediatorOrdersSha256,
  };
}

/**
 * Compare two typed bindings without relying on object identity or JSON key
 * order, which would turn equivalent persisted evidence into a false miss.
 *
 * @param left Persisted checkpoint binding.
 * @param right Current trusted binding.
 * @returns Whether both bind the same review policy and prompt.
 */
function sameShipCheckpointBinding(left: ShipCheckpointBinding, right: ShipCheckpointBinding): boolean {
  return left.bindingVersion === right.bindingVersion &&
    left.shipConfigSha256 === right.shipConfigSha256 &&
    left.contractSha256 === right.contractSha256 &&
    left.graftSha256 === right.graftSha256 &&
    left.systemPromptSha256 === right.systemPromptSha256 &&
    left.reviewInputSha256 === right.reviewInputSha256 &&
    left.mediatorOrdersSha256 === right.mediatorOrdersSha256;
}

/**
 * A broken outcome is retained in the ordinary transcript, not promoted to
 * retry-progress. Reusing one would turn a prior failure observation into a
 * present-tense verdict without another model attempt.
 */
function isResumeEligibleCheckpoint(result: ShipResult): boolean {
  return !result.errored && result.noUsableOutput !== true;
}

/**
 * Validate the nested finding objects too. Checking only that `findings` is an
 * array would accept rows such as `[null]`; the final review builder later
 * dereferences every finding's path/line/body, turning a corrupt best-effort
 * checkpoint into a run-level exception instead of safely re-running the ship.
 */
function parseCheckpointFindings(value: unknown): Finding[] | null {
  if (!Array.isArray(value)) return null;
  const findings: Finding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const finding = item as Record<string, unknown>;
    if (typeof finding.path !== 'string') return null;
    if (!Number.isSafeInteger(finding.line) || (finding.line as number) < 1) return null;
    if (typeof finding.severity !== 'string' || !VALID_SEVERITIES.has(finding.severity)) {
      return null;
    }
    if (typeof finding.body !== 'string') return null;
    findings.push({
      path: finding.path,
      line: finding.line as number,
      severity: finding.severity as Finding['severity'],
      body: finding.body,
    });
  }
  return findings;
}

/**
 * Narrow validation of a checkpoint row's detail back into a {@link ShipResult}.
 * Anything malformed returns null (ship re-runs). The `ship` name must match
 * the row's own ship column — a band collision after a roster change between
 * attempts must lose the checkpoint, never mis-attribute it.
 */
export function parseShipCheckpoint(
  shipColumn: unknown,
  detailJson: unknown,
  expectedBinding?: ShipCheckpointBinding,
): ShipResult | null {
  if (typeof shipColumn !== 'string' || !shipColumn) return null;
  if (typeof detailJson !== 'string' || !detailJson) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(detailJson);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // A legacy row cannot prove it was written after the source-coverage and
  // context-admission and trusted policy/contract contracts landed. Re-running
  // is safe; trusting its formerly-green verdict is not.
  if (r.checkpointSchemaVersion !== SHIP_CHECKPOINT_SCHEMA_VERSION) return null;
  const binding = parseShipCheckpointBinding(r.checkpointBinding);
  if (!binding || (expectedBinding && !sameShipCheckpointBinding(binding, expectedBinding))) {
    return null;
  }
  if (r.ship !== shipColumn) return null;
  if (typeof r.blocking !== 'boolean') return null;
  if (typeof r.errored !== 'boolean') return null;
  if (typeof r.verdict !== 'string' || !VALID_VERDICTS.has(r.verdict)) return null;
  if (r.noUsableOutput !== undefined && typeof r.noUsableOutput !== 'boolean') return null;
  const reviewCoverage =
    r.reviewCoverage === undefined
      ? undefined
      : r.reviewCoverage === 'partial' || r.reviewCoverage === 'none'
        ? r.reviewCoverage
        : null;
  if (reviewCoverage === null) return null;
  if (r.reviewCoverageReason !== undefined) {
    if (reviewCoverage === undefined || typeof r.reviewCoverageReason !== 'string') return null;
    if (
      !r.reviewCoverageReason.trim() ||
      r.reviewCoverageReason.length > MAX_REVIEW_COVERAGE_REASON_CHARS
    ) {
      return null;
    }
  }
  const findings =
    r.findings === undefined ? undefined : parseCheckpointFindings(r.findings);
  if (findings === null) return null;
  return {
    ship: shipColumn,
    blocking: r.blocking,
    verdict: r.verdict as Verdict,
    errored: r.errored,
    ...(r.noUsableOutput !== undefined ? { noUsableOutput: r.noUsableOutput as boolean } : {}),
    ...(reviewCoverage !== undefined ? { reviewCoverage } : {}),
    ...(typeof r.reviewCoverageReason === 'string'
      ? { reviewCoverageReason: r.reviewCoverageReason }
      : {}),
    ...(findings !== undefined ? { findings } : {}),
  };
}

/**
 * Load every checkpoint that matches a caller-supplied current trusted binding.
 *
 * Resume is deliberately impossible without `expectedBindings`: durable rows
 * are evidence of a past invocation, not authority to carry that invocation's
 * result across a changed Fleet policy, contract, graft, or mediator context.
 * Empty map on any read failure — the run then behaves exactly as before
 * checkpoints existed.
 *
 * @param env Worker bindings.
 * @param runId Logical delivery run to inspect.
 * @param expectedBindings Current trusted binding for every resume-eligible ship.
 * @param onCheckpointInvalidated Optional durable-observability callback for a
 * structurally valid retained row that no longer has current trusted inputs or
 * that records a broken, non-resumable outcome.
 * @returns Only results whose durable binding matches the current snapshot.
 */
export async function loadShipCheckpoints(
  env: ExecutorEnv,
  runId: string,
  expectedBindings: ReadonlyMap<string, ShipCheckpointBinding>,
  onCheckpointInvalidated?: (
    ship: string,
    reason: CheckpointInvalidationReason,
  ) => Promise<void> | void,
): Promise<Map<string, ShipResult>> {
  const resumed = new Map<string, ShipResult>();
  if (!env.DB) return resumed;
  try {
    const rows = await env.DB.prepare(
      `SELECT ship, detail FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, SHIP_CHECKPOINT_KIND)
      .all<{ ship: unknown; detail: unknown }>();
    for (const row of rows?.results ?? []) {
      const ship = typeof row.ship === 'string' ? row.ship : null;
      const expected = ship ? expectedBindings.get(ship) : undefined;
      // A roster that no longer contains this ship cannot authorize resuming
      // it. The executor supplies bindings only after it has read every
      // current trusted contract and constructed the exact system prompt.
      if (!ship || !expected) continue;
      const retained = parseShipCheckpoint(ship, row.detail);
      if (!retained) continue;
      const result = parseShipCheckpoint(ship, row.detail, expected);
      if (!result) {
        // The row itself is current-schema durable evidence, but it reviewed
        // different trusted inputs.
        // Re-run the ship and make that decision legible; silently dropping it
        // would look like a lost checkpoint instead of a deliberate safety
        // invalidation.
        try {
          await onCheckpointInvalidated?.(ship, 'trusted-binding-mismatch');
        } catch (err) {
          console.error(
            `[fleet-executor] checkpoint invalidation transcript failed run=${runId} ship=${ship}: ${String(err)}`,
          );
        }
        continue;
      }
      if (!isResumeEligibleCheckpoint(result)) {
        try {
          await onCheckpointInvalidated?.(ship, 'non-resumable-result');
        } catch (err) {
          console.error(
            `[fleet-executor] checkpoint invalidation transcript failed run=${runId} ship=${ship}: ${String(err)}`,
          );
        }
        continue;
      }
      resumed.set(result.ship, result);
    }
  } catch (err) {
    console.error(`[fleet-executor] checkpoint load failed run=${runId}: ${String(err)}`);
  }
  return resumed;
}

/**
 * Persist one completed ship's result (best-effort). `shipIndex` is the ship's
 * position in this attempt's ordered roster — it only disambiguates the seq
 * slot; identity is the `ship` column, which {@link parseShipCheckpoint}
 * cross-checks on read.
 */
export async function saveShipCheckpoint(
  env: ExecutorEnv,
  runId: string,
  shipIndex: number,
  result: ShipResult,
  binding: ShipCheckpointBinding,
): Promise<boolean> {
  if (!env.DB) return false;
  if (!parseShipCheckpointBinding(binding)) return false;
  // An ERROR or all-empty/no-usable-output result is a diagnostic observation,
  // not completed review evidence. Its regular transcript/spend records stay
  // durable, but a retry must make fresh model progress instead of inheriting
  // the broken result into a new attempt.
  if (!isResumeEligibleCheckpoint(result)) return false;
  const safeIndex = Number.isInteger(shipIndex) && shipIndex >= 0 ? shipIndex : 0;
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        SHIP_CHECKPOINT_SEQ_BASE + safeIndex,
        SHIP_CHECKPOINT_KIND,
        result.ship,
        `pd-${result.ship}: checkpointed — ${result.verdict}; a retried delivery may resume after trusted-input revalidation`,
        // Version belongs to the writer, not callers. Keep it out of the
        // reconstructed ShipResult so result contracts stay version-agnostic.
        JSON.stringify({
          ...result,
          checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
          checkpointBinding: binding,
        }),
        Math.floor(Date.now() / 1000),
      )
      .run();
    return true;
  } catch (err) {
    console.error(
      `[fleet-executor] checkpoint write failed run=${runId} ship=${result.ship}: ${String(err)}`,
    );
    return false;
  }
}

/**
 * Count this run's structurally valid retained checkpoint rows for the DLQ
 * summary. This is deliberately NOT a resume lookup: DLQ has no current
 * trusted policy/contract snapshot, so the later delivery must revalidate
 * every retained row before it can reuse it. Zero on failure.
 *
 * @param env Worker bindings.
 * @param runId Logical delivery run to inspect.
 * @returns Number of current-schema, resume-eligible checkpoint records.
 */
export async function countShipCheckpoints(env: ExecutorEnv, runId: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    const rows = await env.DB.prepare(
      `SELECT ship, detail FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, SHIP_CHECKPOINT_KIND)
      .all<{ ship: unknown; detail: unknown }>();
    // Versionless/v2/malformed rows are not retained proof. Broken outcomes
    // are transcript evidence rather than resumable progress. Matching the
    // current trusted binding happens later in loadShipCheckpoints.
    return (rows?.results ?? []).filter(row => {
      const result = parseShipCheckpoint(row.ship, row.detail);
      return result !== null && isResumeEligibleCheckpoint(result);
    }).length;
  } catch (err) {
    console.error(`[fleet-executor] checkpoint count failed run=${runId}: ${String(err)}`);
    return 0;
  }
}
