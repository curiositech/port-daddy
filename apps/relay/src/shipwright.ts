/**
 * The Shipwright chat — a conversational fleet-config architect (MVP v1).
 *
 *   GET  /v1/shipwright/history  (session)                → the user's own log
 *   POST /v1/shipwright/chat     (session + same-origin)  → Workers AI, SSE
 *   POST /v1/shipwright/clear    (session + same-origin)  → delete own history
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
 * HONEST MVP: the Shipwright does NOT open PRs or touch the operator's repo.
 * The system prompt says so, the page says so, and the YAML ships with
 * commit-it-yourself instructions. Direct PR-opening (via the fleet-save
 * GitHub App path) is the plan's next slice, not this one.
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
 */

import type { Env } from './types.js';
import { resolveSession, isSameOrigin } from './auth-github.js';
import {
  insertShipwrightMessage,
  listShipwrightMessages,
  clearShipwrightChats,
} from './db.js';
import { validateFleetYaml, type FleetValidationResult } from './fleet-parser.js';

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
   - Quote every @cf/ model id ('@cf/qwen/qwen3-30b-a3b-fp8' for general work, '@cf/qwen/qwen2.5-coder-32b-instruct' for code review).
5. AFTER the YAML, give commit instructions in 3 short steps: save the block as pd-fleet.yml at the repo root, open a PR to the default branch (git checkout -b fleet-setup && git add pd-fleet.yml && git commit && gh pr create), and install the Port Daddy Fleet GitHub App on the repo so the fleet fires on PR events.

HARD RULES:
- BE HONEST ABOUT YOUR HANDS: you cannot open PRs, read the operator's repo, or change anything anywhere. The operator commits the file; say so whenever you hand over YAML.
- Never invent repo facts the operator didn't give you — ask instead.
- Never emit a partial pd-fleet.yml, and never emit one before you know repo + goals.
- Keep replies tight: a few short paragraphs or a compact list. No walls of text.`;

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

  await insertShipwrightMessage(db, { userId, role: 'user', content: message, now });

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
