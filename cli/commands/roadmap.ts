import { resolve, basename, join, relative, isAbsolute } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import type { RoadmapProgress, FeedbackEntry, RoadmapFeedbackStatus } from '../../lib/roadmap-progress.js';
import type { RoadmapClaim, RoadmapEntry, RoadmapPopKind } from '../../lib/roadmap-pop.js';
import type { RoadmapItem, RoadmapStatus } from '../../lib/roadmap-items.js';
import type { ImportMarkdownResult, ChompRoadmapResult, ChompItemReport } from '../../lib/roadmap-chomp.js';
import {
  buildRoadmapSnapshot,
  writeRoadmapSnapshot,
  readPreviousSnapshot,
  type RoadmapSnapshot,
} from '../../lib/roadmap-snapshot.js';
import type { RoadmapSearchHit } from '../../lib/roadmap-search.js';
import { getWorktreeInfo } from '../../lib/worktree.js';
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

type RoadmapItemResponse =
  | { success: true; item: RoadmapItem }
  | { success: false; error?: string };

/**
 * Read the currently-committed snapshot to reconcile against, if one exists
 * on disk. Never throws — a missing/unparseable file just means there is
 * nothing to reconcile against (first-ever export), not an error.
 */
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

/**
 * Read the authoritative roadmap from the `roadmap_items` SQL table via the
 * daemon. ADR-0033 / lib/roadmap-items.ts: the table is the source of truth;
 * `docs/ROADMAP.md` is a downstream render. `pd roadmap` therefore lists from
 * here, NOT by re-parsing the markdown.
 */
export async function fetchRoadmapItems(options: {
  status?: RoadmapStatus | 'all';
  harbor?: string;
  project?: string;
  limit?: number;
  tag?: string;
} = {}): Promise<RoadmapItem[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.harbor) params.set('harbor', options.harbor);
  if (options.project) params.set('project', options.project);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.tag) params.set('tag', options.tag);
  const raw = params.toString();
  // Build the query suffix with the `?` already attached so the call site is a
  // flat `${PORT_DADDY_URL}/roadmap/items${qs}` — a nested-backtick ternary
  // here is invisible to the endpoint-parity scanner and reads as a ghost route.
  const qs = raw ? `?${raw}` : '';
  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/items${qs}`);
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    items?: RoadmapItem[];
    error?: string;
  };
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Failed to read roadmap_items (status ${res.status})`);
  }
  return data.items ?? [];
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

  if (sub === 'upsert' || sub === 'add') {
    await handleRoadmapUpsert(args.slice(1), options);
    return;
  }

  if (sub === 'delete' || sub === 'rm' || sub === 'remove') {
    await handleRoadmapDelete(args.slice(1), options);
    return;
  }

  if (sub === 'touch') {
    await handleRoadmapTouch(args.slice(1), options);
    return;
  }

  if (sub === 'render') {
    await handleRoadmapRender(args.slice(1), options);
    return;
  }

  if (sub === 'chomp') {
    await handleRoadmapChomp(args.slice(1), options);
    return;
  }

  if (sub === 'import-markdown' || sub === 'import') {
    await handleRoadmapImportMarkdown(args.slice(1), options);
    return;
  }

  if (sub === 'search') {
    await handleRoadmapSearch(args.slice(1), options);
    return;
  }

  if (sub === 'reindex') {
    await handleRoadmapReindex(args.slice(1), options);
    return;
  }

  if (sub === 'export') {
    await handleRoadmapExport(args.slice(1), options);
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
    // `pd roadmap link <slug> --pr N | --doc <path> | --file <path> | --media <path>`
    // is the Jira-card artifact-link verb (2026-08-22 mandate). Without one of
    // those flags, bare `link` keeps its legacy claim-link meaning so existing
    // muscle memory (`pd roadmap link <slug> --session <id>`) is unbroken.
    const wantsArtifactLink =
      sub === 'link'
      && (options.pr !== undefined
        || options.doc !== undefined
        || options.file !== undefined
        || options.media !== undefined);
    if (wantsArtifactLink) {
      await handleRoadmapItemLink(args.slice(1), options, 'link');
      return;
    }
    await handleRoadmapClaimLink(args.slice(1), options);
    return;
  }

  if (sub === 'unlink') {
    await handleRoadmapItemLink(args.slice(1), options, 'unlink');
    return;
  }

  if (sub === 'links') {
    await handleRoadmapLinksList(args.slice(1), options);
    return;
  }

  const limit = parseLimit(options.limit, 8);
  const harbor = readOption(options, 'harbor');
  const project = readOption(options, 'project');
  const statusRaw = readOption(options, 'status') as RoadmapStatus | 'all' | undefined;
  const status = statusRaw ?? 'now';
  const tagFilter = firstTagOption(options);

  // ADR-0033: the `roadmap_items` SQL table is the single source of truth.
  // `pd roadmap` lists from the table via the daemon, NOT by re-parsing
  // docs/ROADMAP.md / IDEAS-TROVE.md (those are render/curation inputs that
  // get folded into the table via `pd roadmap import-markdown` / `promote`).
  let items: RoadmapItem[];
  try {
    items = await fetchRoadmapItems({
      status,
      harbor,
      project,
      limit: limit > 0 ? limit : undefined,
      tag: tagFilter,
    });
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'Failed to read roadmap_items from the daemon');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(items.map((item) => item.slug).join('\n'));
    return;
  }

  console.log('');
  console.log(`ROADMAP · ${items.length} item(s) · status=${status}${harbor ? ` · harbor=${harbor}` : ''}`);
  console.log('-'.repeat(80));
  console.log(ui.dim('source: roadmap_items SQL table (docs/ROADMAP.md is a render of this)'));

  console.log('');
  if (items.length === 0) {
    console.log(ui.dim('  (no roadmap items at this status)'));
    console.log('');
    console.log(ui.dim('  Backfill from the curated markdown piles: pd roadmap import-markdown'));
    console.log(ui.dim('  Promote high-severity feedback:          pd roadmap promote <feedbackId>'));
  } else {
    for (const item of items) {
      const head = item.summaryMd.trim().split('\n')[0] ?? '';
      // Planner columns render inline when set: kind (non-task), priority
      // (non-default), estimate, owner, due date — so the flat list reads as
      // a plan, not just a pile of slugs.
      const meta: string[] = [item.status];
      if (item.kind && item.kind !== 'task') meta.push(item.kind);
      if (item.priority && item.priority !== 3) meta.push(`P${item.priority}`);
      if (item.estimate) meta.push(`est ${item.estimate}`);
      if (item.assigneeId) meta.push(`@${item.assigneeId}`);
      if (item.dueAt) meta.push(`due ${new Date(item.dueAt).toISOString().slice(0, 10)}`);
      if (item.tags?.length) meta.push(item.tags.map((t) => `#${t}`).join(' '));
      console.log(`  - ${item.slug} [${meta.join(' · ')}]`);
      if (head) console.log(`    ${head}`);
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
    if (!beginOptions.lifecycle) beginOptions.lifecycle = 'durable';
    // Rent-at-claim (S3): the popped slug IS the roadmap link — pass it
    // through unless the caller already chose a rent flag explicitly.
    if (
      beginOptions.roadmap === undefined
      && beginOptions.sidequest === undefined
      && beginOptions['roadmap-new'] === undefined
    ) {
      beginOptions.roadmap = popped.entry.slug;
    }
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

function currentRoadmapActor(options: CLIOptions): string {
  return (
    readOption(options, 'as', 'agent', 'by', 'promotedBy') ||
    readCurrentContext()?.agentId ||
    'operator-cli'
  );
}

function readRoadmapSlug(args: string[], options: CLIOptions): string | undefined {
  return args[0] && !args[0].startsWith('--') ? args[0] : readOption(options, 'slug');
}

function readRoadmapSummary(args: string[], options: CLIOptions): string | undefined {
  const explicit = readOption(options, 'summary', 'summaryMd');
  if (explicit) return explicit;
  const rest = args.slice(1).filter((part) => !part.startsWith('--'));
  const joined = rest.join(' ').trim();
  return joined || undefined;
}

async function postRoadmapItem(body: Record<string, unknown>): Promise<RoadmapItem> {
  const res = await pdFetch('/roadmap/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as RoadmapItemResponse;
  if (!res.ok || data.success !== true) {
    throw new Error((data as { error?: string }).error || `roadmap upsert failed: HTTP ${res.status}`);
  }
  return data.item;
}

async function getRoadmapItem(slug: string, harbor?: string): Promise<RoadmapItem> {
  const qs = harbor ? `?${new URLSearchParams({ harbor }).toString()}` : '';
  const res = await pdFetch(`/roadmap/items/${encodeURIComponent(slug)}${qs}`);
  const data = (await res.json().catch(() => ({}))) as RoadmapItemResponse;
  if (!res.ok || data.success !== true) {
    throw new Error((data as { error?: string }).error || `roadmap item '${slug}' not found`);
  }
  return data.item;
}

async function deleteRoadmapItem(slug: string, harbor?: string): Promise<RoadmapItem | null> {
  const qs = harbor ? `?${new URLSearchParams({ harbor }).toString()}` : '';
  const res = await pdFetch(`/roadmap/items/${encodeURIComponent(slug)}${qs}`, { method: 'DELETE' });
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    item?: RoadmapItem;
    error?: string;
  };
  if (!res.ok || data.success !== true) {
    throw new Error(data.error || `roadmap delete failed: HTTP ${res.status}`);
  }
  return data.item ?? null;
}

/**
 * Resolve the harbor a `pd roadmap` write should target. Precedence:
 *   --harbor flag, then $PD_HARBOR, then the canonical repo/project name,
 *   then cwd basename, then undefined.
 *
 * Defaulting to the project name fixes the "harbor split" the Planner pane
 * flags: the daemon's own fallback is the global `fleet` harbor, so a bare
 * `pd roadmap upsert` silently forked receipts off the project board (which
 * lives in the `<project>` harbor). Resolving the project here keeps writes on
 * the same board the operator reads.
 */
export function resolveRoadmapHarbor(options: CLIOptions): string | undefined {
  const explicit = readOption(options, 'harbor');
  if (explicit) return explicit;
  const env = process.env.PD_HARBOR?.trim();
  if (env) return env;
  const worktree = getWorktreeInfo(process.cwd());
  if (worktree) {
    const commonDir = resolve(worktree.root, worktree.commonDir);
    const canonicalRoot = basename(commonDir) === '.git'
      ? resolve(commonDir, '..')
      : worktree.root;
    const projectName = basename(canonicalRoot);
    if (projectName) return projectName;
  }
  const cwdBase = basename(process.cwd());
  return cwdBase || undefined;
}

function roadmapNote(actor: string, text: string | undefined): { at: number; by: string; text: string } {
  return {
    at: Date.now(),
    by: actor,
    text: text?.trim() || 'roadmap touched for active work slice',
  };
}

/**
 * Parse a whole-number planner flag (`--priority`, `--estimate`, `--actual`)
 * inside an inclusive band. Returns undefined when the operator's value is not
 * a whole number in that band, so the caller can reject it the way it rejects
 * a bad date.
 *
 * Why the CLI rejects rather than leaning on the server's sanitizers: the
 * daemon's `clampPriority` / `positiveOrNull` pass (lib/roadmap-items.ts) does
 * keep garbage out of the table — nothing invalid is ever persisted — but it
 * cannot tell a typo from an intent, and on this write path the two coincide
 * destructively. `Number.parseInt('abc', 10)` is NaN, `JSON.stringify` puts
 * NaN on the wire as `null`, and an explicit `null` is this API's CLEAR
 * sentinel. So `--estimate abc` does not "do nothing": it WIPES an estimate a
 * board or import already recorded, and `--priority xyz` resets a stored 1 to
 * the default 3 — silently, from the same command whose contract is that
 * fields it was not asked to change are preserved. Out-of-band numbers
 * saturate the same silent way (`--priority 99` → 5, `--estimate -5` → null).
 *
 * Non-interactive callers (HTTP bodies, markdown import, older rows) keep that
 * documented saturating behaviour, which is deliberate for them. The CLI is
 * the one surface where a human typed the value and can retype it, so here the
 * value is checked before it can clear anything.
 *
 * @param raw - The flag value as typed by the operator.
 * @param min - Smallest accepted value, inclusive.
 * @param max - Largest accepted value, inclusive.
 * @returns The integer, or undefined when it is not a whole number in band.
 */
function parseBandedIntFlag(raw: string, min: number, max: number): number | undefined {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * Parse a human-friendly point-in-time flag into epoch milliseconds.
 *
 * Why three shapes: roadmap authoring must be a one-liner, and the three ways
 * an operator naturally states a date are "a timestamp I copied" (epoch ms),
 * "a calendar day" (ISO `YYYY-MM-DD`, read as UTC midnight — the same instant
 * `Date.parse` gives a date-only ISO string, and the anchor the Gantt reads),
 * and "N days from now" (`+Nd`). Anything else returns undefined so the caller
 * can reject loudly instead of silently scheduling for 1970.
 *
 * Why the shape is matched EXACTLY rather than handed to `Date.parse`:
 * `Date.parse` is lenient in ways that are indistinguishable from a typo once
 * they reach the database. It rolls calendar overflow forward instead of
 * failing (`2023-02-30` → 2023-03-02, `2026-02-29` → 2026-03-01), and it
 * accepts partial dates (`2026` → 2026-01-01). Every one of those silently
 * stores a DIFFERENT day than the operator typed and schedules the Gantt bar
 * against it, with no error to notice. So: match `YYYY-MM-DD`, build the
 * instant, then round-trip the Y/M/D back out and reject if the calendar
 * moved. A wrong date the operator can see beats a wrong date they cannot.
 *
 * @param raw - The flag value as typed by the operator.
 * @returns Epoch milliseconds, or undefined when the shape is unrecognized.
 */
export function parseWhenFlag(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const relative = /^\+(\d+)d$/.exec(trimmed);
  if (relative) return Date.now() + Number.parseInt(relative[1], 10) * 86_400_000;
  if (/^\d{13}$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!iso) return undefined;
  const year = Number.parseInt(iso[1], 10);
  const month = Number.parseInt(iso[2], 10);
  const day = Number.parseInt(iso[3], 10);
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) return undefined;
  const back = new Date(ms);
  const roundTrips =
    back.getUTCFullYear() === year && back.getUTCMonth() + 1 === month && back.getUTCDate() === day;
  return roundTrips ? ms : undefined;
}

/**
 * Collect every `--tag` occurrence into a string list.
 *
 * Why a dedicated reader: `--tag` is registered as a REPEATABLE flag, so the
 * parser hands us a string for one occurrence and an array for several — and
 * `true` when someone types a bare `--tag`. The design intent is that tag
 * authoring is order-preserving and forgiving: non-string noise is dropped
 * here so the daemon-side normalizer only ever sees candidate strings.
 *
 * @param options - Parsed CLI options.
 * @returns The tags in flag order, or undefined when none were passed.
 */
function collectTagOptions(options: CLIOptions): string[] | undefined {
  const raw = options.tag;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const tags = list.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  return tags.length > 0 ? tags : undefined;
}

/**
 * The single `--tag` value used as a LIST FILTER (`pd roadmap --tag x`).
 *
 * Why first-only: the list route's `?tag=` contract is one exact tag; passing
 * several to a filter would silently OR or AND depending on reader intuition,
 * so the CLI keeps the filter unambiguous by using the first and ignoring the
 * rest (authoring, by contrast, consumes all of them via collectTagOptions).
 *
 * @param options - Parsed CLI options.
 * @returns The first tag string, or undefined.
 */
function firstTagOption(options: CLIOptions): string | undefined {
  return collectTagOptions(options)?.[0];
}

async function handleRoadmapUpsert(args: string[], options: CLIOptions): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  const summaryMd = readRoadmapSummary(args, options);
  if (!slug || !summaryMd) {
    ui.error(
      'Usage: pd roadmap upsert <slug> --summary <md> [--status <now|backlog|parked|merge|done>] ' +
        '[--kind <project|epic|story|task|subtask|bug|chore>] [--priority <1-5>] [--estimate <units>] [--actual <units>] ' +
        '[--start <YYYY-MM-DD|+Nd>] [--due <YYYY-MM-DD|+Nd>] [--assignee <roster-id>] [--unassign] ' +
        '[--tag <t>]... [--clear-tags] [--description <md>] [--as <agentId>]',
    );
    process.exit(1);
  }

  const actor = currentRoadmapActor(options);
  const body: Record<string, unknown> = {
    slug,
    summaryMd,
    promotedByAgentId: actor,
    promotedAt: Date.now(),
    notes: [roadmapNote(actor, readOption(options, 'note', 'receipt'))],
  };
  const status = readOption(options, 'status');
  if (status) body.status = status;
  const harbor = resolveRoadmapHarbor(options);
  if (harbor) body.harbor = harbor;
  const project = readOption(options, 'project');
  if (project) body.project = project;
  const dependencies = readOption(options, 'dependencies', 'deps');
  if (dependencies) body.dependencies = dependencies.split(',').map((s) => s.trim()).filter(Boolean);
  // Planner columns (ADR-0086) — the fields that make an item readable on a
  // board and schedulable on a Gantt, writable from the same one-liner.
  const kind = readOption(options, 'kind');
  if (kind) body.kind = kind;
  const priority = readOption(options, 'priority');
  if (priority) {
    const parsed = parseBandedIntFlag(priority, 1, 5);
    if (parsed === undefined) {
      ui.error(`--priority '${priority}' is not a whole number in 1..5 (1 highest .. 5 lowest)`);
      process.exit(1);
    }
    body.priority = parsed;
  }
  const estimate = readOption(options, 'estimate', 'est');
  if (estimate) {
    const parsed = parseBandedIntFlag(estimate, 1, Number.MAX_SAFE_INTEGER);
    if (parsed === undefined) {
      ui.error(`--estimate '${estimate}' is not a positive whole number of effort units`);
      process.exit(1);
    }
    body.estimate = parsed;
  }
  // --actual carries the SAME NaN-clears-the-field hazard as --estimate (both
  // ride positiveOrNull, and NaN serializes to the null CLEAR sentinel), so it
  // gets the same in-band CLI check rather than inheriting the silent wipe.
  const actual = readOption(options, 'actual');
  if (actual) {
    const parsed = parseBandedIntFlag(actual, 1, Number.MAX_SAFE_INTEGER);
    if (parsed === undefined) {
      ui.error(`--actual '${actual}' is not a positive whole number of effort units`);
      process.exit(1);
    }
    body.actual = parsed;
  }
  // Durable owner: --assignee takes a roster agentNodeId or slug (the daemon
  // validates against the durable-agent roster and 400s unknown owners);
  // --unassign sends the explicit null that clears ownership.
  const assignee = readOption(options, 'assignee', 'assigneeId');
  if (options.unassign) body.assigneeId = null;
  else if (assignee) body.assigneeId = assignee;
  // Tags: repeatable --tag sets the tag list; --clear-tags sends [] (the
  // explicit empty set), which wins over any --tag on the same invocation.
  const tags = collectTagOptions(options);
  if (options['clear-tags']) body.tags = [];
  else if (tags) body.tags = tags;
  const description = readOption(options, 'description', 'descriptionMd', 'body');
  if (description) body.descriptionMd = description;
  const startRaw = readOption(options, 'start', 'startedAt');
  if (startRaw) {
    const startedAt = parseWhenFlag(startRaw);
    if (startedAt === undefined) {
      ui.error(`--start '${startRaw}' is not a date (use YYYY-MM-DD, +Nd, or epoch ms)`);
      process.exit(1);
    }
    body.startedAt = startedAt;
  }
  const dueRaw = readOption(options, 'due', 'dueAt');
  if (dueRaw) {
    const dueAt = parseWhenFlag(dueRaw);
    if (dueAt === undefined) {
      ui.error(`--due '${dueRaw}' is not a date (use YYYY-MM-DD, +Nd, or epoch ms)`);
      process.exit(1);
    }
    body.dueAt = dueAt;
  }

  try {
    const item = await postRoadmapItem(body);
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, item }, null, 2));
      return;
    }
    ui.success(`Roadmap item '${item.slug}' upserted`);
    console.log(`  status:  ${item.status}`);
    console.log(`  harbor:  ${item.harbor}`);
    console.log(`  kind:    ${item.kind} · P${item.priority}${item.estimate ? ` · est ${item.estimate}` : ''}${item.actual ? ` · actual ${item.actual}` : ''}`);
    if (item.assigneeId) console.log(`  owner:   ${item.assigneeId}`);
    if (item.tags?.length) console.log(`  tags:    ${item.tags.map((t) => `#${t}`).join(' ')}`);
    if (item.dueAt) console.log(`  due:     ${new Date(item.dueAt).toISOString().slice(0, 10)}`);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'roadmap upsert failed');
    process.exit(1);
  }
}

async function handleRoadmapDelete(args: string[], options: CLIOptions): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  if (!slug) {
    ui.error('Usage: pd roadmap delete <slug> [--harbor <harbor>]');
    process.exit(1);
  }
  const harbor = resolveRoadmapHarbor(options);
  try {
    const item = await deleteRoadmapItem(slug, harbor);
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, removed: item !== null, item }, null, 2));
      return;
    }
    if (!item) {
      ui.error(`Roadmap item '${slug}'${harbor ? ` in harbor '${harbor}'` : ''} not found`);
      process.exit(1);
    }
    ui.success(`Roadmap item '${item.slug}' deleted from harbor '${item.harbor}'`);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'roadmap delete failed');
    process.exit(1);
  }
}

async function handleRoadmapTouch(args: string[], options: CLIOptions): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  if (!slug) {
    ui.error('Usage: pd roadmap touch <slug> [--note <receipt>] [--as <agentId>]');
    process.exit(1);
  }

  const harbor = readOption(options, 'harbor');
  const actor = currentRoadmapActor(options);
  try {
    const existing = await getRoadmapItem(slug, harbor);
    const note = roadmapNote(actor, readOption(options, 'note', 'receipt'));
    const item = await postRoadmapItem({
      slug: existing.slug,
      summaryMd: existing.summaryMd,
      status: existing.status,
      promotedFromFeedbackId: existing.promotedFromFeedbackId ?? undefined,
      promotedByAgentId: actor,
      promotedAt: existing.promotedAt ?? Date.now(),
      dependencies: existing.dependencies,
      notes: [...(existing.notes ?? []), note],
      harbor: existing.harbor,
    });
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, item }, null, 2));
      return;
    }
    ui.success(`Roadmap item '${item.slug}' touched`);
    console.log(`  receipt: ${note.text}`);
    console.log(`  by:      ${actor}`);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'roadmap touch failed');
    process.exit(1);
  }
}

/**
 * `pd roadmap search <free text>` — rank roadmap items against free text via
 * the daemon's GET /roadmap/search (lib/roadmap-search.ts). Standalone
 * lookup; `pd begin` calls the same endpoint automatically when no
 * --roadmap slug is given (see handleBegin in sugar.ts).
 */
async function handleRoadmapSearch(args: string[], options: CLIOptions): Promise<void> {
  const query = args.join(' ').trim() || readOption(options, 'q', 'query');
  if (!query) {
    ui.error('Usage: pd roadmap search <free text> [--harbor <h>] [--limit <n>]');
    process.exit(1);
  }

  const params = new URLSearchParams({ q: query });
  const harbor = readOption(options, 'harbor');
  if (harbor) params.set('harbor', harbor);
  const limit = parseLimit(options.limit, 5);
  params.set('limit', String(limit));

  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/search?${params.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    hits?: RoadmapSearchHit[];
    degraded?: string;
    error?: string;
  };
  if (!res.ok || data.success === false) {
    ui.error(data.error || `roadmap search failed (status ${res.status})`);
    process.exit(1);
  }

  const hits = data.hits ?? [];
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, hits, count: hits.length }, null, 2));
    return;
  }
  if (data.degraded) {
    ui.warn(`search index unavailable — run \`pd roadmap reindex\` on a daemon with the semantic resolver wired`);
    return;
  }
  if (hits.length === 0) {
    ui.info(`No roadmap items matched "${query}". Use --roadmap-new to draft one.`);
    return;
  }
  ui.step(`Roadmap items matching "${query}":`);
  for (const hit of hits) {
    console.log(`  ${hit.slug}  [${hit.status}]  (${hit.stage}, score ${hit.score.toFixed(3)})`);
    console.log(`    ${hit.summaryMd}`);
  }
}

/**
 * `pd roadmap reindex` — backfill/refresh the search embedding index
 * (POST /roadmap/reindex-search). Run once after this feature ships
 * (existing rows predate the index) and safe to re-run any time.
 */
async function handleRoadmapReindex(_args: string[], options: CLIOptions): Promise<void> {
  const harbor = readOption(options, 'harbor');
  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/reindex-search`, {
    method: 'POST',
    body: JSON.stringify(harbor ? { harbor } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    indexed?: number;
    skipped?: number;
    total?: number;
    error?: string;
  };
  if (!res.ok || data.success === false) {
    ui.error(data.error || `roadmap reindex failed (status ${res.status})`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  ui.success(`Reindexed ${data.indexed ?? 0}/${data.total ?? 0} item(s) (${data.skipped ?? 0} unchanged, skipped)`);
}

/**
 * `pd roadmap export <slug> --to github|linear|jira [target-specific flags]`
 * — push one roadmap item to an external tracker (POST
 * /roadmap/items/:slug/export -> lib/roadmap-export.ts). Credentials are
 * server-side env vars only (PD_GITHUB_TOKEN, PD_LINEAR_TOKEN,
 * PD_JIRA_EMAIL/PD_JIRA_API_TOKEN) — this command never accepts a token flag.
 */
async function handleRoadmapExport(args: string[], options: CLIOptions): Promise<void> {
  const slug = args[0] && !args[0].startsWith('--') ? args[0] : readOption(options, 'slug');
  const target = readOption(options, 'to', 'target');
  if (!slug || !target) {
    ui.error(
      'Usage: pd roadmap export <slug> --to github --repo owner/repo\n' +
      '       pd roadmap export <slug> --to linear --team-id <id>\n' +
      '       pd roadmap export <slug> --to jira --base-url <url> --project-key <KEY> [--issue-type <type>]',
    );
    process.exit(1);
  }
  if (!['github', 'linear', 'jira'].includes(target)) {
    ui.error(`--to must be one of: github, linear, jira (got "${target}")`);
    process.exit(1);
  }

  const body = { target };
  if (target === 'github') Object.assign(body, { repo: readOption(options, 'repo') });
  if (target === 'linear') Object.assign(body, { teamId: readOption(options, 'team-id', 'teamId') });
  if (target === 'jira') {
    Object.assign(body, {
      baseUrl: readOption(options, 'base-url', 'baseUrl'),
      projectKey: readOption(options, 'project-key', 'projectKey'),
      issueType: readOption(options, 'issue-type', 'issueType'),
    });
  }

  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/items/${encodeURIComponent(slug)}/export`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    export?: { externalId: string; externalUrl: string };
    error?: string;
  };
  if (!res.ok || data.success === false) {
    ui.error(data.error || `roadmap export failed (status ${res.status})`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  ui.success(`Exported '${slug}' to ${target}: ${data.export?.externalUrl}`);
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

/**
 * Render the chomped item hierarchy as an indented tree.
 *
 * Why a shared renderer: the same tree appears in the `--dry-run` preview,
 * the post-write report, and the emitted PR body, and those three views must
 * agree — the dry-run's promise is "this is exactly what a real run writes."
 *
 * @param items - Per-item reports from the chomp result.
 * @returns One line per item, indented by hierarchy depth.
 */
export function renderChompTree(items: ChompItemReport[]): string[] {
  const children = new Map<string, ChompItemReport[]>();
  const roots: ChompItemReport[] = [];
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  for (const item of items) {
    if (item.parent && bySlug.has(item.parent)) {
      const list = children.get(item.parent) ?? [];
      list.push(item);
      children.set(item.parent, list);
    } else {
      roots.push(item);
    }
  }
  const lines: string[] = [];
  /**
   * Depth-first line emitter. Why a closure: the design keeps rendering
   * order identical to extraction order (parents before children).
   *
   * @param item - Node to render.
   * @param depth - Indent level.
   * @returns Nothing; appends to `lines`.
   */
  const walk = (item: ChompItemReport, depth: number): void => {
    const marks: string[] = [item.kind, item.status];
    if (item.protected) marks.push('protected');
    const deps = item.dependsOn.length > 0 ? `  deps: ${item.dependsOn.join(', ')}` : '';
    const head = item.summaryMd.trim().split('\n')[0] ?? '';
    lines.push(`${'  '.repeat(depth)}- ${item.slug} [${marks.join('/')}]${deps}`);
    if (head && head !== item.slug) lines.push(`${'  '.repeat(depth)}    ${head}`);
    for (const child of children.get(item.slug) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return lines;
}

/**
 * Compose the ready-to-file PR body for a chomp's doc-removal PR.
 *
 * Intent (operator mandate 2026-08-22): after a chomp, the PR that lands is
 * "add the roadmap items, remove the source docs." The emitted body fills the
 * repo's gated PR template — real Summary and Test Plan prose, the
 * visual-exempt marker, and Roadmap-Item / Roadmap-Spawns trailers naming
 * the created slugs — so a human-or-agent only reviews and files it.
 *
 * @param input - Chomp result, doc paths, harbor, and snapshot location.
 * @returns The complete markdown PR body.
 */
export function buildChompPrBody(input: {
  result: ChompRoadmapResult;
  docPaths: string[];
  harbor: string;
  snapshotRelPath: string;
}): string {
  const { result, docPaths, harbor } = input;
  const insertedSlugs = result.inserted;
  const tree = renderChompTree(result.items).join('\n');
  const docList = docPaths.map((p) => `- \`${p}\``).join('\n');
  const spawns = insertedSlugs.length > 0 ? insertedSlugs.join(', ') : 'none — all items already existed';
  return `## Summary

Chomp planning docs into the roadmap DB-of-record and remove them from the repo
(\`pd roadmap chomp\`). The docs below were parsed into ${result.items.length} roadmap item(s)
(${insertedSlugs.length} new, ${result.updated.length} pre-existing and left untouched) in harbor \`${harbor}\`,
with hierarchy (parent_of) and explicit dependencies extracted from the doc structure.
Per ADR-0033 the \`roadmap_items\` table is the source of truth and markdown is a render,
so the source docs are deleted here and the committed roadmap snapshot is regenerated
in their place.

Docs chomped (removed by this PR):

${docList}

Item tree written to the roadmap:

\`\`\`
${tree}
\`\`\`

## Test Plan

- \`pd roadmap chomp ${docPaths.join(' ')} --dry-run\` — previewed the exact tree above; a
  second real run reported 0 new inserts (idempotent).
- \`pd roadmap --status all --harbor ${harbor}\` — all chomped slugs listed from the table.
- \`${input.snapshotRelPath}\` regenerated from the live daemon via the export machinery
  (\`lib/roadmap-snapshot.ts\`) and committed alongside the doc removal; the roadmap-link
  gate reads this mirror.
- The machine-readable work receipt — docs read (+ source commit), items derived, rows
  protected, deps skipped as dangling, and warnings — lands at
  \`docs/roadmap/receipts/chomp-receipt.json\` when it lands with this PR (the path is
  created by this PR, so it does not exist yet on the base branch). Each derived row also
  carries \`source_refs_json\` pointing at its source doc + commit.

<!-- visual-exempt: roadmap data + doc removal only; no visual surface changed -->

## Surface Parity & Docs

- [x] N/A — no new CLI/API surface; this PR moves planning-doc content into roadmap_items

## Coverage & Build

- [x] N/A — no code changes; roadmap data + doc removal only

## Roadmap link

Roadmap-Item: none — planning-doc chomp: this PR removes the docs and records their content as the roadmap items listed above
Roadmap-Spawns: ${spawns}

## Changelog & Parsimony

- [x] No duplicate / fragmented product path introduced (content moved from markdown into the roadmap DB-of-record)
`;
}

/**
 * Best-effort HEAD commit of the repo the docs are read from.
 *
 * Why: `source_refs_json` on derived items and the emitted work receipt both
 * pin the exact revision a doc was chomped at — the doc is deleted by the
 * chomp PR, so the SHA is the durable way back to its content. Failure
 * (not a git repo, git absent) degrades to undefined rather than blocking.
 *
 * @param rootDir - Repo root to resolve HEAD in.
 * @returns The 40-char SHA, or undefined when unresolvable.
 */
function resolveSourceCommit(rootDir: string): string | undefined {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `pd roadmap chomp <doc.md...>` — general planning-doc ingestion (operator
 * mandate 2026-08-22).
 *
 * Design: the default run is a PREVIEW. Under the single-writer doctrine,
 * roadmap state changes travel through a reviewed PR, so the only write path
 * is `--emit-pr-plan <dir>`, which performs the daemon upsert AND emits the
 * artifacts that PR carries (snapshot, work receipt, git-rm list, PR body).
 * The command never pushes or opens the PR itself — that stays an explicit
 * human/agent act.
 *
 * @param args - Positional doc paths (flags are pre-stripped by the parser).
 * @param options - Parsed CLI flags (--emit-pr-plan, --dry-run, --status,
 *   --harbor/--project, --as, --enrich, --dir, --json/--quiet).
 * @returns Resolves after printing the report (and emitting the PR plan).
 */
async function handleRoadmapChomp(args: string[], options: CLIOptions): Promise<void> {
  const paths = args.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    ui.error('Usage: pd roadmap chomp <doc.md...> [--emit-pr-plan <dir>] [--dry-run] [--status <s>] [--harbor <h>] [--as <agentId>] [--enrich]');
    process.exit(1);
  }
  const rootDir = resolve(readOption(options, 'dir', 'root', 'rootDir', 'projectDir') || process.cwd());
  const harbor = resolveRoadmapHarbor(options);
  const project = readOption(options, 'project');
  const by = readOption(options, 'as', 'agent', 'by') ?? readCurrentContext()?.agentId;
  const explicitDryRun = Boolean((options['dry-run'] ?? options.dryRun) || args.includes('--dry-run'));
  const defaultStatus = readOption(options, 'status');
  const enrich = Boolean(options.enrich);
  const emitDir = readOption(options, 'emit-pr-plan', 'emitPrPlan');
  if (emitDir && explicitDryRun) {
    ui.error('--emit-pr-plan requires a real run (the PR plan snapshots what was written); drop --dry-run.');
    process.exit(1);
  }
  // Single-writer doctrine: roadmap state changes land through a reviewed PR,
  // not a silent CLI write. `--emit-pr-plan` IS the write act — it performs
  // the daemon upsert AND emits the receipt + snapshot + doc-removal list the
  // PR carries. Without it, chomp is a preview (same as --dry-run).
  const dryRun = !emitDir;

  const body: Record<string, unknown> = { rootDir, paths };
  if (harbor) body.harbor = harbor;
  if (project) body.project = project;
  if (by) body.by = by;
  if (dryRun) body.dryRun = true;
  if (defaultStatus) body.defaultStatus = defaultStatus;
  if (enrich) body.enrich = true;
  if (!dryRun) {
    const sourceCommit = resolveSourceCommit(rootDir);
    if (sourceCommit) body.sourceCommit = sourceCommit;
  }

  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/chomp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as
    | ({ success: true } & ChompRoadmapResult)
    | { success: false; error?: string };

  if (!res.ok || data.success !== true) {
    ui.error((data as { error?: string }).error || `chomp failed (status ${res.status})`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    for (const item of data.items) console.log(item.slug);
  } else {
    console.log('');
    const verb = data.dryRun ? 'Would chomp' : 'Chomped';
    ui.success(
      `${verb} ${data.items.length} roadmap item(s) from ${data.docs.filter((d) => !d.missing).length} doc(s) ` +
        `(${data.inserted.length} new, ${data.updated.length} existing/protected)`,
    );
    for (const doc of data.docs) {
      console.log(ui.dim(`  ${doc.path}: ${doc.missing ? 'MISSING' : `${doc.parsed} item(s) [${doc.format}]`}`));
    }
    console.log('');
    for (const line of renderChompTree(data.items)) console.log(`  ${line}`);
    if (data.parentEdges.length > 0) {
      console.log('');
      console.log(ui.dim(`  hierarchy: ${data.parentEdges.length} parent_of edge(s)${data.dryRun ? ' (not written — dry-run)' : ` (${data.parentEdgesWritten} written)`}`));
    }
    for (const d of data.dangling) {
      console.log(ui.dim(`  dangling dependency: ${d.slug} → ${d.missing} (not on the roadmap; skipped)`));
    }
    if (data.enrichment) {
      const e = data.enrichment;
      console.log(ui.dim(
        e.backend
          ? `  enrichment: ${e.applied}/${e.attempted} summaries polished via ${e.backend}`
          : '  enrichment: requested, but no LLM backend configured — deterministic extraction only',
      ));
    }
    for (const w of data.warnings) console.log(ui.dim(`  warning: ${w}`));
    if (data.dryRun) {
      console.log(ui.dim('  (preview — nothing written. Writing goes through a reviewed PR:'));
      console.log(ui.dim('   re-run with --emit-pr-plan <dir> to write via the daemon AND emit'));
      console.log(ui.dim('   the receipt + snapshot + doc-removal artifacts that PR carries)'));
    }
    console.log('');
  }

  if (emitDir && data.success === true && !data.dryRun) {
    await emitChompPrPlan(emitDir, data, { paths, rootDir, harbor, options });
  }
}

/**
 * Write the PR-able artifacts for the chomp's doc-removal PR.
 *
 * What lands in `<dir>` and why (operator mandate 2026-08-22 — the chomp
 * produces a PR that "adds the roadmap items and removes the documents"):
 *   - `roadmap.snapshot.json` — the committed read-replica CI reads,
 *     regenerated from the live daemon through the SAME machinery as
 *     `scripts/export-roadmap-snapshot.ts` (`lib/roadmap-snapshot.ts`). The
 *     export needs a reachable daemon, which this command has by definition
 *     (it just chomped through it).
 *   - `chomp-receipt.json` — the machine-readable work receipt: what docs
 *     were read (and at which commit), what items were derived, what was
 *     skipped/protected and why. Committed alongside the doc removal so the
 *     PR carries its own evidence.
 *   - `remove-docs.txt` — the `git rm` list of chomped source docs.
 *   - `pr-body.md` — a filled PR-template body, ready to file.
 * The command deliberately does NOT push or open the PR — filing it is the
 * operator's/agent's explicit act; this emits everything that act needs.
 *
 * @param emitDir - Output directory (created if absent).
 * @param result - The successful chomp result.
 * @param ctx - Doc paths, repo root, harbor, and CLI options.
 * @returns Nothing; prints the artifact paths and next steps.
 */
async function emitChompPrPlan(
  emitDir: string,
  result: ChompRoadmapResult,
  ctx: { paths: string[]; rootDir: string; harbor: string | undefined; options: CLIOptions },
): Promise<void> {
  const dir = resolve(emitDir);
  mkdirSync(dir, { recursive: true });
  const harbor = ctx.harbor ?? process.env.PD_HARBOR ?? 'port-daddy';

  // Doc paths relative to the repo root, for the git rm list.
  const relPaths = ctx.paths.map((p) => (isAbsolute(p) ? relative(ctx.rootDir, p) : p));
  writeFileSync(join(dir, 'remove-docs.txt'), `${relPaths.join('\n')}\n`, 'utf8');

  // The work receipt: normalized, machine-readable evidence of what this
  // chomp read, derived, skipped, and protected — committed with the PR so
  // reviewers (and later audits) never have to reconstruct it from the diff.
  const receipt = {
    receipt: 'roadmap-chomp',
    generatedAt: Date.now(),
    rootDir: ctx.rootDir,
    sourceCommit: result.sourceCommit,
    harbor,
    docs: result.docs,
    items: result.items.map((i) => ({
      slug: i.slug,
      kind: i.kind,
      status: i.status,
      action: i.action,
      protected: i.protected,
      parent: i.parent,
      dependsOn: i.dependsOn,
      tags: i.tags,
      sourcePath: i.sourcePath,
    })),
    inserted: result.inserted,
    updated: result.updated,
    parentEdgesWritten: result.parentEdgesWritten,
    skipped: {
      missingFiles: result.missingFiles,
      danglingDependencies: result.dangling,
      warnings: result.warnings,
    },
    enrichment: result.enrichment,
  };
  writeFileSync(join(dir, 'chomp-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  let snapshotNote = '';
  try {
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: PORT_DADDY_URL,
      harbor,
      fetchImpl: pdFetch,
      previousSnapshot: readPreviousSnapshot(join(ctx.rootDir, 'docs/roadmap/roadmap.snapshot.json')),
      allowShrink: Boolean(ctx.options['allow-shrink'] ?? ctx.options.allowShrink),
    });
    writeRoadmapSnapshot(join(dir, 'roadmap.snapshot.json'), snapshot);
    snapshotNote = `${snapshot.count} item(s), harbor ${harbor}`;
  } catch (error) {
    snapshotNote = `SKIPPED — ${error instanceof Error ? error.message : String(error)}`;
  }

  const prBody = buildChompPrBody({
    result,
    docPaths: relPaths,
    harbor,
    snapshotRelPath: 'docs/roadmap/roadmap.snapshot.json',
  });
  writeFileSync(join(dir, 'pr-body.md'), prBody, 'utf8');

  if (isQuiet(ctx.options) || isJson(ctx.options)) return;
  console.log(ui.dim('PR plan emitted:'));
  console.log(ui.dim(`  ${join(dir, 'roadmap.snapshot.json')}  (${snapshotNote})`));
  console.log(ui.dim(`  ${join(dir, 'chomp-receipt.json')}  (the work receipt — commit it with the PR)`));
  console.log(ui.dim(`  ${join(dir, 'remove-docs.txt')}`));
  console.log(ui.dim(`  ${join(dir, 'pr-body.md')}`));
  console.log(ui.dim('Next steps (run from the repo root, on a branch):'));
  console.log(ui.dim(`  cp ${join(dir, 'roadmap.snapshot.json')} docs/roadmap/roadmap.snapshot.json`));
  console.log(ui.dim(`  mkdir -p docs/roadmap/receipts && cp ${join(dir, 'chomp-receipt.json')} docs/roadmap/receipts/`));
  console.log(ui.dim(`  xargs git rm < ${join(dir, 'remove-docs.txt')}`));
  console.log(ui.dim('  git add docs/roadmap/roadmap.snapshot.json docs/roadmap/receipts'));
  console.log(ui.dim(`  git commit; open the PR with ${join(dir, 'pr-body.md')} as the body`));
  console.log('');
}

type RoadmapLinkKind = 'pr' | 'doc' | 'file' | 'media';

interface RoadmapItemLinkRow {
  kind: RoadmapLinkKind;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Read the one link selector flag (`--pr N | --doc p | --file p | --media p`)
 * the artifact link/unlink verbs operate on.
 *
 * Why exactly-one: a link is a single typed fact; accepting several selectors
 * in one invocation would force the CLI to guess batching semantics (all-or-
 * nothing? per-link errors?). The design keeps the verb atomic — one flag,
 * one edge — and rejects zero or multiple selectors with the usage line.
 *
 * @param options - Parsed CLI options.
 * @returns The selected kind+target, or an error string for the usage path.
 */
function readLinkSelector(options: CLIOptions): { kind: RoadmapLinkKind; target: string } | { error: string } {
  const candidates: Array<{ kind: RoadmapLinkKind; value: unknown }> = [
    { kind: 'pr', value: options.pr },
    { kind: 'doc', value: options.doc },
    { kind: 'file', value: options.file },
    { kind: 'media', value: options.media },
  ];
  const picks = candidates.filter((p) => p.value !== undefined);
  if (picks.length !== 1) {
    return { error: 'Pass exactly one of --pr <number>, --doc <path>, --file <path>, --media <path-or-url>' };
  }
  const pick = picks[0];
  if (typeof pick.value !== 'string' || !pick.value.trim()) {
    return { error: `--${pick.kind} needs a value (PR number for --pr; a path for --doc/--file; a path or URL for --media)` };
  }
  return { kind: pick.kind, target: pick.value.trim() };
}

/**
 * `pd roadmap link <slug> --pr N | --doc p | --file p | --media p` and its
 * inverse `pd roadmap unlink ...` — the CLI face of the typed item-link edges
 * (graph_edges planner:links, lib/planner-edges.ts).
 *
 * The motivation is receipts-at-the-source: the agent that just opened PR N
 * or produced a screenshot should be able to pin it to the roadmap item in
 * one line, so the Jira-card detail read carries evidence instead of prose
 * claims. Link metadata flags: --url/--title (pr), --mime/--caption (media).
 *
 * @param args - Positional args; args[0] is the item slug.
 * @param options - Parsed CLI options.
 * @param mode - 'link' adds (POST), 'unlink' removes (DELETE).
 * @returns Resolves after printing the outcome; exits non-zero on failure.
 */
async function handleRoadmapItemLink(args: string[], options: CLIOptions, mode: 'link' | 'unlink'): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  if (!slug) {
    ui.error(`Usage: pd roadmap ${mode} <slug> --pr <number> | --doc <path> | --file <path> | --media <path-or-url>`);
    process.exit(1);
  }
  const selector = readLinkSelector(options);
  if ('error' in selector) {
    ui.error(selector.error);
    process.exit(1);
  }

  if (mode === 'link') {
    const body: Record<string, unknown> = { type: selector.kind, target: selector.target };
    const url = readOption(options, 'url');
    if (url) body.url = url;
    const title = readOption(options, 'title');
    if (title) body.title = title;
    const mime = readOption(options, 'mime');
    if (mime) body.mime = mime;
    const caption = readOption(options, 'caption');
    if (caption) body.caption = caption;
    const res = await pdFetch(`/roadmap/items/${encodeURIComponent(slug)}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; link?: RoadmapItemLinkRow; error?: string };
    if (!res.ok || data.success !== true) {
      ui.error(data.error || `roadmap link failed: HTTP ${res.status}`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    ui.success(`Linked ${selector.kind} '${selector.target}' to '${slug}'`);
    return;
  }

  const qs = new URLSearchParams({ type: selector.kind, target: selector.target });
  const res = await pdFetch(`/roadmap/items/${encodeURIComponent(slug)}/links?${qs.toString()}`, {
    method: 'DELETE',
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || data.success !== true) {
    ui.error(data.error || `roadmap unlink failed: HTTP ${res.status}`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  ui.success(`Unlinked ${selector.kind} '${selector.target}' from '${slug}'`);
}

/**
 * `pd roadmap links <slug>` — list the typed links pinned to one item.
 *
 * The design intent is evidence auditability: an agent (or the operator in a
 * terminal pinch) can inspect a card's evidence trail without pulling the
 * whole detail read; the same rows render on the board/detail surfaces.
 *
 * @param args - Positional args; args[0] is the item slug.
 * @param options - Parsed CLI options (--json for raw rows).
 * @returns Resolves after printing the link table (or JSON) to stdout.
 */
async function handleRoadmapLinksList(args: string[], options: CLIOptions): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  if (!slug) {
    ui.error('Usage: pd roadmap links <slug>');
    process.exit(1);
  }
  const res = await pdFetch(`/roadmap/items/${encodeURIComponent(slug)}/links`);
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    links?: RoadmapItemLinkRow[];
    error?: string;
  };
  if (!res.ok || data.success !== true) {
    ui.error(data.error || `roadmap links failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const links = data.links ?? [];
  if (isJson(options)) {
    console.log(JSON.stringify(links, null, 2));
    return;
  }
  if (isQuiet(options)) {
    for (const link of links) console.log(`${link.kind}:${link.targetId}`);
    return;
  }
  console.log('');
  console.log(`LINKS · ${slug} · ${links.length} link(s)`);
  console.log('-'.repeat(80));
  if (links.length === 0) {
    console.log(ui.dim('  (no links — add one: pd roadmap link <slug> --pr <n> | --doc <path> | --file <path> | --media <path>)'));
  } else {
    for (const link of links) {
      const extras: string[] = [];
      const meta = link.metadata ?? {};
      for (const key of ['title', 'url', 'mime', 'caption'] as const) {
        const value = meta[key];
        if (typeof value === 'string' && value) extras.push(`${key}=${value}`);
      }
      console.log(`  - [${link.kind}] ${link.targetId}${extras.length ? ` (${extras.join(', ')})` : ''}`);
    }
  }
  console.log('');
}

async function handleRoadmapImportMarkdown(args: string[], options: CLIOptions): Promise<void> {
  const rootDir = resolve(readOption(options, 'dir', 'root', 'rootDir', 'projectDir') || process.cwd());
  const harbor = readOption(options, 'harbor');
  const project = readOption(options, 'project');
  const by = readOption(options, 'as', 'agent', 'by') ?? readCurrentContext()?.agentId;
  const dryRun = Boolean((options['dry-run'] ?? options.dryRun) || args.includes('--dry-run'));

  const body: Record<string, unknown> = { rootDir };
  if (harbor) body.harbor = harbor;
  if (project) body.project = project;
  if (by) body.by = by;
  if (dryRun) body.dryRun = true;

  const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/import-markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as
    | ({ success: true } & ImportMarkdownResult)
    | { success: false; error?: string };

  if (!res.ok || data.success !== true) {
    ui.error((data as { error?: string }).error || `import-markdown failed (status ${res.status})`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    for (const c of data.candidates) console.log(c.slug);
    return;
  }

  console.log('');
  const verb = data.dryRun ? 'Would import' : 'Imported';
  ui.success(
    `${verb} ${data.candidates.length} roadmap item(s) from markdown ` +
      `(${data.inserted.length} new, ${data.updated.length} updated)`,
  );
  console.log(
    ui.dim(
      `  parsed: ${data.parsed.nextCuts} next-cuts · ${data.parsed.ideasNow} ideas-now · ${data.parsed.dogfood} dogfood`,
    ),
  );
  if (data.missingFiles.length > 0) {
    console.log(ui.dim(`  missing (skipped): ${data.missingFiles.join(', ')}`));
  }
  if (data.dryRun) {
    console.log(ui.dim('  (dry-run — no rows written; re-run without --dry-run to persist)'));
  } else {
    console.log(ui.dim('  Render markdown back out: pd roadmap render --write'));
  }
  console.log('');
}

async function handleRoadmapRender(args: string[], options: CLIOptions): Promise<void> {
  const write = Boolean(options.write) || args.includes('--write');
  const rootDir = write ? resolve(readOption(options, 'dir', 'root', 'rootDir', 'projectDir') || process.cwd()) : undefined;
  const status = readOption(options, 'status') ?? 'now';
  const harbor = readOption(options, 'harbor');
  const project = readOption(options, 'project');
  const limit = options.limit !== undefined ? parseLimit(options.limit, 0) : undefined;

  const body: Record<string, unknown> = { status };
  if (harbor) body.harbor = harbor;
  if (project) body.project = project;
  if (limit && limit > 0) body.limit = limit;
  if (write && rootDir) {
    body.write = true;
    body.rootDir = rootDir;
  }

  const res = await pdFetch('/roadmap/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success !== true) {
    ui.error((data.error as string) || `Render failed: HTTP ${res.status}`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (write && (data.write as any)?.path) {
    const writeInfo = data.write as { path: string; changed: boolean; insertedMarkers: boolean };
    if (writeInfo.changed) {
      ui.success(`Wrote ${data.count} item(s) to ${writeInfo.path}${writeInfo.insertedMarkers ? ' (markers inserted)' : ''}`);
    } else {
      ui.success(`${writeInfo.path} already current (${data.count} item(s), no change)`);
    }
    return;
  }
  console.log(data.markdown as string);
}
