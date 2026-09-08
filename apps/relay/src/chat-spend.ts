/**
 * apps/relay/src/chat-spend.ts — daily per-user spend caps for every
 * conversational surface the relay hosts.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FINDING THIS MODULE CLOSES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A chat that can spend without a cap is a defect. Before this module, the
 * relay's chat surface called a model with no per-user budget in front of it:
 * one account in a loop, or one account pasting walls of text, could spend
 * without bound and nothing in the request path would notice. The cap is not a
 * nicety bolted onto a working feature — it is the missing half of the
 * feature, and it lives HERE, in one place, so a second chat surface cannot be
 * added without one.
 *
 * That is the design decision worth stating: the cap is not a helper each
 * surface may choose to call, it is a step inside the shared turn engine
 * (src/chat-engine.ts) that no surface can route around. Adding a third chat
 * means implementing the store interface; it does not mean remembering to
 * check a budget.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 *
 *   · Checked BEFORE the message is persisted and BEFORE the model call. A
 *     refused turn stores nothing and spends nothing.
 *   · Refusal is 429 with `Retry-After` and an honest reason naming what ran
 *     out and when it comes back.
 *   · Charged AT ACCEPTANCE, before the call, so a client that disconnects
 *     mid-stream still spent its turn. Slight over-count on a model error is
 *     the safe direction for a protective budget; under-counting is not.
 *   · Caps are SERVER-OWNED. They come from deploy-time vars or from the
 *     committed defaults. Nothing in a request body can reach them, and a
 *     garbage var can never parse as "unlimited".
 *   · The window key is UTC midnight, so rollover is arithmetic: a new day
 *     reads a row that does not exist and therefore counts zero. Nothing has
 *     to run for a budget to reset, so nothing can fail to run.
 *
 * ── TWO CAPS, BECAUSE THERE ARE TWO WAYS TO OVERSPEND ───────────────────────
 *
 * A message cap alone lets one account send sixty maximal turns; a token cap
 * alone lets it send hundreds of tiny ones. Messages bound the looper, tokens
 * bound the wall-of-text looper, and a turn is charged its input estimate plus
 * the FULL output allowance — the true completion length is unknowable before
 * the call, and a budget that guesses low protects nothing.
 */

import type { Env } from './types.js';

/** Turns per account per UTC day, when no var overrides it. */
export const DAILY_MESSAGES_DEFAULT = 60;
/** Estimated tokens per account per UTC day, when no var overrides it. */
export const DAILY_TOKENS_DEFAULT = 200_000;

/** Coarse chars→tokens divisor. Deliberately conservative. */
const CHARS_PER_TOKEN = 4;
const DAY_SECONDS = 24 * 60 * 60;

export interface DailyCaps {
  messages: number;
  tokens: number;
}

export interface SpendRow {
  messages: number;
  est_tokens: number;
}

/**
 * The caps in force for this deploy: an env override when it parses as a
 * positive integer, else the committed default.
 *
 * FAIL-SAFE PARSING is the point. `parseInt('')`, `parseInt('unlimited')` and
 * `parseInt('-1')` must all mean "use the default", never "no limit" and never
 * "zero" — a typo in a deploy var should not be able to switch a protective
 * budget off, nor to lock every account out of the feature.
 */
export function dailyCaps(env: Env): DailyCaps {
  const parse = (raw: string | undefined, fallback: number): number => {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    messages: parse(env.CHAT_DAILY_MESSAGES, DAILY_MESSAGES_DEFAULT),
    tokens: parse(env.CHAT_DAILY_TOKENS, DAILY_TOKENS_DEFAULT),
  };
}

/**
 * UTC midnight (unix seconds) of the day containing `now` — the counter key.
 * A new day is a new key, so rollover resets the count by arithmetic alone.
 */
export function spendWindowStart(now: number): number {
  return now - (now % DAY_SECONDS);
}

/**
 * Estimated token cost of one turn: the new message's input estimate plus the
 * full output allowance. History re-sent per turn is bounded separately by the
 * engine's window and is deliberately not double-charged here.
 *
 * @param messageChars Length of the accepted user message.
 * @param maxOutputTokens The output allowance the turn will be given.
 */
export function estimateTurnTokens(messageChars: number, maxOutputTokens: number): number {
  return Math.ceil(messageChars / CHARS_PER_TOKEN) + maxOutputTokens;
}

/**
 * The refusal copy a 429 carries and the page renders in-chat. States what ran
 * out, that nothing was stored, and when it comes back — so a cap is never the
 * first the operator hears of a budget, and never looks like a bug.
 */
export function spendCapNotice(retryAfterSeconds: number): string {
  const hours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
  return (
    "Today's chat budget is spent — the daily cap keeps model spend bounded for every " +
    `account. It resets at UTC midnight (about ${hours}h). Your message was NOT stored; ` +
    'bring it back then.'
  );
}

/** Today's spend for one (agent, account). A missing row reads as zero. */
export async function getChatSpend(
  db: D1Database,
  agent: string,
  userId: string,
  windowStart: number,
): Promise<SpendRow> {
  const row = await db
    .prepare(
      'SELECT messages, est_tokens FROM agent_chat_spend WHERE agent = ? AND user_id = ? AND window_start = ?',
    )
    .bind(agent, userId, windowStart)
    .first<SpendRow>();
  return row ?? { messages: 0, est_tokens: 0 };
}

/**
 * Record one accepted turn: +1 message, +`estTokens`. ONE upsert — there is no
 * read-modify-write window for a concurrent turn to slip through uncounted.
 */
export async function addChatSpend(
  db: D1Database,
  m: { agent: string; userId: string; windowStart: number; estTokens: number },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO agent_chat_spend (agent, user_id, window_start, messages, est_tokens) VALUES (?, ?, ?, 1, ?) ' +
        'ON CONFLICT (agent, user_id, window_start) DO UPDATE SET ' +
        'messages = messages + 1, est_tokens = est_tokens + excluded.est_tokens',
    )
    .bind(m.agent, m.userId, m.windowStart, m.estTokens)
    .run();
}

export type SpendDecision =
  | { allowed: true; windowStart: number; turnTokens: number; caps: DailyCaps; spent: SpendRow }
  | { allowed: false; retryAfterSeconds: number; reason: string; caps: DailyCaps; spent: SpendRow };

/**
 * Decide whether one turn may proceed, WITHOUT charging it.
 *
 * Split from the charge on purpose: the decision is pure given a spend row, so
 * the cap's behaviour at every boundary (at the cap, one under, one token over)
 * is testable without a database, and the charge is a separate, idempotent-by-
 * upsert write the caller makes only after accepting the turn.
 *
 * The token test is `spent + turn > cap`, not `>=`: a turn that lands exactly
 * on the ceiling is the last affordable turn, and refusing it would make the
 * advertised budget a lie by one turn.
 */
export function decideSpend(m: {
  caps: DailyCaps;
  spent: SpendRow;
  now: number;
  windowStart: number;
  turnTokens: number;
}): SpendDecision {
  const overMessages = m.spent.messages >= m.caps.messages;
  const overTokens = m.spent.est_tokens + m.turnTokens > m.caps.tokens;
  if (overMessages || overTokens) {
    const retryAfterSeconds = Math.max(1, m.windowStart + DAY_SECONDS - m.now);
    return {
      allowed: false,
      retryAfterSeconds,
      reason: spendCapNotice(retryAfterSeconds),
      caps: m.caps,
      spent: m.spent,
    };
  }
  return {
    allowed: true,
    windowStart: m.windowStart,
    turnTokens: m.turnTokens,
    caps: m.caps,
    spent: m.spent,
  };
}

/**
 * The whole gate, as one call: read today's spend, decide, and (when allowed)
 * charge the turn immediately.
 *
 * Charging BEFORE the model call is deliberate. A client that aborts mid-stream
 * has still consumed the allowance, and a budget that only charges on clean
 * completion is a budget an abusive client can drive to zero cost.
 */
export async function chargeTurn(
  db: D1Database,
  m: { agent: string; userId: string; now: number; messageChars: number; maxOutputTokens: number; caps: DailyCaps },
): Promise<SpendDecision> {
  const windowStart = spendWindowStart(m.now);
  const turnTokens = estimateTurnTokens(m.messageChars, m.maxOutputTokens);
  const spent = await getChatSpend(db, m.agent, m.userId, windowStart);
  const decision = decideSpend({ caps: m.caps, spent, now: m.now, windowStart, turnTokens });
  if (!decision.allowed) return decision;
  await addChatSpend(db, { agent: m.agent, userId: m.userId, windowStart, estTokens: turnTokens });
  return decision;
}

/** The 429 envelope every capped surface returns. One shape, one code. */
export function spendCapResponse(decision: Extract<SpendDecision, { allowed: false }>): Response {
  return Response.json(
    { code: 'SPEND_CAP', error: decision.reason, retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
  );
}
