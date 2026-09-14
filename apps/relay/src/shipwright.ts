/**
 * The Shipwright chat — a conversational fleet-config architect (MVP v1).
 *
 *   POST /v1/shipwright/thread   (session + same-origin)  → issue repo-bound thread
 *   GET  /v1/shipwright/history  (session + thread)       → one repo-scoped log
 *   POST /v1/shipwright/chat     (session + thread)       → Workers AI, SSE
 *   POST /v1/shipwright/clear    (session + thread)       → delete raw thread history
 *   POST /v1/shipwright/repo-clear (session + stored thread) → delete durable repo state
 *   POST /v1/shipwright/open-pr  (session + same-origin)  → PR in the user's repo
 *
 * The Shipwright interviews the operator (repo + goals), proposes a bespoke
 * ship roster, and emits a complete pd-fleet.yml in a fenced block the page
 * (shipwright-page.ts) renders with copy/download buttons.
 *
 * Trust boundary: every live route is scoped to the signed-in web user plus a
 * server-issued opaque thread bound to one GitHub App installation and one
 * normalized repository. GitHub reauthorizes that exact binding before raw
 * history is read or a model is called. The legacy user-only shipwright_chats
 * table is retained for rollback/export/erasure only; it never enters a scoped
 * prompt and can never establish proposal provenance.
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
 *   4. tenancy: the signed-in user's GitHub token must list the exact repo
 *      under the exact installation, and a force-refreshed App lookup must
 *      agree. Publication additionally requires write, maintain, or admin
 *      permission on that repository. All denial shapes are indistinguishable.
 *   5. publication mints one uncached installation token attenuated to that
 *      repository with contents/pull-request write only, then revokes it.
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

import { CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';
import type { Env } from './types.js';
import { modelBoardPromptFragment } from './model-dossier.js';
import { resolveSession, isSameOrigin, type ResolvedSession } from './auth-github.js';
import {
  getOrCreateShipwrightThread,
  getShipwrightThread,
  listShipwrightThreads,
  insertScopedShipwrightMessage,
  listScopedShipwrightMessages,
  clearScopedShipwrightMessages,
  upsertShipwrightRepoMemory,
  insertShipwrightProposal,
  shipwrightProposalExists,
  clearShipwrightRepo,
  listShipwrightRepoMemory,
  latestShipwrightProposal,
  type ShipwrightThreadRow,
} from './db.js';
import { validateFleetYaml, type FleetValidationResult } from './fleet-parser.js';
import { commitFilesAndOpenPr } from './fleet-control.js';
import {
  getRepoInstallationId,
  mintRepositoryInstallationToken,
  revokeInstallationToken,
  getRepoDefaultBranch,
} from './github-app.js';
import { randomHex } from './crypto.js';
import { authorizeExactRepository } from './github-publisher.js';

// ── Bounds ──────────────────────────────────────────────────────────────────
//
// Re-exported from the shared turn engine rather than re-declared. Two chat
// surfaces with two copies of "how long may a message be" is how the copies
// start to disagree; there is one answer and it lives in chat-engine.ts.

export { MAX_MESSAGE_CHARS, HISTORY_WINDOW } from './chat-engine.js';
import { HISTORY_WINDOW, runChatTurn, type ChatAgent } from './chat-engine.js';

/** Committed default; the SHIPWRIGHT_MODEL var overrides without a deploy. */
export const SHIPWRIGHT_DEFAULT_MODEL = CF_ROLE_MODELS.shipwright;

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
   - NAMED ROLE PRESETS — six ready-to-paste ship blocks live in the port-daddy repo's roles/ directory; when an operator's goal matches one, offer the preset BY NAME before designing bespoke: cleanup (stacks small mechanical fixes as PRs on top of the reviewed diff), adversarial-test-writing (the purser packaged as a named role), doc-writing (stacks missing docs), unit-test-writing (stacks coverage-gap tests, sandbox-gated), readme-fixes (stacks README corrections), homebrew-release-shepherd (reviews release-surface drift — findings only, never writes). All six ship blocking: false and \`capability: cheap\` on their cloudflare fallback.
   Fit the roster to the repo: a small library wants 2-3 ships, not eleven. Say what you left out and why. Invite pushback.
4. When the operator is happy with the roster, EMIT the complete pd-fleet.yml in ONE fenced \`\`\`yaml block — a full, valid file, never a fragment. Schema:
   - Top-level key \`fleet:\` with \`name\`, \`harbor: "{project}:fleet"\`, \`limits:\` (\`max_concurrent_spawns\`, \`max_spawns_per_hour\`, \`budget_usd_per_day\`), and \`agents:\`.
   - Each agent: \`trigger:\` (e.g. pull_request:opened, git:committed — string or list), \`backend: cli:claude-code\`, a \`fallbacks:\` list ending with \`- backend: cloudflare\` + \`capability: cheap\` (the rung the cloud executor resolves — NEVER a literal model id), \`cooldown_ms\`, \`singleton: true\`, \`allowedTools\` where relevant, a \`prompt: |\` block with the ship's full working instructions, \`identity: "{project}:fleet:<ship>"\`, and a one-line \`telos:\`.
   - Ideation ships add \`class: ideation\` and a \`temperature:\`. The purser uses \`class: purser\`, \`blocking: false\`, and a \`graft:\` list.
   - Choose every \`model:\` id FROM THE MODEL BOARD below, quoted exactly, and justify the pick by role fit and price (cheap agentic for reviewers reading diffs, the agentic coder tier for ships that must emit runnable code, frontier tiers only where a single judgment is the product).
   - A \`model:\` id you choose is honored only if it is admitted; the board contains exactly the admitted set, so quote from it and never invent one. Where a ship's need is a JOB rather than a specific measured model ("whatever fills the cheap reviewer slot"), you may instead write \`capability:\` with one of cheap | balanced | high | max-thinking | code, which survives a re-tier without an edit.
5. AFTER the YAML, tell the operator how to ship it, in this order: (a) once the roster shows the green "Validates" badge, they can click the "Open PR" button right on this page — you (via the relay) will commit pd-fleet.yml to a fresh branch of their repo and open the PR for them, provided the Port Daddy Fleet GitHub App is installed on that repo; (b) or commit it by hand: save the block as pd-fleet.yml at the repo root and open a PR to the default branch (git checkout -b fleet-setup && git add pd-fleet.yml && git commit && gh pr create). Either way, remind them the fleet only fires once the PR is merged and the App is installed.

HARD RULES:
- BE HONEST ABOUT YOUR HANDS: you CAN open a PR — but only when the operator clicks "Open PR" beside a roster that passed validation, only into a repo where GitHub freshly confirms they have write, maintain, or admin access and the Port Daddy Fleet GitHub App is installed, and only as a fresh branch + PR (never a push, never a merge — their review is the gate). You still cannot read their repo or change anything anywhere else. Say exactly this much whenever you hand over YAML — no more, no less.
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

// ── Repository/thread scope ──────────────────────────────────────────────────

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const THREAD_RE = /^swt_[0-9a-f]{48}$/;

export function normalizeShipwrightRepo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return REPO_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

async function authorizeRepoScope(
  env: Env,
  session: ResolvedSession,
  installationId: number,
  repoFullName: string,
  requiredAccess: 'read' | 'write' = 'read',
): Promise<Response | null> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return json(503, { code: 'SHIPWRIGHT_REPO_AUTH_UNCONFIGURED', error: 'GitHub App not configured on this relay' });
  }
  const [owner, repo] = repoFullName.split('/') as [string, string];
  try {
    const installed = await getRepoInstallationId(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      owner,
      repo,
      env.KV,
      true,
    );
    if (installed !== installationId || !session.ghToken) throw new Error('scope unavailable');
    await authorizeExactRepository(installationId, repoFullName, session.ghToken, requiredAccess);
  } catch {
    // Missing repo, another account, wrong installation and upstream denial
    // are intentionally indistinguishable. This route is not a repository or
    // installation existence oracle.
    return json(404, { code: 'SHIPWRIGHT_SCOPE_UNAVAILABLE', error: 'repository context is unavailable' });
  }
  return null;
}

async function resolveAuthorizedThread(
  request: Request,
  env: Env,
  threadId: string,
): Promise<{ session: ResolvedSession; thread: ShipwrightThreadRow } | Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!THREAD_RE.test(threadId)) {
    return json(409, { code: 'SHIPWRIGHT_THREAD_REQUIRED', error: 'select or create a repository-scoped Shipwright thread' });
  }
  // This metadata lookup is user-scoped and contains no transcript. Raw rows
  // are not read, and the model is not called, until GitHub reauthorizes the
  // exact installation/repository binding below.
  const thread = await getShipwrightThread(env.DB, session.user.id, threadId);
  if (!thread) return json(404, { code: 'SHIPWRIGHT_THREAD_NOT_FOUND', error: 'thread not found in this account' });
  const refused = await authorizeRepoScope(env, session, thread.installation_id, thread.repo_full_name);
  if (refused) return refused;
  return { session, thread };
}

interface CreateThreadBody { installationId?: unknown; repo?: unknown }
interface RepoClearBody { threadId?: unknown }

/** POST /v1/shipwright/thread — issue an opaque, server-bound thread id. */
export async function handleShipwrightCreateThread(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const body = await readJson<CreateThreadBody>(request);
  const installationId = Number(body?.installationId);
  const repoFullName = normalizeShipwrightRepo(body?.repo);
  if (!Number.isInteger(installationId) || installationId <= 0 || !repoFullName) {
    return json(400, { code: 'BAD_JSON', error: 'Request body must be {installationId: positive integer, repo: owner/name}' });
  }
  const refused = await authorizeRepoScope(env, session, installationId, repoFullName);
  if (refused) return refused;
  const now = Math.floor(Date.now() / 1000);
  const threadId = `swt_${randomHex(24)}`;
  let thread: ShipwrightThreadRow;
  try {
    thread = await getOrCreateShipwrightThread(env.DB, {
      id: threadId,
      user_id: session.user.id,
      installation_id: installationId,
      repo_full_name: repoFullName,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('shipwright thread quota exceeded')) {
      return json(429, { code: 'SHIPWRIGHT_THREAD_QUOTA', error: 'repository thread quota reached' });
    }
    throw error;
  }
  await upsertShipwrightRepoMemory(env.DB, {
    id: `swm_${randomHex(24)}`,
    userId: session.user.id,
    installationId,
    repoFullName,
    kind: 'repository',
    bodyJson: JSON.stringify({ repo: repoFullName, installationId }),
    now,
  });
  return json(201, { code: 'SHIPWRIGHT_THREAD_READY', error: null, threadId: thread.id, repo: thread.repo_full_name, installationId: thread.installation_id });
}

/** GET /v1/shipwright/threads — bounded server-backed resume inventory. */
export async function handleShipwrightThreads(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const threads = await listShipwrightThreads(env.DB, session.user.id, 100);
  return json(200, {
    code: 'OK', error: null,
    threads: threads.map((thread) => ({
      threadId: thread.id,
      repo: thread.repo_full_name,
      installationId: thread.installation_id,
      updatedAt: thread.updated_at,
    })),
  });
}

// ── GET /v1/shipwright/history?thread=<opaque> ───────────────────────────────

/** One exact authorized thread, oldest → newest. */
export async function handleShipwrightHistory(request: Request, env: Env): Promise<Response> {
  const threadId = new URL(request.url).searchParams.get('thread') ?? '';
  const scope = await resolveAuthorizedThread(request, env, threadId);
  if (scope instanceof Response) return scope;
  const messages = await listScopedShipwrightMessages(env.DB, {
    threadId: scope.thread.id,
    userId: scope.session.user.id,
    installationId: scope.thread.installation_id,
    repoFullName: scope.thread.repo_full_name,
  }, HISTORY_WINDOW);
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
    thread: {
      threadId: scope.thread.id,
      repo: scope.thread.repo_full_name,
      installationId: scope.thread.installation_id,
    },
  });
}

/** GET /v1/shipwright/context?thread= — user-visible durable-memory preview. */
export async function handleShipwrightContext(request: Request, env: Env): Promise<Response> {
  const threadId = new URL(request.url).searchParams.get('thread') ?? '';
  const scope = await resolveAuthorizedThread(request, env, threadId);
  if (scope instanceof Response) return scope;
  const repoScope = {
    userId: scope.session.user.id,
    installationId: scope.thread.installation_id,
    repoFullName: scope.thread.repo_full_name,
  };
  const [memory, proposal] = await Promise.all([
    listShipwrightRepoMemory(env.DB, repoScope, 20),
    latestShipwrightProposal(env.DB, { ...repoScope, threadId: scope.thread.id }),
  ]);
  return json(200, {
    code: 'OK', error: null,
    thread: { threadId: scope.thread.id, repo: scope.thread.repo_full_name, installationId: scope.thread.installation_id },
    memory: memory.map((row) => ({ kind: row.kind, body: JSON.parse(row.body_json), updatedAt: row.updated_at })),
    latestProposal: proposal ? {
      createdAt: proposal.created_at,
      yaml: proposal.yaml,
      verdict: validateFleetYaml(proposal.yaml),
    } : null,
    modelContinuity: 'held_pending_operator_consent',
  });
}

// ── POST /v1/shipwright/clear?thread=<opaque> ────────────────────────────────

/** Delete the signed-in user's own conversation (ADR-0101 delete control). */
export async function handleShipwrightClear(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const threadId = new URL(request.url).searchParams.get('thread') ?? '';
  const scope = await resolveAuthorizedThread(request, env, threadId);
  if (scope instanceof Response) return scope;
  const cleared = await clearScopedShipwrightMessages(env.DB, {
    threadId: scope.thread.id,
    userId: scope.session.user.id,
    installationId: scope.thread.installation_id,
    repoFullName: scope.thread.repo_full_name,
  });
  return json(200, { code: 'OK', error: null, cleared });
}

/** POST /v1/shipwright/repo-clear — remove transcripts and durable repo state. */
export async function handleShipwrightRepoClear(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const body = await readJson<RepoClearBody>(request);
  const threadId = typeof body?.threadId === 'string' ? body.threadId : '';
  if (!THREAD_RE.test(threadId)) {
    return json(400, { code: 'BAD_JSON', error: 'Request body must be {threadId: opaque Shipwright thread}' });
  }
  // Erasure authority comes from the authenticated account's stored thread,
  // not GitHub. Revoking repo/App access must never strand the user's data.
  const thread = await getShipwrightThread(env.DB, session.user.id, threadId);
  if (!thread) return json(404, { code: 'SHIPWRIGHT_THREAD_NOT_FOUND', error: 'thread not found in this account' });
  const clearedThreads = await clearShipwrightRepo(env.DB, {
    userId: session.user.id,
    installationId: thread.installation_id,
    repoFullName: thread.repo_full_name,
  });
  return json(200, { code: 'SHIPWRIGHT_REPO_CLEARED', error: null, clearedThreads });
}

// ── POST /v1/shipwright/chat ─────────────────────────────────────────────────

/**
 * Reconstructing assistant text from raw SSE wire text is the turn engine's
 * job, not this surface's. Re-exported here because the page and the tests
 * have always imported it from this module — one implementation, two names.
 */
export { assembleSseText } from './chat-engine.js';

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
 * The Shipwright as the shared turn engine sees it: a prompt, a store, a model
 * id, and the one thing that is genuinely this surface's own — the roster
 * verdict that rides the stream.
 *
 * Everything else — the session gate, the same-origin check, the message
 * bound, the unconfigured-binding refusal, the DAILY SPEND CAP, the
 * persist-before-call ordering and the SSE pass-through — belongs to
 * chat-engine.ts and is shared byte-for-byte with every other chat surface.
 * That is deliberate: this surface used to own a private copy of all of it,
 * and a private copy is exactly how the relay ended up with a chat that could
 * call a model with no per-user budget in front of it.
 */
function scopedShipwrightAgent(thread: ShipwrightThreadRow): ChatAgent {
  const scope = {
    threadId: thread.id,
    installationId: thread.installation_id,
    repoFullName: thread.repo_full_name,
  };
  return {
  id: 'shipwright',
  systemPrompt: `${SHIPWRIGHT_SYSTEM_PROMPT}\n\nAUTHORIZED REPOSITORY CONTEXT:\n` +
    `- repository: ${thread.repo_full_name}\n` +
    `- GitHub App installation: ${thread.installation_id}\n` +
    '- Treat this server-bound repository identity as authoritative. Never carry facts or proposals from another repository into this thread.',
  model: shipwrightModel,
  unconfiguredCode: 'SHIPWRIGHT_UNCONFIGURED',
  unconfiguredError: 'no model binding is configured on this relay',
  store: {
    async insert(db, m) {
      await insertScopedShipwrightMessage(db, { ...m, ...scope });
      if (m.role === 'assistant') {
        for (const yaml of extractFencedYamlBlocks(m.content)) {
          await insertShipwrightProposal(db, {
            id: `swp_${randomHex(24)}`,
            ...scope,
            userId: m.userId,
            yaml,
            now: m.now,
          });
        }
      }
    },
    list: (db, userId, limit) => listScopedShipwrightMessages(db, { ...scope, userId }, limit),
    clear: (db, userId) => clearScopedShipwrightMessages(db, { ...scope, userId }),
  },
  // The verdict is computed server-side from the deterministic parser, never
  // asked of the model — a roster's validity is a fact, not a claim.
  bufferedExtras: (reply) => ({ yaml: validateEmittedYaml(reply) }),
  streamTrailer: (text) => {
    // One final synthetic line, AFTER every real token and never blended into
    // the persisted content, so it cannot be mistaken for the model's own
    // words. The client recognizes the `pdYamlVerdict` marker and never treats
    // it as a token (see shipwright-page.ts's pump()). Skipped entirely when
    // the turn emitted no roster — no verdict line, no badge, nothing to lie
    // about.
    const verdicts = validateEmittedYaml(text);
    if (verdicts.length === 0) return null;
    return `data: ${JSON.stringify({ pdYamlVerdict: verdicts })}\n\n`;
  },
  };
}

/** Public descriptor remains fail-closed: a repository thread is mandatory. */
export const shipwrightAgent: ChatAgent = {
  ...scopedShipwrightAgent({
    id: '', user_id: '', installation_id: 0, repo_full_name: '', created_at: 0, updated_at: 0,
  }),
  store: {
    async insert() { throw new Error('SHIPWRIGHT_THREAD_REQUIRED'); },
    async list() { throw new Error('SHIPWRIGHT_THREAD_REQUIRED'); },
    async clear() { throw new Error('SHIPWRIGHT_THREAD_REQUIRED'); },
  },
};

/**
 * One chat turn — delegated whole to {@link runChatTurn}. The user message is
 * persisted after the spend cap clears and before the model call (a failed
 * generation never eats operator input); the pass-through stream forwards the
 * bytes unchanged and persists the assistant message on flush.
 */
export async function handleShipwrightChat(request: Request, env: Env): Promise<Response> {
  let threadId = '';
  try {
    const body = await request.clone().json() as { threadId?: unknown };
    threadId = typeof body.threadId === 'string' ? body.threadId : '';
  } catch {
    // runChatTurn owns the BAD_JSON envelope once a valid scope exists; an
    // unreadable body cannot carry a scope, so refuse before any model call.
  }
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const scope = await resolveAuthorizedThread(request, env, threadId);
  if (scope instanceof Response) return scope;
  return runChatTurn(request, env, scopedShipwrightAgent(scope.thread));
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
  threadId: unknown;
}

/** Read {yaml, installationId, repo} out of whichever dialect posted. */
async function readOpenPrBody(request: Request, form: boolean): Promise<OpenPrFields | null> {
  if (form) {
    const params = new URLSearchParams(await request.text());
    return {
      yaml: params.get('yaml'),
      installationId: params.get('installationId'),
      repo: params.get('repo'),
      threadId: params.get('threadId'),
    };
  }
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return null;
  return { yaml: body.yaml, installationId: body.installationId, repo: body.repo, threadId: body.threadId };
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
 *   - GitHub must freshly confirm both the App's repo→installation binding and
 *     the signed-in user's exact repository grant before publication.
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
  const repoFull = normalizeShipwrightRepo(body.repo) ?? '';
  if (!repoFull) {
    return fail(400, 'BAD_REQUEST', "repo must be 'owner/name'");
  }
  const [owner, repo] = repoFull.split('/') as [string, string];

  // Resolve and reauthorize the exact thread/repository before reading any
  // proposal provenance. Caller-supplied repo/install values must be byte-for-
  // byte equal to the normalized server binding.
  const threadId = typeof body.threadId === 'string' ? body.threadId : '';
  const scoped = await resolveAuthorizedThread(request, env, threadId);
  if (scoped instanceof Response) {
    if (!form) return scoped;
    const detail = await scoped.clone().json().catch(() => null) as { code?: string; error?: string } | null;
    return fail(
      scoped.status,
      detail?.code ?? 'SHIPWRIGHT_THREAD_REQUIRED',
      detail?.error ?? 'select the repository thread that produced this roster',
    );
  }
  if (scoped.thread.installation_id !== installationId || scoped.thread.repo_full_name !== repoFull) {
    return fail(404, 'SHIPWRIGHT_SCOPE_UNAVAILABLE', 'repository context is unavailable');
  }

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
  const fromChat = await shipwrightProposalExists(env.DB, {
    threadId: scoped.thread.id,
    userId: session.user.id,
    installationId,
    repoFullName: repoFull,
    yaml,
  });
  if (!fromChat) {
    return fail(400, 'NOT_FROM_CHAT', 'that roster is not one the Shipwright emitted in your conversation');
  }

  // ── Gate 3: repeat exact repository authorization immediately before the
  // mutation credential is minted. This force-refreshes both the App binding
  // and the signed-in user's installation-repository grant.
  const publicationRefusal = await authorizeRepoScope(env, session, installationId, repoFull, 'write');
  if (publicationRefusal) {
    return fail(404, 'SHIPWRIGHT_SCOPE_UNAVAILABLE', 'repository context is unavailable');
  }

  // ── The write: fresh branch + PR via the ONE mutation core. Review/merge
  // stays the gate; nothing here (or anywhere) pushes to an existing branch.
  let scopedToken: string | null = null;
  try {
    const minted = await mintRepositoryInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
      owner,
      repo,
      { contents: 'write', pull_requests: 'write' },
    );
    scopedToken = minted.token;
    const baseBranch = await getRepoDefaultBranch(owner, repo, scopedToken);
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
      token: scopedToken,
    });
    const revoked = await revokeInstallationToken(scopedToken);
    scopedToken = null;
    if (!revoked) {
      return fail(502, 'TOKEN_CLEANUP_UNCONFIRMED', 'PR may have opened, but repository token cleanup is unconfirmed');
    }
    if (form) return redirect303(prUrl);
    return json(200, { code: 'OK_PR_CREATED', error: null, prUrl, branch: branchName });
  } catch (e) {
    const cleanupConfirmed = scopedToken ? await revokeInstallationToken(scopedToken) : true;
    if (!cleanupConfirmed) {
      return fail(502, 'TOKEN_CLEANUP_UNCONFIRMED', 'repository token cleanup is unconfirmed');
    }
    const message = publicError(e);
    if (message.includes('token revocation UNCONFIRMED')) {
      return fail(502, 'TOKEN_CLEANUP_UNCONFIRMED', 'repository token cleanup is unconfirmed');
    }
    return fail(502, 'GITHUB_ERROR', `GitHub API save failed: ${message}`);
  }
}
