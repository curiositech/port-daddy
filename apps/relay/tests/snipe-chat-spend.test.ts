/**
 * Tests for the shared chat turn engine and its daily spend cap
 * (src/chat-engine.ts, src/chat-spend.ts, src/snipe-chat.ts — G′5).
 *
 * THE FINDING THESE TESTS EXIST TO KEEP CLOSED: a chat that can call a model
 * with no per-user budget in front of it. Everything below is written to fail
 * loudly if that ever becomes possible again, on ANY surface:
 *
 *   · the cap refuses a turn past the limit, with 429 + Retry-After;
 *   · a refused turn stores NOTHING and calls NO model — the two honest claims
 *     the refusal message makes;
 *   · the turn is charged BEFORE the call, so a client that hangs up mid-stream
 *     has still spent it;
 *   · caps are server-owned: a request body cannot move them, and a garbage
 *     deploy var can never parse as "unlimited";
 *   · rollover is key arithmetic — a new UTC day counts zero with nothing
 *     having had to run;
 *   · and the relay's FIRST chat surface goes through the same gate, because
 *     it now runs on the same engine rather than its own copy of it.
 */

import { parse as parseYaml } from 'yaml';
import { describe, it, expect } from 'vitest';
import {
  DAILY_MESSAGES_DEFAULT,
  DAILY_TOKENS_DEFAULT,
  addChatSpend,
  chargeTurn,
  dailyCaps,
  decideSpend,
  estimateTurnTokens,
  getChatSpend,
  spendWindowStart,
} from '../src/chat-spend.js';
import { CHAT_MAX_TOKENS, MAX_MESSAGE_CHARS, agentChatStore } from '../src/chat-engine.js';
import {
  SNIPE_AGENT_ID,
  extractProposalBlocks,
  handleSnipeChat,
  handleSnipeClear,
  handleSnipeHistory,
  parseProposalBlock,
  snipeModel,
  snipeProposalVerdicts,
} from '../src/snipe-chat.js';
import { handleShipwrightChat } from '../src/shipwright.js';
import { hashHex } from '../src/crypto.js';
import { makeTestD1, seedSession, seedSuggestion, type TestD1 } from './support/d1-sqlite.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const COOKIE = 'sess-value-abc';
const DAY = 24 * 60 * 60;

/** A model binding that records what it was asked and answers with canned text. */
function mockAi(result: unknown) {
  const seen: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  const ai = {
    async run(model: string, inputs: Record<string, unknown>) {
      seen.push({ model, inputs });
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Ai;
  return { ai, seen };
}

function makeEnv(t: TestD1, over: Record<string, unknown> = {}): Env {
  return { DB: t.db, PUBLIC_BASE_URL: BASE, ...over } as unknown as Env;
}

function chatReq(path: string, body: unknown, withCookie = true): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (withCookie) headers.set('Cookie', `__Host-pd_session=${COOKIE}`);
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function withSession(over: Record<string, unknown> = {}): { t: TestD1; env: Env; userId: string } {
  const t = makeTestD1();
  const { userId } = seedSession(t, { tokenHash: hashHex(COOKIE) });
  return { t, env: makeEnv(t, over), userId };
}

// ── The budget arithmetic ────────────────────────────────────────────────────

describe('chat spend — server-owned caps', () => {
  it('uses the committed defaults when nothing is configured', () => {
    expect(dailyCaps({} as Env)).toEqual({ messages: DAILY_MESSAGES_DEFAULT, tokens: DAILY_TOKENS_DEFAULT });
  });

  it('a positive integer var overrides; anything else falls back — never to unlimited, never to zero', () => {
    expect(dailyCaps({ CHAT_DAILY_MESSAGES: '5' } as unknown as Env).messages).toBe(5);
    for (const bad of ['', '0', '-1', 'unlimited', 'NaN', '  ']) {
      expect(dailyCaps({ CHAT_DAILY_MESSAGES: bad } as unknown as Env).messages).toBe(DAILY_MESSAGES_DEFAULT);
    }
  });

  it('the window key is UTC midnight, so a new day counts zero by arithmetic alone', () => {
    const noon = 1_760_000_000;
    const start = spendWindowStart(noon);
    expect(start % DAY).toBe(0);
    expect(start).toBeLessThanOrEqual(noon);
    expect(spendWindowStart(start + DAY)).toBe(start + DAY);
  });

  it('a turn is charged its input estimate PLUS the full output allowance', () => {
    expect(estimateTurnTokens(0, CHAT_MAX_TOKENS)).toBe(CHAT_MAX_TOKENS);
    expect(estimateTurnTokens(400, CHAT_MAX_TOKENS)).toBe(100 + CHAT_MAX_TOKENS);
  });

  it('a turn landing exactly on the token ceiling is the last affordable turn', () => {
    const caps = { messages: 100, tokens: 1_000 };
    const at = decideSpend({ caps, spent: { messages: 0, est_tokens: 900 }, now: 0, windowStart: 0, turnTokens: 100 });
    expect(at.allowed).toBe(true);
    const over = decideSpend({ caps, spent: { messages: 0, est_tokens: 901 }, now: 0, windowStart: 0, turnTokens: 100 });
    expect(over.allowed).toBe(false);
  });

  it('the message cap binds independently of the token cap', () => {
    const d = decideSpend({
      caps: { messages: 3, tokens: 1_000_000 },
      spent: { messages: 3, est_tokens: 0 },
      now: 0,
      windowStart: 0,
      turnTokens: 1,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/budget is spent/i);
  });

  it('the counter is one upsert per turn, and a missing row reads as zero', async () => {
    const t = makeTestD1();
    try {
      seedSession(t, { tokenHash: 'h' });
      const w = spendWindowStart(1_760_000_000);
      expect(await getChatSpend(t.db, 'snipe', 'u_1', w)).toEqual({ messages: 0, est_tokens: 0 });
      await addChatSpend(t.db, { agent: 'snipe', userId: 'u_1', windowStart: w, estTokens: 10 });
      await addChatSpend(t.db, { agent: 'snipe', userId: 'u_1', windowStart: w, estTokens: 5 });
      expect(await getChatSpend(t.db, 'snipe', 'u_1', w)).toEqual({ messages: 2, est_tokens: 15 });
      // A different agent has its own budget: one surface cannot drain another.
      expect(await getChatSpend(t.db, 'shipwright', 'u_1', w)).toEqual({ messages: 0, est_tokens: 0 });
      // ...and so does the next day.
      expect(await getChatSpend(t.db, 'snipe', 'u_1', w + DAY)).toEqual({ messages: 0, est_tokens: 0 });
    } finally {
      t.close();
    }
  });

  it('chargeTurn charges on acceptance and does not charge a refusal', async () => {
    const t = makeTestD1();
    try {
      seedSession(t, { tokenHash: 'h' });
      const caps = { messages: 1, tokens: 1_000_000 };
      const first = await chargeTurn(t.db, {
        agent: 'snipe', userId: 'u_1', now: 1_760_000_000, messageChars: 40, maxOutputTokens: 100, caps,
      });
      expect(first.allowed).toBe(true);
      const second = await chargeTurn(t.db, {
        agent: 'snipe', userId: 'u_1', now: 1_760_000_000, messageChars: 40, maxOutputTokens: 100, caps,
      });
      expect(second.allowed).toBe(false);
      const w = spendWindowStart(1_760_000_000);
      expect((await getChatSpend(t.db, 'snipe', 'u_1', w)).messages).toBe(1);
    } finally {
      t.close();
    }
  });
});

// ── The gate, through the real handler ───────────────────────────────────────

describe('snipe chat — the cap is enforced in the request path', () => {
  it('refuses past the cap with 429 + Retry-After, storing nothing and calling no model', async () => {
    const { t, env, userId } = withSession({ CHAT_DAILY_MESSAGES: '1' });
    try {
      const { ai, seen } = mockAi({ response: 'aye' });
      (env as { AI?: Ai }).AI = ai;

      const first = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'hello', stream: false }), env);
      expect(first.status).toBe(200);
      expect(seen).toHaveLength(1);

      const second = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'again', stream: false }), env);
      expect(second.status).toBe(429);
      const body = (await second.json()) as { code: string; error: string; retryAfterSeconds: number };
      expect(body.code).toBe('SPEND_CAP');
      expect(body.error).toMatch(/NOT stored/);
      expect(Number(second.headers.get('Retry-After'))).toBe(body.retryAfterSeconds);
      expect(body.retryAfterSeconds).toBeGreaterThan(0);

      // NOTHING SPENT: the model was not called a second time.
      expect(seen).toHaveLength(1);
      // NOTHING STORED: only the first turn's user + assistant rows exist.
      const rows = await agentChatStore(SNIPE_AGENT_ID).list(t.db, userId, 50);
      expect(rows.map((r) => r.content)).toEqual(['hello', 'aye']);
    } finally {
      t.close();
    }
  });

  it('the turn is charged BEFORE the model call — a failing model still spends it', async () => {
    const { t, env, userId } = withSession();
    try {
      (env as { AI?: Ai }).AI = mockAi(new Error('upstream exploded')).ai;
      const res = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'hello', stream: false }), env);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code: string }).code).toBe('AI_ERROR');
      const w = spendWindowStart(Math.floor(Date.now() / 1000));
      expect((await getChatSpend(t.db, SNIPE_AGENT_ID, userId, w)).messages).toBe(1);
      // ...and the operator's words survive the failure.
      const rows = await agentChatStore(SNIPE_AGENT_ID).list(t.db, userId, 50);
      expect(rows.map((r) => r.content)).toEqual(['hello']);
    } finally {
      t.close();
    }
  });

  it('a request body cannot move the cap', async () => {
    const { t, env } = withSession({ CHAT_DAILY_MESSAGES: '1' });
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'one', stream: false }), env);
      const sneaky = await handleSnipeChat(
        chatReq('/v1/snipe/chat', {
          message: 'two',
          stream: false,
          caps: { messages: 9999 },
          CHAT_DAILY_MESSAGES: '9999',
          maxTokens: 999_999,
        }),
        env,
      );
      expect(sneaky.status).toBe(429);
    } finally {
      t.close();
    }
  });

  it('the cap sits behind the session and shape gates — an unauthenticated turn never touches the counter', async () => {
    const { t, env } = withSession();
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      const anon = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'hi', stream: false }, false), env);
      expect(anon.status).toBe(401);
      const empty = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: '   ', stream: false }), env);
      expect(empty.status).toBe(400);
      const long = await handleSnipeChat(
        chatReq('/v1/snipe/chat', { message: 'x'.repeat(MAX_MESSAGE_CHARS + 1), stream: false }, true),
        env,
      );
      expect(long.status).toBe(400);
      expect(((await long.json()) as { code: string }).code).toBe('MESSAGE_TOO_LONG');
      const rows = t.raw.prepare('SELECT COUNT(*) AS n FROM agent_chat_spend').get() as { n: number };
      expect(rows.n).toBe(0);
    } finally {
      t.close();
    }
  });

  it('a cross-origin turn is refused before anything is charged', async () => {
    const { t, env } = withSession();
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'https://evil.example' });
      headers.set('Cookie', `__Host-pd_session=${COOKIE}`);
      const res = await handleSnipeChat(
        new Request(`${BASE}/v1/snipe/chat`, { method: 'POST', headers, body: JSON.stringify({ message: 'hi' }) }),
        env,
      );
      expect(res.status).toBe(403);
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM agent_chat_spend').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      t.close();
    }
  });

  it('no model binding ⇒ 503, stated honestly, nothing charged', async () => {
    const { t, env } = withSession();
    try {
      const res = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'hi', stream: false }), env);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('SNIPE_UNCONFIGURED');
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM agent_chat_spend').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      t.close();
    }
  });
});

describe('the first chat surface runs on the SAME engine, so it is capped too', () => {
  it('the relay’s other chat refuses past the cap with the same 429 envelope', async () => {
    // This is the regression that matters: the cap must not be a thing the
    // Engineman's surface remembered to do. It is a step in the shared engine,
    // so a surface that predates the cap gets it by construction.
    const { t, env } = withSession({ CHAT_DAILY_MESSAGES: '1' });
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      const first = await handleShipwrightChat(
        chatReq('/v1/shipwright/chat', { message: 'design me a fleet', stream: false }),
        env,
      );
      expect(first.status).toBe(200);
      const second = await handleShipwrightChat(
        chatReq('/v1/shipwright/chat', { message: 'again', stream: false }),
        env,
      );
      expect(second.status).toBe(429);
      expect(((await second.json()) as { code: string }).code).toBe('SPEND_CAP');
    } finally {
      t.close();
    }
  });

  it('the two surfaces keep separate budgets and separate conversations', async () => {
    const { t, env, userId } = withSession({ CHAT_DAILY_MESSAGES: '1' });
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'snipe turn', stream: false }), env);
      // The other surface still has its own allowance.
      const other = await handleShipwrightChat(
        chatReq('/v1/shipwright/chat', { message: 'other turn', stream: false }),
        env,
      );
      expect(other.status).toBe(200);
      // ...and neither can see the other's turns.
      const snipeRows = await agentChatStore(SNIPE_AGENT_ID).list(t.db, userId, 50);
      expect(snipeRows.map((r) => r.content)).toEqual(['snipe turn', 'aye']);
      const shipRows = t.raw.prepare('SELECT content FROM shipwright_chats ORDER BY id').all() as {
        content: string;
      }[];
      expect(shipRows.map((r) => r.content)).toEqual(['other turn', 'aye']);
    } finally {
      t.close();
    }
  });
});

// ── History / clear / tenancy ────────────────────────────────────────────────

describe('snipe chat — tenancy and controls', () => {
  it('history and clear are scoped to the signed-in account', async () => {
    const { t, env, userId } = withSession();
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: 'aye' }).ai;
      await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'mine', stream: false }), env);

      // Another account's rows in the same table stay invisible.
      t.raw
        .prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 99, ?, ?, 0)')
        .run('u_other', 'someone', 1);
      t.raw
        .prepare("INSERT INTO agent_chats (agent, user_id, role, content, created_at) VALUES ('snipe', 'u_other', 'user', 'theirs', 1)")
        .run();

      const hist = await handleSnipeHistory(
        new Request(`${BASE}/v1/snipe/history`, { headers: { Cookie: `__Host-pd_session=${COOKIE}` } }),
        env,
      );
      const body = (await hist.json()) as { messages: { content: string }[] };
      expect(body.messages.map((m) => m.content)).toEqual(['mine', 'aye']);

      const cleared = await handleSnipeClear(
        new Request(`${BASE}/v1/snipe/clear`, { method: 'POST', headers: { Cookie: `__Host-pd_session=${COOKIE}` } }),
        env,
      );
      expect(cleared.status).toBe(200);
      const left = t.raw.prepare('SELECT user_id FROM agent_chats').all() as { user_id: string }[];
      expect(left.map((r) => r.user_id)).toEqual(['u_other']);
      expect(userId).not.toBe('u_other');
    } finally {
      t.close();
    }
  });

  it('history without a session is 401', async () => {
    const { t, env } = withSession();
    try {
      const res = await handleSnipeHistory(new Request(`${BASE}/v1/snipe/history`), env);
      expect(res.status).toBe(401);
    } finally {
      t.close();
    }
  });
});

// ── The proposal verdict ─────────────────────────────────────────────────────

describe('snipe chat — the proposal verdict is computed, not claimed', () => {
  const reply = [
    'Here is one worth having.',
    '',
    '```skill',
    'name: migration-backfill-verify',
    'description: Walks a migration, its backfill and its verification as one dance.',
    'rationale: Three PRs hand-rolled it.',
    '```',
    '',
    'Approve it and I will open the PR.',
  ].join('\n');

  it('finds fenced skill blocks and parses their three keys', () => {
    const blocks = extractProposalBlocks(reply);
    expect(blocks).toHaveLength(1);
    expect(parseProposalBlock(blocks[0] as string)).toMatchObject({
      ok: true,
      proposal: { name: 'migration-backfill-verify' },
    });
  });

  // ── Prose in a YAML field ─────────────────────────────────────────────────
  //
  // The block's three values are sentences the model wrote, and YAML rejects
  // sentences: an unquoted scalar containing ": " parses as a nested mapping
  // and throws. The system prompt's own template asked for exactly that shape
  // ("description: One or two sentences: what the skill does..."), so a model
  // following instructions produced a block the parser refused — and refused
  // with "it needs name, description and rationale" about a block that had all
  // three. Both halves are fixed: the template no longer contains an inner
  // colon, and a block YAML cannot read is re-read as the three-key shape it is
  // documented to be.

  it('a description containing a colon is a proposal, not a parse error', () => {
    const block = [
      'name: migration-backfill-verify',
      'description: Verifies a backfill: rows match the source of truth. NOT for schema changes (use d1-and-supabase-migrations).',
      'rationale: Three PRs hand-rolled it.',
    ].join('\n');

    // Premise: this really is the case YAML refuses. Without this the test
    // could pass because the parser never had a problem with it.
    expect(() => parseYaml(block)).toThrow();

    expect(parseProposalBlock(block)).toMatchObject({
      ok: true,
      proposal: {
        name: 'migration-backfill-verify',
        description:
          'Verifies a backfill: rows match the source of truth. NOT for schema changes (use d1-and-supabase-migrations).',
      },
    });
  });

  it('the fallback never overrides a block YAML can read', () => {
    // The line reader takes values literally, so it would keep the quotes YAML
    // strips. Reading this back unquoted is what proves YAML still wins when it
    // succeeds.
    const quoted = 'name: a\ndescription: "Verifies a backfill: rows match."\nrationale: r';
    expect(parseProposalBlock(quoted)).toMatchObject({
      ok: true,
      proposal: { description: 'Verifies a backfill: rows match.' },
    });
  });

  it('a value spanning several lines keeps its continuation lines', () => {
    const block = [
      'name: a',
      'description: Verifies a backfill: rows match.',
      '  It also checks counts.',
      'rationale: r',
    ].join('\n');
    const parsed = parseProposalBlock(block);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.proposal.description).toContain('It also checks counts.');
  });

  it('an unreadable block is not reported as an incomplete one', () => {
    // The two failures used to share a message, so an operator holding a
    // complete proposal was told it was missing keys.
    const unreadable = snipeProposalVerdicts(
      '```skill\nname: a\ndescription: Verifies a backfill: rows match.\n```',
      [],
    );
    expect(unreadable[0]?.ok).toBe(false);
    expect(unreadable[0]?.message).toMatch(/could not be read/);

    const incomplete = snipeProposalVerdicts('```skill\nname: only-a-name\n```', []);
    expect(incomplete[0]?.message).toMatch(/needs name, description and rationale/);
    expect(incomplete[0]?.message).not.toBe(unreadable[0]?.message);
  });

  it('a reasoning trace is never a source of proposals', () => {
    const sneaky = '<think>```skill\nname: hidden\n```</think> nothing here';
    expect(extractProposalBlocks(sneaky)).toHaveLength(0);
  });

  it('badges a proposal the account already has, whatever the agent said about it', () => {
    const v = snipeProposalVerdicts(reply, ['Migration Backfill Verify']);
    expect(v).toHaveLength(1);
    expect(v[0]?.ok).toBe(false);
    expect(v[0]?.message).toMatch(/already been proposed/);
  });

  it('badges a genuinely new proposal as new', () => {
    const v = snipeProposalVerdicts(reply, ['something-else']);
    expect(v[0]).toMatchObject({ ok: true, slug: 'migration-backfill-verify' });
  });

  it('a block missing a required key is refused rather than half-accepted', () => {
    const v = snipeProposalVerdicts('```skill\nname: only-a-name\n```', []);
    expect(v[0]?.ok).toBe(false);
    expect(v[0]?.slug).toBeNull();
  });

  // Every verdict test above hands `knownNames` to the pure function as a
  // literal, so none of them touches the query that produces it. That query is
  // the whole novelty claim: `knownSuggestionNames` is scoped by user_id, and
  // if it returns [] — a real failure, or the wrong user — every proposal is
  // badged "is new to this account", asserting novelty nothing verified.

  it('the novelty verdict is computed from this user\'s own stored suggestions', async () => {
    const { t, env, userId } = withSession();
    try {
      // Stored under a differently-shaped id than the reply proposes, so the
      // fold through normalizeSkillName is part of what this pins.
      seedSuggestion(t, { id: 'sug_seen01', userId, repo: 'octocat/port-daddy', skillName: 'Migration Backfill Verify' });
      (env as { AI?: Ai }).AI = mockAi({ response: reply }).ai;
      const res = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'propose', stream: false }), env);
      const body = (await res.json()) as { proposals: { ok: boolean; message: string }[] };
      expect(body.proposals[0]?.ok).toBe(false);
      expect(body.proposals[0]?.message).toMatch(/already been proposed/);
    } finally {
      t.close();
    }
  });

  it('another account\'s suggestion does not make this account\'s proposal old', async () => {
    const { t, env } = withSession();
    try {
      // Same skill name, different owner. Without the user_id scope this comes
      // back "already proposed" and leaks that some other account was offered
      // it — the reason the query is scoped rather than global.
      t.raw
        .prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, ?, ?, ?, 0)')
        .run('u_other', 987654, 'someone-else', Math.floor(Date.now() / 1000));
      seedSuggestion(t, { id: 'sug_other1', userId: 'u_other', repo: 'other/repo', skillName: 'migration-backfill-verify' });
      (env as { AI?: Ai }).AI = mockAi({ response: reply }).ai;
      const res = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'propose', stream: false }), env);
      const body = (await res.json()) as { proposals: { ok: boolean; slug: string }[] };
      expect(body.proposals[0]).toMatchObject({ ok: true, slug: 'migration-backfill-verify' });
    } finally {
      t.close();
    }
  });

  it('the buffered envelope carries the verdicts alongside the reply', async () => {
    const { t, env } = withSession();
    try {
      (env as { AI?: Ai }).AI = mockAi({ response: reply }).ai;
      const res = await handleSnipeChat(chatReq('/v1/snipe/chat', { message: 'propose', stream: false }), env);
      const body = (await res.json()) as { reply: string; proposals: { ok: boolean; slug: string }[] };
      expect(body.proposals).toHaveLength(1);
      expect(body.proposals[0]).toMatchObject({ ok: true, slug: 'migration-backfill-verify' });
    } finally {
      t.close();
    }
  });
});

describe('snipe chat — model selection', () => {
  it('SNIPE_MODEL overrides per-surface; absent it, the relay’s one committed default is used', () => {
    expect(snipeModel({ SNIPE_MODEL: 'configured-id' } as unknown as Env)).toBe('configured-id');
    const fallback = snipeModel({} as Env);
    expect(typeof fallback).toBe('string');
    expect(fallback.length).toBeGreaterThan(0);
    // Whitespace-only is not a configuration.
    expect(snipeModel({ SNIPE_MODEL: '   ' } as unknown as Env)).toBe(fallback);
  });
});
