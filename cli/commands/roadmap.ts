import { resolve } from 'node:path';

import type { RoadmapProgress, FeedbackEntry, RoadmapFeedbackStatus } from '../../lib/roadmap-progress.js';
import type { RoadmapClaim, RoadmapEntry, RoadmapPopKind } from '../../lib/roadmap-pop.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import { handleBegin } from './sugar.js';
import * as ui from '../utils/ui.js';

const VALID_POP_KINDS = new Set<string>(['any', 'live', 'next-cut', 'now', 'feedback']);

interface PopResponse {
  success: true;
  entry: RoadmapEntry;
  claim: RoadmapClaim;
}

interface PopFailureResponse {
  success: false;
  reason?: 'pile-empty' | 'slug-not-on-pile' | 'slug-already-claimed';
  slug?: string;
  claim?: RoadmapClaim | null;
  error?: string;
}

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

  if (sub === 'promote') {
    await handleRoadmapPromote(args.slice(1), options);
    return;
  }

  if (sub === 'pop') {
    await handleRoadmapPop(args.slice(1), options);
    return;
  }

  if (sub === 'release') {
    await handleRoadmapRelease(args.slice(1), options);
    return;
  }

  if (sub === 'claims') {
    await handleRoadmapClaims(options);
    return;
  }

  if (sub === 'claim-link' || sub === 'link') {
    await handleRoadmapClaimLink(args.slice(1), options);
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

function defaultClaimedBy(options: CLIOptions): string {
  const explicit = readOption(options, 'as', 'claimedBy', 'agent');
  if (explicit) return explicit;
  const ctx = readCurrentContext();
  if (ctx?.agentId) return ctx.agentId;
  return 'operator-cli';
}

function printClaimRow(claim: RoadmapClaim): void {
  const ageMs = Date.now() - claim.claimedAt;
  const ageMin = Math.max(0, Math.round(ageMs / 60_000));
  const ageStr = ageMin < 60 ? `${ageMin}m` : `${(ageMin / 60).toFixed(1)}h`;
  console.log(`  - ${claim.slug} [${claim.kind}] by ${claim.claimedBy} ${ageStr} ago`);
  if (claim.summary) console.log(`    ${claim.summary}`);
  if (claim.sessionId) console.log(`    session: ${claim.sessionId}`);
}

async function handleRoadmapPop(args: string[], options: CLIOptions): Promise<void> {
  const claimedBy = defaultClaimedBy(options);
  const kindRaw = readOption(options, 'kind') ?? 'any';
  if (!VALID_POP_KINDS.has(kindRaw)) {
    ui.error(`Invalid --kind: ${kindRaw}. Valid: any, live, next-cut, now, feedback`);
    process.exit(1);
  }
  const kind = kindRaw as RoadmapPopKind | 'any';
  const slug = args[0] || readOption(options, 'slug');
  const rootDir = resolve(readOption(options, 'dir', 'root', 'projectDir') || process.cwd());
  const feedbackHarbor = readOption(options, 'feedback-harbor', 'feedbackHarbor', 'harbor');
  const dryRun = Boolean(options['dry-run'] ?? options.dryRun);

  if (dryRun) {
    const progress = await fetchRoadmapProgress(rootDir, { feedbackHarbor });
    const piles: Array<{ slug: string; kind: string; summary: string }> = [];
    for (const e of progress.liveFeedback) piles.push({ slug: e.slug, kind: 'live', summary: e.summary ?? e.hook ?? e.slug });
    for (const c of progress.nextCuts) piles.push({ slug: c.slug, kind: 'next-cut', summary: c.summary });
    for (const e of progress.ideasNow) piles.push({ slug: e.slug, kind: 'now', summary: e.summary ?? e.hook ?? e.slug });
    for (const e of progress.dogfoodFeedback) piles.push({ slug: e.slug, kind: 'feedback', summary: e.summary ?? e.hook ?? e.slug });
    const want = kind === 'any' ? null : kind;
    const filtered = want ? piles.filter((p) => p.kind === want) : piles;
    const targeted = slug ? filtered.filter((p) => p.slug === slug) : filtered;
    const first = targeted[0];
    if (isJson(options)) {
      console.log(JSON.stringify({ wouldPop: first ?? null, total: targeted.length }, null, 2));
      return;
    }
    if (!first) {
      console.log(ui.dim('(dry-run) pile empty for this kind/slug'));
      return;
    }
    console.log(`(dry-run) would pop: ${first.slug} [${first.kind}]`);
    console.log(`           summary: ${first.summary}`);
    return;
  }

  const body: Record<string, unknown> = { claimedBy, kind, root: rootDir };
  if (slug) body.slug = slug;
  if (feedbackHarbor) body.feedbackHarbor = feedbackHarbor;

  const res = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-pop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as unknown as PopResponse | PopFailureResponse;

  if (res.status === 503) {
    ui.error((data as PopFailureResponse).error || 'roadmap-pop primitive unavailable on this daemon');
    process.exit(1);
  }

  if (!data.success) {
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      process.exit(res.status === 409 ? 2 : 1);
    }
    if (data.reason === 'pile-empty') {
      console.error(ui.dim('Pile empty. Nothing to pop.'));
      process.exit(1);
    }
    if (data.reason === 'slug-not-on-pile') {
      ui.error(`Slug '${data.slug}' is not on the roadmap pile.`);
      process.exit(1);
    }
    if (data.reason === 'slug-already-claimed') {
      ui.error(`Slug '${data.slug}' is already claimed by ${data.claim?.claimedBy ?? 'someone else'}.`);
      console.error(`  Release first: pd roadmap release ${data.slug}`);
      process.exit(2);
    }
    ui.error(data.error || 'pop failed');
    process.exit(1);
  }

  const popped = data as PopResponse;

  if (isJson(options)) {
    console.log(JSON.stringify(popped, null, 2));
  } else if (isQuiet(options)) {
    console.log(popped.entry.slug);
  } else {
    console.log('');
    ui.success(`Popped ${popped.entry.slug} [${popped.entry.kind}]`);
    console.log(`  Claimed by: ${popped.claim.claimedBy}`);
    console.log(`  Summary:    ${popped.entry.summary}`);
    if (popped.entry.surface) console.log(`  Surface:    ${popped.entry.surface}`);
    console.log('');
    console.log(ui.dim(`Next: pd roadmap release ${popped.entry.slug}   # when done or abandoning`));
  }

  if (options.begin) {
    const purpose = `${popped.entry.slug}: ${popped.entry.summary}`;
    const beginOptions: CLIOptions = { ...options };
    const identity = readOption(options, 'identity') ?? defaultClaimedBy(options);
    if (identity) beginOptions.identity = identity;
    try {
      await handleBegin(purpose, [], beginOptions);
    } catch (err) {
      ui.error(`pop succeeded but pd begin failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`  The claim is held. Run: pd roadmap release ${popped.entry.slug}`);
      process.exit(1);
    }

    // ADR-0034: stitch the new session/agent back onto the claim row so
    // `pd sessions` and `pd whois` can resolve in both directions.
    const ctx = readCurrentContext();
    if (ctx?.sessionId) {
      const linkRes = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-claim-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimId: popped.claim.id,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
        }),
      });
      if (!linkRes.ok && !isQuiet(options) && !isJson(options)) {
        const linkData = await linkRes.json().catch(() => ({})) as { error?: string; reason?: string };
        console.error(ui.dim(`  Warning: could not link claim to session (${linkData.reason ?? linkData.error ?? linkRes.status}). Rebind: pd roadmap claim-link ${popped.entry.slug} --session ${ctx.sessionId}`));
      }
    }
  }
}

async function handleRoadmapClaimLink(args: string[], options: CLIOptions): Promise<void> {
  const slug = args[0] || readOption(options, 'slug');
  if (!slug) {
    ui.error('Usage: pd roadmap claim-link <slug> [--session <id>] [--agent <id>] [--force]');
    process.exit(1);
  }
  const sessionId = readOption(options, 'session', 'sessionId') ?? readCurrentContext()?.sessionId;
  const agentIdInput = readOption(options, 'agent', 'agentId');
  const agentId = agentIdInput ?? readCurrentContext()?.agentId;
  const force = Boolean(options.force);
  if (!sessionId && !agentId) {
    ui.error('No session/agent to link. Pass --session or --agent, or run from a worktree with an active pd begin.');
    process.exit(1);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-claim-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, sessionId, agentId, force }),
  });
  const data = await res.json() as { success: boolean; claim?: RoadmapClaim; reason?: string; error?: string };
  if (!res.ok || !data.success) {
    ui.error(data.error || data.reason || `link failed (status ${res.status})`);
    if (data.reason === 'already-linked' && !force) {
      console.error(`  Rebind with --force: pd roadmap claim-link ${slug} --session ${sessionId} --force`);
    }
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(slug);
    return;
  }
  ui.success(`Linked ${slug}`);
  if (data.claim?.sessionId) console.log(`  Session: ${data.claim.sessionId}`);
  if (data.claim?.agentId) console.log(`  Agent:   ${data.claim.agentId}`);
}

async function handleRoadmapRelease(args: string[], options: CLIOptions): Promise<void> {
  const slug = args[0] || readOption(options, 'slug');
  if (!slug) {
    ui.error('Usage: pd roadmap release <slug> [--reason "<why>"]');
    process.exit(1);
  }
  const releasedBy = defaultClaimedBy(options);
  const reason = readOption(options, 'reason');

  const res = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, releasedBy, reason }),
  });
  const data = await res.json() as { success: boolean; released?: boolean; claim?: RoadmapClaim; error?: string };

  if (!res.ok || !data.success) {
    ui.error(data.error || `release failed (status ${res.status})`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(slug);
    return;
  }
  ui.success(`Released ${slug}`);
  if (reason) console.log(`  Reason: ${reason}`);
}

const VALID_CLAIM_STATUSES = new Set(['open', 'released', 'all']);

async function handleRoadmapClaims(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  const statusRaw = readOption(options, 'status') ?? (options.all ? 'all' : 'open');
  if (!VALID_CLAIM_STATUSES.has(statusRaw)) {
    ui.error(`Invalid --status: ${statusRaw}. Valid: open, released, all`);
    process.exit(1);
  }
  const status = statusRaw;
  params.set('status', status);
  if (options.mine) params.set('claimedBy', defaultClaimedBy(options));
  else {
    const claimedBy = readOption(options, 'as', 'claimedBy', 'agent');
    if (claimedBy) params.set('claimedBy', claimedBy);
  }
  const limit = parseLimit(options.limit, 50);
  params.set('limit', String(limit));

  const res = await pdFetch(`${PORT_DADDY_URL}/cartographer/roadmap-claims?${params.toString()}`);
  const data = await res.json() as { success: boolean; claims?: RoadmapClaim[]; error?: string };
  if (!res.ok || !data.success) {
    ui.error(data.error || `claims fetch failed (status ${res.status})`);
    process.exit(1);
  }

  const claims = data.claims ?? [];
  if (isJson(options)) {
    console.log(JSON.stringify(claims, null, 2));
    return;
  }
  if (isQuiet(options)) {
    for (const c of claims) console.log(c.slug);
    return;
  }
  console.log('');
  console.log(`ROADMAP CLAIMS (${status}) · ${claims.length} entries`);
  console.log('-'.repeat(80));
  if (claims.length === 0) {
    console.log(ui.dim('  (no claims)'));
    return;
  }
  for (const c of claims) printClaimRow(c);
  console.log('');
}

async function handleRoadmapPromote(args: string[], options: CLIOptions): Promise<void> {
  const feedbackId =
    args[0] && !args[0].startsWith('--')
      ? args[0]
      : readOption(options, 'from-feedback', 'fromFeedback', 'feedbackId', 'id');
  if (!feedbackId) {
    ui.error('Usage: pd roadmap promote <feedbackId> [--slug <s>] [--summary <md>] [--status <now|backlog|parked|merge|done>] [--as <agentId>]');
    process.exit(1);
  }
  const promotedBy =
    readOption(options, 'as', 'agent', 'promotedBy')
    || readCurrentContext()?.agentId
    || '';
  if (!promotedBy) {
    ui.error('--as <agentId> required (or run inside an active pd session)');
    process.exit(1);
  }
  const body: Record<string, unknown> = { feedbackId, promotedBy };
  const slug = readOption(options, 'slug');
  if (slug) body.slug = slug;
  const summary = readOption(options, 'summary', 'summaryMd');
  if (summary) body.summaryMd = summary;
  const status = readOption(options, 'status');
  if (status) body.status = status;
  const harbor = readOption(options, 'harbor');
  if (harbor) body.harbor = harbor;

  const res = await pdFetch('/roadmap/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success !== true) {
    ui.error((data.error as string) || `Promote failed: HTTP ${res.status}`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const item = data.roadmapItem as any;
  const feedback = data.feedback as any;
  ui.success(`Promoted feedback ${feedbackId.slice(0, 8)} → roadmap item '${item.slug}'`);
  console.log(`  status:    ${item.status}`);
  console.log(`  harbor:    ${item.harbor}`);
  console.log(`  summary:   ${item.summaryMd.slice(0, 140)}${item.summaryMd.length > 140 ? '…' : ''}`);
  console.log(`  feedback:  status=${feedback.status} harvestedIntoSlug=${feedback.harvestedIntoSlug}`);
}
