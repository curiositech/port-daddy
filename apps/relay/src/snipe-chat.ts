/**
 * apps/relay/src/snipe-chat.ts — the Engineman's chat (G′5).
 *
 *   GET  /v1/snipe/history  (session)                → this user's own log
 *   POST /v1/snipe/chat     (session + same-origin)  → one capped turn, SSE
 *   POST /v1/snipe/clear    (session + same-origin)  → delete own log
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THIS IS NOT A SECOND CHAT IMPLEMENTATION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every guard, the streaming pass-through, the persistence order and the spend
 * cap all live in src/chat-engine.ts and are shared byte-for-byte with the
 * relay's first chat surface. This file contributes exactly four things:
 *
 *   · WHO the agent is        — {@link SNIPE_SYSTEM_PROMPT}
 *   · WHERE its turns live    — `agentChatStore('snipe')` over `agent_chats`
 *   · WHICH model id is in force — {@link snipeModel}
 *   · WHAT rides along after a reply — {@link snipeProposalVerdicts}
 *
 * There is no code path here that reaches a model. The only way to a model
 * from this file is `runChatTurn`, which means this surface is capped, session-
 * scoped, same-origin-checked and fail-closed by construction rather than by
 * this author having remembered each of those.
 *
 * ── THE CAP IS NOT OPTIONAL, AND NOT LOCAL ──────────────────────────────────
 *
 * The per-user daily budget (src/chat-spend.ts) is enforced inside the engine,
 * before the message is stored and before the model is called, counted under
 * this agent's own key so one surface cannot drain another's allowance. There
 * is no parameter on this file's descriptor that raises, waives or bypasses it.
 *
 * ── THE PROPOSAL VERDICT ────────────────────────────────────────────────────
 *
 * Snipe's job is to propose ONE reusable skill when a repo keeps hand-rolling
 * the same jig. A chat that proposes is a chat that can propose something the
 * operator already has — so every fenced `skill` block in a reply is checked
 * SERVER-SIDE against the ids already proposed for this account, and the
 * verdict rides the stream as a synthetic trailing line. The agent never gets
 * a vote on whether its own proposal is novel; it cannot, because the answer is
 * computed from the database after it has finished speaking.
 *
 * ── WHAT SNIPE STILL CANNOT DO, AND SAYS SO ─────────────────────────────────
 *
 * Talking to the Engineman writes nothing anywhere. A skill exists only after
 * a proposal is stored, a human approves it, and the pull request that approval
 * authorizes is merged (src/snipe-builder.ts). This surface has no write path
 * to a catalog, and the prompt is instructed to say exactly that much.
 */

import { parse as parseYaml } from 'yaml';
import type { Env } from './types.js';
import {
  agentChatStore,
  runChatClear,
  runChatHistory,
  runChatTurn,
  type ChatAgent,
} from './chat-engine.js';
import { shipwrightModel } from './shipwright.js';
import { normalizeSkillName } from './snipe-suggestions.js';
import { resolveSession } from './auth-github.js';

/** The agent id: the spend counter's key and the `agent_chats` row scope. */
export const SNIPE_AGENT_ID = 'snipe';

/**
 * The model id in force for this surface.
 *
 * `SNIPE_MODEL` (a var, not a secret) overrides per-surface; absent that, the
 * relay's one committed chat model default is used — resolved by importing the
 * existing resolver rather than restating the id here, so there is exactly one
 * place in the codebase where that default lives.
 */
export function snipeModel(env: Env): string {
  return env.SNIPE_MODEL?.trim() || shipwrightModel(env);
}

export const SNIPE_SYSTEM_PROMPT = `You are SNIPE — rated ENGINEMAN in Port Daddy's fleet. A snipe is an engineering-rating sailor: below decks, hands black, the one who keeps the plant running and builds the jig so the next watch does not have to improvise. You are warm and direct, you speak like someone who has actually been in the bilges, and you are a rigorous engineer first.

YOUR ONE QUESTION: would a reusable skill make this kind of work materially easier next time?

A skill is worth proposing when a repo HAND-ROLLS something that future work will hand-roll again:
- a fixture or test harness built from scratch for one change;
- a multi-step dance (a migration plus a backfill plus a verification; a release-surface sync);
- domain knowledge encoded in comments or in a one-off script that nobody will find again;
- a review or audit pattern that clearly generalizes.

A skill is NOT worth proposing when: the work is genuinely one-off; an existing skill already covers it (say which, and say so plainly); the "skill" would just be a wrapper around one command; or the operator is asking you to justify a skill they have already decided on. Silence is a legitimate and often correct answer. Say "nothing here warrants a skill, and here is why" without apologising for it.

YOUR PROCESS:
1. ASK what you need before proposing: which repo, what the recent work has looked like, what keeps coming back. Never invent facts about a repo you have not been told.
2. NAME the recurring friction in one sentence, in the operator's own terms. If you cannot name it, you do not have a proposal yet.
3. CHECK yourself against what they already have. If they tell you a skill exists that covers it, drop the proposal — do not argue it into being different.
4. PROPOSE AT MOST ONE skill per turn, in a fenced block tagged \`skill\`, containing exactly three keys:

\`\`\`skill
name: lower-kebab-id
description: One or two sentences: what the skill does, and the boundary of what it is NOT for.
rationale: The recurring friction in this repo that this skill ends, and what the next piece of work would look like with it.
\`\`\`

Write \`description\` the way the catalog writes descriptions: what it covers, then an explicit "NOT for X (use Y)" boundary. Those boundaries are load-bearing — they are how the catalog stops proposing the same thing twice.

5. AFTER the block, say plainly what happens next: this proposal is stored for the operator to APPROVE or DISMISS. Approving is what authorizes a pull request that authors the skill into their repo, private by default, under their own name. Nothing is written to any catalog until they merge that pull request.

HARD RULES:
- BE HONEST ABOUT YOUR HANDS: talking to you writes nothing, anywhere. You cannot create a skill, edit a repo, open a pull request by yourself, or add anything to a catalog. You propose; a person approves; a pull request they merge is what makes a skill real. Say this whenever you hand over a proposal — no more, no less.
- One proposal per turn, maximum. Two proposals is a backlog, and a backlog is not advice.
- Never propose a skill whose whole job is "call this tool" or "read this file".
- Keep replies tight: a few short paragraphs or a compact list. No walls of text.`;

// ══════════════════════════════════════════════════════════════════════════
//  The proposal verdict — computed, never claimed
// ══════════════════════════════════════════════════════════════════════════

/** One parsed `skill` block, as the agent wrote it. */
export interface ParsedProposal {
  name: string;
  description: string;
  rationale: string;
}

/**
 * Extract every fenced ```skill block from a reply, in document order.
 *
 * Deliberately a dumb fence scan rather than a markdown parser: the only thing
 * that matters is finding the same substrings a page's own renderer will turn
 * into proposal panels, so the verdict and the display can never disagree about
 * which blocks exist. Reasoning-trace blocks are stripped first — a proposal is
 * something the agent SAID, not something it thought about saying.
 */
export function extractProposalBlocks(content: string): string[] {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const out: string[] = [];
  const fence = /```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(stripped))) {
    if ((m[1] ?? '').trim().toLowerCase() === 'skill') out.push((m[2] ?? '').replace(/\s+$/, ''));
  }
  return out;
}

/** Parse one block's three keys. Returns null when it is not a usable proposal. */
export function parseProposalBlock(block: string): ParsedProposal | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (!name || !description || !rationale) return null;
  return { name, description, rationale };
}

export interface ProposalVerdict {
  /** The block's index in the reply, so a page can pair verdict to panel. */
  index: number;
  ok: boolean;
  /** The normalized id the proposal would be stored under, when parseable. */
  slug: string | null;
  /** Why the verdict is what it is — shown verbatim beside the panel. */
  message: string;
}

/**
 * Judge every proposal block in a reply against ids this account has ALREADY
 * been offered.
 *
 * PURE given `knownNames`, so the rule is testable without a database and
 * cannot drift from what the suggestion job's own dedup gate does — both fold
 * ids through {@link normalizeSkillName}, so `Skill Architect`,
 * `skill_architect` and `skill-architect` are one skill in both places.
 *
 * The point is that an agent cannot self-certify novelty. It writes a
 * proposal; the server answers whether that proposal is new. A "you already
 * have this" verdict is a fact computed after the agent stopped talking.
 */
export function snipeProposalVerdicts(
  replyText: string,
  knownNames: readonly string[],
): ProposalVerdict[] {
  const known = new Set(knownNames.map(normalizeSkillName).filter(Boolean));
  return extractProposalBlocks(replyText).map((block, index) => {
    const parsed = parseProposalBlock(block);
    if (!parsed) {
      return {
        index,
        ok: false,
        slug: null,
        message: 'This block is not a usable proposal — it needs name, description and rationale.',
      };
    }
    const slug = normalizeSkillName(parsed.name);
    if (!slug) {
      return { index, ok: false, slug: null, message: `'${parsed.name}' is not a usable skill id.` };
    }
    if (known.has(slug)) {
      return {
        index,
        ok: false,
        slug,
        message: `'${slug}' has already been proposed for this account — approving it again would build the same skill twice.`,
      };
    }
    return { index, ok: true, slug, message: `'${slug}' is new to this account.` };
  });
}

/** Every skill name this account has ever been offered, across all its repos. */
async function knownSuggestionNames(db: D1Database, userId: string): Promise<string[]> {
  try {
    const rows = await db
      .prepare('SELECT skill_name FROM seamanship_suggestions WHERE user_id = ? LIMIT 500')
      .bind(userId)
      .all<{ skill_name: string }>();
    return (rows.results ?? []).map((r) => r.skill_name);
  } catch {
    // A verdict is an enhancement, not a gate. Failing to compute one must
    // never cost the operator their turn — the reply still streams, just
    // without the "already proposed" badge.
    return [];
  }
}

/**
 * Build the descriptor for one request, closing over this account's known
 * proposal ids so the trailer can be computed synchronously when the stream
 * drains.
 */
export function snipeAgent(knownNames: readonly string[]): ChatAgent {
  return {
    id: SNIPE_AGENT_ID,
    systemPrompt: SNIPE_SYSTEM_PROMPT,
    model: snipeModel,
    store: agentChatStore(SNIPE_AGENT_ID),
    unconfiguredCode: 'SNIPE_UNCONFIGURED',
    unconfiguredError: 'no model binding is configured on this relay',
    bufferedExtras(reply) {
      return { proposals: snipeProposalVerdicts(reply, knownNames) };
    },
    streamTrailer(reply) {
      const verdicts = snipeProposalVerdicts(reply, knownNames);
      if (verdicts.length === 0) return null;
      return `data: ${JSON.stringify({ pdProposalVerdict: verdicts })}\n\n`;
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  Handlers
// ══════════════════════════════════════════════════════════════════════════

/** GET /v1/snipe/history — this user's own Engineman log. */
export async function handleSnipeHistory(request: Request, env: Env): Promise<Response> {
  return runChatHistory(request, env, snipeAgent([]));
}

/** POST /v1/snipe/clear — delete this user's own Engineman log. */
export async function handleSnipeClear(request: Request, env: Env): Promise<Response> {
  return runChatClear(request, env, snipeAgent([]));
}

/**
 * POST /v1/snipe/chat — one capped turn.
 *
 * The known-names read happens BEFORE the engine call so the trailer can be
 * computed without I/O at flush time, and is best-effort: it is scoped to the
 * session's own rows, and a failure yields an empty set rather than a failed
 * turn. The session is resolved here only to scope that read — the engine
 * re-resolves it and owns the 401, so there is exactly one place that decides
 * whether a turn is authorized.
 */
export async function handleSnipeChat(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  const known = session ? await knownSuggestionNames(env.DB, session.user.id) : [];
  return runChatTurn(request, env, snipeAgent(known));
}
