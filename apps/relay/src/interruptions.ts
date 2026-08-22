/**
 * OPERATOR INTERRUPTIONS v1 — the human-in-the-loop (HITL) primitive.
 *
 * When an agent hits a blocking operator instruction it cannot satisfy on its
 * own (a permission it lacks, a fail-closed flag with no sandbox, a question
 * only a human can answer), it does NOT guess and does NOT silently degrade:
 * it files an INTERRUPTION — a real, durable ask addressed to a real human —
 * and blocks (by polling) until the human answers, acks, or the ask expires.
 *
 *   POST /v1/interruptions            (pdu_ bearer or session) — create an ask
 *   GET  /v1/interruptions?state=open (pdu_ bearer or session) — poll; agents
 *                                     BLOCK on this (see docs/hitl-interruptions.md)
 *   POST /v1/interruptions/:id/answer (session-gated) — answer text, closes it
 *   POST /v1/interruptions/:id/ack    (session-gated) — seen-and-handled, closes it
 *   GET  /account/interruptions       (session-gated) — HTML list + plain forms
 *
 * STATE MACHINE:  open → acked | answered | expired.  Terminal states stay
 * terminal. Only the nag engine may expire; only a session (a human) may
 * answer/ack. Answer/ack silences the nag engine instantly (it only ever
 * selects state='open').
 *
 * DECAY/NAG ENGINE (runs inside the mercy 5-min cron):
 *   - FULL JITTER (Brooker): next_nag = last + random(0, min(CAP 6h,
 *     base(urgency) * 2^stage)). Never a fixed offset — 50 simultaneous
 *     interruptions must not page 50 times at the same cron tick.
 *   - The jittered `next_nag_at` is rolled ONCE per stage and advances ONLY
 *     when a page is DELIVERED — the mercy paged_at dedupe pattern: "never two
 *     pages for the same stage" means "never DELIVER two for the same stage";
 *     a failed webhook POST is retried next sweep at the SAME stage.
 *   - HARD STOP: after MAX_NAGS delivered nags, the next due tick flips the
 *     row to 'expired' and one final "gave up" page is sent (its delivery
 *     pinned by gave_up_paged_at, retried until delivered).
 *   - PER-OPERATOR PAGE BUDGET: at most PAGE_BUDGET_PER_HOUR delivered pages
 *     per operator per trailing hour (the interruption_pages ledger). Overflow
 *     collapses into ONE digest page ("N asks waiting, top: <title>") at most
 *     once per hour; digest delivery advances every collapsed row's stage.
 *   - WEBHOOK BREAKER: MERCY_PAGE_WEBHOOK posts go through a minimal circuit
 *     breaker (KV 'interruptions:breaker'): 3 consecutive failures open it for
 *     one sweep cycle; ≤2 in-call retries with full jitter; 4xx is NEVER
 *     retried; Retry-After on 429/503 is honored (breaker opens that long).
 *   - TWO TRANSPORTS, ONE SCHEDULE: each page decision fans out to the JSON
 *     webhook AND to APNs (src/push-apns.ts — the operator's registered iOS
 *     devices). "Delivered" for stage advancement / the page ledger means AT
 *     LEAST ONE transport delivered; pushes therefore ride the SAME decaying
 *     jittered next_nag_at, never a cadence of their own. The breaker is
 *     webhook-scoped: APNs failures never trip it, and an open breaker never
 *     silences APNs. With neither transport configured, asks are still
 *     recorded and expired — nobody is paged (the mercy contract).
 *   - KILL SWITCH: KV 'interruptions:paused' truthy ⇒ the sweep no-ops.
 *
 * CREATION RATE LIMIT: at most CREATE_LIMIT_PER_HOUR interruptions per
 * (operator, source_agent) per hour — a looping agent cannot nag-bomb. Excess
 * collapses into that agent's newest open interruption (409-free: the caller
 * gets the existing row back with collapsed:true).
 */

import type { Env } from './types.js';
import { randomHex } from './crypto.js';
import { resolveSession, isSameOrigin } from './auth-github.js';
import { resolveUserFromRequest } from './device-flow.js';
import { apnsConfigured, sendInterruptionPushes, type ApnsPushMessage } from './push-apns.js';
import { HEAD, TOKENS } from './account-page.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InterruptionUrgency = 'low' | 'normal' | 'high' | 'critical';
export type InterruptionState = 'open' | 'acked' | 'answered' | 'expired';

export interface InterruptionRow {
  id: string;
  user_id: string;
  installation_id: number | null;
  source_agent: string;
  source_session: string | null;
  title: string;
  body: string;
  urgency: InterruptionUrgency;
  state: InterruptionState;
  answer: string | null;
  created_at: number;
  last_nagged_at: number | null;
  nag_count: number;
  decay_stage: number;
  next_nag_at: number;
  closed_at: number | null;
  gave_up_paged_at: number | null;
}

export interface InterruptionSweepResult {
  at: number;
  paused: boolean;
  breakerOpen: boolean;
  expired: number;
  nagsSent: number;
  gaveUpSent: number;
  digestsSent: number;
  errors: string[];
}

/** Injectable nondeterminism so tests are exact. */
export interface SweepIo {
  /** Uniform [0,1) — full-jitter source. Default Math.random. */
  rand?: () => number;
  /** In-call retry delay. Default real setTimeout; tests inject a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

// ── Tuning ────────────────────────────────────────────────────────────────────

export const URGENCIES: readonly InterruptionUrgency[] = ['low', 'normal', 'high', 'critical'];
export const STATES: readonly InterruptionState[] = ['open', 'acked', 'answered', 'expired'];

/** Urgency-based base delay before the FIRST nag (stage 0 ceiling), seconds. */
export const URGENCY_BASE_SECONDS: Record<InterruptionUrgency, number> = {
  critical: 5 * 60,
  high: 15 * 60,
  normal: 60 * 60,
  low: 4 * 60 * 60,
};
/** Backoff ceiling cap — no nag interval ceiling ever exceeds 6h. */
export const NAG_CAP_SECONDS = 6 * 60 * 60;
/** Hard stop: after this many DELIVERED nags the next due tick expires the ask. */
export const MAX_NAGS = 5;
/** Per-operator delivered-page budget over the trailing hour (all interruptions). */
export const PAGE_BUDGET_PER_HOUR = 6;
const BUDGET_WINDOW_SECONDS = 60 * 60;
/** The mercy cron cadence — the breaker opens for one of these on trip. */
const SWEEP_INTERVAL_SECONDS = 5 * 60;
/** Creation rate limit per (operator, source_agent) per hour. */
export const CREATE_LIMIT_PER_HOUR = 5;
/** Global nag-engine kill switch (KV). Truthy value ⇒ sweep no-ops. */
export const INTERRUPTIONS_PAUSED_KEY = 'interruptions:paused';
/** Webhook circuit-breaker state (KV): { failures, openUntil }. */
export const INTERRUPTIONS_BREAKER_KEY = 'interruptions:breaker';
/** Breaker trips after this many CONSECUTIVE delivery failures. */
export const BREAKER_FAILURE_THRESHOLD = 3;
/** In-call retries after the first attempt (attempts = 1 + this). NEVER on 4xx. */
const WEBHOOK_MAX_RETRIES = 2;
const WEBHOOK_TIMEOUT_MS = 5000;
/** Full-jitter in-call retry delay: random(0, RETRY_BASE_MS * 2^attempt), capped. */
const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 2000;
/** Retry-After ceiling — never let a webhook park the breaker longer than 1h. */
const RETRY_AFTER_CAP_SECONDS = 60 * 60;
/** Retention: closed interruptions 30d; page ledger 24h; gave-up retry 24h. */
const CLOSED_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const PAGE_LEDGER_RETENTION_SECONDS = 24 * 60 * 60;
const GAVE_UP_RETRY_WINDOW_SECONDS = 24 * 60 * 60;

const TITLE_MAX = 200;
const BODY_MAX = 4000;
const ANSWER_MAX = 4000;
const SOURCE_MAX = 120;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── State machine (pure — unit-tested directly) ──────────────────────────────

/**
 * The whole transition law: 'open' may move to any terminal state; terminal
 * states never move again. Expiry belongs to the nag engine only; answer/ack
 * belong to a session only — both enforced at the call sites.
 */
export function canTransition(from: InterruptionState, to: InterruptionState): boolean {
  if (from !== 'open') return false;
  return to === 'acked' || to === 'answered' || to === 'expired';
}

// ── Decay schedule math (pure — unit-tested directly) ─────────────────────────

/** The stage's backoff ceiling: min(CAP, base(urgency) * 2^stage). */
export function nagCeilingSeconds(urgency: InterruptionUrgency, stage: number): number {
  const base = URGENCY_BASE_SECONDS[urgency];
  const s = Math.max(0, Math.floor(stage));
  // 2^s can overflow reasonable bounds fast; the cap makes it irrelevant past ~6 stages.
  const raw = s >= 31 ? Number.MAX_SAFE_INTEGER : base * 2 ** s;
  return Math.min(NAG_CAP_SECONDS, raw);
}

/**
 * FULL JITTER (Brooker/AWS): delay = random(0, ceiling). Never a fixed offset —
 * a relay outage that opens 50 interruptions must not page 50 times at the
 * same cron tick. `rand` is injectable for deterministic tests. A 1-second
 * floor keeps a 0-roll from re-nagging inside the same sweep.
 */
export function nextNagDelaySeconds(
  urgency: InterruptionUrgency,
  stage: number,
  rand: () => number = Math.random,
): number {
  const ceiling = nagCeilingSeconds(urgency, stage);
  return Math.max(1, Math.floor(rand() * ceiling));
}

// ── Webhook delivery: minimal breaker + bounded full-jitter retry ────────────

interface BreakerState {
  failures: number;
  openUntil: number;
}

async function readBreaker(env: Env): Promise<BreakerState> {
  try {
    const raw = await env.KV.get(INTERRUPTIONS_BREAKER_KEY);
    if (!raw) return { failures: 0, openUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<BreakerState>;
    return {
      failures: typeof parsed.failures === 'number' ? parsed.failures : 0,
      openUntil: typeof parsed.openUntil === 'number' ? parsed.openUntil : 0,
    };
  } catch {
    return { failures: 0, openUntil: 0 };
  }
}

async function writeBreaker(env: Env, state: BreakerState): Promise<void> {
  try {
    await env.KV.put(INTERRUPTIONS_BREAKER_KEY, JSON.stringify(state));
  } catch {
    // Breaker state is best-effort; losing it fails open to normal posting.
  }
}

function parseRetryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, RETRY_AFTER_CAP_SECONDS);
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, Math.floor((asDate - Date.now()) / 1000)), RETRY_AFTER_CAP_SECONDS);
  }
  return null;
}

interface PostOutcome {
  delivered: boolean;
  /** From a Retry-After header on 429/503 — parked into the breaker. */
  retryAfterSec: number | null;
}

/**
 * One page delivery: attempt + up to WEBHOOK_MAX_RETRIES in-call retries with
 * full-jitter delays. 4xx is NEVER retried (it will never succeed); 429/503's
 * Retry-After is surfaced so the breaker honors it. This is the ONLY retry
 * layer for page delivery — the sweep-level "retry next sweep while
 * undelivered" is stage-scoped dedupe, not a second retry loop (the stage's
 * next_nag_at never re-rolls, so attempts stay bounded per stage per sweep).
 */
async function postPageOnce(
  url: string,
  body: Record<string, unknown>,
  rand: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<PostOutcome> {
  let retryAfterSec: number | null = null;
  for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Full jitter between in-call attempts too.
      await sleep(Math.floor(rand() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt)));
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.ok) return { delivered: true, retryAfterSec: null };
      if (res.status === 429 || res.status === 503) {
        retryAfterSec = parseRetryAfterSeconds(res) ?? retryAfterSec;
      }
      // 4xx is NEVER retried in-call (it will not start succeeding); a 429's
      // Retry-After is honored by parking the breaker, not by hammering.
      if (res.status >= 400 && res.status < 500) {
        return { delivered: false, retryAfterSec };
      }
      // 503 with Retry-After: the server told us when — stop retrying now.
      if (retryAfterSec != null) {
        return { delivered: false, retryAfterSec };
      }
    } catch {
      // network / timeout — retriable
    }
  }
  return { delivered: false, retryAfterSec };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function insertPageLedger(env: Env, userId: string, kind: 'nag' | 'gave-up' | 'digest', now: number): Promise<void> {
  await env.DB.prepare('INSERT INTO interruption_pages (id, user_id, kind, sent_at) VALUES (?, ?, ?, ?)')
    .bind(`ip_${randomHex(8)}`, userId, kind, now)
    .run();
}

async function pagesInWindow(env: Env, userId: string, since: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM interruption_pages WHERE user_id = ? AND sent_at >= ?',
  )
    .bind(userId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function digestsInWindow(env: Env, userId: string, since: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM interruption_pages WHERE user_id = ? AND kind = 'digest' AND sent_at >= ?",
  )
    .bind(userId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Advance a nagged row to its next stage; called ONLY after a DELIVERED page. */
async function advanceNag(env: Env, row: InterruptionRow, now: number, rand: () => number): Promise<void> {
  const nextStage = row.decay_stage + 1;
  const nextAt = now + nextNagDelaySeconds(row.urgency, nextStage, rand);
  await env.DB.prepare(
    'UPDATE operator_interruptions SET nag_count = nag_count + 1, decay_stage = ?, last_nagged_at = ?, next_nag_at = ? WHERE id = ?',
  )
    .bind(nextStage, now, nextAt, row.id)
    .run();
}

/** Count global open interruptions — the /mercy status surface. Best-effort. */
export async function countOpenInterruptions(db: D1Database): Promise<number | null> {
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM operator_interruptions WHERE state = 'open'")
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return null;
  }
}

/** One operator's open interruptions: count + top item (the /account banner). */
export async function openInterruptionsSummary(
  db: D1Database,
  userId: string,
): Promise<{ count: number; top: InterruptionRow | null }> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM operator_interruptions WHERE user_id = ? AND state = 'open'")
    .bind(userId)
    .first<{ n: number }>();
  const count = row?.n ?? 0;
  if (count === 0) return { count: 0, top: null };
  const top = await db
    .prepare(
      `SELECT * FROM operator_interruptions WHERE user_id = ? AND state = 'open'
       ORDER BY CASE urgency WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END DESC,
                created_at ASC LIMIT 1`,
    )
    .bind(userId)
    .first<InterruptionRow>();
  return { count, top: top ?? null };
}

// ── The DECAY/NAG sweep (mercy 5-min cron entry point) ───────────────────────

interface PageCandidate {
  row: InterruptionRow;
  kind: 'nag' | 'gave-up';
}

/**
 * Run one nag sweep at injected `now` (unix seconds). Never throws: every step
 * is best-effort and failures land in `errors`. Expiry transitions happen even
 * when no webhook is configured or the breaker is open — silence must never
 * keep a dead ask alive forever.
 */
export async function runInterruptionNagSweep(
  env: Env,
  now: number,
  io: SweepIo = {},
): Promise<InterruptionSweepResult> {
  const rand = io.rand ?? Math.random;
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const result: InterruptionSweepResult = {
    at: now,
    paused: false,
    breakerOpen: false,
    expired: 0,
    nagsSent: 0,
    gaveUpSent: 0,
    digestsSent: 0,
    errors: [],
  };

  // Kill switch: KV 'interruptions:paused' truthy ⇒ the whole engine stands down.
  try {
    const paused = await env.KV.get(INTERRUPTIONS_PAUSED_KEY);
    if (paused && paused !== 'false' && paused !== '0') {
      result.paused = true;
      return result;
    }
  } catch (e) {
    result.errors.push(`pause-check: ${msg(e)}`);
  }

  // 1. Due open rows.
  let due: InterruptionRow[] = [];
  try {
    const r = await env.DB.prepare(
      "SELECT * FROM operator_interruptions WHERE state = 'open' AND next_nag_at <= ? ORDER BY user_id, created_at",
    )
      .bind(now)
      .all<InterruptionRow>();
    due = r.results ?? [];
  } catch (e) {
    result.errors.push(`select-due: ${msg(e)}`);
  }

  // 2. HARD STOP: rows past MAX_NAGS expire NOW (independent of the webhook).
  const nagCandidates: PageCandidate[] = [];
  for (const row of due) {
    if (row.nag_count >= MAX_NAGS) {
      try {
        const res = await env.DB.prepare(
          "UPDATE operator_interruptions SET state = 'expired', closed_at = ? WHERE id = ? AND state = 'open'",
        )
          .bind(now, row.id)
          .run();
        // changes=0 ⇒ a concurrent answer/ack won the race — it silences us.
        if ((res.meta?.changes ?? 0) > 0) result.expired++;
      } catch (e) {
        result.errors.push(`expire(${row.id}): ${msg(e)}`);
      }
    } else {
      nagCandidates.push({ row, kind: 'nag' });
    }
  }

  // 3. Undelivered "gave up" pages (including rows expired this very sweep).
  let gaveUpDue: InterruptionRow[] = [];
  try {
    const r = await env.DB.prepare(
      "SELECT * FROM operator_interruptions WHERE state = 'expired' AND gave_up_paged_at IS NULL AND closed_at >= ?",
    )
      .bind(now - GAVE_UP_RETRY_WINDOW_SECONDS)
      .all<InterruptionRow>();
    gaveUpDue = r.results ?? [];
  } catch (e) {
    result.errors.push(`select-gave-up: ${msg(e)}`);
  }

  const candidates: PageCandidate[] = [
    ...nagCandidates,
    ...gaveUpDue.map((row): PageCandidate => ({ row, kind: 'gave-up' })),
  ];

  const url = env.MERCY_PAGE_WEBHOOK;
  const apnsOn = apnsConfigured(env);
  if ((!url && !apnsOn) || candidates.length === 0) {
    // No transport at all ⇒ asks are still recorded, expired, and visible on
    // /account — nobody is paged (the mercy contract). Nothing due ⇒ done.
    //
    // Say so when there is something that WOULD have been paged. Inert is the
    // correct state for a deployment with no secrets set, so logging it on
    // every empty sweep would be noise; logging it when asks were actually
    // waiting answers the operator question this silence otherwise raises —
    // "I have open interruptions and my phone never rang."
    if (!url && !apnsOn && candidates.length > 0) {
      console.info(
        `[interruptions] ${candidates.length} ask(s) due but no transport configured ` +
          '(MERCY_PAGE_WEBHOOK unset, APNs secrets unset); recording only, nobody paged',
      );
    }
    await prune(env, now, result.errors);
    return result;
  }

  // 4. Circuit breaker — WEBHOOK-scoped: open ⇒ no webhook posts this sweep
  //    (fail fast), but APNs (its own transport with its own failure handling)
  //    still delivers when configured. With no APNs that is the old early out.
  let breaker: BreakerState = { failures: 0, openUntil: 0 };
  if (url) breaker = await readBreaker(env);
  const webhookAllowed = Boolean(url) && now >= breaker.openUntil;
  if (url && !webhookAllowed) {
    result.breakerOpen = true;
    if (!apnsOn) {
      await prune(env, now, result.errors);
      return result;
    }
  }

  // 5. Group by operator and enforce the per-operator page budget.
  const byUser = new Map<string, PageCandidate[]>();
  for (const c of candidates) {
    const list = byUser.get(c.row.user_id) ?? [];
    list.push(c);
    byUser.set(c.row.user_id, list);
  }

  let consecutiveFailures = breaker.failures;
  let breakerTrippedUntil = 0;

  /**
   * One page decision, fanned out over both transports. "Delivered" means AT
   * LEAST ONE transport delivered — that single bit advances the stage and
   * writes the ledger row, so the decay schedule stays transport-agnostic:
   * APNs pushes ride the SAME jittered next_nag_at, never a schedule of their
   * own. Webhook outcomes feed the webhook breaker exactly as before; APNs
   * outcomes never touch it (a dead Apple endpoint must not silence the
   * webhook, and an open webhook breaker must not silence APNs). A tripped
   * breaker stops further webhook posts mid-sweep via the guard below.
   */
  const deliverPage = async (
    userId: string,
    webhookBody: Record<string, unknown>,
    push: ApnsPushMessage,
  ): Promise<boolean> => {
    let delivered = false;
    if (webhookAllowed && url && breakerTrippedUntil === 0) {
      const outcome = await postPageOnce(url, webhookBody, rand, sleep);
      if (outcome.delivered) {
        consecutiveFailures = 0;
        delivered = true;
      } else {
        consecutiveFailures++;
        if (outcome.retryAfterSec != null) {
          breakerTrippedUntil = now + Math.max(outcome.retryAfterSec, SWEEP_INTERVAL_SECONDS);
        } else if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
          breakerTrippedUntil = now + SWEEP_INTERVAL_SECONDS;
        }
      }
    }
    if (apnsOn) {
      const pushed = await sendInterruptionPushes(env, userId, push);
      if (pushed.delivered) delivered = true;
    }
    return delivered;
  };

  for (const [userId, list] of byUser) {
    // Webhook breaker tripped mid-sweep AND no APNs ⇒ nothing left to deliver.
    if (breakerTrippedUntil > 0 && !apnsOn) break;
    try {
      const sent = await pagesInWindow(env, userId, now - BUDGET_WINDOW_SECONDS);
      const overBudget = sent + list.length > PAGE_BUDGET_PER_HOUR;

      if (overBudget) {
        // Collapse into ONE digest page, at most once per hour per operator.
        const digests = await digestsInWindow(env, userId, now - BUDGET_WINDOW_SECONDS);
        if (digests > 0) continue; // digest already sent — stay quiet; dues stay pending
        const summary = await openInterruptionsSummary(env.DB, userId);
        const top = summary.top;
        const delivered = await deliverPage(
          userId,
          {
            source: 'port-daddy-relay/interruptions',
            kind: 'digest',
            open_count: summary.count,
            top_id: top?.id ?? null,
            top_title: top?.title ?? null,
            top_urgency: top?.urgency ?? null,
            at: now,
          },
          {
            kind: 'digest',
            title: `${summary.count} asks waiting on you`,
            body: top ? `Top: ${top.title}` : undefined,
            urgency: top?.urgency ?? 'normal',
            interruptionId: top?.id ?? null,
            openCount: summary.count,
          },
        );
        if (delivered) {
          result.digestsSent++;
          await insertPageLedger(env, userId, 'digest', now);
          // Digest delivery counts as delivery for every collapsed candidate:
          // stages advance so they do not re-fire instantly.
          for (const c of list) {
            if (c.kind === 'nag') await advanceNag(env, c.row, now, rand);
            else
              await env.DB.prepare('UPDATE operator_interruptions SET gave_up_paged_at = ? WHERE id = ?')
                .bind(now, c.row.id)
                .run();
          }
        }
        continue;
      }

      // Within budget: one page per due candidate.
      for (const c of list) {
        if (breakerTrippedUntil > 0 && !apnsOn) break;
        const delivered = await deliverPage(
          userId,
          {
            source: 'port-daddy-relay/interruptions',
            kind: c.kind,
            interruption_id: c.row.id,
            title: c.row.title,
            urgency: c.row.urgency,
            source_agent: c.row.source_agent,
            nag_count: c.row.nag_count,
            stage: c.row.decay_stage,
            created_at: c.row.created_at,
            at: now,
          },
          {
            kind: c.kind,
            title: c.row.title,
            body:
              c.kind === 'nag'
                ? `${c.row.source_agent} is blocked — nag ${c.row.nag_count + 1}/${MAX_NAGS}`
                : `Gave up after ${c.row.nag_count} nags — expired unanswered`,
            urgency: c.row.urgency,
            interruptionId: c.row.id,
            nagCount: c.row.nag_count,
          },
        );
        if (delivered) {
          await insertPageLedger(env, userId, c.kind, now);
          if (c.kind === 'nag') {
            result.nagsSent++;
            await advanceNag(env, c.row, now, rand);
          } else {
            result.gaveUpSent++;
            await env.DB.prepare('UPDATE operator_interruptions SET gave_up_paged_at = ?, last_nagged_at = ? WHERE id = ?')
              .bind(now, now, c.row.id)
              .run();
          }
        }
      }
    } catch (e) {
      result.errors.push(`page(${userId}): ${msg(e)}`);
    }
  }

  // Persist webhook breaker state only when webhook posting was permitted this
  // sweep — an APNs-only pass (breaker open, or no webhook configured) must
  // never clobber the parked openUntil.
  if (webhookAllowed) {
    await writeBreaker(env, {
      failures: consecutiveFailures,
      openUntil: breakerTrippedUntil,
    });
  }

  await prune(env, now, result.errors);
  return result;
}

/** Bounded growth: prune long-closed asks + the stale page ledger. */
async function prune(env: Env, now: number, errors: string[]): Promise<void> {
  try {
    await env.DB.prepare(
      "DELETE FROM operator_interruptions WHERE state != 'open' AND closed_at IS NOT NULL AND closed_at < ?",
    )
      .bind(now - CLOSED_RETENTION_SECONDS)
      .run();
    await env.DB.prepare('DELETE FROM interruption_pages WHERE sent_at < ?')
      .bind(now - PAGE_LEDGER_RETENTION_SECONDS)
      .run();
  } catch (e) {
    errors.push(`prune: ${msg(e)}`);
  }
}

// ── API handlers ─────────────────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function publicShape(row: InterruptionRow): Record<string, unknown> {
  return {
    id: row.id,
    installationId: row.installation_id,
    sourceAgent: row.source_agent,
    sourceSession: row.source_session,
    title: row.title,
    body: row.body,
    urgency: row.urgency,
    state: row.state,
    answer: row.answer,
    createdAt: row.created_at,
    nagCount: row.nag_count,
    lastNaggedAt: row.last_nagged_at,
    closedAt: row.closed_at,
  };
}

function isUrgency(x: unknown): x is InterruptionUrgency {
  return typeof x === 'string' && (URGENCIES as readonly string[]).includes(x);
}

function isState(x: unknown): x is InterruptionState {
  return typeof x === 'string' && (STATES as readonly string[]).includes(x);
}

/**
 * POST /v1/interruptions — an agent (pdu_ bearer) or a signed-in surface
 * (session) files a blocking ask. Rate-limited per (operator, source_agent):
 * past CREATE_LIMIT_PER_HOUR/h, the excess collapses into the newest open ask
 * from the same agent (collapsed:true) instead of nag-bombing the operator.
 */
export async function handleCreateInterruption(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'a pdu_ bearer token or session is required' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'body must be JSON' });
  }
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { code: 'BAD_REQUEST', error: 'body must be a JSON object' });
  }
  const b = raw as Record<string, unknown>;

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > TITLE_MAX) {
    return json(400, { code: 'BAD_REQUEST', error: `title is required (1..${TITLE_MAX} chars)` });
  }
  const body = typeof b.body === 'string' ? b.body.slice(0, BODY_MAX) : '';
  const urgency: InterruptionUrgency = isUrgency(b.urgency) ? b.urgency : 'normal';
  const sourceAgent =
    typeof b.source_agent === 'string' && b.source_agent.trim()
      ? b.source_agent.trim().slice(0, SOURCE_MAX)
      : 'unknown';
  const sourceSession =
    typeof b.source_session === 'string' ? b.source_session.slice(0, SOURCE_MAX) : null;
  const installationId =
    typeof b.installation_id === 'number' && Number.isInteger(b.installation_id)
      ? b.installation_id
      : null;

  const now = Math.floor(Date.now() / 1000);

  // Creation rate limit: a looping agent cannot nag-bomb its operator.
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM operator_interruptions WHERE user_id = ? AND source_agent = ? AND created_at >= ?',
  )
    .bind(user.id, sourceAgent, now - 3600)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= CREATE_LIMIT_PER_HOUR) {
    const newestOpen = await env.DB.prepare(
      "SELECT * FROM operator_interruptions WHERE user_id = ? AND source_agent = ? AND state = 'open' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(user.id, sourceAgent)
      .first<InterruptionRow>();
    if (newestOpen) {
      return json(200, { code: 'OK', error: null, collapsed: true, interruption: publicShape(newestOpen) });
    }
    return json(429, { code: 'RATE_LIMITED', error: `at most ${CREATE_LIMIT_PER_HOUR} interruptions per source agent per hour` });
  }

  const id = `oi_${randomHex(8)}`;
  // First nag is full-jittered off the urgency base — never a thundering herd.
  const nextNagAt = now + nextNagDelaySeconds(urgency, 0);
  await env.DB.prepare(
    `INSERT INTO operator_interruptions
       (id, user_id, installation_id, source_agent, source_session, title, body, urgency, state, created_at, nag_count, decay_stage, next_nag_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, 0, ?)`,
  )
    .bind(id, user.id, installationId, sourceAgent, sourceSession, title, body, urgency, now, nextNagAt)
    .run();

  const row = await env.DB.prepare('SELECT * FROM operator_interruptions WHERE id = ?')
    .bind(id)
    .first<InterruptionRow>();
  return json(201, { code: 'OK', error: null, collapsed: false, interruption: row ? publicShape(row) : { id } });
}

/**
 * GET /v1/interruptions[?state=open] — the poll surface. Agents BLOCK on this
 * (full-jitter polling, see docs/hitl-interruptions.md); UIs (FleetBar,
 * pd-console, `pd interruptions`) surface open asks within 60s. Rows are
 * scoped to the authenticated operator — never anyone else's.
 */
export async function handleListInterruptions(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'a pdu_ bearer token or session is required' });

  const stateParam = new URL(request.url).searchParams.get('state');
  if (stateParam !== null && !isState(stateParam)) {
    return json(400, { code: 'BAD_REQUEST', error: `state must be one of ${STATES.join('|')}` });
  }

  const rows = stateParam
    ? await env.DB.prepare(
        `SELECT * FROM operator_interruptions WHERE user_id = ? AND state = ?
         ORDER BY CASE urgency WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END DESC,
                  created_at ASC LIMIT 100`,
      )
        .bind(user.id, stateParam)
        .all<InterruptionRow>()
    : await env.DB.prepare(
        'SELECT * FROM operator_interruptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      )
        .bind(user.id)
        .all<InterruptionRow>();

  const list = rows.results ?? [];
  const openCount =
    stateParam === 'open'
      ? list.length
      : list.filter((r) => r.state === 'open').length;
  return json(200, {
    code: 'OK',
    error: null,
    openCount,
    interruptions: list.map(publicShape),
  });
}

/** Shared close path for answer/ack — session-gated, owner-only, CSRF-checked. */
async function closeInterruption(
  request: Request,
  env: Env,
  id: string,
  to: 'answered' | 'acked',
): Promise<Response> {
  if (!isSameOrigin(request, env)) {
    return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  }
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'a signed-in session is required' });

  // Accept a plain HTML form (the no-JS /account/interruptions page) or JSON.
  const contentType = request.headers.get('Content-Type') ?? '';
  const isForm = contentType.includes('application/x-www-form-urlencoded');
  let answer = '';
  if (to === 'answered') {
    if (isForm) {
      const form = await request.formData();
      const v = form.get('answer');
      answer = typeof v === 'string' ? v.trim() : '';
    } else {
      try {
        const raw = (await request.json()) as Record<string, unknown>;
        answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
      } catch {
        answer = '';
      }
    }
    if (!answer || answer.length > ANSWER_MAX) {
      return json(400, { code: 'BAD_REQUEST', error: `answer is required (1..${ANSWER_MAX} chars)` });
    }
  } else if (isForm) {
    await request.formData().catch(() => undefined); // drain; ack carries no fields
  }

  const row = await env.DB.prepare('SELECT * FROM operator_interruptions WHERE id = ?')
    .bind(id)
    .first<InterruptionRow>();
  // Owner-only; a foreign id and a missing id are indistinguishable (no leak).
  if (!row || row.user_id !== session.user.id) {
    return json(404, { code: 'NOT_FOUND', error: 'no such interruption' });
  }
  if (!canTransition(row.state, to)) {
    return json(409, { code: 'CONFLICT', error: `cannot ${to === 'answered' ? 'answer' : 'ack'} a ${row.state} interruption` });
  }

  const now = Math.floor(Date.now() / 1000);
  // Guarded write: WHERE state='open' makes the transition race-safe — the
  // nag engine's expiry or a concurrent close loses cleanly (changes=0).
  const res = await env.DB.prepare(
    "UPDATE operator_interruptions SET state = ?, answer = ?, closed_at = ? WHERE id = ? AND state = 'open'",
  )
    .bind(to, to === 'answered' ? answer : row.answer, now, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    return json(409, { code: 'CONFLICT', error: 'interruption was closed concurrently' });
  }

  if (isForm) {
    // Plain-form flow: land back on the list (303 = GET after POST).
    return new Response(null, { status: 303, headers: { Location: '/account/interruptions' } });
  }
  return json(200, { code: 'OK', error: null, id, state: to });
}

/** POST /v1/interruptions/:id/answer — session-gated; answer text closes it. */
export function handleAnswerInterruption(request: Request, env: Env, id: string): Promise<Response> {
  return closeInterruption(request, env, id, 'answered');
}

/** POST /v1/interruptions/:id/ack — session-gated; seen-and-handled closes it. */
export function handleAckInterruption(request: Request, env: Env, id: string): Promise<Response> {
  return closeInterruption(request, env, id, 'acked');
}

// ── /account surfaces ────────────────────────────────────────────────────────

/** Minimal HTML-escape for interpolated data (XSS guard). */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlPage(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const INTERRUPTIONS_CSS = `
${TOKENS}
.page{max-width:1080px;margin:0 auto;padding:0 40px 80px}
.site-header{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px 0;background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.page-head{padding-top:32px}
.page-head h1{font-size:clamp(30px,3.4vw,42px);font-weight:700;line-height:1.05;letter-spacing:-.03em}
.page-head .caption{margin-top:10px;max-width:62ch}
section.sect{padding-top:44px}
.sect h2{font-size:24px;font-weight:700;margin-bottom:14px}
.sect .eyebrow{display:block;margin-bottom:6px}
.ask{border:2px solid var(--error);background:var(--surface-card);margin-bottom:22px}
.ask.closed{border:1px solid var(--hair-strong);opacity:.85}
.ask-head{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid var(--hair-strong)}
.ask-head h3{font-size:18px;font-weight:700;letter-spacing:-.01em}
.ask-meta{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--text-muted)}
.urg{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:3px 9px;border:1px solid currentColor}
.urg-critical,.urg-high{color:var(--error)}
.urg-normal{color:var(--amber)}
.urg-low{color:var(--text-muted)}
.st{font-family:"IBM Plex Mono",monospace;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:12px}
.st-open{color:var(--error)}.st-answered{color:var(--health)}.st-acked{color:var(--teal)}.st-expired{color:var(--text-muted)}
.ask-body{padding:16px 20px;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.ask-answer{padding:0 20px 14px;font-size:14.5px;color:var(--text-secondary)}
.ask-answer b{color:var(--health)}
.ask-forms{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;padding:14px 20px 18px;border-top:1px solid var(--hair)}
.ask-forms form{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.ask-forms label{display:block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:6px}
.ask-forms textarea{font:inherit;font-size:14.5px;padding:9px 12px;border:1.5px solid var(--hair-strong);background:var(--surface-base);color:var(--text-primary);min-width:280px;min-height:44px;vertical-align:bottom}
.btn-answer{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:10px 18px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.btn-answer:hover{background:var(--border-strong);color:var(--surface-base)}
.btn-ack{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:10px 18px;border:1px solid var(--hair-strong);background:transparent;color:var(--text-primary);cursor:pointer}
.btn-ack:hover{border-color:var(--border-strong)}
.empty{border:1px dashed var(--hair-strong);background:transparent;padding:22px 24px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:6px;max-width:64ch}
.backlink{display:inline-block;margin-top:26px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;padding:10px 18px;border:2px solid var(--border-strong);color:var(--text-primary);text-decoration:none}
.backlink:hover{background:var(--border-strong);color:var(--surface-base)}
@media (max-width:720px){.page{padding:0 20px 64px}.ask-forms textarea{min-width:0;width:100%}}
`;

function fmtTs(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function renderAsk(row: InterruptionRow): string {
  const open = row.state === 'open';
  const answer =
    row.state === 'answered' && row.answer
      ? `<div class="ask-answer"><b>Answered:</b> ${esc(row.answer)}</div>`
      : '';
  const forms = open
    ? `<div class="ask-forms">
  <form method="post" action="/v1/interruptions/${esc(row.id)}/answer">
    <div><label for="answer-${esc(row.id)}">Answer</label>
    <textarea id="answer-${esc(row.id)}" name="answer" required maxlength="4000" placeholder="Tell the agent what to do"></textarea></div>
    <button type="submit" class="btn-answer">Answer</button>
  </form>
  <form method="post" action="/v1/interruptions/${esc(row.id)}/ack">
    <button type="submit" class="btn-ack">Acknowledge</button>
  </form>
</div>`
    : '';
  return `<article class="ask${open ? '' : ' closed'}">
  <div class="ask-head">
    <h3>${esc(row.title)}</h3>
    <div><span class="urg urg-${esc(row.urgency)}">${esc(row.urgency)}</span> <span class="st st-${esc(row.state)}">${esc(row.state)}</span></div>
  </div>
  <div class="ask-body">${esc(row.body)}</div>
  ${answer}
  <div class="ask-head" style="border-top:1px solid var(--hair);border-bottom:none">
    <span class="ask-meta">from ${esc(row.source_agent)}${row.source_session ? ` · ${esc(row.source_session)}` : ''} · filed ${esc(fmtTs(row.created_at))}</span>
    <span class="ask-meta">nagged ${row.nag_count}× · ${row.last_nagged_at ? `last ${esc(fmtTs(row.last_nagged_at))}` : 'never paged'}</span>
  </div>
  ${forms}
</article>`;
}

/** Render the interruptions page. Exported for direct render tests. */
export function renderInterruptionsPage(open: InterruptionRow[], closed: InterruptionRow[]): string {
  const openHtml = open.length
    ? open.map(renderAsk).join('\n')
    : `<div class="empty"><div class="e-title">No agent is waiting on you.</div><p>When an agent hits a blocking degradation it cannot resolve — a permission it lacks, a fail-closed gate with no sandbox — it files an ask here and blocks until you answer, acknowledge, or it expires. Right now the fleet needs nothing.</p></div>`;
  const closedHtml = closed.length
    ? closed.map(renderAsk).join('\n')
    : `<div class="empty"><div class="e-title">No resolved asks on record.</div><p>Answered, acknowledged and expired asks appear here for 30 days, then are pruned.</p></div>`;
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Interruptions</title>${HEAD}<style>${INTERRUPTIONS_CSS}</style></head><body>
<div class="page">
  <header class="site-header">
    <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
    <span class="eyebrow">Interruptions / human-in-the-loop</span>
  </header>
  <div class="page-head">
    <span class="eyebrow">portdaddy.dev · account · interruptions</span>
    <h1 style="margin-top:8px">Agents <span class="rec">waiting on you</span></h1>
    <p class="caption">A blocking ask escalates here instead of failing silently. Answer it (the agent reads your text) or acknowledge it (you have handled it out-of-band). Unanswered asks re-page on a decaying schedule, then give up honestly.</p>
  </div>

  <section class="sect" aria-labelledby="open-h">
    <span class="eyebrow">Blocking · needs a human</span>
    <h2 id="open-h">Open asks (${open.length})</h2>
    ${openHtml}
  </section>

  <section class="sect" aria-labelledby="closed-h">
    <span class="eyebrow">Resolved</span>
    <h2 id="closed-h">Recently closed</h2>
    ${closedHtml}
  </section>

  <a class="backlink" href="/account">&larr; Back to account</a>
</div>
</body></html>`;
}

/** GET /account/interruptions — session-gated; redirects to /login signed out. */
export async function handleInterruptionsPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  let open: InterruptionRow[] = [];
  let closed: InterruptionRow[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT * FROM operator_interruptions WHERE user_id = ? AND state = 'open'
       ORDER BY CASE urgency WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END DESC,
                created_at ASC LIMIT 100`,
    )
      .bind(session.user.id)
      .all<InterruptionRow>();
    open = r.results ?? [];
  } catch {
    open = [];
  }
  try {
    const r = await env.DB.prepare(
      "SELECT * FROM operator_interruptions WHERE user_id = ? AND state != 'open' ORDER BY closed_at DESC LIMIT 20",
    )
      .bind(session.user.id)
      .all<InterruptionRow>();
    closed = r.results ?? [];
  } catch {
    closed = [];
  }
  return htmlPage(renderInterruptionsPage(open, closed));
}
