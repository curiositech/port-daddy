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
  type DispatchState,
  type MergePolicy,
} from '../../lib/dispatch/queue.js';
import {
  planRunFor,
  runNext,
  type DispatchBackend,
} from '../../lib/dispatch/runner.js';
import { defaultSpawnAdapter } from '../../lib/dispatch/spawn-adapter.js';
import { describeState, stateGlyph } from '../../lib/dispatch/state-machine.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { handleReview } from './review.js';
import { pdFetch, isDaemonRunning } from '../utils/fetch.js';

function usage(): never {
  console.error('Usage: pd dispatch <subcommand> [args]');
  console.error('');
  console.error('Subcommands:');
  console.error('  propose <goal text>     Drop a goal into the queue (state=proposed)');
  console.error('  queue                   List proposed dispatches');
  console.error('  list                    List dispatches (default: all)');
  console.error('  show <id>               Show one dispatch in detail');
  console.error('  run <id>                Queue a dispatch for daemon-side execution (returns immediately)');
  console.error('  run --next              Queue the next proposed dispatch for the daemon');
  console.error('  status <id>             Show live state of a dispatch (daemon-driven progress)');
  console.error('  review <id>             Alias for `pd review` (see `pd review --help`)');
  console.error('  cancel <id> [--reason]  Cancel a non-terminal dispatch');
  console.error('  help                    Show this help');
  console.error('');
  console.error('Options:');
  console.error('  --tags a,b,c              Comma-separated tags for propose');
  console.error('  --backend <name>          cli:claude-code | cli:codex (default: cli:codex)');
  console.error('  --base-branch <name>      Branch the worktree is carved from (default: main)');
  console.error('  --merge-policy <p>        review | never (auto requires PR #141; rejected today)');
  console.error('  --budget <usd>            Per-dispatch budget ceiling (default 5, max 25)');
  console.error('  --timeout <seconds>       Per-dispatch timeout (default 10800 = 3h, max 21600 = 6h)');
  console.error('  --to <actor>              Target actor (auto-routing not yet wired)');
  console.error('  --reviewer <actor>        Reviewer actor (default: operator)');
  console.error('  --state <state>           Filter list by state | open | terminal | awaiting_review | all');
  console.error('  --limit <n>               Limit list results');
  console.error('  --auto-claim              propose: skip proposed step, go straight to claimed');
  console.error('  --foreground              run: run synchronously in THIS process (legacy; blocks up to 6h)');
  console.error('  --really-run              run --foreground: actually spawn (else prints plan only)');
  console.error('  --dry-run                 run: just print the plan, do not queue or spawn');
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

export async function handleDispatch(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help') usage();

  const db = initDatabase();
  const queue = createDispatchQueue({ db });

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
      dispatch = queue.propose({
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
      });
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
    printDispatchDetail(d);
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

  // -- status (live daemon-driven progress) -----------------------------
  if (subcommand === 'status') {
    const id = args[1];
    if (!id) {
      ui.error('pd dispatch status requires a dispatch id');
      usage();
    }
    // Prefer the daemon (it holds the live row + worker status); fall back to the
    // local DB if the daemon is unreachable.
    let d = queue.get(id);
    let worker: Record<string, unknown> | null = null;
    if (await isDaemonRunning()) {
      try {
        const res = await pdFetch(`/dispatches/${encodeURIComponent(id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json && (json as any).dispatch) d = (json as any).dispatch as Dispatch;
        }
        const wres = await pdFetch('/dispatches/worker/status');
        if (wres.ok) {
          const wjson = await wres.json();
          worker = (wjson as any).worker ?? null;
        }
      } catch { /* fall back to local row */ }
    }
    if (!d) {
      ui.error(`Dispatch ${id} not found`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: d, worker }, null, 2));
      return;
    }
    printDispatchDetail(d);
    if (worker) {
      console.log('');
      console.log(`  daemon worker:  running=${worker.running} inFlight=${worker.inFlight}/${worker.maxConcurrency}`);
    }
    return;
  }

  // -- run --------------------------------------------------------------
  if (subcommand === 'run') {
    const rest = args.slice(1);
    const wantsNext = rest.includes('--next') || !!options.next;
    const dryRun = !!options['dry-run'] || !!options.dryRun;
    // --foreground (or the legacy --really-run) keeps the OLD behavior: run the
    // spawn synchronously in THIS CLI process, blocking up to the timeout. The
    // DEFAULT is now daemon-driven (enqueue-and-return) so the operator can
    // queue overnight work and walk away.
    const foreground = !!options.foreground || !!options['really-run'] || !!options.reallyRun;

    // ---- dry-run: print the plan only, never queue or spawn ----
    if (dryRun) {
      if (wantsNext) {
        const result = await runNext(queue, { dryRun: true, backend: parseBackend(options.backend) });
        if (!result) {
          if (isJson(options)) console.log(JSON.stringify({ plan: null, message: 'queue is empty' }, null, 2));
          else console.log('No proposed dispatches to run.');
          return;
        }
        if (isJson(options)) { console.log(JSON.stringify({ plan: result.plan }, null, 2)); return; }
        printPlan(result.plan, true);
        return;
      }
      const id = rest.find((a) => !a.startsWith('--'));
      if (!id) { ui.error('pd dispatch run requires a dispatch id or --next'); usage(); }
      const d = queue.get(id);
      if (!d) { ui.error(`Dispatch ${id} not found`); process.exit(1); }
      const plan = planRunFor(d, { backend: parseBackend(options.backend) });
      if (isJson(options)) { console.log(JSON.stringify({ plan, dryRun: true }, null, 2)); return; }
      printPlan(plan, true);
      return;
    }

    // ---- foreground (legacy synchronous): run in THIS process ----
    if (foreground) {
      const result = await runNext(queue, {
        dryRun: false,
        backend: parseBackend(options.backend),
        spawnAdapter: defaultSpawnAdapter,
      });
      if (!result) {
        ui.error('No proposed dispatches to run (queue empty or dispatch cancelled).');
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify({ plan: result.plan, result: result.result ?? null }, null, 2));
        return;
      }
      printPlan(result.plan, false);
      if (result.result) {
        const r = result.result;
        console.log('');
        if (r.state === 'settled') ui.success('Dispatch complete.');
        else ui.warn(`Dispatch ended with state: ${r.state}`);
        if (r.errorMessage) console.log(`  error:    ${r.errorMessage}`);
        if (r.costUsd != null) console.log(`  cost:     $${r.costUsd.toFixed(2)}`);
        if (r.resultArtifact) console.log(`  PR:       ${r.resultArtifact}`);
      }
      return;
    }

    // ---- DEFAULT: daemon-driven enqueue-and-return ----
    if (!(await isDaemonRunning())) {
      ui.error(
        'Daemon not reachable. Start it (`port-daddy start`) so it can run dispatches ' +
        'detached, or use `pd dispatch run <id> --foreground` to run synchronously here.',
      );
      process.exit(1);
    }

    // Resolve the target dispatch id (explicit id, or oldest proposed for --next).
    let targetId: string | undefined = rest.find((a) => !a.startsWith('--'));
    if (wantsNext && !targetId) {
      const next = queue.list({ state: 'proposed', limit: 1 })[0];
      if (!next) {
        if (isJson(options)) console.log(JSON.stringify({ queued: false, message: 'queue is empty' }, null, 2));
        else console.log('No proposed dispatches to run.');
        return;
      }
      targetId = next.id;
    }
    if (!targetId) { ui.error('pd dispatch run requires a dispatch id or --next'); usage(); }

    let res;
    try {
      res = await pdFetch(`/dispatches/${encodeURIComponent(targetId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (err) {
      ui.error(`Failed to queue dispatch on daemon: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !(json as any).ok) {
      ui.error(`Daemon rejected the run request: ${(json as any).error ?? `HTTP ${res.status}`}`);
      process.exit(1);
    }
    if (isJson(options)) { console.log(JSON.stringify(json, null, 2)); return; }
    const dispatch = (json as any).dispatch as Dispatch | undefined;
    ui.success(`Queued dispatch ${targetId.slice(0, 8)} for daemon-side execution.`);
    if (dispatch) console.log(`  state:    ${dispatch.state}`);
    console.log('  The daemon runs it detached from this CLI — you can close the terminal.');
    console.log(`  Watch progress:  pd dispatch status ${targetId.slice(0, 8)}`);
    return;
  }

  ui.error(`Unknown subcommand: ${subcommand}`);
  usage();
}

function printPlan(plan: ReturnType<typeof planRunFor>, dryRun: boolean): void {
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
