/**
 * Feedback — first-class agentic feedback primitive.
 *
 * The pitch: agents (and humans) drop short structured findings while
 * they work. Cartographer (or any subscriber) harvests the stream into
 * the project roadmap. This is the *central* loop port-daddy advertises:
 *
 *   agents develop -> drop feedback -> cartographer curates ->
 *   roadmap drives next work -> agents get more efficient.
 *
 * Why tuples (not files): tuples already give us
 *   - durable, project-scoped storage
 *   - pattern-match subscription so cartographer can listen with
 *     ['feedback:dropped', '*', '*']
 *   - TTL semantics for stale unharvested feedback
 *   - harbor scoping so multi-project daemons don't cross streams
 *
 * Markdown files in `.spark/feedback/` remain the legacy/local channel
 * (gitignored, free-form). The tuple stream is the structured channel
 * that the API/MCP/CLI all share. Cartographer can consume both.
 *
 * Tuple shapes:
 *   ['feedback:dropped', feedbackId,
 *     { slug, summary, surface?, severity, status, source,
 *       suggested?, hook?, fleetbotRunId?, droppedBy, project?, harbor, at,
 *       harvestedAt? }]
 *
 * fleetbotRunId (surface='Fleetbot' by convention) is the extension this
 * primitive grows for "this fleetbot verdict on a PR was wrong/low-quality" —
 * see `pd feedback --fleetbot-review <run-id>`. It is NOT a parallel
 * mechanism: it is the exact same drop/list/harvest lifecycle with one extra
 * pointer back to the `fleet_runs` row (relay D1) the flag is about, so
 * `pd feedback fleetbot` / `pd feedback list --surface Fleetbot` is a normal
 * filtered read of the one feedback stream, not a second store.
 *
 *   ['feedback:harvested', feedbackId,
 *     { harvestedBy, harvestedAt, intoSlug? }]
 *
 * Severity ordering: low < medium < high < critical. Used for sort and
 * for cartographer's auto-promotion threshold (high/critical promote
 * to roadmap `now` automatically; lower stays in the trove).
 */

import { randomUUID } from 'node:crypto';

interface TupleRow {
  id: number;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
  rd(
    pattern: unknown[],
    options?: { harbor?: string; limit?: number },
  ): TupleRow[];
}

export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackStatus = 'open' | 'harvested' | 'wontfix';
export type FeedbackSource = 'agent' | 'human' | 'mcp' | 'cli' | 'unknown';

export interface FeedbackEntry {
  feedbackId: string;
  slug: string;
  summary: string;
  surface: string | null;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  source: FeedbackSource;
  suggested: string | null;
  hook: string | null;
  /**
   * Pointer to the `fleet_runs.id` (relay D1, shape `run:<deliveryId>`) this
   * feedback is flagging a verdict on. Null for every ordinary feedback drop;
   * set only via `pd feedback --fleetbot-review <runId>`.
   */
  fleetbotRunId: string | null;
  droppedBy: string;
  project: string | null;
  harbor: string;
  at: number;
  harvestedAt: number | null;
  harvestedIntoSlug: string | null;
}

export interface DropFeedbackInput {
  slug: string;
  summary: string;
  droppedBy: string;
  surface?: string;
  severity?: FeedbackSeverity;
  source?: FeedbackSource;
  suggested?: string;
  hook?: string;
  fleetbotRunId?: string;
  project?: string;
  harbor?: string;
  ttlMs?: number;
}

export interface ListFeedbackOptions {
  harbor?: string;
  status?: FeedbackStatus | 'all';
  severity?: FeedbackSeverity;
  surface?: string;
  limit?: number;
}

export interface HarvestInput {
  feedbackId: string;
  harvestedBy: string;
  intoSlug?: string;
}

export interface FeedbackDeps {
  tuples: TupleSpaceMin;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
}

interface HarvestState {
  harvestedBy: string | null;
  harvestedAt: number | null;
  intoSlug: string | null;
}

const SEVERITIES: FeedbackSeverity[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: FeedbackStatus[] = ['open', 'harvested', 'wontfix'];
const SOURCES: FeedbackSource[] = ['agent', 'human', 'mcp', 'cli', 'unknown'];
const SEVERITY_RANK: Record<FeedbackSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const DEFAULT_HARBOR = 'fleet';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — stale unharvested feedback eventually expires.

function harborForProject(project: string | undefined): string | null {
  const trimmed = typeof project === 'string' ? project.trim() : '';
  return trimmed ? `${trimmed}:fleet` : null;
}

function asEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  if (value && (allowed as string[]).includes(value)) return value as T;
  return fallback;
}

export function createFeedback(deps: FeedbackDeps) {
  const { tuples } = deps;
  const now = deps.now ?? (() => Date.now());

  function normalizeEntry(data: unknown): FeedbackEntry | null {
    if (!data || typeof data !== 'object') return null;
    const entry = data as FeedbackEntry;
    return {
      ...entry,
      surface: entry.surface ?? null,
      suggested: entry.suggested ?? null,
      hook: entry.hook ?? null,
      fleetbotRunId: entry.fleetbotRunId ?? null,
      project: entry.project ?? null,
      harvestedAt: typeof entry.harvestedAt === 'number' ? entry.harvestedAt : null,
      harvestedIntoSlug: entry.harvestedIntoSlug ?? null,
    };
  }

  function applyHarvestState(entry: FeedbackEntry, state: HarvestState | undefined): FeedbackEntry {
    if (!state) return entry;
    return {
      ...entry,
      status: 'harvested',
      harvestedAt: state.harvestedAt ?? entry.harvestedAt,
      harvestedIntoSlug: state.intoSlug ?? entry.harvestedIntoSlug,
    };
  }

  function drop(input: DropFeedbackInput): FeedbackEntry {
    if (!input.slug || typeof input.slug !== 'string') {
      throw new Error('feedback.drop: slug is required (string)');
    }
    if (!input.summary || typeof input.summary !== 'string') {
      throw new Error('feedback.drop: summary is required (string)');
    }
    if (!input.droppedBy || typeof input.droppedBy !== 'string') {
      throw new Error('feedback.drop: droppedBy is required (string)');
    }

    const harbor = input.harbor ?? harborForProject(input.project) ?? DEFAULT_HARBOR;
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const at = now();
    const feedbackId = randomUUID();

    const entry: FeedbackEntry = {
      feedbackId,
      slug: input.slug.trim(),
      summary: input.summary.trim(),
      surface: input.surface?.trim() || null,
      severity: asEnum(input.severity, SEVERITIES, 'medium'),
      status: 'open',
      source: asEnum(input.source, SOURCES, 'unknown'),
      suggested: input.suggested?.trim() || null,
      hook: input.hook?.trim() || null,
      fleetbotRunId: input.fleetbotRunId?.trim() || null,
      droppedBy: input.droppedBy,
      project: input.project ?? null,
      harbor,
      at,
      harvestedAt: null,
      harvestedIntoSlug: null,
    };

    tuples.out(['feedback:dropped', feedbackId, entry], {
      harbor,
      writtenBy: input.droppedBy,
      ttlMs: ttlMs > 0 ? ttlMs : undefined,
    });

    return entry;
  }

  function findEntry(feedbackId: string, harbor?: string): FeedbackEntry | null {
    const matches = tuples.rd(['feedback:dropped', feedbackId, '*'], { harbor, limit: 1 });
    if (matches.length === 0) return null;
    return normalizeEntry(matches[0].fields[2]);
  }

  function listHarvested(harbor?: string): Map<string, HarvestState> {
    const matches = tuples.rd(['feedback:harvested', '*', '*'], { harbor, limit: 10000 });
    const states = new Map<string, HarvestState>();
    for (const row of matches) {
      const id = row.fields[1];
      if (typeof id !== 'string' || states.has(id)) continue;
      const data = row.fields[2];
      const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      states.set(id, {
        harvestedBy: typeof payload.harvestedBy === 'string' ? payload.harvestedBy : null,
        harvestedAt: typeof payload.harvestedAt === 'number' ? payload.harvestedAt : null,
        intoSlug: typeof payload.intoSlug === 'string' ? payload.intoSlug : null,
      });
    }
    return states;
  }

  function list(options: ListFeedbackOptions = {}): FeedbackEntry[] {
    const harbor = options.harbor;
    const limit = options.limit ?? 100;
    const matches = tuples.rd(['feedback:dropped', '*', '*'], { harbor, limit: 10000 });

    const harvested = listHarvested(harbor);

    const entries: FeedbackEntry[] = [];
    for (const row of matches) {
      const entry = normalizeEntry(row.fields[2]);
      if (!entry) continue;
      // Reflect harvest state from the harvested-tuple side so we don't
      // need to mutate the original drop tuple (tuples are immutable).
      const effective = applyHarvestState(entry, harvested.get(entry.feedbackId));

      if (options.status && options.status !== 'all' && effective.status !== options.status) {
        continue;
      }
      if (options.severity && effective.severity !== options.severity) continue;
      if (options.surface && effective.surface !== options.surface) continue;
      entries.push(effective);
    }

    entries.sort((a, b) => {
      const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sev !== 0) return sev;
      return b.at - a.at;
    });
    return entries.slice(0, limit);
  }

  function get(feedbackId: string, harbor?: string): FeedbackEntry | null {
    const entry = findEntry(feedbackId, harbor);
    if (!entry) return null;
    const harvested = listHarvested(harbor);
    return applyHarvestState(entry, harvested.get(feedbackId));
  }

  function harvest(input: HarvestInput): FeedbackEntry {
    if (!input.feedbackId || typeof input.feedbackId !== 'string') {
      throw new Error('feedback.harvest: feedbackId is required (string)');
    }
    if (!input.harvestedBy || typeof input.harvestedBy !== 'string') {
      throw new Error('feedback.harvest: harvestedBy is required (string)');
    }
    const entry = findEntry(input.feedbackId);
    if (!entry) {
      throw new Error(`feedback.harvest: no feedback '${input.feedbackId}' found`);
    }
    const at = now();
    tuples.out(
      [
        'feedback:harvested',
        input.feedbackId,
        {
          harvestedBy: input.harvestedBy,
          harvestedAt: at,
          intoSlug: input.intoSlug ?? null,
        },
      ],
      { harbor: entry.harbor, writtenBy: input.harvestedBy },
    );
    return { ...entry, status: 'harvested', harvestedAt: at, harvestedIntoSlug: input.intoSlug ?? null };
  }

  function summary(harbor?: string): {
    total: number;
    open: number;
    harvested: number;
    bySeverity: Record<FeedbackSeverity, number>;
    bySurface: Record<string, number>;
  } {
    const all = list({ harbor, status: 'all', limit: 10000 });
    const result = {
      total: all.length,
      open: 0,
      harvested: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } as Record<FeedbackSeverity, number>,
      bySurface: {} as Record<string, number>,
    };
    for (const e of all) {
      if (e.status === 'harvested') result.harvested++;
      else if (e.status === 'open') result.open++;
      result.bySeverity[e.severity]++;
      const surfaceKey = e.surface ?? '(unspecified)';
      result.bySurface[surfaceKey] = (result.bySurface[surfaceKey] ?? 0) + 1;
    }
    return result;
  }

  return {
    drop,
    list,
    get,
    harvest,
    summary,
  };
}

export type Feedback = ReturnType<typeof createFeedback>;
