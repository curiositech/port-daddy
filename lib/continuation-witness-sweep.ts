import { randomBytes } from 'node:crypto';

import {
  BACKEND_CATALOG,
  type BackendCatalogEntry,
  type HarnessAdapterCapabilities,
} from './backend-catalog.js';
import { assessBackendReadiness, type BackendReadiness } from './backend-readiness.js';
import {
  HANDOFF_CAPSULE_SCHEMA,
  HandoffSecretError,
  HandoffValidationError,
  sanitizeHandoffCapsule,
  type GitleaksRunner,
} from './handoff-capsule.js';
import type { ContinuationMode, ContinuationReceipt } from './continuation-runtime.js';

/**
 * `pd continuation witness-sweep` engine.
 *
 * The sweep is a daemon CLIENT, never a daemon. It drives the live HTTP
 * paths (POST /spawn, POST /memory/handoffs, POST /memory/handoffs/:id/continue,
 * GET /transcripts/:id, GET /harness-adapters/continuation-matrix) so that
 * REAL continuations happen. It holds no write path into agent_continuations
 * or fleet_transcripts: only the daemon's continuationStore.markCompleted
 * (after spawner.spawn actually ran) can produce the rows that
 * collectHarnessConformanceWitnesses turns into witnessed matrix cells.
 * A fabricated client-side "receipt" structurally cannot flip a cell —
 * the matrix section of the sweep report is always re-fetched from the
 * daemon after the sweep, never tallied locally.
 */

export const WITNESS_SWEEP_SCHEMA = 'pd.agent-harbor.witness-sweep.v0' as const;

export type SweepSkipReason =
  | 'missing-binary'
  | 'missing-credential'
  | 'adapter-unverified'
  | 'vendor-refuses'
  | 'backend-not-launchable';

export type SweepOutcome =
  | 'witnessed-carried'
  | 'witnessed-uncarried'
  | 'failed'
  | 'source-run-failed'
  | 'skipped'
  | 'budget-aborted'
  | 'not-attempted';

export interface SweepFamilySide {
  family: string;
  /** Representative backend id chosen for this family (prefer ready). */
  backendId: string;
  runnable: boolean;
  skipReason: SweepSkipReason | null;
  detail: string;
}

export interface SweepPair {
  sourceFamily: string;
  targetFamily: string;
  sourceBackendId: string;
  targetBackendId: string;
  mode: 'native' | 'handoff' | 'unsupported';
  runnable: boolean;
  skipReason: SweepSkipReason | null;
  skipDetail: string | null;
}

export interface SweepPairResult {
  pair: SweepPair;
  outcome: SweepOutcome;
  token: string | null;
  sourceAgentId: string | null;
  episodeId: number | null;
  receiptId: string | null;
  receiptStatus: string | null;
  successorRunId: string | null;
  witnessBasis: 'daemon-transcript' | null;
  error: string | null;
  detail: string;
}

export interface WitnessSweepReport {
  schema: typeof WITNESS_SWEEP_SCHEMA;
  sweepId: string;
  startedAt: string;
  finishedAt: string;
  workdir: string;
  maxPairs: number;
  budgetUsd: number;
  spentUsd: number | null;
  attempted: number;
  witnessedCarried: number;
  witnessedUncarried: number;
  failed: number;
  skipped: number;
  results: SweepPairResult[];
  receipts: ContinuationReceipt[];
  /**
   * Verbatim body of GET /harness-adapters/continuation-matrix taken AFTER
   * the sweep. This is the daemon's own read of witnessed cells — the sweep's
   * local tally can never substitute for it.
   */
  matrix: unknown | null;
}

/** Minimal HTTP shape shared with cli/utils/fetch.ts pdFetch. */
export interface SweepHttpResponse {
  ok: boolean;
  status: number | undefined;
  json: () => Promise<Record<string, unknown>>;
  text: () => Promise<string>;
}

export type SweepHttp = (
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string | number>;
    body?: string;
    timeout?: number;
  },
) => Promise<SweepHttpResponse>;

/**
 * Cheapest sensible model per representative backend id. `undefined` lets the
 * daemon pick its default. ~2 short prompts of ~200 tokens per pair keeps a
 * full sweep under fractions of a cent on metered backends.
 */
export const CHEAPEST_MODEL_BY_BACKEND: Record<string, string | undefined> = {
  'cli:claude-code': 'claude-haiku-4-5',
  'claude-cli': 'haiku',
  'cli:codex': 'gpt-5',
  codex: 'gpt-5.4-mini',
  'cli:gemini': 'gemini-2.5-flash',
  'cli:groq': 'llama-3.3-70b-versatile',
  claude: 'claude-haiku-4-5',
  // NOT flash-lite: Google 404s `gemini-2.5-flash-lite` for new API users
  // (witnessed in sweep 027b5be4), so the cheapest RELIABLE model wins.
  gemini: 'gemini-2.5-flash',
  cloudflare: '@cf/zai-org/glm-4.7-flash',
  openai: 'gpt-5-nano',
  groq: 'llama-3.1-8b-instant',
  deepseek: 'deepseek-chat',
  xai: 'grok-code-fast-1',
  lmstudio: 'local-model',
  aider: 'gpt-4.1-mini',
};

const SOURCE_LEG_TIMEOUT_MS = 60_000;
const CONTINUE_LEG_TIMEOUT_MS = 120_000;
/** HTTP timeouts are leg timeout + headroom so the daemon owns the deadline. */
const HTTP_HEADROOM_MS = 60_000;

/**
 * Every daemon launch demands a semantic identity (spend attribution) and a
 * positive budget ceiling. The sweep books all probe legs against one wallet
 * project so the operator can cap it once:
 *   pd wallet budget witness-sweep --usd-per-day <N>
 */
export const SWEEP_WALLET_PROJECT = 'witness-sweep';
export const PER_LEG_BUDGET_USD = 0.05;

export function sweepIdentity(sweepId: string): string {
  return `${SWEEP_WALLET_PROJECT}:probe:${sweepId}`;
}

interface FamilyRecord {
  adapter: HarnessAdapterCapabilities;
  backendIds: string[];
}

/** Same grouping rule as harness-conformance's private groupCatalog. */
export function groupCatalogByFamily(
  catalog: readonly BackendCatalogEntry[] = BACKEND_CATALOG,
): Map<string, FamilyRecord> {
  const grouped = new Map<string, FamilyRecord>();
  for (const backend of catalog) {
    const existing = grouped.get(backend.adapter.family);
    if (existing) existing.backendIds.push(backend.id);
    else grouped.set(backend.adapter.family, { adapter: backend.adapter, backendIds: [backend.id] });
  }
  return grouped;
}

/** Assess readiness for every backend id in the catalog (live probes). */
export async function collectSweepReadiness(
  catalog: readonly BackendCatalogEntry[] = BACKEND_CATALOG,
  assess: (backendId: string) => Promise<BackendReadiness> = (id) => assessBackendReadiness(id),
): Promise<Map<string, BackendReadiness>> {
  const readiness = new Map<string, BackendReadiness>();
  for (const entry of catalog) {
    try {
      readiness.set(entry.id, await assess(entry.id));
    } catch (error) {
      readiness.set(entry.id, {
        backend: entry.id,
        status: 'unknown',
        summary: `readiness probe failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return readiness;
}

function skipReasonForFamily(
  record: FamilyRecord,
  readiness: BackendReadiness | undefined,
): { reason: SweepSkipReason; detail: string } {
  const detail = readiness?.summary ?? 'no readiness assessment is available for this backend';
  if (readiness?.launchableUnverified) {
    return { reason: 'adapter-unverified', detail };
  }
  const transport = record.adapter.spawn.transport;
  if (transport === 'agent-cli' || transport === 'custom-command') {
    return { reason: 'missing-binary', detail };
  }
  const auth = record.adapter.authModes;
  if (auth.includes('api-key') || auth.includes('api-token')) {
    return { reason: 'missing-credential', detail };
  }
  return { reason: 'backend-not-launchable', detail };
}

/**
 * Choose one representative backend id per family and decide honest
 * executability on THIS machine. `launchableUnverified` backends (installed
 * CLI whose auth cannot be proven offline) are `adapter-unverified`: attempted
 * only when the operator opts a pair in via `include`.
 */
export function collectFamilyExecutability(
  catalog: readonly BackendCatalogEntry[],
  readiness: ReadonlyMap<string, BackendReadiness>,
): Map<string, SweepFamilySide> {
  const sides = new Map<string, SweepFamilySide>();
  for (const [family, record] of groupCatalogByFamily(catalog)) {
    const ready = record.backendIds.find((id) => readiness.get(id)?.status === 'ready');
    const launchable = record.backendIds.find((id) => readiness.get(id)?.launchableUnverified);
    const backendId = ready ?? launchable ?? record.backendIds[0];
    const backendReadiness = readiness.get(backendId);
    if (ready) {
      sides.set(family, {
        family,
        backendId,
        runnable: true,
        skipReason: null,
        detail: backendReadiness?.summary ?? 'ready',
      });
      continue;
    }
    const { reason, detail } = skipReasonForFamily(record, backendReadiness);
    sides.set(family, { family, backendId, runnable: false, skipReason: reason, detail });
  }
  return sides;
}

/** Exact daemon mode rule — mirror of routes/memory.ts resolveContinuationMode('auto'). */
export function resolveSweepMode(
  sourceFamily: string,
  target: HarnessAdapterCapabilities,
): 'native' | 'handoff' | 'unsupported' {
  if (sourceFamily === target.family && target.resume.native && target.resume.scope === 'session') {
    return 'native';
  }
  return target.acceptsInitialPrompt ? 'handoff' : 'unsupported';
}

export interface EnumerateSweepPairsOptions {
  catalog?: readonly BackendCatalogEntry[];
  readiness: ReadonlyMap<string, BackendReadiness>;
  /** Pairs ("sourceFamily:targetFamily") allowed to run despite adapter-unverified sides. */
  include?: readonly string[];
  /** Force handoff for native-capable pairs, or restrict the sweep to native pairs. */
  modeOverride?: 'auto' | 'handoff' | 'native';
}

/**
 * Enumerate the full N x N ordered family grid. Every cell is present so the
 * grid can render each pair with its honest reason; `runnable` marks the
 * subset this machine can actually witness right now.
 */
export function enumerateSweepPairs(options: EnumerateSweepPairsOptions): SweepPair[] {
  const catalog = options.catalog ?? BACKEND_CATALOG;
  const modeOverride = options.modeOverride ?? 'auto';
  const include = new Set(options.include ?? []);
  const grouped = groupCatalogByFamily(catalog);
  const sides = collectFamilyExecutability(catalog, options.readiness);

  const pairs: SweepPair[] = [];
  for (const [sourceFamily] of grouped) {
    for (const [targetFamily, target] of grouped) {
      const source = sides.get(sourceFamily)!;
      const targetSide = sides.get(targetFamily)!;
      const autoMode = resolveSweepMode(sourceFamily, target.adapter);
      let mode = autoMode;
      if (modeOverride === 'handoff' && autoMode === 'native') {
        mode = target.adapter.acceptsInitialPrompt ? 'handoff' : 'unsupported';
      }

      const pairKey = `${sourceFamily}:${targetFamily}`;
      const included = include.has(pairKey);
      let runnable = false;
      let skipReason: SweepSkipReason | null = null;
      let skipDetail: string | null = null;

      if (mode === 'unsupported') {
        skipReason = 'vendor-refuses';
        skipDetail = 'target adapter cannot accept native session identity or successor initialization context';
      } else if (modeOverride === 'native' && mode !== 'native') {
        skipReason = 'vendor-refuses';
        skipDetail = 'pair has no native path and the sweep was restricted to native mode';
      } else {
        const blockers = [source, targetSide].filter((side) => !side.runnable);
        const hardBlocker = blockers.find((side) => side.skipReason !== 'adapter-unverified');
        const softBlocker = blockers.find((side) => side.skipReason === 'adapter-unverified');
        if (hardBlocker) {
          skipReason = hardBlocker.skipReason;
          skipDetail = `${hardBlocker.family}: ${hardBlocker.detail}`;
        } else if (softBlocker && !included) {
          skipReason = 'adapter-unverified';
          skipDetail = `${softBlocker.family}: ${softBlocker.detail} (attempt with --include ${pairKey})`;
        } else {
          runnable = true;
        }
      }

      pairs.push({
        sourceFamily,
        targetFamily,
        sourceBackendId: source.backendId,
        targetBackendId: targetSide.backendId,
        mode,
        runnable,
        skipReason,
        skipDetail,
      });
    }
  }
  return pairs;
}

export function newSweepId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Deliberately LOW-entropy token (fixed prefix + 8 hex chars) so the
 * fail-closed secret scanners in sanitizeHandoffCapsule never quarantine it.
 */
export function newContinuityToken(): string {
  return `pd-witness-${randomBytes(4).toString('hex')}`;
}

export interface ProbeCapsuleInput {
  pair: SweepPair;
  sweepId: string;
  token: string;
  sessionId: string;
  agentId: string | null;
  workdir: string;
  now?: Date;
}

/** Build the HandoffCapsuleV0-shaped input posted to POST /memory/handoffs. */
export function buildProbeCapsule(input: ProbeCapsuleInput): Record<string, unknown> {
  const at = (input.now ?? new Date()).toISOString();
  return {
    schema: HANDOFF_CAPSULE_SCHEMA,
    capsuleId: `witness-sweep-${input.sweepId}-${input.pair.sourceFamily}-${input.pair.targetFamily}`,
    capturedAt: at,
    source: {
      adapter: input.pair.sourceBackendId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      workflowId: null,
      transcriptRef: null,
    },
    target: { adapter: input.pair.targetBackendId, agentId: null },
    identity: { project: 'port-daddy-witness-sweep', projectDir: input.workdir, harbor: null },
    workspace: {
      cwd: input.workdir,
      repoRoot: null,
      branch: null,
      worktreeId: null,
      gitHead: null,
      dirtyFiles: [],
    },
    telos: 'Carry the predecessor continuity token across a harness continuation and restate it verbatim.',
    operatorTurns: [
      {
        id: 'op-1',
        at,
        text: `The continuity token is ${input.token}. Any successor must restate it as: TOKEN ${input.token}`,
      },
    ],
    decisions: [
      { id: 'dec-1', at, text: `Continuity token: ${input.token}`, source: 'operator' },
    ],
    coordination: [],
    artifacts: [],
    tail: [],
  };
}

/**
 * Local pre-validation. The daemon recomputes the contentHash and rescans
 * fail-closed either way; this only catches shape/secret mistakes before a
 * network round trip. A locally-unavailable gitleaks binary is NOT an error
 * here — the daemon's scanner remains the authority.
 */
export function prevalidateProbeCapsule(
  capsule: Record<string, unknown>,
  gitleaksRunner?: GitleaksRunner,
): void {
  try {
    sanitizeHandoffCapsule(capsule, gitleaksRunner ? { gitleaksRunner } : {});
  } catch (error) {
    if (error instanceof HandoffValidationError || error instanceof HandoffSecretError) throw error;
    // Scanner unavailable locally — defer to the daemon's fail-closed scan.
  }
}

export interface RunWitnessSweepOptions {
  pairs: readonly SweepPair[];
  fetch: SweepHttp;
  workdir: string;
  sweepId?: string;
  maxPairs?: number;
  budgetUsd?: number;
  now?: () => Date;
}

interface TranscriptMessageRow {
  role?: string;
  content?: string;
}

async function daemonTranscriptStatesToken(
  fetch: SweepHttp,
  agentId: string,
  token: string,
): Promise<{ found: boolean; detail: string }> {
  try {
    const listRes = await fetch(`/transcripts?agentId=${encodeURIComponent(agentId)}&limit=5`, { timeout: 15_000 });
    if (!listRes.ok) return { found: false, detail: `transcript listing returned ${listRes.status}` };
    const listing = await listRes.json();
    const rows = Array.isArray(listing.transcripts) ? listing.transcripts as Array<Record<string, unknown>> : [];
    if (rows.length === 0) return { found: false, detail: `no durable transcript exists for agent ${agentId}` };
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : null;
      if (!id) continue;
      const txRes = await fetch(`/transcripts/${encodeURIComponent(id)}`, { timeout: 15_000 });
      if (!txRes.ok) continue;
      const body = await txRes.json();
      const transcript = body.transcript as Record<string, unknown> | undefined;
      const messages = Array.isArray(transcript?.messages)
        ? transcript!.messages as TranscriptMessageRow[]
        : [];
      const stated = messages.some(
        (message) => message.role !== 'user' && message.role !== 'system'
          && typeof message.content === 'string' && message.content.includes(token),
      );
      if (stated) return { found: true, detail: `daemon transcript ${id} states the token` };
    }
    return { found: false, detail: 'daemon-stored transcript output does not state the token' };
  } catch (error) {
    return { found: false, detail: `transcript verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function sweepSpendSince(fetch: SweepHttp, sinceMs: number): Promise<number | null> {
  try {
    const res = await fetch(`/transcripts/cost?since=${sinceMs}`, { timeout: 10_000 });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.total_cost_usd === 'number' ? body.total_cost_usd : null;
  } catch {
    return null;
  }
}

function skippedResult(pair: SweepPair, outcome: SweepOutcome, detail: string): SweepPairResult {
  return {
    pair,
    outcome,
    token: null,
    sourceAgentId: null,
    episodeId: null,
    receiptId: null,
    receiptStatus: null,
    successorRunId: null,
    witnessBasis: null,
    error: null,
    detail,
  };
}

async function probePair(
  pair: SweepPair,
  ctx: { fetch: SweepHttp; workdir: string; sweepId: string; now: () => Date },
): Promise<{ result: SweepPairResult; receipt: ContinuationReceipt | null }> {
  const token = newContinuityToken();
  const base: SweepPairResult = {
    pair,
    outcome: 'failed',
    token,
    sourceAgentId: null,
    episodeId: null,
    receiptId: null,
    receiptStatus: null,
    successorRunId: null,
    witnessBasis: null,
    error: null,
    detail: '',
  };

  // ── Leg 1: fact establishment on the source harness ──
  let spawnBody: Record<string, unknown>;
  try {
    const model = CHEAPEST_MODEL_BY_BACKEND[pair.sourceBackendId];
    const res = await ctx.fetch('/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: SOURCE_LEG_TIMEOUT_MS + HTTP_HEADROOM_MS,
      body: JSON.stringify({
        backend: pair.sourceBackendId,
        ...(model ? { model } : {}),
        task: `You are a continuity probe. The continuity token is ${token}. Reply with exactly one line: TOKEN ${token}`,
        purpose: `continuation witness sweep ${ctx.sweepId} source leg (${pair.sourceFamily}->${pair.targetFamily})`,
        identity: sweepIdentity(ctx.sweepId),
        budgetUsd: PER_LEG_BUDGET_USD,
        workdir: ctx.workdir,
        timeout: SOURCE_LEG_TIMEOUT_MS,
      }),
    });
    spawnBody = await res.json();
    if (!res.ok || spawnBody.success !== true || spawnBody.status !== 'completed') {
      const error = typeof spawnBody.error === 'string' ? spawnBody.error : `spawn returned status ${String(spawnBody.status ?? res.status)}`;
      return { result: { ...base, outcome: 'source-run-failed', error, detail: 'source harness run did not complete; no capsule was posted' }, receipt: null };
    }
  } catch (error) {
    return {
      result: {
        ...base,
        outcome: 'source-run-failed',
        error: error instanceof Error ? error.message : String(error),
        detail: 'source spawn request failed; no capsule was posted',
      },
      receipt: null,
    };
  }
  const sourceAgentId = typeof spawnBody.agentId === 'string' ? spawnBody.agentId : null;
  if (!sourceAgentId) {
    return { result: { ...base, outcome: 'source-run-failed', error: 'spawn result carried no agentId', detail: 'source harness run is unverifiable; no capsule was posted' }, receipt: null };
  }
  base.sourceAgentId = sourceAgentId;
  const sourceWitness = await daemonTranscriptStatesToken(ctx.fetch, sourceAgentId, token);
  if (!sourceWitness.found) {
    return { result: { ...base, outcome: 'source-run-failed', error: sourceWitness.detail, detail: 'daemon transcript does not witness the source fact; no capsule was posted' }, receipt: null };
  }

  // ── Leg 2: capsule through the live sanitizer ──
  const harnessSessionId = typeof spawnBody.harnessSessionId === 'string' ? spawnBody.harnessSessionId : null;
  const capsule = buildProbeCapsule({
    pair,
    sweepId: ctx.sweepId,
    token,
    sessionId: harnessSessionId ?? sourceAgentId,
    agentId: sourceAgentId,
    workdir: ctx.workdir,
    now: ctx.now(),
  });
  prevalidateProbeCapsule(capsule);
  let episodeId: number;
  try {
    const res = await ctx.fetch('/memory/handoffs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
      body: JSON.stringify({ capsule }),
    });
    const body = await res.json();
    const episode = body.episode as Record<string, unknown> | undefined;
    if (!res.ok || body.success !== true || typeof episode?.id !== 'number') {
      const error = typeof body.error === 'string' ? body.error : `handoff capture returned ${res.status}`;
      return { result: { ...base, outcome: 'failed', error, detail: 'daemon rejected the sanitized handoff capsule' }, receipt: null };
    }
    episodeId = episode.id;
  } catch (error) {
    return { result: { ...base, outcome: 'failed', error: error instanceof Error ? error.message : String(error), detail: 'handoff capture request failed' }, receipt: null };
  }
  base.episodeId = episodeId;

  // ── Leg 3: continue on the target harness ──
  let receipt: ContinuationReceipt | null = null;
  try {
    const model = CHEAPEST_MODEL_BY_BACKEND[pair.targetBackendId];
    const res = await ctx.fetch(`/memory/handoffs/${episodeId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: CONTINUE_LEG_TIMEOUT_MS + HTTP_HEADROOM_MS,
      body: JSON.stringify({
        targetBackend: pair.targetBackendId,
        mode: pair.mode,
        ...(model ? { model } : {}),
        prompt: 'Reply with exactly one line stating your predecessor\'s continuity token: TOKEN <value>',
        // Books the successor leg against the sweep wallet project too.
        durableAgentId: sweepIdentity(ctx.sweepId),
        targetWorkdir: ctx.workdir,
        timeoutMs: CONTINUE_LEG_TIMEOUT_MS,
        idempotencyKey: `witness-sweep:${ctx.sweepId}:${pair.sourceFamily}:${pair.targetFamily}:${pair.mode}`,
      }),
    });
    const body = await res.json();
    receipt = (body.receipt as ContinuationReceipt | undefined) ?? null;
    base.receiptId = receipt?.id ?? null;
    base.receiptStatus = receipt?.status ?? null;
    base.successorRunId = receipt?.successorRunId ?? null;
    if (!res.ok || body.success !== true || receipt?.status !== 'completed') {
      const error = typeof body.error === 'string' ? body.error : `continuation returned ${res.status}`;
      return { result: { ...base, outcome: 'failed', error, detail: `continuation receipt is ${receipt?.status ?? 'absent'}` }, receipt };
    }
  } catch (error) {
    return { result: { ...base, outcome: 'failed', error: error instanceof Error ? error.message : String(error), detail: 'continuation request failed' }, receipt };
  }

  // ── Leg 4: fact-carriage verification against the daemon-stored successor transcript ──
  if (!base.successorRunId) {
    return { result: { ...base, outcome: 'witnessed-uncarried', detail: 'receipt completed but carries no successorRunId to verify carriage against' }, receipt };
  }
  const carriage = await daemonTranscriptStatesToken(ctx.fetch, base.successorRunId, token);
  if (carriage.found) {
    return { result: { ...base, outcome: 'witnessed-carried', witnessBasis: 'daemon-transcript', detail: carriage.detail }, receipt };
  }
  return {
    result: {
      ...base,
      outcome: 'witnessed-uncarried',
      witnessBasis: 'daemon-transcript',
      detail: `receipt completed but the successor did not restate the token (soul-continuity failure): ${carriage.detail}`,
    },
    receipt,
  };
}

/**
 * Run the sweep sequentially over the runnable pairs, under `maxPairs` and a
 * `budgetUsd` enforced between pairs via GET /transcripts/cost deltas. The
 * matrix field stays null here — the caller fetches it from the daemon so the
 * report's witnessed cells are the daemon's own read.
 */
export async function runWitnessSweep(options: RunWitnessSweepOptions): Promise<WitnessSweepReport> {
  const now = options.now ?? (() => new Date());
  const sweepId = options.sweepId ?? newSweepId();
  const maxPairs = options.maxPairs ?? 8;
  const budgetUsd = options.budgetUsd ?? 0.25;
  const startedAt = now();
  const startedMs = startedAt.getTime();

  const results: SweepPairResult[] = [];
  const receipts: ContinuationReceipt[] = [];
  let attempted = 0;
  let budgetBreached = false;

  for (const pair of options.pairs) {
    if (!pair.runnable) {
      results.push(skippedResult(pair, 'skipped', pair.skipDetail ?? pair.skipReason ?? 'not runnable on this machine'));
      continue;
    }
    if (budgetBreached) {
      results.push(skippedResult(pair, 'budget-aborted', `sweep budget of $${budgetUsd} was reached before this pair`));
      continue;
    }
    if (attempted >= maxPairs) {
      results.push(skippedResult(pair, 'not-attempted', `--max-pairs ${maxPairs} was reached before this pair`));
      continue;
    }
    if (attempted > 0) {
      const spent = await sweepSpendSince(options.fetch, startedMs);
      if (spent !== null && spent >= budgetUsd) {
        budgetBreached = true;
        results.push(skippedResult(pair, 'budget-aborted', `sweep spend $${spent.toFixed(4)} reached the $${budgetUsd} budget`));
        continue;
      }
    }
    attempted += 1;
    const { result, receipt } = await probePair(pair, {
      fetch: options.fetch,
      workdir: options.workdir,
      sweepId,
      now,
    });
    results.push(result);
    if (receipt) receipts.push(receipt);
  }

  const spentUsd = await sweepSpendSince(options.fetch, startedMs);
  return {
    schema: WITNESS_SWEEP_SCHEMA,
    sweepId,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    workdir: options.workdir,
    maxPairs,
    budgetUsd,
    spentUsd,
    attempted,
    witnessedCarried: results.filter((r) => r.outcome === 'witnessed-carried').length,
    witnessedUncarried: results.filter((r) => r.outcome === 'witnessed-uncarried').length,
    failed: results.filter((r) => r.outcome === 'failed' || r.outcome === 'source-run-failed').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    results,
    receipts,
    matrix: null,
  };
}

/**
 * Fetch the daemon's continuation matrix verbatim. This — not the sweep's own
 * tally — is the only source of "witnessed" in the sweep report, so a
 * fabricated client-side receipt can never change the matrix JSON.
 */
export async function fetchDaemonContinuationMatrix(fetch: SweepHttp): Promise<unknown | null> {
  try {
    const res = await fetch('/harness-adapters/continuation-matrix', { timeout: 15_000 });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data ?? null;
  } catch {
    return null;
  }
}
