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
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { describeState, stateGlyph } from '../../lib/dispatch/state-machine.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { pdFetch, isDaemonRunning } from '../utils/fetch.js';
import { handleReview } from './review.js';

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

async function readResponseJson(res: Awaited<ReturnType<typeof pdFetch>>): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function runDispatchViaDaemon(id: string): Promise<Record<string, unknown>> {
  if (!(await isDaemonRunning())) {
    throw new Error(
      'daemon unavailable; refusing local dispatch --really-run fallback. ' +
      'Start the daemon from FleetBar or retry when Port Daddy is healthy.',
    );
  }
  const res = await pdFetch(`/dispatches/${encodeURIComponent(id)}/run`, { method: 'POST' });
  const payload = await readResponseJson(res);
  if (!res.ok) {
    const error = typeof payload.error === 'string'
      ? payload.error
      : `daemon returned HTTP ${res.status ?? 'unknown'}`;
    throw new Error(error);
  }
  return payload;
}

function printDaemonRunResult(payload: Record<string, unknown>): void {
  const launched = typeof payload.launchedThisTick === 'number'
    ? payload.launchedThisTick
    : 0;
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

  // -- run --------------------------------------------------------------
  if (subcommand === 'run') {
    const dryRun = !options['really-run'] && !options.reallyRun;
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
          const result = await runDispatchViaDaemon(next.id);
          if (isJson(options)) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printDaemonRunResult(result);
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
      printPlan(result.plan, dryRun);
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
    if (!isJson(options)) printPlan(plan, dryRun);
    if (!dryRun) {
      if (d.state !== 'proposed') {
        ui.error(`Dispatch ${id} is in state '${d.state}'; only 'proposed' dispatches can be run.`);
        process.exit(1);
      }
      try {
        const result = await runDispatchViaDaemon(id);
        if (isJson(options)) {
          console.log(JSON.stringify({ plan, dryRun, daemon: result }, null, 2));
        } else {
          console.log('');
          printDaemonRunResult(result);
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
