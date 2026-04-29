import { resolve } from 'node:path';

import type { RoadmapProgress, FeedbackEntry, RoadmapFeedbackStatus } from '../../lib/roadmap-progress.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

function readOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function formatAge(hours: number | null): string {
  if (hours === null) return 'unknown freshness';
  if (hours < 0.1) return 'updated just now';
  if (hours < 1) return `updated ${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `updated ${hours.toFixed(1)}h ago`;
  return `updated ${(hours / 24).toFixed(1)}d ago`;
}

function printFeedbackEntry(entry: FeedbackEntry): void {
  const bits: string[] = [entry.status];
  if (entry.surface) bits.push(entry.surface);
  if (entry.severity) bits.push(entry.severity);
  console.log(`  - ${entry.slug} [${bits.join('; ')}]`);
  if (entry.hook ?? entry.summary) console.log(`    ${entry.hook ?? entry.summary}`);
  if (entry.feedbackId) console.log(`    id=${entry.feedbackId.slice(0, 8)} by=${entry.droppedBy ?? 'unknown'}`);
}

export async function fetchRoadmapProgress(projectDir: string, options: {
  feedbackStatus?: RoadmapFeedbackStatus | 'all';
  feedbackHarbor?: string;
  feedbackLimit?: number;
} = {}): Promise<RoadmapProgress> {
  const params = new URLSearchParams({ root: projectDir });
  if (options.feedbackStatus) params.set('feedbackStatus', options.feedbackStatus);
  if (options.feedbackHarbor) params.set('feedbackHarbor', options.feedbackHarbor);
  if (options.feedbackLimit) params.set('feedbackLimit', String(options.feedbackLimit));
  const res = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-progress?${params.toString()}`);
  const data = (await res.json()) as unknown as RoadmapProgress & { error?: string };

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch Cartographer roadmap progress');
  }

  return data;
}

async function harvestRoadmapFeedback(feedbackId: string, options: CLIOptions): Promise<void> {
  const harvestedBy = readOption(options, 'as', 'harvestedBy', 'agent') ?? 'operator-cli';
  const intoSlug = readOption(options, 'into', 'intoSlug');
  const res = await pdFetch(`${PORT_DADDY_URL}/feedback/${encodeURIComponent(feedbackId)}/harvest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ harvestedBy, intoSlug }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; entry?: unknown };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to harvest feedback');
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data.entry, null, 2));
    return;
  }
  if (!isQuiet(options)) {
    console.log(`Acked ${feedbackId}${intoSlug ? ` into ${intoSlug}` : ''}`);
  }
}

export async function handleRoadmap(argsOrOptions: string[] | CLIOptions, maybeOptions?: CLIOptions): Promise<void> {
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const options = Array.isArray(argsOrOptions) ? (maybeOptions ?? {}) : argsOrOptions;

  const sub = args[0];
  if (sub === 'ack' || sub === 'harvest') {
    const feedbackId = args[1] || readOption(options, 'id', 'feedbackId');
    if (!feedbackId) {
      ui.error('Usage: pd roadmap ack <feedbackId> [--as <agentId>] [--into <roadmap-slug>]');
      process.exit(1);
    }
    try {
      await harvestRoadmapFeedback(feedbackId, options);
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'Failed to harvest feedback');
      process.exit(1);
    }
    return;
  }

  const projectDir = resolve(readOption(options, 'dir', 'root', 'projectDir') || process.cwd());
  const limit = parseLimit(options.limit, 8);
  const feedbackStatus = readOption(options, 'feedback-status', 'feedbackStatus') as RoadmapFeedbackStatus | 'all' | undefined;
  const feedbackHarbor = readOption(options, 'feedback-harbor', 'feedbackHarbor', 'harbor');
  const feedbackLimitValue = options['feedback-limit'] ?? options.feedbackLimit;
  const feedbackLimit = feedbackLimitValue === undefined ? undefined : parseLimit(feedbackLimitValue, 100);

  let progress: RoadmapProgress;
  try {
    progress = await fetchRoadmapProgress(projectDir, {
      feedbackStatus,
      feedbackHarbor,
      feedbackLimit,
    });
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'Failed to fetch Cartographer roadmap progress');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(progress, null, 2));
    return;
  }

  const nextCuts = progress.nextCuts.slice(0, limit);
  const ideasNow = progress.ideasNow.slice(0, limit);
  const liveFeedback = progress.liveFeedback.slice(0, limit);
  const feedback = progress.dogfoodFeedback.slice(0, limit);

  if (isQuiet(options)) {
    const rows = [
      ...nextCuts.map((entry) => `next:${entry.slug}`),
      ...ideasNow.map((entry) => `now:${entry.slug}`),
      ...liveFeedback.map((entry) => `live:${entry.slug}`),
      ...feedback.map((entry) => `feedback:${entry.slug}`),
    ];
    console.log(rows.join('\n'));
    return;
  }

  console.log('');
  const openFeedback = progress.feedbackSummary?.open ?? progress.liveFeedback.length;
  console.log(`ROADMAP · ${progress.nextCuts.length} next cuts · ${progress.ideasNow.length} now · ${openFeedback} live feedback · ${progress.dogfoodFeedback.length} curated · ${formatAge(progress.freshness.hoursSinceLastUpdate)}`);
  console.log('-'.repeat(80));
  console.log(ui.dim(`source: ${projectDir}`));

  if (progress.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of progress.warnings) console.log(`  - ${warning}`);
  }

  console.log('');
  console.log('Next cuts:');
  if (nextCuts.length === 0) {
    console.log(ui.dim('  (none surfaced)'));
  } else {
    for (const cut of nextCuts) {
      console.log(`  - ${cut.slug}`);
      console.log(`    ${cut.summary}`);
    }
  }

  console.log('');
  console.log('Curated now:');
  if (ideasNow.length === 0) {
    console.log(ui.dim('  (none surfaced)'));
  } else {
    for (const entry of ideasNow) printFeedbackEntry(entry);
  }

  console.log('');
  console.log('Live feedback:');
  if (liveFeedback.length === 0) {
    console.log(ui.dim('  (none surfaced)'));
  } else {
    for (const entry of liveFeedback) printFeedbackEntry(entry);
  }

  console.log('');
  console.log('Dogfood feedback:');
  if (feedback.length === 0) {
    console.log(ui.dim('  (none surfaced)'));
  } else {
    for (const entry of feedback) printFeedbackEntry(entry);
  }

  if (!options['no-excerpts']) {
    if (progress.currentWorkExcerpt) {
      console.log('');
      console.log('Current work excerpt:');
      console.log(progress.currentWorkExcerpt.trimEnd().split('\n').map((line) => `  ${line}`).join('\n'));
    }
    if (progress.cartographerStatusExcerpt) {
      console.log('');
      console.log('Cartographer status excerpt:');
      console.log(progress.cartographerStatusExcerpt.trimEnd().split('\n').map((line) => `  ${line}`).join('\n'));
    }
  }

  console.log('');
}
