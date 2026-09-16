/**
 * apps/relay/src/chat-engine.ts — the ONE conversational turn engine the relay
 * runs. Every chat surface is a descriptor handed to this module; none of them
 * is a second implementation.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS: THE SECOND CHAT IS WHERE SAFETY GOES TO DIE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The relay's first chat surface grew its guards one at a time — session gate,
 * same-origin check, message bound, unconfigured-binding refusal, persist-
 * before-call, a pass-through stream that persists on flush. Copying that file
 * to add a second surface would copy the guards as they stand TODAY and then
 * let the two copies drift: the next fix lands in one of them, and the other
 * quietly becomes the weaker surface. That is how a chat ends up able to spend
 * without a cap.
 *
 * So the guards live here, once, in a fixed order that no descriptor can
 * reorder or skip:
 *
 *   1. session          → 401
 *   2. same-origin      → 403
 *   3. message shape    → 400
 *   4. model binding    → 503 (deploy-before-provision, stated honestly)
 *   5. SPEND CAP        → 429 + Retry-After     ← nothing stored, nothing spent
 *   6. charge the turn                          ← before the call, on purpose
 *   7. persist the user message                 ← a failed call never eats input
 *   8. call the model, stream or buffer
 *   9. persist the reply; append the surface's trailer, if it has one
 *
 * A surface supplies WHAT it says (its prompt), WHERE its turns live (a store),
 * and optionally what rides along after a reply. It does not get a say in the
 * order above, and it cannot reach the model without passing step 5.
 *
 * ── WHAT A DESCRIPTOR MAY NOT DO ────────────────────────────────────────────
 *
 * There is no hook before the cap, no way to raise the cap, and no way to reach
 * `ai.run` except by returning from this function's own call site. A new chat
 * surface is a `ChatAgent` literal; if that literal is the only new code, the
 * new surface is capped, scoped and fail-closed by construction.
 *
 * ── TENANCY ─────────────────────────────────────────────────────────────────
 *
 * Every store read and write is scoped to the signed-in user's id, and (for the
 * generic store) to the agent as well. One account can never read another's
 * conversation; one surface can never read another's turns inside the same
 * account. The model sees this user's own conversation with THIS agent plus the
 * agent's static prompt — no repo contents, no other tenants, no secrets.
 */

import type { Env } from './types.js';
import { resolveSession, isSameOrigin } from './auth-github.js';
import { chargeTurn, dailyCaps, spendCapResponse } from './chat-spend.js';

/** Upper bound on one operator message — D1 row sanity and prompt bounds. */
export const MAX_MESSAGE_CHARS = 4_000;
/** How much conversation the model sees per turn (and a page reloads). */
export const HISTORY_WINDOW = 40;
/** The output allowance one turn is given — and is charged for up front. */
export const CHAT_MAX_TOKENS = 2_048;

export interface ChatMessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

/**
 * Where one surface's turns live. Deliberately three methods: everything the
 * engine needs and nothing that would let a surface reach past its own rows.
 */
export interface ChatStore {
  insert(db: D1Database, m: { userId: string; role: 'user' | 'assistant'; content: string; now: number }): Promise<void>;
  list(db: D1Database, userId: string, limit: number): Promise<ChatMessageRow[]>;
  clear(db: D1Database, userId: string): Promise<number>;
}

/**
 * One chat surface. The engine reads this; it never writes to it, and nothing
 * here can change the order of the guards.
 */
export interface ChatAgent {
  /** Stable id — the spend counter's key, and (for the generic store) the row scope. */
  id: string;
  /** The static system prompt prepended to every turn's history window. */
  systemPrompt: string;
  /** The model id in force, resolved from deploy-time vars by the surface. */
  model(env: Env): string;
  /** Where this surface's turns live. */
  store: ChatStore;
  /** The 503 envelope's code when no model binding is provisioned. */
  unconfiguredCode: string;
  /** The 503 envelope's message. Owned by the surface so it can be honest about itself. */
  unconfiguredError: string;
  /**
   * Extra fields for the BUFFERED reply envelope, computed server-side from the
   * reply text. Used for verdicts a model must not be able to self-report.
   */
  bufferedExtras?(replyText: string): Record<string, unknown>;
  /**
   * A final synthetic SSE `data:` line appended AFTER every real token, or null
   * for none. It is never blended into the persisted content, so a model cannot
   * forge it by emitting the same words.
   */
  streamTrailer?(replyText: string): string | null;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

/** Redaction-safe error text; never leaks a token-shaped string. */
export function publicError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[A-Za-z0-9+/=_-]{60,}/g, '[redacted]').slice(0, 240);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

interface ChatBody {
  message?: string;
  /** false ⇒ buffered JSON reply (tests / non-SSE clients). Default: stream. */
  stream?: boolean;
}

/** Streaming SSE line shapes accepted from the model binding (defensive). */
function tokenOf(payload: string): string {
  try {
    const o = JSON.parse(payload) as {
      response?: unknown;
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    if (typeof o.response === 'string') return o.response;
    const delta = o.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  } catch {
    return '';
  }
}

/** Reconstruct the full assistant text from raw SSE wire text. */
export function assembleSseText(raw: string): string {
  let out = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    out += tokenOf(payload);
  }
  return out;
}

/** GET the signed-in user's own log for one surface. */
export async function runChatHistory(request: Request, env: Env, agent: ChatAgent): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const messages = await agent.store.list(env.DB, session.user.id, HISTORY_WINDOW);
  return json(200, { code: 'OK', error: null, messages });
}

/** DELETE the signed-in user's own log for one surface. */
export async function runChatClear(request: Request, env: Env, agent: ChatAgent): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) {
    return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  }
  const deleted = await agent.store.clear(env.DB, session.user.id);
  return json(200, { code: 'OK', error: null, deleted });
}

/**
 * ONE chat turn, for any surface.
 *
 * The guard order in the module banner is this function's body, in that order,
 * with no branch that reaches the model without passing all of it. In
 * particular the spend cap sits between "the request is well-formed" and "the
 * message is stored", which is the only position where a refusal can honestly
 * say *nothing was stored and nothing was spent*.
 */
export async function runChatTurn(request: Request, env: Env, agent: ChatAgent): Promise<Response> {
  // 1–2. Who, and from where.
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) {
    return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  }

  // 3. Shape.
  const body = await readJson<ChatBody>(request);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return json(400, { code: 'BAD_JSON', error: 'Request body must be JSON {message: string}' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return json(400, { code: 'MESSAGE_TOO_LONG', error: `message exceeds ${MAX_MESSAGE_CHARS} chars` });
  }

  // 4. The binding. A relay deployed before provisioning says so rather than 500ing.
  if (!env.AI) {
    return json(503, { code: agent.unconfiguredCode, error: agent.unconfiguredError });
  }
  const ai = env.AI;
  const db = env.DB;
  const userId = session.user.id;
  const now = Math.floor(Date.now() / 1000);

  // 5–6. THE CAP. Before the message is stored and before the model is called,
  // so a refusal is honest on both counts; charged at acceptance, so a client
  // that hangs up mid-stream has still spent its turn.
  const decision = await chargeTurn(db, {
    agent: agent.id,
    userId,
    now,
    messageChars: message.length,
    maxOutputTokens: CHAT_MAX_TOKENS,
    caps: dailyCaps(env),
  });
  if (!decision.allowed) return spendCapResponse(decision);

  // 7. Persist the operator's words before spending them — a failed generation
  // must never lose input the operator typed.
  await agent.store.insert(db, { userId, role: 'user', content: message, now });

  const history = await agent.store.list(db, userId, HISTORY_WINDOW);
  const messages = [
    { role: 'system', content: agent.systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const model = agent.model(env) as Parameters<typeof ai.run>[0];

  const persistReply = async (content: string): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed) return;
    await agent.store.insert(db, {
      userId,
      role: 'assistant',
      content: trimmed,
      now: Math.floor(Date.now() / 1000),
    });
  };

  // 8a. Buffered mode — one JSON envelope, no SSE.
  if (body?.stream === false) {
    try {
      const res = (await ai.run(model, { messages, max_tokens: CHAT_MAX_TOKENS })) as { response?: string };
      const reply = (res.response ?? '').trim();
      await persistReply(reply);
      return json(200, { code: 'OK', error: null, reply, ...(agent.bufferedExtras?.(reply) ?? {}) });
    } catch (e) {
      return json(500, { code: 'AI_ERROR', error: `model request failed: ${publicError(e)}` });
    }
  }

  // 8b. Streaming mode — forward the upstream bytes unchanged while
  // accumulating the text; flush() runs after the last chunk is forwarded.
  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = (await ai.run(model, {
      messages,
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
    })) as unknown as ReadableStream<Uint8Array>;
  } catch (e) {
    return json(500, { code: 'AI_ERROR', error: `model request failed: ${publicError(e)}` });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let raw = '';
  const forwarded = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          raw += decoder.decode(value, { stream: true });
          controller.enqueue(value);
        }

        raw += decoder.decode();
        const text = assembleSseText(raw);
        await persistReply(text);
        // The trailer rides the SAME stream as one final synthetic line, AFTER
        // every real token, and is never part of `raw` or of what is persisted —
        // so it can never be mistaken for, or forged as, the model's own words.
        const trailer = agent.streamTrailer?.(text) ?? null;
        if (trailer) controller.enqueue(encoder.encode(trailer));
        controller.close();
      } catch (e) {
        controller.error(e);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(forwarded, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  The generic store — agent_chats
// ══════════════════════════════════════════════════════════════════════════

/**
 * A {@link ChatStore} over the generic `agent_chats` table, scoped to one
 * agent id. A third chat surface is a new value in the `agent` column: no
 * migration, no new table, no new SQL.
 *
 * Both the agent and the user id appear in every WHERE clause. Dropping either
 * would silently widen a read across surfaces or across tenants, so neither is
 * ever optional here.
 */
export function agentChatStore(agent: string): ChatStore {
  return {
    async insert(db, m) {
      await db
        .prepare('INSERT INTO agent_chats (agent, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(agent, m.userId, m.role, m.content, m.now)
        .run();
    },
    async list(db, userId, limit) {
      // Newest-first then reversed: conversation order is by the AUTOINCREMENT
      // id, never created_at — two turns routinely share a unix second.
      const rows = await db
        .prepare(
          'SELECT id, role, content, created_at FROM agent_chats WHERE agent = ? AND user_id = ? ORDER BY id DESC LIMIT ?',
        )
        .bind(agent, userId, limit)
        .all<ChatMessageRow>();
      return (rows.results ?? []).reverse();
    },
    async clear(db, userId) {
      const res = await db
        .prepare('DELETE FROM agent_chats WHERE agent = ? AND user_id = ?')
        .bind(agent, userId)
        .run();
      return res.meta?.changes ?? 0;
    },
  };
}
