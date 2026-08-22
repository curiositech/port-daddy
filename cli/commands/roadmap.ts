import { resolve } from 'node:path';

import type { RoadmapProgress, FeedbackEntry, RoadmapFeedbackStatus } from '../../lib/roadmap-progress.js';
import type { RoadmapClaim, RoadmapEntry, RoadmapPopKind } from '../../lib/roadmap-pop.js';
import type { RoadmapItem, RoadmapStatus } from '../../lib/roadmap-items.js';
import type { ImportMarkdownResult } from '../../lib/roadmap-import.js';
import { resolveHarbor } from '../../lib/harbor-resolve.js';
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
} = {}): Promise<RoadmapItem[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.harbor) params.set('harbor', options.harbor);
  if (options.project) params.set('project', options.project);
  if (options.limit) params.set('limit', String(options.limit));
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

  if (sub === 'import-markdown' || sub === 'import') {
    await handleRoadmapImportMarkdown(args.slice(1), options);
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

  const limit = parseLimit(options.limit, 8);
  const harbor = readOption(options, 'harbor');
  const project = readOption(options, 'project');
  const statusRaw = readOption(options, 'status') as RoadmapStatus | 'all' | undefined;
  const status = statusRaw ?? 'now';

  // ADR-0033: the `roadmap_items` SQL table is the single source of truth.
  // `pd roadmap` lists from the table via the daemon, NOT by re-parsing
  // docs/ROADMAP.md / IDEAS-TROVE.md (those are render/curation inputs that
  // get folded into the table via `pd roadmap import-markdown` / `promote`).
  let items: RoadmapItem[];
  try {
    items = await fetchRoadmapItems({ status, harbor, project, limit: limit > 0 ? limit : undefined });
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
      console.log(`  - ${item.slug} [${item.status}]`);
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
 *
 * The actual resolution logic lives in `lib/harbor-resolve.ts` (CLI-free) so
 * non-CLI callers like `scripts/roadmap-dedup.ts` can reuse it without
 * pulling in this module's pdFetch/prompt/shell-quote dependency chain. This
 * function is now a thin CLIOptions-shaped wrapper kept for the existing
 * `pd roadmap` call sites and the CLI-facing test suite.
 */
export function resolveRoadmapHarbor(options: CLIOptions): string | undefined {
  return resolveHarbor({ harbor: readOption(options, 'harbor') });
}

function roadmapNote(actor: string, text: string | undefined): { at: number; by: string; text: string } {
  return {
    at: Date.now(),
    by: actor,
    text: text?.trim() || 'roadmap touched for active work slice',
  };
}

async function handleRoadmapUpsert(args: string[], options: CLIOptions): Promise<void> {
  const slug = readRoadmapSlug(args, options);
  const summaryMd = readRoadmapSummary(args, options);
  if (!slug || !summaryMd) {
    ui.error('Usage: pd roadmap upsert <slug> --summary <md> [--status <now|backlog|parked|merge|done>] [--as <agentId>]');
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

  try {
    const item = await postRoadmapItem(body);
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, item }, null, 2));
      return;
    }
    ui.success(`Roadmap item '${item.slug}' upserted`);
    console.log(`  status:  ${item.status}`);
    console.log(`  harbor:  ${item.harbor}`);
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

async function handleRoadmapImportMarkdown(args: string[], options: CLIOptions): Promise<void> {
  const rootDir = resolve(readOption(options, 'dir', 'root', 'rootDir', 'projectDir') || process.cwd());
  // Same git-worktree-aware canonicalization handleRoadmapUpsert uses. Without
  // this, an unflagged `pd roadmap import-markdown` fell back to the daemon's
  // DEFAULT_HARBOR ('fleet') while every other write landed on the real
  // project harbor — the second of the two root causes behind the Planner
  // pane's "harbor split" (the biggest bucket: hundreds of import rows
  // stranded in `fleet` instead of `port-daddy`).
  const harbor = resolveRoadmapHarbor(options);
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
