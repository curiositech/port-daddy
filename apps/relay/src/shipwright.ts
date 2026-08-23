/**
 * The Shipwright chat — a conversational fleet-config architect (MVP v1).
 *
 *   GET  /v1/shipwright/history  (session)                → the user's own log
 *   POST /v1/shipwright/chat     (session + same-origin)  → Workers AI, SSE
 *   POST /v1/shipwright/clear    (session + same-origin)  → delete own history
 *   POST /v1/shipwright/open-pr  (session + same-origin)  → PR in the user's repo
 *
 * The Shipwright interviews the operator (repo + goals), proposes a bespoke
 * ship roster, and emits a complete pd-fleet.yml in a fenced block the page
 * (shipwright-page.ts) renders with copy/download buttons.
 *
 * Trust boundary: every route is scoped to the signed-in web user
 * (resolveSession → users.id); the conversation is stored per-user in
 * shipwright_chats and one session can never read or write another account's
 * rows. State-changing POSTs carry the same defense-in-depth same-origin
 * check the other session POSTs use. Blast radius of the AI call: the model
 * only ever sees THIS user's conversation + the static system prompt — no
 * repo contents, no other tenants' data, no secrets.
 *
 * Fail semantics (D12): writes fail closed — no session ⇒ 401, cross-origin
 * ⇒ 403, missing [ai] binding ⇒ 503 SHIPWRIGHT_UNCONFIGURED (the same
 * "deploys before provisioning" idiom as billing), model failure ⇒ 500
 * AI_ERROR with a redaction-safe message. The user message is persisted
 * BEFORE the model call, so a failed generation never loses operator input.
 *
 * PR-OPENING (grand-plan §shipwright-pr-open): the Shipwright's hands are no
 * longer tied. Once a roster VALIDATES, the page offers an "Open PR" button —
 * a plain form POST to {@link handleShipwrightOpenPr} — that commits the YAML
 * to a fresh branch of the operator's own repo and opens a PR, through the
 * SAME zero-trust mutation core the fleet control-plane uses
 * (`commitFilesAndOpenPr` in fleet-control.ts, the only code path that can
 * write). The click is the product (a user-initiated action), not an approval
 * gate — no new permission-ask machinery (ADR-0109 / D11). What the
 * Shipwright still cannot do, and still says so: read the repo, push to an
 * existing branch, or merge anything — PR review/merge stays the gate.
 *
 * PR-route trust boundary, in order of the checks:
 *   1. session + same-origin (as every Shipwright write);
 *   2. the server RE-VALIDATES the submitted YAML with `validateFleetYaml` —
 *      a client claiming "it validated" is a claim, not evidence, and an
 *      invalid roster 400s here no matter what the page showed (fail-closed);
 *   3. provenance: the YAML must be a fenced block the Shipwright actually
 *      emitted in THIS user's own stored conversation — the PR body then
 *      carries that provenance honestly;
 *   4. tenancy (the billing-page idiom, ADR-0116): `userOwnsInstallation`
 *      gates on GitHub's own GET /user/installations answer, and the target
 *      repo must resolve (via the App JWT) to that SAME installation — so a
 *      session can never target another tenant's installation or repo, and
 *      never supplies an id the server didn't offer it.
 *
 * VALIDATION (grand-plan §shipwright-yaml-validate): the model's emitted
 * pd-fleet.yml is never trusted on its say-so. Every fenced ```yaml/```yml
 * block in an assistant message is piped through the SAME deterministic
 * validator the executor trusts (`validateFleetYaml` in fleet-parser.ts, the
 * engine behind POST /v1/fleet/validate) before the page is allowed to badge
 * it pass/fail. The model never self-reports validity — it cannot, since the
 * verdict is computed server-side from the parser, not asked of the LLM.
 * Verdicts are NOT persisted (no schema change): they are recomputed from the
 * stored message content on every read, so a schema/parser upgrade re-badges
 * old conversations for free. See {@link validateEmittedYaml}.
 *
 * SPEND CAPS (grand-plan §chat-spend-caps): per-message chars and the
 * 40-message history window bound one turn, but nothing bounded how many
 * turns — a looping client could burn Workers AI quota indefinitely. Each
 * chat turn now checks a per-user DAILY budget (messages + estimated tokens,
 * one D1 counter row per user per UTC day) BEFORE the model call; a spent
 * budget refuses with 429 + `Retry-After` (seconds to UTC midnight) and an
 * honest reason the page shows in-chat — and the refused user message is NOT
 * persisted, so a refusal never half-spends a turn. The budget constants are
 * server-owned: committed defaults, overridable ONLY by deploy-time vars
 * (SHIPWRIGHT_DAILY_MESSAGES / SHIPWRIGHT_DAILY_TOKENS), never caller input.
 * This is deliberately NOT the per-harbor X8 budget machinery — chat is
 * user-scoped, so a plain D1 counter row keyed (user_id, window_start)
 * suffices: no ledger, no reservations, no cross-plane accounting.
 */

import type { Env } from './types.js';
import { modelBoardPromptFragment } from './model-dossier.js';
import { resolveSession, isSameOrigin, userOwnsInstallation } from './auth-github.js';
import {
  insertShipwrightMessage,
  listShipwrightMessages,
  clearShipwrightChats,
  getShipwrightSpend,
  addShipwrightSpend,
} from './db.js';
import { validateFleetYaml, type FleetValidationResult } from './fleet-parser.js';
import { commitFilesAndOpenPr } from './fleet-control.js';
import {
  getRepoInstallationId,
  getInstallationTokenCached,
  getRepoDefaultBranch,
} from './github-app.js';

// ── Bounds (protect Workers AI quota + D1 row size) ──────────────────────────

export const MAX_MESSAGE_CHARS = 4_000;
/** How much conversation the model sees per turn (and the page reloads). */
export const HISTORY_WINDOW = 40;
const CHAT_MAX_TOKENS = 2_048;

/** Committed default; the SHIPWRIGHT_MODEL var overrides without a deploy. */
export const SHIPWRIGHT_DEFAULT_MODEL = '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';

export function shipwrightModel(env: Env): string {
  return env.SHIPWRIGHT_MODEL?.trim() || SHIPWRIGHT_DEFAULT_MODEL;
}

// ── Daily spend caps (chat-spend-caps) ───────────────────────────────────────
//
// Server-owned budget constants. Overridable only by deploy-time vars — a
// request body never reaches these numbers. Sizing: the token estimate below
// floors a turn at CHAT_MAX_TOKENS (2 048) even for an empty prompt, so
// 200 000 tokens ≈ the same order as 60 maximal turns — the two caps bind
// together, messages for loopers, tokens for wall-of-text loopers.

export const SHIPWRIGHT_DAILY_MESSAGES_DEFAULT = 60;
export const SHIPWRIGHT_DAILY_TOKENS_DEFAULT = 200_000;
/** Coarse chars→tokens divisor; deliberately conservative (English ≈ 4). */
const CHARS_PER_TOKEN = 4;
const DAY_SECONDS = 24 * 60 * 60;

export interface ShipwrightDailyCaps {
  messages: number;
  tokens: number;
}

/** The caps in force: env override when it parses as a positive integer, else
 * the committed default. Fail-safe: garbage can never mean "unlimited". */
export function shipwrightDailyCaps(env: Env): ShipwrightDailyCaps {
  const parse = (raw: string | undefined, fallback: number): number => {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    messages: parse(env.SHIPWRIGHT_DAILY_MESSAGES, SHIPWRIGHT_DAILY_MESSAGES_DEFAULT),
    tokens: parse(env.SHIPWRIGHT_DAILY_TOKENS, SHIPWRIGHT_DAILY_TOKENS_DEFAULT),
  };
}

/** UTC midnight (unix seconds) of the day containing `now` — the counter key.
 * A new day is a new key, so rollover resets the count by arithmetic alone. */
export function spendWindowStart(now: number): number {
  return now - (now % DAY_SECONDS);
}

/**
 * Estimated token cost of one chat turn, charged at acceptance time: the new
 * message's input tokens plus the FULL output allowance (CHAT_MAX_TOKENS) —
 * we cannot know the real completion length before the model runs, and a
 * budget that guesses low protects nothing. An estimate, and says so: history
 * re-sent per turn is bounded separately (HISTORY_WINDOW × MAX_MESSAGE_CHARS)
 * and is deliberately not double-charged here.
 */
export function estimateTurnTokens(messageChars: number): number {
  return Math.ceil(messageChars / CHARS_PER_TOKEN) + CHAT_MAX_TOKENS;
}

/** The honest refusal copy — the 429 body's `error`, rendered in-chat by the
 * page. States what ran out, that nothing was stored, and when it resets. */
export function spendCapNotice(retryAfterSeconds: number): string {
  const hours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
  return (
    `Today's Shipwright budget is spent — the daily cap on chat turns keeps model spend bounded ` +
    `for every account. It resets at UTC midnight (about ${hours}h). ` +
    `Your message was NOT stored; bring it back then.`
  );
}

// ── The system prompt — colorful, but competent ──────────────────────────────

export const SHIPWRIGHT_SYSTEM_PROMPT = `You are THE SHIPWRIGHT — Port Daddy's naval architect for AI agent fleets. You design bespoke crews of AI "ships" (agents) that watch a GitHub repository: reviewing PRs, hunting bugs, imagining products, and holding work to its own contract. You speak with warm dockside color (a well-placed "aye" or "keel" is welcome), but you are a rigorous engineer first — every recommendation is concrete, justified, and buildable.

YOUR PROCESS, in order:
1. GREET the operator briefly (once — never re-greet mid-conversation).
2. ASK for what you need before designing: (a) the repository — owner/name, primary language(s), what the project is; (b) their goals — what should the fleet watch, review, or imagine? How strict? What budget appetite?
3. PROPOSE a bespoke ship roster fitted to those answers, before writing any YAML. For each ship: its name, its job in one line, and why THIS repo needs it. Draw from the standard classes:
   - REVIEWER ships — code-reviewer (severity-ranked findings, cites specifics), red-team (tries to break security-relevant diffs; silence is success), tautology-sniffer (catches tests that assert their own mocks), qa (breaks changes with hostile inputs).
   - IDEATION ships — spark (high-temperature buildable product ideas), spider (strict two-premise syllogisms: A + B therefore C), lookout (contradictions and trouble across open PRs; alerts, never fixes), snipe (proposes ONE reusable skill when a PR hand-rolls something).
   - THE PURSER — the adversarial gatekeeper: steel-mans each PR into its strongest contract and authors tests against it. Give the purser a "graft" list of repo skill ids prepended to its prompt; the canonical pair is sandboxed-adversarial-test-harness and steel-man-argument. Start it blocking: false — advisory until trusted.
   - NAMED ROLE PRESETS — six ready-to-paste ship blocks live in the port-daddy repo's roles/ directory; when an operator's goal matches one, offer the preset BY NAME before designing bespoke: cleanup (stacks small mechanical fixes as PRs on top of the reviewed diff), adversarial-test-writing (the purser packaged as a named role), doc-writing (stacks missing docs), unit-test-writing (stacks coverage-gap tests, sandbox-gated), readme-fixes (stacks README corrections), homebrew-release-shepherd (reviews release-surface drift — findings only, never writes). All six ship blocking: false and a quoted '@cf/qwen/qwen3-30b-a3b-fp8' model.
   Fit the roster to the repo: a small library wants 2-3 ships, not eleven. Say what you left out and why. Invite pushback.
4. When the operator is happy with the roster, EMIT the complete pd-fleet.yml in ONE fenced \`\`\`yaml block — a full, valid file, never a fragment. Schema:
   - Top-level key \`fleet:\` with \`name\`, \`harbor: "{project}:fleet"\`, \`limits:\` (\`max_concurrent_spawns\`, \`max_spawns_per_hour\`, \`budget_usd_per_day\`), and \`agents:\`.
   - Each agent: \`trigger:\` (e.g. pull_request:opened, git:committed — string or list), \`backend: cli:claude-code\`, a \`fallbacks:\` list ending with \`- backend: cloudflare\` + \`model: '@cf/...'\` (this is the model the cloud executor runs), \`cooldown_ms\`, \`singleton: true\`, \`allowedTools\` where relevant, a \`prompt: |\` block with the ship's full working instructions, \`identity: "{project}:fleet:<ship>"\`, and a one-line \`telos:\`.
   - Ideation ships add \`class: ideation\` and a \`temperature:\`. The purser uses \`class: purser\`, \`blocking: false\`, and a \`graft:\` list.
   - Choose every \`model:\` id FROM THE MODEL BOARD below, quoted exactly, and justify the pick by role fit and price (cheap agentic for reviewers reading diffs, the agentic coder tier for ships that must emit runnable code, frontier tiers only where a single judgment is the product).
5. AFTER the YAML, tell the operator how to ship it, in this order: (a) once the roster shows the green "Validates" badge, they can click the "Open PR" button right on this page — you (via the relay) will commit pd-fleet.yml to a fresh branch of their repo and open the PR for them, provided the Port Daddy Fleet GitHub App is installed on that repo; (b) or commit it by hand: save the block as pd-fleet.yml at the repo root and open a PR to the default branch (git checkout -b fleet-setup && git add pd-fleet.yml && git commit && gh pr create). Either way, remind them the fleet only fires once the PR is merged and the App is installed.

HARD RULES:
- BE HONEST ABOUT YOUR HANDS: you CAN open a PR — but only when the operator clicks "Open PR" beside a roster that passed validation, only into a repo whose Port Daddy Fleet GitHub App installation they own, and only as a fresh branch + PR (never a push, never a merge — their review is the gate). You still cannot read their repo or change anything anywhere else. Say exactly this much whenever you hand over YAML — no more, no less.
- Never invent repo facts the operator didn't give you — ask instead.
- Never emit a partial pd-fleet.yml, and never emit one before you know repo + goals.
- Keep replies tight: a few short paragraphs or a compact list. No walls of text.

${modelBoardPromptFragment()}`;

// ── Envelope helpers ─────────────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function publicError(e: unknown): string {
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

// ── GET /v1/shipwright/history ───────────────────────────────────────────────

/** The signed-in user's own conversation, oldest → newest. Session-scoped. */
export async function handleShipwrightHistory(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const messages = await listShipwrightMessages(env.DB, session.user.id, HISTORY_WINDOW);
  return json(200, {
    code: 'OK',
    error: null,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      // Only the Shipwright's own turns can carry a roster to badge.
      yaml: m.role === 'assistant' ? validateEmittedYaml(m.content) : [],
    })),
  });
}

// ── POST /v1/shipwright/clear ────────────────────────────────────────────────

/** Delete the signed-in user's own conversation (ADR-0101 delete control). */
export async function handleShipwrightClear(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const cleared = await clearShipwrightChats(env.DB, session.user.id);
  return json(200, { code: 'OK', error: null, cleared });
}

// ── POST /v1/shipwright/chat ─────────────────────────────────────────────────

interface ChatBody {
  message?: string;
  /** false ⇒ buffered JSON reply (tests / non-SSE clients). Default: stream. */
  stream?: boolean;
}

/** Workers AI streaming SSE line shapes we accept (defensive across models). */
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

// ── YAML validation badge (shipwright-yaml-validate) ─────────────────────────

/**
 * Extract every fenced ```yaml / ```yml code block from a chat message, in
 * document order. Mirrors the client's own `splitBlocks` fence scan exactly
 * (same delimiter, same lang normalization, same trailing-whitespace trim) so
 * the i-th block found here is the i-th yaml/yml panel the page renders —
 * positional alignment is how the client matches a verdict to its panel
 * without persisting a link between them. `<think>` blocks are stripped
 * first (deepseek-style reasoning traces are never a source of roster YAML).
 *
 * Design rationale: this is intentionally a dumb regex scan, not a markdown
 * parser — the ONLY thing that matters is finding the same substrings the
 * page's own renderer will turn into yaml panels, so validation and display
 * never disagree about which blocks exist.
 *
 * @param content Raw stored message text (model-emitted, therefore hostile —
 *   never interpreted as anything but a string to scan).
 * @returns Fenced block bodies, trailing whitespace trimmed, in order.
 */
export function extractFencedYamlBlocks(content: string): string[] {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const out: string[] = [];
  const fence = /```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(stripped))) {
    const lang = (m[1] ?? '').trim().toLowerCase();
    if (lang === 'yaml' || lang === 'yml') {
      out.push((m[2] ?? '').replace(/\s+$/, ''));
    }
  }
  return out;
}

/**
 * Compute the honest validation verdict for every roster the Shipwright has
 * emitted in one message, by piping each fenced block through the SAME
 * deterministic parser the executor trusts. This is the safety substrate for
 * PR-opening (shipwright-pr-open hard-depends on it): a roster that fails
 * here must never render as safe to copy/download without a loud warning,
 * and the model itself never gets a vote — only `validateFleetYaml`'s
 * structured errors do. Fails CLOSED: any unexpected throw from extraction or
 * validation becomes an explicit invalid verdict, never a silently-dropped
 * or silently-valid roster.
 *
 * Motivation: an LLM claiming "here is a full, valid file" is not evidence —
 * it is a claim. The whole point of this function is to replace that claim
 * with a fact computed by code the model cannot influence.
 *
 * @param content The stored (or in-flight) assistant message text to scan.
 * @returns One {@link FleetValidationResult} per fenced yaml/yml block found,
 *   in document order; empty when the message has no such block.
 */
export function validateEmittedYaml(content: string): FleetValidationResult[] {
  let blocks: string[];
  try {
    blocks = extractFencedYamlBlocks(content);
  } catch (e) {
    // Extraction is a plain regex scan and should never throw; if it somehow
    // does, fail closed with one loud invalid verdict rather than silence.
    return [
      {
        code: 'BAD_YAML',
        valid: false,
        ships: [],
        errors: [{ field: 'yaml', message: publicError(e) }],
        message: 'Could not scan the message for a roster — treated as invalid.',
      },
    ];
  }
  return blocks.map((yaml) => {
    try {
      return validateFleetYaml(yaml);
    } catch (e) {
      // validateFleetYaml already catches its own YAML parse errors; this
      // guards the theoretical case of a parser bug — fail closed, never
      // report a roster valid because the deterministic check itself broke.
      return {
        code: 'BAD_YAML',
        valid: false,
        ships: [],
        errors: [{ field: 'yaml', message: publicError(e) }],
        message: 'Validator error — treated as invalid (fail-closed).',
      };
    }
  });
}

/**
 * One chat turn. The user message is persisted first (a failed generation
 * never eats operator input), then the model streams; a pass-through
 * TransformStream forwards the SSE bytes to the browser unchanged while
 * accumulating the text, and persists the assistant message on flush.
 */
export async function handleShipwrightChat(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });

  const body = await readJson<ChatBody>(request);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return json(400, { code: 'BAD_JSON', error: 'Request body must be JSON {message: string}' });
  if (message.length > MAX_MESSAGE_CHARS) {
    return json(400, { code: 'MESSAGE_TOO_LONG', error: `message exceeds ${MAX_MESSAGE_CHARS} chars` });
  }
  if (!env.AI) {
    // Same honest idiom as BILLING_UNCONFIGURED: the relay deploys before the
    // [ai] binding is provisioned; the feature says so instead of 500ing.
    return json(503, { code: 'SHIPWRIGHT_UNCONFIGURED', error: 'Workers AI binding not configured' });
  }
  const ai = env.AI;
  const db = env.DB;
  const userId = session.user.id;
  const now = Math.floor(Date.now() / 1000);

  // ── Spend cap (chat-spend-caps): checked BEFORE persisting the message and
  // BEFORE the model call. A refused turn stores nothing and spends nothing —
  // 429 with Retry-After (seconds to UTC midnight, when the window rolls) and
  // an honest reason the page renders in-chat. Caps are server-owned
  // (shipwrightDailyCaps) — nothing in the request body can move them.
  const caps = shipwrightDailyCaps(env);
  const windowStart = spendWindowStart(now);
  const turnTokens = estimateTurnTokens(message.length);
  const spent = await getShipwrightSpend(db, userId, windowStart);
  if (spent.messages >= caps.messages || spent.est_tokens + turnTokens > caps.tokens) {
    const retryAfter = Math.max(1, windowStart + DAY_SECONDS - now);
    return Response.json(
      { code: 'SPEND_CAP', error: spendCapNotice(retryAfter), retryAfterSeconds: retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  await insertShipwrightMessage(db, { userId, role: 'user', content: message, now });
  // The turn is accepted — charge it now (before the model call), so a client
  // that aborts mid-stream still spent its turn. Slight over-count on a model
  // error is the safe direction for a protective budget.
  await addShipwrightSpend(db, { userId, windowStart, estTokens: turnTokens });

  const history = await listShipwrightMessages(db, userId, HISTORY_WINDOW);
  const messages = [
    { role: 'system', content: SHIPWRIGHT_SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const model = shipwrightModel(env) as Parameters<typeof ai.run>[0];

  const persistReply = async (content: string): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed) return;
    await insertShipwrightMessage(db, {
      userId,
      role: 'assistant',
      content: trimmed,
      now: Math.floor(Date.now() / 1000),
    });
  };

  // Buffered mode — one JSON envelope, no SSE.
  if (body?.stream === false) {
    try {
      const res = (await ai.run(model, {
        messages,
        max_tokens: CHAT_MAX_TOKENS,
      })) as { response?: string };
      const reply = (res.response ?? '').trim();
      await persistReply(reply);
      return json(200, { code: 'OK', error: null, reply, yaml: validateEmittedYaml(reply) });
    } catch (e) {
      return json(500, { code: 'AI_ERROR', error: `Workers AI request failed: ${publicError(e)}` });
    }
  }

  // Streaming mode — pipe the Workers AI SSE stream straight through while
  // accumulating the text; flush() runs after the last chunk is forwarded and
  // persists the assistant message (the runtime keeps the request context
  // alive while the response body is still streaming).
  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = (await ai.run(model, {
      messages,
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
    })) as unknown as ReadableStream<Uint8Array>;
  } catch (e) {
    return json(500, { code: 'AI_ERROR', error: `Workers AI request failed: ${publicError(e)}` });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let raw = '';
  const tee = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      raw += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    async flush(controller) {
      raw += decoder.decode();
      const text = assembleSseText(raw);
      await persistReply(text);
      // The verdict rides the SAME SSE stream as one final synthetic line,
      // after every real model token — never blended into `raw`/persisted
      // content, so it can never be mistaken for the model's own words. The
      // client recognizes the `pdYamlVerdict` marker and never treats it as
      // a token (see shipwright-page.ts's pump()). Skipped entirely when the
      // turn emitted no roster — no verdict line, no badge, nothing to lie
      // about.
      const verdicts = validateEmittedYaml(text);
      if (verdicts.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ pdYamlVerdict: verdicts })}\n\n`));
      }
    },
  });

  return new Response(upstream.pipeThrough(tee), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ── POST /v1/shipwright/open-pr (shipwright-pr-open) ─────────────────────────

/** Upper bound on a submitted roster (D1 row size + GitHub content sanity). */
export const MAX_YAML_CHARS = 64_000;

/** Branch prefix for Shipwright-opened PRs — distinct from the control-plane prefix. */
export const SHIPWRIGHT_BRANCH_PREFIX = 'shipwright-fleet-setup-';

function generateShipwrightBranch(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rand = Math.random().toString(36).slice(2, 8);
  return `${SHIPWRIGHT_BRANCH_PREFIX}${date}-${rand}`;
}

/** `owner/name` — GitHub's own charset; rejects traversal and URL smuggling flat. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Is this the page's plain-form dialect (vs the JSON API dialect)? */
function isFormPost(request: Request): boolean {
  return (request.headers.get('Content-Type') ?? '').includes('application/x-www-form-urlencoded');
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

interface OpenPrFields {
  yaml: unknown;
  installationId: unknown;
  repo: unknown;
}

/** Read {yaml, installationId, repo} out of whichever dialect posted. */
async function readOpenPrBody(request: Request, form: boolean): Promise<OpenPrFields | null> {
  if (form) {
    const params = new URLSearchParams(await request.text());
    return {
      yaml: params.get('yaml'),
      installationId: params.get('installationId'),
      repo: params.get('repo'),
    };
  }
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return null;
  return { yaml: body.yaml, installationId: body.installationId, repo: body.repo };
}

/**
 * Open a PR carrying a validated pd-fleet.yml into the signed-in user's OWN
 * repository. This is the Shipwright's one write into the world, and it goes
 * through {@link commitFilesAndOpenPr} — the same zero-trust mutation core as
 * the fleet control-plane — so "fresh branch + PR, review is the gate" holds
 * here by construction, not by promise.
 *
 * The click that fires this IS the product feature (a user-initiated action),
 * not an approval gate: no new permission-ask machinery exists or should
 * (ADR-0109 / D11). What replaces asking is checking:
 *   - the server re-runs `validateFleetYaml` on the submitted bytes — a client
 *     that lies about validation gets a 400, unconditionally;
 *   - the YAML must be a block the Shipwright actually emitted in this user's
 *     own stored conversation (provenance — and the PR body says so);
 *   - `userOwnsInstallation` plus the App-JWT repo→installation binding make
 *     the tenancy boundary GitHub's own answer: session A can never target
 *     session B's installation, or any repo outside the chosen installation.
 *
 * Dialects: JSON (`{yaml, installationId, repo}`) answers JSON; the page's
 * script-free form POST answers 303 — to the created PR on success, back to
 * /account/shipwright?notice=<code> on failure (the billing form idiom).
 */
export async function handleShipwrightOpenPr(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (status: number, code: string, error: string): Response => {
    if (!form) return json(status, { code, error });
    if (code === 'UNAUTHENTICATED') return redirect303('/login');
    return redirect303(`/account/shipwright?notice=${encodeURIComponent(code.toLowerCase())}`);
  };

  const session = await resolveSession(request, env);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'no session');
  if (!isSameOrigin(request, env)) return fail(403, 'CROSS_ORIGIN', 'cross-origin request refused');
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    // Same honest idiom as SHIPWRIGHT_UNCONFIGURED: a relay deployed before
    // the GitHub App secrets are provisioned says so instead of 500ing.
    return fail(503, 'PR_UNCONFIGURED', 'GitHub App not configured on this relay');
  }

  const body = await readOpenPrBody(request, form);
  if (!body) return fail(400, 'BAD_JSON', 'Request body must be JSON {yaml, installationId, repo}');

  const yaml = typeof body.yaml === 'string' ? body.yaml.replace(/\s+$/, '') : '';
  if (!yaml) return fail(400, 'BAD_REQUEST', 'yaml (non-empty string) required');
  if (yaml.length > MAX_YAML_CHARS) {
    return fail(400, 'BAD_REQUEST', `yaml exceeds ${MAX_YAML_CHARS} chars`);
  }
  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return fail(400, 'BAD_REQUEST', 'installationId (positive integer) required');
  }
  const repoFull = typeof body.repo === 'string' ? body.repo.trim() : '';
  if (!REPO_RE.test(repoFull)) {
    return fail(400, 'BAD_REQUEST', "repo must be 'owner/name'");
  }
  const [owner, repo] = repoFull.split('/') as [string, string];

  // ── Gate 1: the server re-validates. The page's badge, the model's claim,
  // and the client's say-so are all just claims; this is the fact.
  let verdict: FleetValidationResult;
  try {
    verdict = validateFleetYaml(yaml);
  } catch (e) {
    return fail(400, 'INVALID_YAML', `validator error — treated as invalid: ${publicError(e)}`);
  }
  if (!verdict.valid) {
    return fail(400, 'INVALID_YAML', verdict.message || 'the roster does not validate');
  }

  // ── Gate 2: provenance. The YAML must be a fenced block the Shipwright
  // actually emitted in THIS user's own stored conversation — the PR body's
  // provenance line is then true, and this route can never be used as a
  // generic write-anything-to-github primitive.
  const history = await listShipwrightMessages(env.DB, session.user.id, HISTORY_WINDOW);
  const fromChat = history.some(
    (m) => m.role === 'assistant' && extractFencedYamlBlocks(m.content).some((b) => b === yaml),
  );
  if (!fromChat) {
    return fail(400, 'NOT_FROM_CHAT', 'that roster is not one the Shipwright emitted in your conversation');
  }

  // ── Gate 3: tenancy (the billing idiom, ADR-0116). GitHub's own answer
  // decides ownership of the installation, and the App JWT decides which
  // installation serves the repo — both must agree before anything writes.
  if (!(await userOwnsInstallation(env, session, installationId))) {
    return fail(403, 'FORBIDDEN', 'you do not own this installation');
  }
  let boundInstallation: number;
  try {
    boundInstallation = await getRepoInstallationId(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      owner,
      repo,
      env.KV,
    );
  } catch {
    return fail(403, 'REPO_NOT_INSTALLED', `the Port Daddy Fleet GitHub App is not installed on ${repoFull}`);
  }
  if (boundInstallation !== installationId) {
    return fail(403, 'REPO_NOT_INSTALLED', `${repoFull} does not belong to installation ${installationId}`);
  }

  // ── The write: fresh branch + PR via the ONE mutation core. Review/merge
  // stays the gate; nothing here (or anywhere) pushes to an existing branch.
  try {
    const token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
      env.KV,
    );
    const baseBranch = await getRepoDefaultBranch(owner, repo, token);
    const branchName = generateShipwrightBranch();
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const shipNames = verdict.ships.map((sh) => `\`${sh.name}\``).join(', ');
    const prBody = [
      'Fleet roster drafted in a **Port Daddy Shipwright** conversation.',
      '',
      `**Provenance:** designed with GitHub user \`@${session.user.login}\` in their own`,
      `Shipwright chat and opened at their click on ${when}. The YAML was re-validated`,
      `server-side before this PR existed: ${verdict.ships.length} ship(s) parse clean (${shipNames}).`,
      '',
      'Zero-trust: this PR adds a fresh branch only. The fleet reads config from',
      `\`${baseBranch}\`, so nothing takes effect until you review and merge. The`,
      'Shipwright cannot push to existing branches and cannot merge — that part is yours.',
    ].join('\n');
    const prUrl = await commitFilesAndOpenPr({
      owner,
      repo,
      baseBranch,
      branchName,
      files: { 'pd-fleet.yml': yaml + '\n' },
      commitMessage: 'fleet: add pd-fleet.yml drafted by the Port Daddy Shipwright',
      prTitle: 'Add pd-fleet.yml — fleet roster drafted by the Port Daddy Shipwright',
      prBody,
      token,
    });
    if (form) return redirect303(prUrl);
    return json(200, { code: 'OK_PR_CREATED', error: null, prUrl, branch: branchName });
  } catch (e) {
    return fail(502, 'GITHUB_ERROR', `GitHub API save failed: ${publicError(e)}`);
  }
}
