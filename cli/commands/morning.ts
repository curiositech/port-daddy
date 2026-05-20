/**
 * pd morning -- start-of-day summary of overnight nightshift completions.
 *
 * The Bostock-density variant (small multiples, sparkline of cost vs cap,
 * inline transcript previews) is a follow-up. This first cut prints a
 * plain-text table that is honest about what ran, what cost it, and what
 * needs operator attention.
 *
 * Default time window is the last 18 hours (covers an overnight from
 * yesterday evening through breakfast). Override with --since <iso|ms>.
 */

import { initDatabase } from '../../lib/db.js';
import { createNightshiftQueue, type NightshiftIntent } from '../../lib/nightshift/queue.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

const DEFAULT_LOOKBACK_HOURS = 18;

function parseSince(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    // Try ISO first
    const iso = Date.parse(value);
    if (Number.isFinite(iso)) return iso;
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
}

function statusGlyph(status: NightshiftIntent['status']): string {
  switch (status) {
    case 'succeeded': return '+';
    case 'failed':
    case 'aborted':
    case 'timeout': return 'x';
    case 'cancelled': return '-';
    case 'running': return '>';
    case 'queued':
    case 'proposed': return '.';
    default: return '?';
  }
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
  intents: NightshiftIntent[];
  totals: {
    completed: number;
    succeeded: number;
    failed: number;
    inFlight: number;
    cancelled: number;
    totalCostUsd: number;
  };
}

export function summarize(intents: NightshiftIntent[], windowStart: number, windowEnd: number): MorningSummary {
  let succeeded = 0;
  let failed = 0;
  let inFlight = 0;
  let cancelled = 0;
  let totalCostUsd = 0;
  for (const intent of intents) {
    if (intent.status === 'succeeded') succeeded += 1;
    else if (intent.status === 'failed' || intent.status === 'aborted' || intent.status === 'timeout') failed += 1;
    else if (intent.status === 'running') inFlight += 1;
    else if (intent.status === 'cancelled') cancelled += 1;
    if (intent.costUsd != null && Number.isFinite(intent.costUsd)) totalCostUsd += intent.costUsd;
  }
  return {
    windowStart,
    windowEnd,
    intents,
    totals: {
      completed: succeeded + failed + cancelled,
      succeeded,
      failed,
      inFlight,
      cancelled,
      totalCostUsd,
    },
  };
}

export async function handleMorning(args: string[], options: CLIOptions): Promise<void> {
  // args may carry --since-relative shorthand later; not used today.
  void args;
  const windowStart = parseSince(options.since);
  const windowEnd = Date.now();

  const db = initDatabase();
  const queue = createNightshiftQueue({ db });
  const intents = queue.list({ since: windowStart });
  const summary = summarize(intents, windowStart, windowEnd);

  if (isJson(options)) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(
      `${summary.totals.succeeded} succeeded, ${summary.totals.failed} failed, ` +
        `${summary.totals.inFlight} in flight, ${formatCost(summary.totals.totalCostUsd)} total`,
    );
    return;
  }

  const startIso = new Date(windowStart).toISOString();
  const endIso = new Date(windowEnd).toISOString();
  ui.intro('pd morning');
  console.log(`Window: ${startIso} -> ${endIso}`);
  console.log('');

  if (summary.intents.length === 0) {
    console.log('Nothing ran in this window.');
    console.log('');
    console.log('Drop an intent for tonight:');
    console.log('  pd nightshift propose "<what you wish was done by morning>"');
    return;
  }

  console.log('  id        status       slug                              duration   cost   pr/branch');
  console.log('  --------  -----------  --------------------------------  ---------  -----  ----------');
  for (const intent of summary.intents) {
    const idShort = intent.id.slice(0, 8);
    const glyph = statusGlyph(intent.status);
    const status = `${glyph} ${intent.status}`.padEnd(11);
    const slug = intent.slug.slice(0, 32).padEnd(32);
    const dur = formatDuration(intent.durationMs).padEnd(9);
    const cost = formatCost(intent.costUsd).padEnd(5);
    const trailer = intent.prUrl
      ? intent.prUrl
      : intent.branchName
        ? `branch:${intent.branchName}`
        : '(no branch yet)';
    console.log(`  ${idShort}  ${status}  ${slug}  ${dur}  ${cost}  ${trailer}`);
  }

  console.log('');
  console.log(
    `${summary.totals.succeeded} succeeded  ` +
      `${summary.totals.failed} failed  ` +
      `${summary.totals.inFlight} in flight  ` +
      `${summary.totals.cancelled} cancelled  ` +
      `total cost ${formatCost(summary.totals.totalCostUsd)}`,
  );

  const needsReview = summary.intents.filter(
    (i) =>
      (i.status === 'succeeded' || i.status === 'failed' || i.status === 'aborted' || i.status === 'timeout') &&
      i.reviewedAt == null,
  );
  if (needsReview.length > 0) {
    console.log('');
    console.log(`${needsReview.length} intent(s) need review:`);
    for (const intent of needsReview) {
      console.log(`  pd nightshift review ${intent.id}`);
    }
  }
}
