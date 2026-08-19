import { birthCharter, reviseCharter } from './charter.js';
import { appendDeckLog, readDeckLog } from './ledgers.js';
import type { Charter, DeckLogEntry, Env, WakeEvent } from './types.js';

/**
 * The Steward's seat — one Durable Object per repo (THE_FULL_WHEEL.md §1–§5,
 * ADR-0109), scaffold slice (P1 PR 1).
 *
 * WHAT THE SCAFFOLD IS AND IS NOT: this DO holds the durable *identity* of the
 * merge authority — charter, wake inbox, alarm heartbeat, deck-log discipline.
 * It renders no verdicts and lands nothing: the tick (survey → priority
 * function → one PR to completion) is P1 PR 2, and every deck-log entry this
 * scaffold writes says so honestly. Shipping the seat before the judgment is
 * deliberate sequencing: the sanity protocol (§5) is pure harness machinery —
 * episodic wakes, charter re-read, deck log as vital sign — and proving it
 * under test *before* a model is in the loop means the tick lands into an
 * already-disciplined body.
 *
 * SINGLE-WRITER GUARD: the DO's name IS its identity (`steward:owner/repo`),
 * but a DO cannot read its own name, so the first authenticated request binds
 * the seat to its repo and every later request must match — a mismatch is a
 * 409, never a silent context switch. One seat, one repo, forever.
 */
export class StewardDO {
  /** Durable state handle — storage is the seat's only hot memory. */
  private readonly state: DurableObjectState;
  /** Worker environment (D1 ledger fabric; tokens are checked upstream). */
  private readonly env: Env;

  /** Storage keys, centralized so tests and future PRs share one vocabulary. */
  private static readonly KEY_REPO = 'repo';
  private static readonly KEY_CHARTER = 'charter';
  private static readonly KEY_INBOX_SEQ = 'inboxSeq';
  private static readonly KEY_DEGRADED = 'degraded';
  private static readonly KEY_LAST_WAKE_AT = 'lastWakeAt';
  private static readonly KEY_FALLBACK_LOG = 'decklogFallback';
  private static readonly INBOX_PREFIX = 'inbox:';
  private static readonly SEEN_PREFIX = 'seen:';

  /** How soon after a wake event the alarm drains the inbox (debounce window). */
  static readonly WAKE_DEBOUNCE_MS = 5_000;
  /** Heartbeat cadence — an ALL QUIET entry at least this often proves liveness. */
  static readonly HEARTBEAT_MS = 6 * 3600_000;
  /** Bounded size of the DO-storage fallback ring used when D1 is unreachable. */
  static readonly FALLBACK_RING_MAX = 50;

  /**
   * Standard DO constructor.
   *
   * WHY NO WORK HERE: Durable Object constructors run on every cold start;
   * doing storage I/O or charter seeding here would race the first request.
   * All initialization is lazy and idempotent inside the handlers.
   *
   * @param state - The platform-provided durable state handle.
   * @param env - The Worker environment bindings.
   */
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Route a request already authenticated by the Worker entry (worker.ts).
   *
   * DESIGN: the DO trusts its Worker completely and only its Worker — the
   * bearer-token gate lives one layer up so the seat's own logic never
   * handles credentials. Paths are the normalized `/wake`, `/status`,
   * `/charter`; the repo travels in the `x-steward-repo` header because the
   * DO cannot read its own name.
   *
   * @param request - The normalized internal request.
   * @returns JSON responses; 409 on repo mismatch, 404 on unknown paths.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const repoHeader = request.headers.get('x-steward-repo') ?? '';
    if (!/^[^/\s]+\/[^/\s]+$/.test(repoHeader)) {
      return json({ error: 'missing or malformed x-steward-repo header' }, 400);
    }

    const bound = await this.state.storage.get<string>(StewardDO.KEY_REPO);
    if (bound === undefined) {
      await this.state.storage.put(StewardDO.KEY_REPO, repoHeader);
    } else if (bound !== repoHeader) {
      // Single-writer identity guard: this seat serves exactly one repo.
      return json({ error: `seat is bound to ${bound}, not ${repoHeader}` }, 409);
    }
    const repo = bound ?? repoHeader;

    if (request.method === 'POST' && url.pathname === '/wake') {
      return this.handleWake(request);
    }
    if (request.method === 'GET' && url.pathname === '/status') {
      return this.handleStatus(repo);
    }
    if (request.method === 'POST' && url.pathname === '/charter') {
      return this.handleCharterRevision(request);
    }
    return json({ error: 'not found' }, 404);
  }

  /**
   * Accept a wake event into the inbox and arm the drain alarm.
   *
   * MOTIVATION: wakes-not-loops (§3). The intake does the minimum durable
   * work — dedupe, persist, arm — and returns; all thinking happens in
   * `alarm()`. Dedupe by deliveryId is what makes at-least-once webhook
   * delivery safe to point at this endpoint.
   *
   * @param request - POST /wake with a JSON body `{kind, deliveryId, prNumber?, detail?}`.
   * @returns 202 with the queue position, or 200 `{deduped: true}` for replays.
   */
  private async handleWake(request: Request): Promise<Response> {
    let body: { kind?: unknown; deliveryId?: unknown; prNumber?: unknown; detail?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
    const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : null;
    const deliveryId =
      typeof body.deliveryId === 'string' && body.deliveryId.trim() ? body.deliveryId.trim() : null;
    if (!kind || !deliveryId) {
      return json({ error: 'kind and deliveryId are required' }, 400);
    }

    const seenKey = StewardDO.SEEN_PREFIX + deliveryId;
    if ((await this.state.storage.get(seenKey)) !== undefined) {
      return json({ deduped: true }, 200);
    }

    const seq = ((await this.state.storage.get<number>(StewardDO.KEY_INBOX_SEQ)) ?? 0) + 1;
    const event: WakeEvent = {
      kind,
      deliveryId,
      receivedAt: Date.now(),
      ...(typeof body.prNumber === 'number' ? { prNumber: body.prNumber } : {}),
      ...(typeof body.detail === 'string' ? { detail: body.detail.slice(0, 2000) } : {}),
    };
    await this.state.storage.put({
      [StewardDO.INBOX_PREFIX + String(seq).padStart(12, '0')]: event,
      [StewardDO.KEY_INBOX_SEQ]: seq,
      [seenKey]: event.receivedAt,
    });

    // Arm the drain if nothing sooner is already scheduled — never push an
    // armed alarm later, or a steady event stream would starve the drain.
    const current = await this.state.storage.getAlarm();
    const target = Date.now() + StewardDO.WAKE_DEBOUNCE_MS;
    if (current === null || current > target) {
      await this.state.storage.setAlarm(target);
    }
    return json({ queued: true, seq }, 202);
  }

  /**
   * Report the seat's live state for the console and for humans with curl.
   *
   * WHY THIS SHAPE: binder chapter 10's first questions — who is this, is it
   * alive, what has it done lately — must be answerable from one GET with no
   * terminal archaeology. `degraded` is first-class because a seat whose
   * ledger writes are falling back to DO storage is a seat the operator needs
   * to know about *before* it matters.
   *
   * @param repo - The repo this seat is bound to.
   * @returns 200 with identity, charter, inbox depth, and recent deck log.
   */
  private async handleStatus(repo: string): Promise<Response> {
    const charter = await this.state.storage.get<Charter>(StewardDO.KEY_CHARTER);
    const inbox = await this.state.storage.list({ prefix: StewardDO.INBOX_PREFIX });
    const degraded = (await this.state.storage.get<boolean>(StewardDO.KEY_DEGRADED)) ?? false;
    const lastWakeAt = (await this.state.storage.get<number>(StewardDO.KEY_LAST_WAKE_AT)) ?? null;
    const fallback =
      (await this.state.storage.get<DeckLogEntry[]>(StewardDO.KEY_FALLBACK_LOG)) ?? [];
    const recentLog = await readDeckLog(this.env.DB, repo, 5);
    return json({
      role: 'steward',
      repo,
      commissioned: charter !== undefined,
      charter: charter ?? null,
      pendingWakes: inbox.size,
      lastWakeAt,
      degraded,
      fallbackEntries: fallback.length,
      recentDeckLog: recentLog,
      tick: 'not yet commissioned (P1 PR 2)',
    });
  }

  /**
   * Apply an operator/PR charter revision.
   *
   * AUTHORITY RATIONALE: the Worker entry has already checked the bearer
   * token, which only the operator's surfaces hold — the seat itself never
   * calls this (hard limit: it may not edit its own charter). By design, the
   * first revision on an un-commissioned seat seeds the default charter
   * first, so version numbers always start from the canonical constitution.
   *
   * @param request - POST /charter with partial fields + mandatory `updatedBy`.
   * @returns 200 with the new charter, or 400 on a malformed body.
   */
  private async handleCharterRevision(request: Request): Promise<Response> {
    let body: {
      mission?: unknown;
      hardLimits?: unknown;
      escalationRules?: unknown;
      updatedBy?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
    const updatedBy =
      typeof body.updatedBy === 'string' && body.updatedBy.trim() ? body.updatedBy.trim() : null;
    if (!updatedBy) return json({ error: 'updatedBy is required' }, 400);

    /**
     * Narrow an untrusted body field to a string array.
     *
     * PURPOSE: charter lists are replaced whole (see reviseCharter's design
     * note), so a partially-string array must be rejected outright rather
     * than filtered — filtering would silently drop operator-authored rules.
     *
     * @param v - The untrusted value from the request body.
     * @returns True only when every element is a string.
     */
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every(x => typeof x === 'string');

    const now = Date.now();
    const current =
      (await this.state.storage.get<Charter>(StewardDO.KEY_CHARTER)) ?? birthCharter(now);
    const next = reviseCharter(
      current,
      {
        updatedBy,
        ...(typeof body.mission === 'string' ? { mission: body.mission } : {}),
        ...(isStringArray(body.hardLimits) ? { hardLimits: body.hardLimits } : {}),
        ...(isStringArray(body.escalationRules) ? { escalationRules: body.escalationRules } : {}),
      },
      now,
    );
    await this.state.storage.put(StewardDO.KEY_CHARTER, next);
    return json({ charter: next });
  }

  /**
   * The wake — drain the inbox, write the deck-log entry, re-arm the heartbeat.
   *
   * The sanity protocol, mechanized — the design intent of §5: every alarm firing is one episodic
   * wake. It re-reads (or seeds) the charter, drains whatever stimuli
   * accumulated, and writes exactly one deck-log entry — `wake` when events
   * were drained, `all-quiet` when none were, because a silent seat is
   * indistinguishable from a dead one. The scaffold's wake takes no action on
   * the events (the tick is P1 PR 2) and says so in the entry rather than
   * pretending; the honesty bar applies to machinery, not just features. The
   * alarm is always re-armed at the heartbeat cadence, so liveness is a
   * standing invariant, not a hope.
   *
   * @returns Resolves once the entry is ledgered (or ring-buffered under
   * degradation) and the next heartbeat is armed.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const repo = (await this.state.storage.get<string>(StewardDO.KEY_REPO)) ?? 'unbound';

    // Charter re-read is the wake's first act; a brand-new seat seeds it here.
    let charter = await this.state.storage.get<Charter>(StewardDO.KEY_CHARTER);
    if (!charter) {
      charter = birthCharter(now);
      await this.state.storage.put(StewardDO.KEY_CHARTER, charter);
    }

    // Drain the inbox in arrival order.
    const pending = await this.state.storage.list<WakeEvent>({ prefix: StewardDO.INBOX_PREFIX });
    const events = [...pending.values()];
    if (pending.size > 0) {
      await this.state.storage.delete([...pending.keys()]);
    }

    const entry: DeckLogEntry = {
      repo,
      entryKind: events.length > 0 ? 'wake' : 'all-quiet',
      summary:
        events.length > 0
          ? `Wake: drained ${events.length} event(s) [${summarizeKinds(events)}]. ` +
            'Seat scaffold holding — the tick lands in P1 PR 2; no verdicts rendered.'
          : 'ALL QUIET. Heartbeat wake; inbox empty; seat scaffold holding.',
      detail: JSON.stringify({
        charterVersion: charter.version,
        events: events.map(e => ({ kind: e.kind, deliveryId: e.deliveryId, prNumber: e.prNumber ?? null })),
      }),
      wakeEvents: events.length,
      createdAt: Math.floor(now / 1000),
    };

    const landed = await appendDeckLog(this.env.DB, entry);
    if (!landed) {
      // D1 unreachable: keep the vital sign in a bounded DO-storage ring and
      // raise the degraded flag — visible on /status, never silently dropped.
      const ring =
        (await this.state.storage.get<DeckLogEntry[]>(StewardDO.KEY_FALLBACK_LOG)) ?? [];
      ring.push(entry);
      await this.state.storage.put({
        [StewardDO.KEY_FALLBACK_LOG]: ring.slice(-StewardDO.FALLBACK_RING_MAX),
        [StewardDO.KEY_DEGRADED]: true,
      });
    } else if ((await this.state.storage.get<boolean>(StewardDO.KEY_DEGRADED)) === true) {
      await this.state.storage.put(StewardDO.KEY_DEGRADED, false);
    }

    await this.state.storage.put(StewardDO.KEY_LAST_WAKE_AT, now);
    await this.state.storage.setAlarm(now + StewardDO.HEARTBEAT_MS);
  }
}

/**
 * Compress drained events into the deck-log one-liner's bracket note.
 *
 * WHY: the summary line is what a human scans in the console; listing every
 * delivery GUID would bury the signal. Kinds with counts is the useful
 * altitude — the full event list still rides in `detail`.
 *
 * @param events - The drained wake events.
 * @returns e.g. `pull_request:synchronize ×3, heartbeat ×1`.
 */
function summarizeKinds(events: WakeEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
}

/**
 * Small JSON response helper.
 *
 * PURPOSE: one place that sets the content type so every seat response is
 * machine-readable by the console and by curl-wielding humans alike.
 *
 * @param body - The value to serialize.
 * @param status - HTTP status (defaults to 200).
 * @returns The JSON response.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
