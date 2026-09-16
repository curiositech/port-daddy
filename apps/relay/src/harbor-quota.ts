/**
 * Port Daddy Relay — HarborQuota Durable Object (grand-plan §X8).
 *
 * ONE instance per harbor fingerprint (idFromName(harborFp)) — deliberately
 * aggregating across every channel in the harbor, unlike HarborChannel which is
 * keyed per (harbor, channel). This object replaces the in-memory
 * `rateLimitCounters` Map that lived in HarborChannel: that limiter reset on DO
 * eviction and split its counts per channel, so a publisher spreading traffic
 * across N channels got N times its stated rate, and any eviction forgot
 * everything.
 *
 * What it tracks, per UTC day:
 *   - events published + ciphertext bytes published (the daily budget);
 *   - the SHADOW-vs-ENFORCE delta: how many events/bytes WOULD have been
 *     refused had enforcement been on (shadow mode), and how many actually
 *     were refused (enforce mode). The flip decision is made from this data,
 *     read via ?action=status — never from vibes.
 * Plus per-sender per-minute rate windows (the old HarborChannel semantics,
 * now harbor-wide and eviction-surviving).
 *
 * DURABILITY MODEL — batched, alarm-flushed:
 *   `check` NEVER writes to storage. Increments accumulate in memory
 *   (`pending`) and an alarm flushes them to `state.storage` every
 *   QUOTA_FLUSH_MS in a single batched put. Publish latency therefore stays
 *   flat: one DO round-trip, zero storage writes on the hot path. The accepted
 *   trade, stated: an eviction between flushes loses at most QUOTA_FLUSH_MS
 *   worth of unflushed counts — the durable baseline survives and counting
 *   resumes from it. (The old Map lost EVERYTHING on eviction.)
 *
 * ENFORCEMENT MODEL — shadow first, honest 429 later:
 *   The Worker passes `enforce` per check (env-gated via QUOTA_ENFORCE;
 *   default shadow). In shadow mode an over-budget event still passes —
 *   provably non-enforcing — and the would-have-denied delta is recorded. In
 *   enforce mode the verdict is a refusal the Worker turns into
 *   429 + `Retry-After` + a pointer to the credit ledger. NEVER a silent drop.
 */

import type { Env } from './types.js';

/** How long increments may sit in memory before the alarm flushes them. */
export const QUOTA_FLUSH_MS = 5_000;

/** Default per-harbor daily budgets (generous; env-tunable — see
 *  {@link resolveQuotaSettings}). */
export const DEFAULT_DAILY_EVENT_BUDGET = 100_000;
export const DEFAULT_DAILY_BYTE_BUDGET = 256 * 1024 * 1024; // 256 MiB

/**
 * Where a refused publisher is pointed: the credit ledger surface. A 429 body
 * always carries this — budget exhaustion must name its remedy, never just
 * refuse.
 */
export const CREDIT_LEDGER_POINTER = '/account/billing';

/** Storage key prefix for per-day counter records (`day:YYYY-MM-DD`). */
const DAY_PREFIX = 'day:';
/** Storage key for the per-sender minute-window snapshot. */
const SENDERS_KEY = 'senders';

// ── Wire shapes ───────────────────────────────────────────────────────────────

/** Body of a `?action=check` POST from the Worker's publish path. */
export interface QuotaCheckRequest {
  /** Publishing daemon fingerprint (card.sub). */
  sender: string;
  /** Per-sender per-minute publish cap (from the card capability). */
  ratePerMin: number;
  /** Decoded ciphertext size of the event being published. */
  eventBytes: number;
  /** Daily per-harbor event budget in force for this check. */
  eventBudget: number;
  /** Daily per-harbor byte budget in force for this check. */
  byteBudget: number;
  /** True: refuse over-budget traffic; false: shadow (count, do not enforce). */
  enforce: boolean;
}

/** Verdict returned by `?action=check`. */
export interface QuotaVerdict {
  allowed: boolean;
  code?: 'RATE_LIMITED' | 'QUOTA_EXHAUSTED';
  /** Seconds until the caller may retry (rate window end / next UTC day). */
  retryAfterSeconds?: number;
  /** True when this event exceeded the budget but shadow mode let it pass. */
  shadow?: boolean;
}

/** One UTC day's durable counters. */
export interface QuotaDayCounters {
  events: number;
  bytes: number;
  /** Events/bytes that passed in shadow mode but WOULD have been refused. */
  shadowDeniedEvents: number;
  shadowDeniedBytes: number;
  /** Events/bytes actually refused with a 429 (enforce mode). */
  enforcedDeniedEvents: number;
  enforcedDeniedBytes: number;
}

/** `?action=status` response: merged (durable + unflushed) view of today. */
export interface QuotaStatus {
  day: string;
  counters: QuotaDayCounters;
}

interface SenderWindow {
  count: number;
  windowStart: number; // ms epoch
}

const zeroDay = (): QuotaDayCounters => ({
  events: 0,
  bytes: 0,
  shadowDeniedEvents: 0,
  shadowDeniedBytes: 0,
  enforcedDeniedEvents: 0,
  enforcedDeniedBytes: 0,
});

// ── Time helpers ──────────────────────────────────────────────────────────────

/** The UTC calendar day (`YYYY-MM-DD`) a millisecond timestamp falls in. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Seconds until the next UTC midnight — the honest `Retry-After` for a daily
 * budget: the budget resets when the day does, not a moment sooner.
 */
export function secondsToUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

// ── Worker-side settings resolution ───────────────────────────────────────────

/** The quota regime the Worker passes into every check. */
export interface QuotaSettings {
  eventBudget: number;
  byteBudget: number;
  /** True ONLY when QUOTA_ENFORCE is the exact string 'enforce'. */
  enforce: boolean;
}

function parseBudget(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Resolve the per-harbor daily budgets and the enforcement switch from env.
 *
 * SHADOW BY DEFAULT: only the exact string `'enforce'` in QUOTA_ENFORCE turns
 * refusal on (same consent idiom as PARLEY_MEDIATOR's `'on'`). Unset, empty,
 * `'shadow'`, typos — all mean shadow: count, record the delta, refuse nothing.
 * The flip to enforcement is a deliberate config change backed by the recorded
 * shadow-vs-enforce delta, never a code default.
 */
export function resolveQuotaSettings(env: Env): QuotaSettings {
  return {
    eventBudget: parseBudget(env.HARBOR_DAILY_EVENT_BUDGET, DEFAULT_DAILY_EVENT_BUDGET),
    byteBudget: parseBudget(env.HARBOR_DAILY_BYTE_BUDGET, DEFAULT_DAILY_BYTE_BUDGET),
    enforce: env.QUOTA_ENFORCE === 'enforce',
  };
}

/**
 * Turn a refusing {@link QuotaVerdict} into the HTTP response the publish path
 * returns, or null when the verdict allows the publish.
 *
 * Both refusal shapes are 429 with a `Retry-After` header (interruptions.ts's
 * client-side breaker honors it). Budget exhaustion additionally carries
 * `credit_ledger` — the pointer to the remedy — per the X8 rule that exhaustion
 * degrades loudly and helpfully, never into a silent drop.
 */
export function quotaGateResponse(verdict: QuotaVerdict, ratePerMin: number): Response | null {
  if (verdict.allowed) return null;
  const headers = { 'Retry-After': String(verdict.retryAfterSeconds ?? 60) };
  if (verdict.code === 'QUOTA_EXHAUSTED') {
    return Response.json(
      {
        error: 'Harbor daily publish budget exhausted; resets at UTC midnight',
        code: 'QUOTA_EXHAUSTED',
        credit_ledger: CREDIT_LEDGER_POINTER,
      },
      { status: 429, headers },
    );
  }
  return Response.json(
    { error: `Rate limit ${ratePerMin}/min exceeded`, code: 'RATE_LIMITED' },
    { status: 429, headers },
  );
}

// ── The Durable Object ────────────────────────────────────────────────────────

export class HarborQuota implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  /** True once today's durable baseline has been read from storage. */
  private loaded = false;
  /** UTC day the in-memory counters belong to. */
  private day = '';
  /** Last-flushed durable baseline for `day`. */
  private durable: QuotaDayCounters = zeroDay();
  /** Unflushed in-memory deltas (lost on eviction — at most QUOTA_FLUSH_MS worth). */
  private pending: QuotaDayCounters = zeroDay();
  /** Per-sender minute windows; snapshot-flushed alongside the day record. */
  private senders = new Map<string, SenderWindow>();
  private sendersDirty = false;
  /** In-memory arm flag so `check` avoids even a getAlarm() per publish. */
  private alarmArmed = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.searchParams.get('action')) {
      case 'check': {
        const body = (await request.json()) as QuotaCheckRequest;
        return Response.json(await this.check(body));
      }
      case 'status': {
        await this.ensureLoaded(Date.now());
        return Response.json(this.statusView());
      }
      default:
        return new Response('Unknown action', { status: 400 });
    }
  }

  /** Alarm = the flush tick. Re-armed lazily by the next dirtying check. */
  async alarm(): Promise<void> {
    this.alarmArmed = false;
    // If we were evicted after arming, the alarm fires on a fresh instance
    // that holds no pending state — nothing to flush (the pre-eviction
    // pending was the accepted loss; the durable baseline is intact).
    if (!this.loaded) return;
    await this.flush(Date.now());
  }

  // ── Core ────────────────────────────────────────────────────────────────────

  private async check(req: QuotaCheckRequest): Promise<QuotaVerdict> {
    const nowMs = Date.now();
    await this.ensureLoaded(nowMs);

    // 1) Per-sender per-minute rate limit — ALWAYS enforced (this predates X8;
    //    shadow mode applies only to the NEW daily-budget behavior).
    const windowMs = parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;
    const w = this.senders.get(req.sender);
    if (!w || nowMs - w.windowStart >= windowMs) {
      this.senders.set(req.sender, { count: 1, windowStart: nowMs });
      this.sendersDirty = true;
    } else if (w.count >= req.ratePerMin) {
      return {
        allowed: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(1, Math.ceil((w.windowStart + windowMs - nowMs) / 1000)),
      };
    } else {
      w.count++;
      this.sendersDirty = true;
    }

    // 2) Daily budgets. A refused event consumes NO budget (it was not
    //    published); a shadow-passed event consumes budget (it WAS published).
    const events = this.durable.events + this.pending.events;
    const bytes = this.durable.bytes + this.pending.bytes;
    const over = events + 1 > req.eventBudget || bytes + req.eventBytes > req.byteBudget;

    let verdict: QuotaVerdict;
    if (over && req.enforce) {
      this.pending.enforcedDeniedEvents++;
      this.pending.enforcedDeniedBytes += req.eventBytes;
      verdict = {
        allowed: false,
        code: 'QUOTA_EXHAUSTED',
        retryAfterSeconds: secondsToUtcMidnight(nowMs),
      };
    } else if (over) {
      // SHADOW: record the would-have-denied delta, then let it pass.
      this.pending.shadowDeniedEvents++;
      this.pending.shadowDeniedBytes += req.eventBytes;
      this.pending.events++;
      this.pending.bytes += req.eventBytes;
      verdict = { allowed: true, shadow: true };
    } else {
      this.pending.events++;
      this.pending.bytes += req.eventBytes;
      verdict = { allowed: true };
    }

    await this.armFlush();
    return verdict;
  }

  /** Load today's durable baseline (once) and handle UTC-day rollover. */
  private async ensureLoaded(nowMs: number): Promise<void> {
    const dayKey = utcDayKey(nowMs);
    if (!this.loaded) {
      const [dayRec, senders] = await Promise.all([
        this.state.storage.get<QuotaDayCounters>(`${DAY_PREFIX}${dayKey}`),
        this.state.storage.get<Record<string, SenderWindow>>(SENDERS_KEY),
      ]);
      this.durable = dayRec ?? zeroDay();
      this.pending = zeroDay();
      this.senders = new Map(Object.entries(senders ?? {}));
      this.day = dayKey;
      this.loaded = true;
      return;
    }
    if (dayKey !== this.day) {
      // Rollover: flush the finished day's remainder, then start the new day
      // from whatever baseline it already has (normally zero).
      await this.flush(nowMs);
      this.durable = (await this.state.storage.get<QuotaDayCounters>(`${DAY_PREFIX}${dayKey}`)) ?? zeroDay();
      this.pending = zeroDay();
      this.day = dayKey;
    }
  }

  /** Arm the flush alarm if it is not already armed. */
  private async armFlush(): Promise<void> {
    if (this.alarmArmed) return;
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(Date.now() + QUOTA_FLUSH_MS);
    }
    this.alarmArmed = true;
  }

  /**
   * ONE batched storage write: today's merged counters + the pruned sender
   * snapshot, in a single multi-key put. This is the only place counters
   * touch storage.
   */
  private async flush(nowMs: number): Promise<void> {
    const writes: Record<string, unknown> = {};
    const pendingDirty = Object.values(this.pending).some((v) => v !== 0);
    if (pendingDirty) {
      const merged = this.mergedCounters();
      writes[`${DAY_PREFIX}${this.day}`] = merged;
      this.durable = merged;
      this.pending = zeroDay();
    }
    if (this.sendersDirty) {
      const windowMs = parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;
      for (const [sender, w] of this.senders) {
        if (nowMs - w.windowStart >= windowMs) this.senders.delete(sender);
      }
      writes[SENDERS_KEY] = Object.fromEntries(this.senders);
      this.sendersDirty = false;
    }
    if (Object.keys(writes).length > 0) {
      await this.state.storage.put(writes);
    }
  }

  private mergedCounters(): QuotaDayCounters {
    return {
      events: this.durable.events + this.pending.events,
      bytes: this.durable.bytes + this.pending.bytes,
      shadowDeniedEvents: this.durable.shadowDeniedEvents + this.pending.shadowDeniedEvents,
      shadowDeniedBytes: this.durable.shadowDeniedBytes + this.pending.shadowDeniedBytes,
      enforcedDeniedEvents: this.durable.enforcedDeniedEvents + this.pending.enforcedDeniedEvents,
      enforcedDeniedBytes: this.durable.enforcedDeniedBytes + this.pending.enforcedDeniedBytes,
    };
  }

  private statusView(): QuotaStatus {
    return { day: this.day, counters: this.mergedCounters() };
  }
}

// ── DO stub key ───────────────────────────────────────────────────────────────

/** One quota DO per harbor: the stub key is the harbor fingerprint itself. */
export function harborQuotaKey(harborFingerprint: string): string {
  return harborFingerprint;
}
