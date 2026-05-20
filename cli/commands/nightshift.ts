/**
 * pd nightshift -- operator queue for autonomous overnight feature dev.
 *
 * First cut is intentionally direct-DB: propose / queue / show / cancel /
 * review all operate against the same SQLite file the daemon uses. The
 * `run` subcommand prints a plan but does not invoke the autonomous agent
 * unless --really-run is passed AND the operator has acknowledged the
 * blast-radius caveats (claude wrapper deny-list is not yet wired).
 *
 * No daemon HTTP route exists for nightshift yet. That is the next
 * follow-up PR once the cron path lands.
 */

import { initDatabase } from '../../lib/db.js';
import {
  createNightshiftQueue,
  type NightshiftIntent,
  type NightshiftStatus,
} from '../../lib/nightshift/queue.js';
import {
  planRunFor,
  runNext,
  type NightshiftBackend,
} from '../../lib/nightshift/runner.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

function usage(): never {
  console.error('Usage: pd nightshift <subcommand> [args]');
  console.error('');
  console.error('Subcommands:');
  console.error('  propose <intent text>   Drop an intent into the queue (status=proposed)');
  console.error('  queue [id]              Promote a proposed intent to queued; with no id, list all queued');
  console.error('  list                    List intents (default: all)');
  console.error('  show <id>               Show one intent in detail');
  console.error('  run <id>                Run a specific intent (default --dry-run)');
  console.error('  run --next              Run the next queued intent (default --dry-run)');
  console.error('  review <id>             Stamp the operator review timestamp + print PR / branch');
  console.error('  cancel <id> [--reason]  Cancel a non-terminal intent');
  console.error('  help                    Show this help');
  console.error('');
  console.error('Options:');
  console.error('  --tags a,b,c            Comma-separated tags for propose');
  console.error('  --backend <name>        cli:claude-code | cli:codex (default: cli:codex)');
  console.error('  --budget <usd>          Per-intent budget ceiling (default 5, max 25)');
  console.error('  --timeout <seconds>     Per-intent timeout (default 10800 = 3h, max 21600 = 6h)');
  console.error('  --status <status>       Filter list: proposed|queued|running|open|terminal|all');
  console.error('  --limit <n>             Limit list results');
  console.error('  --auto-queue            propose: skip the proposed step, go straight to queued');
  console.error('  --really-run            run: actually spawn (default is dry-run -- prints plan only)');
  console.error('  --reason <text>         cancel: record a reason');
  console.error('  -j, --json              JSON output');
  console.error('  -q, --quiet             Quiet output');
  process.exit(1);
}

function parseBackend(value: unknown): NightshiftBackend | undefined {
  if (value === 'cli:claude-code' || value === 'cli:codex') return value;
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

function formatIntentLine(intent: NightshiftIntent): string {
  const idShort = intent.id.slice(0, 8);
  const status = intent.status.padEnd(10);
  const slug = intent.slug.slice(0, 32).padEnd(32);
  const cost = intent.costUsd != null ? `$${intent.costUsd.toFixed(2)}` : '   --';
  const pr = intent.prUrl ? ` ${intent.prUrl}` : '';
  return `${idShort}  ${status}  ${slug}  ${cost}${pr}`;
}

function printIntentDetail(intent: NightshiftIntent): void {
  console.log(`Intent ${intent.id}`);
  console.log(`  slug:        ${intent.slug}`);
  console.log(`  status:      ${intent.status}`);
  console.log(`  intent:      ${intent.intent}`);
  if (intent.tags.length > 0) console.log(`  tags:        ${intent.tags.join(', ')}`);
  console.log(`  backend:     ${intent.backend ?? '(default at runtime)'}`);
  if (intent.budgetUsd != null) console.log(`  budget:      $${intent.budgetUsd.toFixed(2)}`);
  if (intent.timeoutMs != null) console.log(`  timeout:     ${Math.round(intent.timeoutMs / 1000)}s`);
  if (intent.worktreePath) console.log(`  worktree:    ${intent.worktreePath}`);
  if (intent.branchName) console.log(`  branch:      ${intent.branchName}`);
  if (intent.sessionId) console.log(`  session:     ${intent.sessionId}`);
  if (intent.prUrl) console.log(`  pr:          ${intent.prUrl}`);
  if (intent.costUsd != null) console.log(`  cost:        $${intent.costUsd.toFixed(2)}`);
  if (intent.durationMs != null) console.log(`  duration:    ${Math.round(intent.durationMs / 1000)}s`);
  if (intent.errorMessage) console.log(`  error:       ${intent.errorMessage}`);
  console.log(`  createdAt:   ${new Date(intent.createdAt).toISOString()}`);
  if (intent.queuedAt) console.log(`  queuedAt:    ${new Date(intent.queuedAt).toISOString()}`);
  if (intent.startedAt) console.log(`  startedAt:   ${new Date(intent.startedAt).toISOString()}`);
  if (intent.completedAt) console.log(`  completedAt: ${new Date(intent.completedAt).toISOString()}`);
  if (intent.reviewedAt) console.log(`  reviewedAt:  ${new Date(intent.reviewedAt).toISOString()}`);
}

export async function handleNightshift(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help') usage();

  const db = initDatabase();
  const queue = createNightshiftQueue({ db });

  // ── propose ────────────────────────────────────────────────────────────
  if (subcommand === 'propose') {
    const intentText = args.slice(1).join(' ').trim();
    if (!intentText) {
      ui.error('pd nightshift propose requires intent text');
      usage();
    }
    let intent: NightshiftIntent;
    try {
      intent = queue.propose({
        intent: intentText,
        tags: parseTags(options.tags),
        backend: parseBackend(options.backend),
        budgetUsd: parseNumber(options.budget),
        timeoutMs: parseNumber(options.timeout) != null
          ? Math.round((parseNumber(options.timeout) ?? 0) * 1000)
          : undefined,
        autoQueue: !!options['auto-queue'] || !!options.autoQueue,
      });
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ intent }, null, 2));
      return;
    }
    if (!isQuiet(options)) {
      ui.success(`Proposed nightshift intent ${intent.id.slice(0, 8)}`);
      console.log(`  slug:   ${intent.slug}`);
      console.log(`  status: ${intent.status}`);
      console.log(`  promote with: pd nightshift queue ${intent.id}`);
    } else {
      console.log(intent.id);
    }
    return;
  }

  // ── queue (with id: promote; without id: list queued) ──────────────────
  if (subcommand === 'queue') {
    const id = args[1];
    if (id) {
      let intent: NightshiftIntent;
      try {
        intent = queue.queue(id);
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify({ intent }, null, 2));
        return;
      }
      ui.success(`Queued intent ${intent.id.slice(0, 8)} (${intent.slug})`);
      return;
    }
    const intents = queue.list({ status: 'queued' });
    if (isJson(options)) {
      console.log(JSON.stringify({ intents }, null, 2));
      return;
    }
    if (intents.length === 0) {
      console.log('No queued intents.');
      return;
    }
    for (const intent of intents) {
      console.log(formatIntentLine(intent));
    }
    return;
  }

  // ── list ───────────────────────────────────────────────────────────────
  if (subcommand === 'list') {
    const status = typeof options.status === 'string'
      ? (options.status as NightshiftStatus | 'all' | 'open' | 'terminal')
      : 'all';
    const limit = parseNumber(options.limit);
    const intents = queue.list({ status, limit });
    if (isJson(options)) {
      console.log(JSON.stringify({ intents }, null, 2));
      return;
    }
    if (intents.length === 0) {
      console.log('No nightshift intents.');
      return;
    }
    for (const intent of intents) {
      console.log(formatIntentLine(intent));
    }
    return;
  }

  // ── show ───────────────────────────────────────────────────────────────
  if (subcommand === 'show') {
    const id = args[1];
    if (!id) {
      ui.error('pd nightshift show requires an intent id');
      usage();
    }
    const intent = queue.get(id);
    if (!intent) {
      ui.error(`Intent ${id} not found`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ intent }, null, 2));
      return;
    }
    printIntentDetail(intent);
    return;
  }

  // ── cancel ─────────────────────────────────────────────────────────────
  if (subcommand === 'cancel') {
    const id = args[1];
    if (!id) {
      ui.error('pd nightshift cancel requires an intent id');
      usage();
    }
    const reason = typeof options.reason === 'string' ? options.reason : undefined;
    let intent: NightshiftIntent;
    try {
      intent = queue.cancel(id, reason);
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ intent }, null, 2));
      return;
    }
    ui.success(`Cancelled intent ${intent.id.slice(0, 8)}`);
    return;
  }

  // ── review ─────────────────────────────────────────────────────────────
  if (subcommand === 'review') {
    const id = args[1];
    if (!id) {
      ui.error('pd nightshift review requires an intent id');
      usage();
    }
    const intent = queue.get(id);
    if (!intent) {
      ui.error(`Intent ${id} not found`);
      process.exit(1);
    }
    queue.markReviewed(id);
    if (isJson(options)) {
      console.log(JSON.stringify({ intent: queue.get(id) }, null, 2));
      return;
    }
    printIntentDetail(intent);
    if (intent.prUrl) {
      console.log('');
      console.log(`Review on GitHub: ${intent.prUrl}`);
    } else if (intent.branchName) {
      console.log('');
      console.log(`No PR opened yet. Branch: ${intent.branchName}`);
      console.log(`If you want to land it manually:`);
      console.log(`  gh pr create --draft --base main --head ${intent.branchName} --title "<title>" --body "<body>"`);
    }
    return;
  }

  // ── run ────────────────────────────────────────────────────────────────
  if (subcommand === 'run') {
    const dryRun = !options['really-run'] && !options.reallyRun;
    const rest = args.slice(1);
    const wantsNext = rest.includes('--next') || !!options.next;
    if (wantsNext) {
      const result = await runNext(queue, {
        dryRun,
        backend: parseBackend(options.backend),
      });
      if (!result) {
        if (isJson(options)) {
          console.log(JSON.stringify({ plan: null, message: 'queue is empty' }, null, 2));
        } else {
          console.log('No queued intents to run.');
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
        console.log(`Result: ${result.result.status}`);
        if (result.result.errorMessage) console.log(`  error: ${result.result.errorMessage}`);
        if (result.result.costUsd != null) console.log(`  cost:  $${result.result.costUsd.toFixed(2)}`);
        if (result.result.prUrl) console.log(`  pr:    ${result.result.prUrl}`);
      }
      return;
    }
    const id = rest.find((a) => !a.startsWith('--'));
    if (!id) {
      ui.error('pd nightshift run requires an intent id or --next');
      usage();
    }
    const intent = queue.get(id);
    if (!intent) {
      ui.error(`Intent ${id} not found`);
      process.exit(1);
    }
    const plan = planRunFor(intent, {
      backend: parseBackend(options.backend),
    });
    if (isJson(options)) {
      console.log(JSON.stringify({ plan, dryRun }, null, 2));
      return;
    }
    printPlan(plan, dryRun);
    if (!dryRun) {
      ui.warn(
        '`--really-run` is wired but the first-cut runner only prints the plan. ' +
          'See docs/proposals/pd-nightshift.md "stubbed" section.',
      );
    }
    return;
  }

  ui.error(`Unknown subcommand: ${subcommand}`);
  usage();
}

function printPlan(plan: ReturnType<typeof planRunFor>, dryRun: boolean): void {
  ui.success(`Nightshift plan for ${plan.intent.slug} (${plan.intent.id.slice(0, 8)})`);
  console.log(`  intent:    ${plan.intent.intent}`);
  console.log(`  backend:   ${plan.backend}`);
  console.log(`  worktree:  ${plan.worktreePath}`);
  console.log(`  branch:    ${plan.branchName}`);
  console.log(`  baseRef:   ${plan.baseRef}`);
  console.log(`  timeout:   ${Math.round(plan.timeoutMs / 60000)} min`);
  console.log(`  budget:    $${plan.budgetUsd.toFixed(2)}`);
  console.log(`  command:   ${plan.command} ${plan.args.join(' ')}`);
  console.log(`  rationale:`);
  for (const line of plan.rationale) console.log(`    - ${line}`);
  if (dryRun) {
    console.log('');
    console.log('(dry-run; pass --really-run to actually spawn -- and read the proposal first)');
  }
}
