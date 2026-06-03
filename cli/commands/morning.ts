/**
 * pd morning -- start-of-day summary of overnight dispatch activity.
 *
 * Renamed-table-aware: reads from `dispatches`, falls back to the
 * (now-migrated) `nightshift_intents` rows via lib/dispatch/queue's
 * migrateNightshiftIntents() which runs at queue construction.
 *
 * Shows the full 8-state machine, not just "is there a PR":
 *
 *   queued / running / awaiting-review / accepted / rejected / failed
 *
 * Plus a "needs your review" callout listing dispatches in `review_pending`,
 * with the `pd review <id> --accept|--reject` commands ready to copy.
 *
 * Default time window is the last 18 hours (overnight from yesterday
 * evening through breakfast). Override with --since <iso|ms>.
 */

import { initDatabase } from '../../lib/db.js';
import {
  createDispatchQueue,
  type Dispatch,
  type DispatchState,
} from '../../lib/dispatch/queue.js';
import { stateGlyph } from '../../lib/dispatch/state-machine.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

const DEFAULT_LOOKBACK_HOURS = 18;

function parseSince(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const iso = Date.parse(value);
    if (Number.isFinite(iso)) return iso;
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '   --';
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes} min`;
  return `${totalSec}s`;
}

function formatCost(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return '   --';
  return `$${usd.toFixed(2)}`;
}

interface MorningSummary {
  windowStart: number;
  windowEnd: number;
  dispatches: Dispatch[];
  totals: {
    /** Total dispatches in window (any state). */
    total: number;
    /** Per-state breakdown. */
    byState: Record<DispatchState, number>;
    /** Convenience: how many need operator attention right now. */
    awaitingReview: number;
    /** Convenience: terminal-but-not-good. */
    failedOrRejected: number;
    /** Sum of cost_usd for dispatches in window. */
    totalCostUsd: number;
  };
}

const STATE_ORDER: DispatchState[] = [
  'proposed',
  'claimed',
  'in_progress',
  'produced',
  'review_pending',
  'accepted',
  'rejected',
  'settled',
  'failed',
  'salvage',
];

export function summarize(
  dispatches: Dispatch[],
  windowStart: number,
  windowEnd: number,
): MorningSummary {
  const byState = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<DispatchState, number>;
  let totalCostUsd = 0;
  for (const d of dispatches) {
    byState[d.state] = (byState[d.state] ?? 0) + 1;
    if (d.costUsd != null && Number.isFinite(d.costUsd)) totalCostUsd += d.costUsd;
  }
  return {
    windowStart,
    windowEnd,
    dispatches,
    totals: {
      total: dispatches.length,
      byState,
      awaitingReview: byState.review_pending,
      failedOrRejected: byState.failed + byState.rejected + byState.salvage,
      totalCostUsd,
    },
  };
}

export async function handleMorning(args: string[], options: CLIOptions): Promise<void> {
  void args;
  const windowStart = parseSince(options.since);
  const windowEnd = Date.now();

  const db = initDatabase();
  const queue = createDispatchQueue({ db });
  const dispatches = queue.list({ since: windowStart });
  const summary = summarize(dispatches, windowStart, windowEnd);

  if (isJson(options)) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (isQuiet(options)) {
    const t = summary.totals;
    console.log(
      `${t.byState.settled} settled, ${t.failedOrRejected} failed/rejected, ` +
        `${t.awaitingReview} awaiting review, ${formatCost(t.totalCostUsd)} total`,
    );
    return;
  }

  const startIso = new Date(windowStart).toISOString();
  const endIso = new Date(windowEnd).toISOString();
  ui.intro('pd morning');
  console.log(`Window: ${startIso} -> ${endIso}`);
  console.log('');

  if (summary.dispatches.length === 0) {
    console.log('Nothing ran in this window.');
    console.log('');
    console.log('Drop a goal for the next run:');
    console.log('  pd dispatch propose "<what you wish was done by morning>"');
    return;
  }

  console.log('  id        state             slug                              duration   cost   artifact/branch');
  console.log('  --------  ----------------  --------------------------------  ---------  -----  ---------------');
  for (const d of summary.dispatches) {
    const idShort = d.id.slice(0, 8);
    const glyph = stateGlyph(d.state);
    const state = `${glyph} ${d.state}`.padEnd(16);
    const slug = d.slug.slice(0, 32).padEnd(32);
    const dur = formatDuration(d.durationMs).padEnd(9);
    const cost = formatCost(d.costUsd).padEnd(5);
    const trailer = d.resultArtifact
      ? d.resultArtifact
      : d.branch
        ? `branch:${d.branch}`
        : '(no branch yet)';
    console.log(`  ${idShort}  ${state}  ${slug}  ${dur}  ${cost}  ${trailer}`);
  }

  console.log('');
  const t = summary.totals;
  // State-machine roll-up: print every non-zero state. Order is the canonical
  // 8-state walk so the operator can read top-to-bottom and see where work
  // is sitting.
  const parts: string[] = [];
  for (const state of STATE_ORDER) {
    const n = t.byState[state];
    if (n > 0) parts.push(`${n} ${state}`);
  }
  console.log(parts.join('  '));
  console.log(`total cost ${formatCost(t.totalCostUsd)}`);

  // Operator-action callouts.
  if (t.awaitingReview > 0) {
    console.log('');
    console.log(`${t.awaitingReview} dispatch(es) awaiting review:`);
    for (const d of summary.dispatches) {
      if (d.state !== 'review_pending') continue;
      console.log(`  pd review ${d.id} --accept`);
      console.log(`  pd review ${d.id} --reject "<reason>"`);
    }
  }

  const stuckProduced = summary.dispatches.filter(
    (d) => d.state === 'produced' && d.producedAt && (Date.now() - d.producedAt) > 30 * 60 * 1000,
  );
  if (stuckProduced.length > 0) {
    console.log('');
    console.log(`${stuckProduced.length} dispatch(es) stuck in "produced" >30min:`);
    for (const d of stuckProduced) {
      console.log(`  ${d.id.slice(0, 8)} ${d.slug} (artifact: ${d.resultArtifact ?? 'none'})`);
    }
  }

  const failed = summary.dispatches.filter(
    (d) => d.state === 'failed' && !d.reviewedAt,
  );
  if (failed.length > 0) {
    console.log('');
    console.log(`${failed.length} dispatch(es) failed -- see error_message via:`);
    for (const d of failed) {
      console.log(`  pd dispatch show ${d.id}`);
    }
  }
}
