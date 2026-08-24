/**
 * pd dispatch -- operator queue for autonomous feature dev.
 *
 * Renamed from `pd nightshift` (PR #143). `pd nightshift` remains as an
 * alias for one minor version (cli/commands/nightshift.ts re-exports
 * handleDispatch as handleNightshift and rewrites the help banner).
 *
 * Subcommands:
 *   propose <goal text>  Drop a goal into the queue (state=proposed)
 *   queue                List proposed dispatches (alias of `list --state proposed`)
 *   list                 List dispatches (default: all)
 *   show <id>            Show one dispatch in detail
 *   run <id>             Run a specific dispatch (default --dry-run)
 *   run --next           Run the oldest proposed dispatch (default --dry-run)
 *   cancel <id>          Cancel a non-terminal dispatch (-> salvage)
 *
 * Review lives at `pd review` (cli/commands/review.ts) so the operator-facing
 * verb is short. `pd dispatch review` is an alias for back-compat with PR
 * #143's `pd nightshift review`.
 */

import { initDatabase } from '../../lib/db.js';
import {
  createDispatchQueue,
  type Dispatch,
  type DispatchQueue,
  type DispatchState,
  type MergePolicy,
} from '../../lib/dispatch/queue.js';
import {
  planRunFor,
  runNext,
  type DispatchBackend,
} from '../../lib/dispatch/runner.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { describeState, stateGlyph } from '../../lib/dispatch/state-machine.js';
import { runAutoMergeSweep } from '../../lib/dispatch/auto-merge.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { pdFetch, isDaemonRunning } from '../utils/fetch.js';
import { handleReview } from './review.js';
import { preflightInterruptionsGate } from './interruptions.js';

function usage(): never {
  console.error('Usage: pd dispatch <subcommand> [args]');
  console.error('');
  console.error('Subcommands:');
  console.error('  propose <goal text>     Drop a goal into the queue (state=proposed)');
  console.error('  queue                   List proposed dispatches');
  console.error('  list                    List dispatches (default: all)');
  console.error('  show <id>               Show one dispatch in detail (local row)');
  console.error('  status <id>             Live daemon-driven progress + worker health');
  console.error('  run <id>                Run a specific dispatch (default --dry-run)');
  console.error('  run --next              Run the next proposed dispatch (default --dry-run)');
  console.error('  review <id>             Alias for `pd review` (see `pd review --help`)');
  console.error('  cancel <id> [--reason]  Cancel a non-terminal dispatch');
  console.error('  merge-sweep             Check auto merge_policy dispatches; merge PRs that are');
  console.error('                          CI-green + mergeable + 0 unresolved threads (see below)');
  console.error('  help                    Show this help');
  console.error('');
  console.error('Options:');
  console.error('  --tags a,b,c              Comma-separated tags for propose');
  console.error('  --backend <name>          cli:claude-code | cli:codex (default: cli:codex)');
  console.error('  --base-branch <name>      Branch the worktree is carved from (default: main)');
  console.error('  --merge-policy <p>        review | auto | never (default: review)');
  console.error('                              review = operator runs `pd review --accept` + merges by hand');
  console.error('                              auto   = Port Daddy merges the PR itself once ALL hold:');
  console.error('                                       CI required checks green, PR mergeable (no');
  console.error('                                       conflicts), 0 unresolved review threads, not a');
  console.error('                                       draft. Never force-pushes, never --admin. The');
  console.error('                                       daemon sweeps this on an interval; `pd dispatch');
  console.error('                                       merge-sweep` or `pd done` also trigger it.');
  console.error('                              never  = Port Daddy never merges; PR sits for manual close');
  console.error('  --budget <usd>            Per-dispatch budget ceiling (default 5, max 25)');
  console.error('  --timeout <seconds>       Per-dispatch timeout (default 10800 = 3h, max 21600 = 6h)');
  console.error('  --to <actor>              Target actor (auto-routing not yet wired)');
  console.error('  --reviewer <actor>        Reviewer actor (default: operator)');
  console.error('  --state <state>           Filter list by state | open | terminal | awaiting_review | all');
  console.error('  --limit <n>               Limit list results');
  console.error('  --auto-claim              propose: skip proposed step, go straight to claimed');
  console.error('  --really-run              run: actually spawn (default is dry-run -- prints plan only)');
  console.error('  --reason <text>           cancel: record a reason');
  console.error('  -j, --json                JSON output');
  console.error('  -q, --quiet               Quiet output');
  process.exit(1);
}

function parseBackend(value: unknown): DispatchBackend | undefined {
  if (value === 'cli:claude-code' || value === 'cli:codex') return value;
  return undefined;
}

function parseMergePolicy(value: unknown): MergePolicy | undefined {
  if (value === 'review' || value === 'auto' || value === 'never') return value;
  return undefined;
}

function parseTags(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const tags = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatDispatchLine(d: Dispatch): string {
  const idShort = d.id.slice(0, 8);
  const glyph = stateGlyph(d.state);
  const state = `${glyph} ${d.state}`.padEnd(20);
  const slug = d.slug.slice(0, 32).padEnd(32);
  const cost = d.costUsd != null ? `$${d.costUsd.toFixed(2)}` : '   --';
  const artifact = d.resultArtifact ? ` ${d.resultArtifact}` : '';
  return `${idShort}  ${state}  ${slug}  ${cost}${artifact}`;
}

export function dispatchState(state: DispatchState): ui.LineworkState {
  switch (state) {
    case 'proposed': return 'pending';
    case 'claimed': return 'active';
    case 'in_progress': return 'active';
    case 'produced': return 'pending';
    case 'review_pending': return 'pending';
    case 'accepted': return 'confirmed';
    case 'rejected': return 'refused';
    case 'settled': return 'confirmed';
    case 'failed': return 'failed';
    case 'salvage': return 'recovering';
  }
}

function dispatchTone(state: DispatchState): ui.LineworkTone {
  return ui.lineworkVisual(dispatchState(state)).tone;
}

function shouldRenderLinework(options?: CLIOptions): boolean {
  return typeof ui.lineworkEnabled === 'function' &&
    typeof ui.renderLineworkPanel === 'function' &&
    ui.lineworkEnabled({
      json: options ? isJson(options) : false,
      quiet: options ? isQuiet(options) : false,
    });
}

function renderDispatchListLinework(dispatches: Dispatch[], title: string): string {
  return ui.renderLineworkPanel({
    title,
    subtitle: `${dispatches.length} dispatch(es)`,
    tone: dispatches.some((d) => dispatchTone(d.state) === 'failed')
      ? 'failed'
      : dispatches.some((d) => dispatchTone(d.state) === 'blocked')
        ? 'blocked'
        : 'running',
    zone: 'dispatch queue',
    rows: dispatches.map((d): ui.LineworkRow => ({
      state: dispatchState(d.state),
      label: d.id.slice(0, 8),
      text: `${d.state} · ${d.slug} · ${d.costUsd != null ? `$${d.costUsd.toFixed(2)}` : 'no cost yet'}${d.resultArtifact ? ` · ${d.resultArtifact}` : ''}`,
    })),
    footer: 'use pd dispatch show <id> for local row details',
  });
}

function printDispatchDetail(d: Dispatch): void {
  console.log(`Dispatch ${d.id}`);
  console.log(`  slug:           ${d.slug}`);
  console.log(`  state:          ${stateGlyph(d.state)} ${d.state} (${describeState(d.state)})`);
  console.log(`  goal:           ${d.goal}`);
  if (d.tags.length > 0) console.log(`  tags:           ${d.tags.join(', ')}`);
  console.log(`  requested_by:   ${d.requestedBy}`);
  if (d.targetActorId) console.log(`  target_actor:   ${d.targetActorId}`);
  if (d.workerActorId) console.log(`  worker_actor:   ${d.workerActorId}`);
  console.log(`  reviewer_actor: ${d.reviewerActorId ?? '(unset)'}`);
  console.log(`  base_branch:    ${d.baseBranch}`);
  console.log(`  merge_policy:   ${d.mergePolicy}`);
  console.log(`  backend:        ${d.backend ?? '(default at runtime)'}`);
  if (d.budgetUsd != null) console.log(`  budget:         $${d.budgetUsd.toFixed(2)}`);
  if (d.timeoutMs != null) console.log(`  timeout:        ${Math.round(d.timeoutMs / 1000)}s`);
  if (d.worktreePath) console.log(`  worktree:       ${d.worktreePath}`);
  if (d.branch) console.log(`  branch:         ${d.branch}`);
  if (d.sessionId) console.log(`  session:        ${d.sessionId}`);
  if (d.resultArtifact) console.log(`  artifact:       ${d.resultArtifact}`);
  if (d.costUsd != null) console.log(`  cost:           $${d.costUsd.toFixed(2)}`);
  if (d.durationMs != null) console.log(`  duration:       ${Math.round(d.durationMs / 1000)}s`);
  if (d.rejectReason) console.log(`  reject_reason:  ${d.rejectReason}`);
  if (d.errorMessage) console.log(`  error:          ${d.errorMessage}`);
  console.log(`  createdAt:      ${new Date(d.createdAt).toISOString()}`);
  if (d.claimedAt) console.log(`  claimedAt:      ${new Date(d.claimedAt).toISOString()}`);
  if (d.startedAt) console.log(`  startedAt:      ${new Date(d.startedAt).toISOString()}`);
  if (d.producedAt) console.log(`  producedAt:     ${new Date(d.producedAt).toISOString()}`);
  if (d.reviewedAt) console.log(`  reviewedAt:     ${new Date(d.reviewedAt).toISOString()}`);
  if (d.settledAt) console.log(`  settledAt:      ${new Date(d.settledAt).toISOString()}`);
}

function renderDispatchDetailLinework(d: Dispatch, worker?: Record<string, unknown> | null): string {
  const rows: ui.LineworkRow[] = [
    { state: dispatchState(d.state), label: 'state', text: `${d.state} · ${describeState(d.state)}` },
    { state: 'pending', label: 'goal', text: d.goal },
    { state: 'active', label: 'base', text: `${d.baseBranch} · ${d.mergePolicy}` },
    { state: d.backend ? 'confirmed' : 'unknown', label: 'backend', text: d.backend ?? 'default at runtime' },
  ];
  rows.push({ state: 'info', label: 'requested', text: d.requestedBy });
  if (d.targetActorId) rows.push({ state: 'info', label: 'target', text: d.targetActorId });
  if (d.workerActorId) rows.push({ state: 'active', label: 'worker', text: d.workerActorId });
  rows.push({ state: d.reviewerActorId ? 'info' : 'unknown', label: 'reviewer', text: d.reviewerActorId ?? '(unset)' });
  if (d.tags.length > 0) rows.push({ state: 'info', label: 'tags', text: d.tags.join(', ') });
  if (d.budgetUsd != null) rows.push({ state: 'pending', label: 'budget', text: `$${d.budgetUsd.toFixed(2)}` });
  if (d.timeoutMs != null) rows.push({ state: 'pending', label: 'timeout', text: `${Math.round(d.timeoutMs / 1000)}s` });
  if (d.worktreePath) rows.push({ state: 'active', label: 'worktree', text: d.worktreePath });
  if (d.branch) rows.push({ state: 'active', label: 'branch', text: d.branch });
  if (d.sessionId) rows.push({ state: 'active', label: 'session', text: d.sessionId });
  if (d.resultArtifact) rows.push({ state: 'confirmed', label: 'artifact', text: d.resultArtifact });
  if (d.costUsd != null) rows.push({ state: 'pending', label: 'cost', text: `$${d.costUsd.toFixed(2)}` });
  if (d.durationMs != null) rows.push({ state: 'info', label: 'duration', text: `${Math.round(d.durationMs / 1000)}s` });
  if (d.rejectReason) rows.push({ state: 'refused', label: 'reject', text: d.rejectReason });
  if (d.errorMessage) rows.push({ state: 'failed', label: 'error', text: `${d.errorMessage} · next: inspect worker transcript or cancel to salvage` });
  if (worker) {
    rows.push({
      state: worker.running ? 'active' : 'unknown',
      label: 'worker',
      text: `running=${worker.running} · inFlight=${worker.inFlight}/${worker.maxConcurrency}`,
    });
  }
  rows.push({ state: 'info', label: 'created', text: new Date(d.createdAt).toISOString() });
  if (d.claimedAt) rows.push({ state: 'info', label: 'claimed', text: new Date(d.claimedAt).toISOString() });
  if (d.startedAt) rows.push({ state: 'info', label: 'started', text: new Date(d.startedAt).toISOString() });
  if (d.producedAt) rows.push({ state: 'info', label: 'produced', text: new Date(d.producedAt).toISOString() });
  if (d.reviewedAt) rows.push({ state: 'info', label: 'reviewed', text: new Date(d.reviewedAt).toISOString() });
  if (d.settledAt) rows.push({ state: 'info', label: 'settled', text: new Date(d.settledAt).toISOString() });
  return ui.renderLineworkPanel({
    title: 'Dispatch',
    subtitle: d.id,
    tone: dispatchTone(d.state),
    zone: `${d.state} · ${d.slug}`,
    rows,
    footer: `created ${new Date(d.createdAt).toISOString()}`,
  });
}

async function readResponseJson(res: Awaited<ReturnType<typeof pdFetch>>): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function runDispatchViaDaemon(id: string, queue: DispatchQueue): Promise<Record<string, unknown>> {
  if (!(await isDaemonRunning())) {
    throw new Error(
      'daemon unavailable; refusing local dispatch --really-run fallback. ' +
      'Start the daemon from FleetBar or retry when Port Daddy is healthy.',
    );
  }
  const original = queue.get(id);
  if (!original) throw new Error(`dispatch ${id} not found`);
  const prepared = queue.prepareForRun(id);
  if (prepared.state === 'claimed' || prepared.state === 'in_progress') {
    return {
      ok: true,
      queued: true,
      launchedThisTick: 0,
      dispatch: prepared,
      message: 'Dispatch already holds a worker lease; the daemon-side run remains queued.',
    };
  }
  let res: Awaited<ReturnType<typeof pdFetch>>;
  try {
    res = await pdFetch(`/dispatches/${encodeURIComponent(id)}/run`, { method: 'POST' });
  } catch (error) {
    queue.restorePreparedRun(original, prepared);
    throw error;
  }
  const payload = await readResponseJson(res);
  if (!res.ok) {
    const racedDispatch = payload.dispatch && typeof payload.dispatch === 'object'
      ? payload.dispatch as Record<string, unknown>
      : null;
    const racedHasLease = racedDispatch?.state === 'in_progress'
      || (
        racedDispatch?.state === 'claimed'
        && [
          racedDispatch.workerActorId,
          racedDispatch.worktreePath,
          racedDispatch.branch,
          racedDispatch.sessionId,
          racedDispatch.startedAt,
        ].some((value) => value !== null && value !== undefined)
      );
    if (res.status === 409 && racedHasLease) {
      return {
        ...payload,
        ok: true,
        queued: true,
        launchedThisTick: 0,
        message: 'Dispatch acquired a worker lease while the run request was being sent.',
      };
    }
    queue.restorePreparedRun(original, prepared);
    const error = typeof payload.error === 'string'
      ? payload.error
      : `daemon returned HTTP ${res.status ?? 'unknown'}`;
    throw new Error(error);
  }
  return payload;
}

function printDaemonRunResult(payload: Record<string, unknown>, options: CLIOptions): void {
  const launched = typeof payload.launchedThisTick === 'number'
    ? payload.launchedThisTick
    : 0;
  if (shouldRenderLinework(options)) {
    console.log(ui.renderLineworkPanel({
      title: 'Dispatch Run',
      subtitle: 'daemon-side execution',
      tone: launched > 0 ? 'running' : 'pending',
      zone: launched > 0 ? 'worker launched' : 'queued',
      rows: [
        { state: launched > 0 ? 'spawning' : 'pending', label: 'launched', text: String(launched) },
        ...(typeof payload.message === 'string'
          ? [{ state: 'info' as ui.LineworkState, label: 'message', text: payload.message }]
          : []),
      ],
      footer: 'daemon owns worker health from here',
    }));
    return;
  }
  ui.success('Dispatch queued for daemon-side execution.');
  console.log(`  launched_this_tick: ${launched}`);
  if (typeof payload.message === 'string') {
    console.log(`  message: ${payload.message}`);
  }
}

export async function handleDispatch(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help') usage();

  const db = initDatabase();
  const queue = createDispatchQueue({ db });
  const workIntentService = createWorkIntentService({ db });

  // -- propose ----------------------------------------------------------
  if (subcommand === 'propose') {
    const goalText = args.slice(1).join(' ').trim();
    if (!goalText) {
      ui.error('pd dispatch propose requires a goal text');
      usage();
    }
    const requestedMerge = parseMergePolicy(
      options['merge-policy'] ?? options.mergePolicy,
    );
    let dispatch: Dispatch;
    try {
      const result = workIntentService.captureDispatch({
        goal: goalText,
        tags: parseTags(options.tags),
        backend: parseBackend(options.backend),
        budgetUsd: parseNumber(options.budget),
        timeoutMs: parseNumber(options.timeout) != null
          ? Math.round((parseNumber(options.timeout) ?? 0) * 1000)
          : undefined,
        baseBranch: typeof options['base-branch'] === 'string'
          ? options['base-branch']
          : typeof options.baseBranch === 'string'
            ? options.baseBranch
            : undefined,
        autoClaim: !!options['auto-claim'] || !!options.autoClaim,
        targetActorId: typeof options.to === 'string' ? options.to : undefined,
        reviewerActorId: typeof options.reviewer === 'string' ? options.reviewer : undefined,
        mergePolicy: requestedMerge,
      }, queue);
      dispatch = result.dispatch;
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch }, null, 2));
      return;
    }
    if (!isQuiet(options)) {
      ui.success(`Proposed dispatch ${dispatch.id.slice(0, 8)}`);
      console.log(`  slug:         ${dispatch.slug}`);
      console.log(`  state:        ${dispatch.state}`);
      console.log(`  base_branch:  ${dispatch.baseBranch}`);
      console.log(`  merge_policy: ${dispatch.mergePolicy}`);
      console.log(`  run with:     pd dispatch run ${dispatch.id}`);
    } else {
      console.log(dispatch.id);
    }
    return;
  }

  // -- queue (list proposed) -------------------------------------------
  if (subcommand === 'queue') {
    const dispatches = queue.list({ state: 'proposed' });
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatches }, null, 2));
      return;
    }
    if (dispatches.length === 0) {
      console.log('No proposed dispatches.');
      return;
    }
    if (shouldRenderLinework(options)) {
      console.log(renderDispatchListLinework(dispatches, 'Dispatch Queue'));
      return;
    }
    for (const d of dispatches) {
      console.log(formatDispatchLine(d));
    }
    return;
  }

  // -- list -------------------------------------------------------------
  if (subcommand === 'list') {
    const state = typeof options.state === 'string'
      ? (options.state as DispatchState | 'all' | 'open' | 'terminal' | 'awaiting_review')
      : 'all';
    const limit = parseNumber(options.limit);
    const dispatches = queue.list({ state, limit });
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatches }, null, 2));
      return;
    }
    if (dispatches.length === 0) {
      console.log('No dispatches.');
      return;
    }
    if (shouldRenderLinework(options)) {
      console.log(renderDispatchListLinework(dispatches, 'Dispatches'));
      return;
    }
    for (const d of dispatches) {
      console.log(formatDispatchLine(d));
    }
    return;
  }

  // -- show -------------------------------------------------------------
  if (subcommand === 'show') {
    const id = args[1];
    if (!id) {
      ui.error('pd dispatch show requires a dispatch id');
      usage();
    }
    const d = queue.get(id);
    if (!d) {
      ui.error(`Dispatch ${id} not found`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: d }, null, 2));
      return;
    }
    if (shouldRenderLinework(options)) {
      console.log(renderDispatchDetailLinework(d));
      return;
    }
    printDispatchDetail(d);
    return;
  }

  // -- status (live daemon-driven progress + worker health) -------------
  // `show` reads the LOCAL queue row; `status` additionally consults the daemon
  // for the live row AND the autonomous worker's health (running? draining?),
  // since the worker lives in the daemon process, not this CLI.
  if (subcommand === 'status') {
    const id = args[1];
    if (!id) {
      ui.error('pd dispatch status requires a dispatch id');
      usage();
    }
    // Prefer the daemon (it holds the live row + worker status); fall back to the
    // local DB row if the daemon is unreachable.
    let d = queue.get(id);
    let worker: Record<string, unknown> | null = null;
    if (await isDaemonRunning()) {
      try {
        const res = await pdFetch(`/dispatches/${encodeURIComponent(id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json && (json as { dispatch?: Dispatch }).dispatch) {
            d = (json as { dispatch: Dispatch }).dispatch;
          }
        }
        const wres = await pdFetch('/dispatches/worker/status');
        if (wres.ok) {
          const wjson = await wres.json();
          worker = (wjson as { worker?: Record<string, unknown> }).worker ?? null;
        }
      } catch { /* daemon unreachable mid-call — fall back to the local row */ }
    }
    if (!d) {
      ui.error(`Dispatch ${id} not found`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: d, worker }, null, 2));
      return;
    }
    if (shouldRenderLinework(options)) {
      console.log(renderDispatchDetailLinework(d, worker));
      return;
    }
    printDispatchDetail(d);
    if (worker) {
      console.log('');
      console.log(
        `  daemon worker:  running=${worker.running} ` +
        `inFlight=${worker.inFlight}/${worker.maxConcurrency}`,
      );
    }
    return;
  }

  // -- cancel -----------------------------------------------------------
  if (subcommand === 'cancel') {
    const id = args[1];
    if (!id) {
      ui.error('pd dispatch cancel requires a dispatch id');
      usage();
    }
    const reason = typeof options.reason === 'string' ? options.reason : undefined;
    let d: Dispatch;
    try {
      const existing = queue.get(id);
      if (existing) workIntentService.ensureDispatchIntent(existing);
      d = queue.cancel(id, reason);
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: d }, null, 2));
      return;
    }
    ui.success(`Cancelled dispatch ${d.id.slice(0, 8)}`);
    return;
  }

  // -- review (back-compat alias for `pd review`) -----------------------
  if (subcommand === 'review') {
    await handleReview(args.slice(1), options);
    return;
  }

  // -- merge-sweep --------------------------------------------------------
  // Manual/foreground trigger for the same auto-merge check the daemon runs
  // on an interval (server.ts) and `pd done` runs as a confirmation point.
  // Useful when the daemon's sweep hasn't ticked yet, or when running without
  // a daemon at all. Never touches `review`/`never` policy dispatches.
  if (subcommand === 'merge-sweep') {
    const result = await runAutoMergeSweep(queue);
    if (isJson(options)) {
      console.log(JSON.stringify({ result }, null, 2));
      return;
    }
    ui.success(`Auto-merge sweep: checked ${result.checked} 'auto' dispatch(es)`);
    for (const m of result.merged) {
      console.log(`  merged:      ${m.prUrl} (dispatch ${m.dispatchId.slice(0, 8)}${m.mergeCommit ? `, ${m.mergeCommit}` : ''})`);
    }
    for (const c of result.cleanedUp) {
      console.log(`  cleaned up:  ${c.prUrl} (dispatch ${c.dispatchId.slice(0, 8)}, already merged)`);
    }
    for (const b of result.blocked) {
      console.log(`  not ready:   ${b.prUrl} (dispatch ${b.dispatchId.slice(0, 8)}) — ${b.reasons.join('; ')}`);
    }
    for (const e of result.errors) {
      console.log(`  error:       dispatch ${e.dispatchId.slice(0, 8)} — ${e.error}`);
    }
    if (result.merged.length === 0 && result.blocked.length === 0 && result.errors.length === 0 && result.cleanedUp.length === 0) {
      console.log('  nothing to do');
    }
    return;
  }

  // -- run --------------------------------------------------------------
  if (subcommand === 'run') {
    const dryRun = !options['really-run'] && !options.reallyRun;
    // HITL contract §4.3: refuse NEW dependent work while a critical operator
    // ask is open (docs/hitl-interruptions.md). Dry runs stay allowed — they
    // launch nothing.
    if (!dryRun && !(await preflightInterruptionsGate('pd dispatch run'))) {
      process.exit(1);
    }
    const rest = args.slice(1);
    const wantsNext = rest.includes('--next') || !!options.next;
    if (wantsNext) {
      if (!dryRun) {
        const next = [...queue.list({ state: 'proposed' })]
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) {
          if (isJson(options)) {
            console.log(JSON.stringify({ result: null, message: 'queue is empty' }, null, 2));
          } else {
            console.log('No proposed dispatches to run.');
          }
          return;
        }
        try {
          const result = await runDispatchViaDaemon(next.id, queue);
          if (isJson(options)) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printDaemonRunResult(result, options);
          }
          return;
        } catch (err) {
          ui.error(`Dispatch daemon run failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }
      const result = await runNext(queue, {
        dryRun,
        backend: parseBackend(options.backend),
      });
      if (!result) {
        if (isJson(options)) {
          console.log(JSON.stringify({ plan: null, message: 'queue is empty' }, null, 2));
        } else {
          console.log('No proposed dispatches to run.');
        }
        return;
      }
      if (isJson(options)) {
        console.log(JSON.stringify({ plan: result.plan, result: result.result ?? null }, null, 2));
        return;
      }
      printPlan(result.plan, dryRun, options);
      if (result.result) {
        console.log('');
        console.log(`Result: ${result.result.state}`);
        if (result.result.errorMessage) console.log(`  error: ${result.result.errorMessage}`);
        if (result.result.costUsd != null) console.log(`  cost:  $${result.result.costUsd.toFixed(2)}`);
        if (result.result.resultArtifact) console.log(`  artifact: ${result.result.resultArtifact}`);
      }
      return;
    }
    const id = rest.find((a) => !a.startsWith('--'));
    if (!id) {
      ui.error('pd dispatch run requires a dispatch id or --next');
      usage();
    }
    const d = queue.get(id);
    if (!d) {
      ui.error(`Dispatch ${id} not found`);
      process.exit(1);
    }
    const plan = planRunFor(d, {
      backend: parseBackend(options.backend),
    });
    if (isJson(options) && dryRun) {
      console.log(JSON.stringify({ plan, dryRun }, null, 2));
      return;
    }
    if (!isJson(options)) printPlan(plan, dryRun, options);
    if (!dryRun) {
      try {
        const result = await runDispatchViaDaemon(id, queue);
        if (isJson(options)) {
          console.log(JSON.stringify({ plan, dryRun, daemon: result }, null, 2));
        } else {
          console.log('');
          printDaemonRunResult(result, options);
        }
      } catch (err) {
        ui.error(`Dispatch daemon run failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    return;
  }

  ui.error(`Unknown subcommand: ${subcommand}`);
  usage();
}

function printPlan(plan: ReturnType<typeof planRunFor>, dryRun: boolean, options: CLIOptions): void {
  if (shouldRenderLinework(options)) {
    const rows: ui.LineworkRow[] = [
      { state: 'pending', label: 'goal', text: plan.dispatch.goal },
      { state: 'active', label: 'backend', text: plan.backend },
      { state: 'active', label: 'worktree', text: plan.worktreePath },
      { state: 'active', label: 'branch', text: plan.branch },
      { state: 'pending', label: 'base', text: `${plan.dispatch.baseBranch} · ${plan.baseRef}` },
      { state: 'pending', label: 'timeout', text: `${Math.round(plan.timeoutMs / 60000)} min` },
      { state: 'pending', label: 'budget', text: `$${plan.budgetUsd.toFixed(2)}` },
      { state: dryRun ? 'guard-blocked' : 'spawning', label: 'next', text: dryRun ? 'pass --really-run to spawn after reading the plan' : 'daemon-side worker launch requested' },
      ...plan.rationale.map((line): ui.LineworkRow => ({ state: 'info', label: 'why', text: line })),
    ];
    console.log(ui.renderLineworkPanel({
      title: 'Dispatch Plan',
      subtitle: `${plan.dispatch.slug} (${plan.dispatch.id.slice(0, 8)})`,
      tone: dryRun ? 'pending' : 'running',
      zone: dryRun ? 'dry run' : 'ready to run',
      rows,
      footer: `${plan.command} ${plan.args.join(' ')}`,
    }));
    return;
  }
  ui.success(`Dispatch plan for ${plan.dispatch.slug} (${plan.dispatch.id.slice(0, 8)})`);
  console.log(`  goal:        ${plan.dispatch.goal}`);
  console.log(`  backend:     ${plan.backend}`);
  console.log(`  worktree:    ${plan.worktreePath}`);
  console.log(`  branch:      ${plan.branch}`);
  console.log(`  base_branch: ${plan.dispatch.baseBranch}`);
  console.log(`  baseRef:     ${plan.baseRef}`);
  console.log(`  timeout:     ${Math.round(plan.timeoutMs / 60000)} min`);
  console.log(`  budget:      $${plan.budgetUsd.toFixed(2)}`);
  console.log(`  command:     ${plan.command} ${plan.args.join(' ')}`);
  console.log(`  rationale:`);
  for (const line of plan.rationale) console.log(`    - ${line}`);
  if (dryRun) {
    console.log('');
    console.log('(dry-run; pass --really-run to actually spawn -- and read the proposal first)');
  }
}
