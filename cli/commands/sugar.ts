/**
 * CLI Sugar Commands — Compound commands for common workflows
 *
 * Handles: begin, done, whoami, with-lock
 */

import { spawn } from 'node:child_process';
import { highlightChannel } from '../../lib/maritime.js';
import PortDaddy from '../../lib/client.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { ensureCliActorCredential, resolveCliActorCredential } from '../utils/actor-credential.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY, relativeTime } from '../utils/output.js';
import { canPrompt, promptText, promptSelect, promptIdentity, promptConfirm, printRoger } from '../utils/prompt.js';
import { autoIdentityFromPackageJson } from './services.js';
import { assertSafeId, posixShellQuote, fishShellQuote } from '../../lib/shell-quote.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import type { RoadmapSearchHit } from '../../lib/roadmap-search.js';
import * as ui from '../utils/ui.js';
import { clearCurrentContext, readCurrentContext, writeCurrentContext } from '../utils/current-context.js';
import {
  attachCliSessionWorktreePolicy,
  resolveCliSessionWorktreePolicy,
} from '../utils/session-worktree-policy.js';
import { initDatabase } from '../../lib/db.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { checkAndCompleteDispatch } from '../../lib/dispatch/auto-merge.js';
import { isReviewedSemanticWhoisHit } from '../../lib/whois.js';
import type { SugarParleyCard } from '../../lib/sugar-parley.js';
import { renderSugarParleyCard } from '../utils/sugar-parley-card.js';

type BeginLifecycle = 'durable' | 'ephemeral';

type BeginLifecycleResolution =
  | { success: true; lifecycle: BeginLifecycle; durable: boolean }
  | { success: false; error: string };

function parseBeginLifecycle(value: unknown): BeginLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
}

function resolveBeginLifecycle(options: CLIOptions): BeginLifecycleResolution {
  if (options.lifecycle === undefined) {
    return {
      success: false,
      error: 'pd begin requires an explicit lifecycle: pass --lifecycle durable for ordinary agent work, or --lifecycle ephemeral for heartbeat-bound process sessions.',
    };
  }

  const lifecycle = parseBeginLifecycle(options.lifecycle);
  if (!lifecycle) {
    return { success: false, error: '--lifecycle must be either "durable" or "ephemeral".' };
  }

  return { success: true, lifecycle, durable: lifecycle === 'durable' };
}

function printBeginUsage(): void {
  console.error('Usage: pd begin <purpose> --lifecycle durable|ephemeral [--purpose "text"] [-P "text"]');
  console.error('       pd begin --identity ID --agent AGENT_ID --files f1 f2... --lifecycle durable|ephemeral');
  console.error('       pd begin                                 # interactive (TTY only)');
  console.error('');
  console.error('Roadmap rent (one required):');
  console.error('  --roadmap <slug>              link to an existing roadmap item');
  console.error('  --roadmap-new "<title>"       create a draft roadmap item and link it');
  console.error('  --sidequest "<reason>"        opt out with a one-line reason (min 12 chars)');
}

// =============================================================================
// Rent-at-claim (S3) — roadmap link-or-opt-out at session start
// =============================================================================

const SIDEQUEST_MIN_CHARS = 12;
const RENT_EXEMPT_VALUES = ['hotfix', 'chore'] as const;

/**
 * The rent message. Names ONLY the correct actions — never a bypass.
 */
export const RENT_GATE_MESSAGE = [
  'pd begin needs a roadmap link or an explicit opt-out. Pass exactly one:',
  '  --roadmap <slug>              link this session to an existing roadmap item',
  '  --roadmap-new "<title>"       create a draft roadmap item and link it',
  `  --sidequest "<reason>"        opt out with a one-line reason (min ${SIDEQUEST_MIN_CHARS} chars)`,
].join('\n');

export interface BeginRentResolution {
  ok: boolean;
  roadmapLink?: string;
  sidequestReason?: string;
  roadmapNewTitle?: string;
  /** TTY path: caller should run the interactive prompt. */
  needsPrompt?: boolean;
  error?: string;
}

/**
 * Best-effort: fetch roadmap items matching `purpose` (lib/roadmap-search.ts,
 * GET /roadmap/search) and print them so the rent-gate rejection carries a
 * fix, not just a rule. Never throws — a daemon hiccup or an un-indexed
 * roadmap degrades silently back to the plain gate message; suggestions are
 * a convenience, not a dependency of the gate itself.
 */
export async function printRoadmapSuggestions(
  purpose: string,
  harbor: string | undefined,
  fetcher: typeof pdFetch = pdFetch,
): Promise<void> {
  try {
    const params = new URLSearchParams({ q: purpose, limit: '5' });
    if (harbor) params.set('harbor', harbor);
    const res = await fetcher(`${PORT_DADDY_URL}/roadmap/search?${params.toString()}`);
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { hits?: RoadmapSearchHit[] };
    const hits = data.hits ?? [];
    if (hits.length === 0) return;

    ui.note(
      hits.map((h) => `  --roadmap ${h.slug}\n    [${h.status}] ${h.summaryMd}`).join('\n'),
      `Did you mean one of these? (matched "${purpose}")`,
    );
  } catch {
    // Best-effort only — see docblock.
  }
}

/**
 * Pure resolver behind the rent gate. `interactive` is the canPrompt() result,
 * injected so tests can exercise both TTY and non-TTY paths.
 */
export function resolveBeginRent(
  options: Pick<CLIOptions, 'roadmap' | 'sidequest'> & Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  interactive: boolean = canPrompt(),
): BeginRentResolution {
  const roadmap = options.roadmap;
  const sidequest = options.sidequest;
  const roadmapNew = options['roadmap-new'] ?? options.roadmapNew;

  const given = [roadmap, sidequest, roadmapNew].filter((v) => v !== undefined && v !== null);
  if (given.length > 1) {
    return { ok: false, error: '--roadmap, --sidequest, and --roadmap-new are mutually exclusive — pass exactly one.' };
  }

  if (roadmap !== undefined) {
    if (typeof roadmap !== 'string' || !roadmap.trim()) {
      return { ok: false, error: '--roadmap requires a slug, e.g. --roadmap adr-0090-database-distribution' };
    }
    return { ok: true, roadmapLink: roadmap.trim() };
  }

  if (sidequest !== undefined) {
    const reason = typeof sidequest === 'string' ? sidequest.trim() : '';
    if (reason.length < SIDEQUEST_MIN_CHARS) {
      return { ok: false, error: `--sidequest needs a real one-line reason (min ${SIDEQUEST_MIN_CHARS} chars) — say what the work actually is.` };
    }
    return { ok: true, sidequestReason: reason };
  }

  if (roadmapNew !== undefined) {
    if (typeof roadmapNew !== 'string' || !roadmapNew.trim()) {
      return { ok: false, error: '--roadmap-new requires a title, e.g. --roadmap-new "Rent at claim gate"' };
    }
    return { ok: true, roadmapNewTitle: roadmapNew.trim() };
  }

  // None given — a bounded env exemption is a sanctioned opt-out (never named
  // in the rent message itself).
  const exempt = typeof env.PD_RENT_EXEMPT === 'string' ? env.PD_RENT_EXEMPT.trim().toLowerCase() : '';
  if (exempt) {
    if (!(RENT_EXEMPT_VALUES as readonly string[]).includes(exempt)) {
      return { ok: false, error: `PD_RENT_EXEMPT must be one of: ${RENT_EXEMPT_VALUES.join(', ')} (got "${exempt}").` };
    }
    return { ok: true, sidequestReason: `PD_RENT_EXEMPT: ${exempt}` };
  }

  if (interactive) {
    return { ok: false, needsPrompt: true };
  }

  return { ok: false, error: RENT_GATE_MESSAGE };
}

/**
 * Anti-Goodhart valve: the relink message. Two options — relink never
 * creates roadmap items (use pd begin --roadmap-new / pd roadmap for that).
 */
export const RELINK_GATE_MESSAGE = [
  'pd session relink updates the ACTIVE session\'s roadmap rent. Pass exactly one:',
  '  --roadmap <slug>              re-link to an existing roadmap item',
  `  --sidequest "<reason>"        switch to an opt-out with a one-line reason (min ${SIDEQUEST_MIN_CHARS} chars)`,
].join('\n');

export interface RelinkRentResolution {
  ok: boolean;
  roadmapLink?: string;
  sidequestReason?: string;
  error?: string;
}

/**
 * Pure resolver behind `pd session relink`. Same validation as begin, minus
 * roadmap-new / env exemptions / prompting — relinking is always deliberate.
 */
export function resolveRelinkRent(
  options: Pick<CLIOptions, 'roadmap' | 'sidequest'> & Record<string, unknown>,
): RelinkRentResolution {
  const roadmap = options.roadmap;
  const sidequest = options.sidequest;

  const given = [roadmap, sidequest].filter((v) => v !== undefined && v !== null);
  if (given.length > 1) {
    return { ok: false, error: '--roadmap and --sidequest are mutually exclusive — pass exactly one.' };
  }

  if (roadmap !== undefined) {
    if (typeof roadmap !== 'string' || !roadmap.trim()) {
      return { ok: false, error: '--roadmap requires a slug, e.g. --roadmap adr-0090-database-distribution' };
    }
    return { ok: true, roadmapLink: roadmap.trim() };
  }

  if (sidequest !== undefined) {
    const reason = typeof sidequest === 'string' ? sidequest.trim() : '';
    if (reason.length < SIDEQUEST_MIN_CHARS) {
      return { ok: false, error: `--sidequest needs a real one-line reason (min ${SIDEQUEST_MIN_CHARS} chars) — say what the work actually is.` };
    }
    return { ok: true, sidequestReason: reason };
  }

  return { ok: false, error: RELINK_GATE_MESSAGE };
}

/**
 * The rent receipt line. Printed after every successful rent payment
 * (pd begin, pd session relink) so agents know a wrong link is not sticky —
 * that's the anti-Goodhart valve that keeps slugs honest.
 */
export function formatRentReceipt(rent: { roadmapLink?: string | null; sidequestReason?: string | null }): string | null {
  const target = rent.roadmapLink
    ? rent.roadmapLink
    : rent.sidequestReason
      ? `sidequest: ${rent.sidequestReason}`
      : null;
  if (!target) return null;
  return `rent paid -> ${target} (change anytime: pd session relink)`;
}

/**
 * TTY path: ask for the missing rent field. One line, three choices.
 */
async function promptBeginRent(): Promise<BeginRentResolution> {
  const choice = await promptSelect({
    label: 'Link this session to the roadmap?',
    choices: [
      { value: 'roadmap', label: 'Link an existing roadmap item (slug)' },
      { value: 'roadmap-new', label: 'Create a draft roadmap item (title)' },
      { value: 'sidequest', label: 'Sidequest — opt out with a reason' },
    ],
    default: 'roadmap',
  });
  if (choice === 'roadmap') {
    const slug = await promptText({ label: 'Roadmap slug:', required: true });
    return resolveBeginRent({ roadmap: slug || '' }, {}, false);
  }
  if (choice === 'roadmap-new') {
    const title = await promptText({ label: 'New roadmap item title:', required: true });
    return resolveBeginRent({ 'roadmap-new': title || '' }, {}, false);
  }
  const reason = await promptText({ label: `Sidequest reason (min ${SIDEQUEST_MIN_CHARS} chars):`, required: true });
  return resolveBeginRent({ sidequest: reason || '' }, {}, false);
}

export const HELPFUL_SUGGESTION_LIMIT = 3;
export const HELPFUL_SUGGESTION_TIMEOUT_MS = 75;

export interface HelpfulPeerSuggestion {
  agentId: string;
  agentName?: string | null;
  phrase: string;
  score: number;
  similarity: number;
  stage: 'exact' | 'bm25' | 'semantic' | 'llm';
}

/**
 * Keep arrival guidance genuinely selective. The daemon's whois service owns
 * the shared BM25 + MiniLM cascade; this client only applies the published
 * semantic review threshold, removes the just-created session, and enforces a
 * hard display cap. The design intent is to make `pd begin` quiet unless a
 * semantically reviewed peer is unusually relevant; there is deliberately no
 * lexical or substring fallback.
 *
 * @param hits - Ranked candidates returned by the daemon's hybrid resolver.
 * @param currentAgentId - Agent created by this begin call, which must not be suggested to itself.
 * @returns At most three semantically reviewed peers in daemon rank order.
 */
export function selectHelpfulPeerSuggestions(
  hits: HelpfulPeerSuggestion[],
  currentAgentId: string | undefined,
): HelpfulPeerSuggestion[] {
  return hits
    .filter((hit) => hit.agentId !== currentAgentId)
    .filter(isReviewedSemanticWhoisHit)
    .slice(0, HELPFUL_SUGGESTION_LIMIT);
}

/**
 * Fetch bounded arrival guidance through the shared daemon resolver. The
 * injected fetcher makes the latency and fail-open contract executable in a
 * unit fixture without consulting a developer's live daemon.
 *
 * @param purpose - Natural-language purpose sent to hybrid peer resolution.
 * @param currentAgentId - Newly created agent excluded from its own suggestions.
 * @param fetcher - Daemon fetch implementation, injectable for timing-contract tests.
 * @returns Reviewed peer suggestions, or an empty list on timeout or failure.
 */
export async function fetchHelpfulPeerSuggestions(
  purpose: string,
  currentAgentId: string | undefined,
  fetcher: typeof pdFetch = pdFetch,
): Promise<HelpfulPeerSuggestion[]> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const params = new URLSearchParams({
      q: purpose,
      kind: 'agent',
      limit: String(HELPFUL_SUGGESTION_LIMIT + 1),
      // Arrival guidance can point an agent at a live peer, so require the
      // same resolver-reviewed contract that Sugar Parley uses. This keeps a
      // verbatim purpose match from becoming an unreviewed lexical shortcut.
      semantic_review: 'true',
    });
    const request = fetcher(`/whois?${params.toString()}`, {
      timeout: HELPFUL_SUGGESTION_TIMEOUT_MS,
      retry: false,
      signal: controller.signal,
    });
    const res = await Promise.race([
      request,
      new Promise<null>((resolveDeadline) => {
        deadline = setTimeout(() => {
          controller.abort();
          resolveDeadline(null);
        }, HELPFUL_SUGGESTION_TIMEOUT_MS);
      }),
    ]);
    if (!res) return [];
    if (!res.ok) return [];
    const data = await res.json();
    return selectHelpfulPeerSuggestions(
      Array.isArray(data.hits) ? data.hits as unknown as HelpfulPeerSuggestion[] : [],
      currentAgentId,
    );
  } catch {
    return [];
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

/**
 * Render optional live-peer guidance after a successful begin. The purpose of
 * the short deadline and silent catch is failure containment: coordination
 * enrichment must never delay or invalidate session creation.
 *
 * @param purpose - Natural-language purpose used by the daemon's hybrid resolver.
 * @param currentAgentId - Newly created agent excluded from its own suggestions.
 * @returns A promise that settles after printing useful guidance or a silent no-op.
 */
async function showHelpfulSuggestions(purpose: string, currentAgentId: string | undefined): Promise<void> {
  const hits = await fetchHelpfulPeerSuggestions(purpose, currentAgentId);
  if (hits.length === 0) return;

  try {
    console.error(`\n${ui.fmtCyan('Useful live peers for this session:')}`);
    for (const hit of hits) {
      const label = hit.agentName ? `${hit.agentName} (${hit.agentId})` : hit.agentId;
      console.error(`  - ${ui.fmtYellow(label)}: "${hit.phrase}" (semantic fit ${hit.similarity.toFixed(2)})`);
    }
    console.error('');
  } catch {
    // Rendering is optional too; session creation already succeeded.
  }
}

/** The arrival card is optional enrichment and must never delay `pd begin`. */
export const SUGAR_PARLEY_CARD_TIMEOUT_MS = 150;

interface SugarParleyCardResponse {
  success?: unknown;
  state?: unknown;
  card?: unknown;
}

function isSugarParleyCard(value: unknown): value is SugarParleyCard {
  return Boolean(value)
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'sugar_parley_card'
    && typeof (value as { signalId?: unknown }).signalId === 'string';
}

/**
 * Read the server-derived coordination card after the successful Sugar begin
 * has persisted the new actor credential. This is intentionally bounded and
 * fail-open: a resolver or daemon delay never changes the already-successful
 * session-creation result, and the client never synthesizes an overlap itself.
 */
export async function fetchSugarParleyCard(
  agentId: string | undefined,
  sessionId: string | undefined,
  fetcher: typeof pdFetch = pdFetch,
): Promise<SugarParleyCard | null> {
  if (!agentId || !sessionId) return null;
  const credential = resolveCliActorCredential(agentId);
  if (!credential) return null;
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const params = new URLSearchParams({ sessionId });
    const request = fetcher(`/sugar/parley-card?${params.toString()}`, {
      headers: { 'x-actor-credential': credential },
      timeout: SUGAR_PARLEY_CARD_TIMEOUT_MS,
      retry: false,
      signal: controller.signal,
    });
    const response = await Promise.race([
      request,
      new Promise<null>((resolveDeadline) => {
        deadline = setTimeout(() => {
          controller.abort();
          resolveDeadline(null);
        }, SUGAR_PARLEY_CARD_TIMEOUT_MS);
      }),
    ]);
    if (!response || !response.ok) return null;
    const body = await response.json() as SugarParleyCardResponse;
    return body.success === true && body.state === 'ready' && isSugarParleyCard(body.card)
      ? body.card
      : null;
  } catch {
    return null;
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

/**
 * Keep the established machine-oriented begin contracts entirely free of an
 * arrival card. The optional card belongs only to an ordinary capable human
 * terminal; it must not leak into JSON, quiet, eval/export, or explicitly
 * non-interactive invocations. A NO_COLOR terminal remains interactive and
 * receives the same bounded card in its ANSI-free linework form.
 */
export function shouldShowSugarParleyExperience(
  options: CLIOptions,
  interactive: boolean = canPrompt(),
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return interactive
    && !isJson(options)
    && !isQuiet(options)
    && environment.PORT_DADDY_NON_INTERACTIVE === undefined
    && environment.PD_EMIT_EXPORTS !== '1';
}

async function postSugarParleyAction(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await pdFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 3_000,
      retry: false,
    });
    const result: Record<string, unknown> = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok || result.success !== true) {
      ui.warn(String(result.error || 'The coordination action was not accepted.'));
      return null;
    }
    return result;
  } catch (error) {
    ui.warn(`The coordination action could not reach the daemon: ${(error as Error).message}`);
    return null;
  }
}

async function offerSettlement(
  sessionId: string,
  parleyId: string,
): Promise<void> {
  const summary = await promptText({
    label: 'What did you settle?',
    hint: 'A concise shared decision',
    required: true,
  });
  if (!summary) return;
  const nextStep = await promptText({
    label: 'What is the next bounded step?',
    hint: 'A concrete next action for both plans',
    required: true,
  });
  if (!nextStep) return;
  const receipt = await postSugarParleyAction('/sugar/parley/settle', {
    sessionId,
    parleyId,
    summary,
    nextStep,
  });
  if (!receipt) return;
  const state = String(receipt.state || 'recorded');
  if (state === 'awaiting-peer') {
    console.error('  Settlement acknowledgement recorded. The other party must acknowledge the same receipt.');
    return;
  }
  console.error(`  Settlement ${state}: claims and plans were updated through the typed receipt.`);
}

async function offerBoundedParleyNextStep(
  sessionId: string,
  parleyId: string,
): Promise<void> {
  const next = await promptSelect({
    label: 'Bounded Parley next step',
    choices: [
      { value: 'message', label: 'Send a message', hint: 'Share natural-language context with the other party' },
      { value: 'settle', label: 'Record a typed settlement', hint: 'Acknowledge the shared decision and update its effects' },
      { value: 'later', label: 'Return to work', hint: 'Keep the bounded Parley available for a later turn' },
    ],
    default: 'message',
  });
  if (next === 'message') {
    const message = await promptText({ label: 'Message for the other party', required: true });
    if (!message) return;
    const receipt = await postSugarParleyAction('/sugar/parley/message', {
      sessionId,
      parleyId,
      message,
    });
    if (receipt) console.error('  Message delivered to the bounded Parley.');
    return;
  }
  if (next === 'settle') await offerSettlement(sessionId, parleyId);
}

/**
 * Present the normal Sugar-first action card only when the terminal can safely
 * prompt. JSON, quiet, exports, pipes, and explicit noninteractive modes
 * retain their exact deterministic begin surfaces; NO_COLOR gets the plain
 * renderer rather than losing the coordination affordance.
 */
export async function showSugarParleyExperience(
  agentId: string | undefined,
  sessionId: string | undefined,
  options: CLIOptions,
): Promise<void> {
  if (!agentId || !sessionId || !shouldShowSugarParleyExperience(options)) return;
  const card = await fetchSugarParleyCard(agentId, sessionId);
  if (!card) return;
  console.error(`\n${renderSugarParleyCard(card, {
    width: process.stderr.columns,
    colorLevel: ui.lineworkColorLevel('stderr'),
  })}\n`);
  const selected = await promptSelect({
    label: 'Coordination action',
    choices: card.actions.map((action) => ({
      value: action.id,
      label: action.label,
      hint: action.enabled ? undefined : (action.reason || 'Unavailable for this bounded card'),
    })),
  });
  if (!selected) return;
  const action = card.actions.find((candidate) => candidate.id === selected);
  if (!action?.enabled) {
    ui.warn(action?.reason || 'That coordination action is unavailable for this card.');
    return;
  }
  const base = { sessionId, signalId: card.signalId };
  if (selected === 'work-separately') {
    const receipt = await postSugarParleyAction('/sugar/parley/work-separately', base);
    if (receipt) console.error('  Work-separately decision recorded with its evidence.');
    return;
  }
  if (selected === 'send-note') {
    const message = await promptText({ label: 'Note for the matched peer', required: true });
    if (!message) return;
    const receipt = await postSugarParleyAction('/sugar/parley/note', { ...base, message });
    if (receipt) console.error('  Attributed coordination note delivered.');
    return;
  }
  const receipt = await postSugarParleyAction('/sugar/parley/resolve-together', base);
  if (!receipt) return;
  const parleyId = typeof receipt.parleyId === 'string' ? receipt.parleyId : null;
  const hookContext = receipt.hookContext as { message?: unknown } | undefined;
  if (!parleyId) {
    ui.warn(String(receipt.reason || 'The bounded Parley was not admitted.'));
    return;
  }
  console.error(`  ${typeof hookContext?.message === 'string'
    ? hookContext.message
    : 'A bounded Parley is active for this shared surface.'}`);
  await offerBoundedParleyNextStep(sessionId, parleyId);
}

async function fetchAndRenderWelcomeBriefing(harbor?: string): Promise<void> {
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/sugar/welcome?harbor=${encodeURIComponent(harbor || '')}`);
    if (!res.ok) return;
    const data = (await res.json()) as any;
    if (!data || !data.success) return;

    console.error(`\n👋 ${ui.fmtBold(ui.fmtCyan('WELCOME TO THE PORT DADDY HARBOR'))}`);
    
    // 1. Next roadmap item
    if (data.nextRoadmap) {
      console.error(`\n📌 ${ui.fmtBold('Next Roadmap Target:')}`);
      console.error(`   ${ui.fmtGreen(data.nextRoadmap.slug)}: "${data.nextRoadmap.summaryMd}"`);
    }

    // 2. Ongoing projects
    if (data.ongoing && data.ongoing.length > 0) {
      console.error(`\n🚢 ${ui.fmtBold('Ongoing Fleet Missions:')}`);
      for (const s of data.ongoing) {
        const wt = s.worktree ? ` (worktree: ${s.worktree.name || s.worktree.id})` : '';
        console.error(`   - ${ui.fmtYellow(s.agentName || s.agentId)}: "${s.purpose}"${wt}`);
      }
    }

    // 3. High-priority bugs
    if (data.highPriBugs && data.highPriBugs.length > 0) {
      console.error(`\n🚨 ${ui.fmtBold('High-Priority Bugs Needing Attention:')}`);
      for (const f of data.highPriBugs) {
        const surf = f.surface ? ` in ${f.surface}` : '';
        console.error(`   - [${ui.fmtRed(f.severity.toUpperCase())}] ${ui.fmtYellow(f.slug)}: "${f.summary}"${surf}`);
      }
    }

    // 4. Dormant or engineering excellence opportunities
    if (data.dormant && data.dormant.length > 0) {
      console.error(`\n⚓ ${ui.fmtBold('Dormant Projects / Refactoring Opportunities:')}`);
      for (const d of data.dormant) {
        console.error(`   - Session ${ui.fmtYellow(d.sessionId)}: "${d.purpose}" (dormant for ${d.lastActiveAgoMinutes}m)`);
      }
    }
    console.error('');
  } catch (err) {
    // Fail silently
  }
}

// =============================================================================
// handleBegin — pd begin "purpose" --lifecycle durable|ephemeral [--identity X] [--files f1 f2...]
// =============================================================================

/**
 * The guided wizard is reserved for a truly bare interactive invocation.
 * Supplying any session-scoping flag means the caller is scripting the command;
 * missing purpose must fail with usage instead of blocking on stdin.
 */
export function shouldRunBeginWizard(
  purpose: string | undefined,
  options: CLIOptions,
  interactive: boolean = canPrompt(),
): boolean {
  const hasScopingArgs = [
    options.purpose,
    options.identity,
    options.agent,
    options.files,
    options.lifecycle,
    options.name,
  ].some((value) => value !== undefined);
  return purpose === undefined && interactive && !hasScopingArgs;
}

/**
 * Preserve the credential that authenticated a successful repeated begin.
 * Generated Sugar display handles can change between sessions for one minted
 * actor, so resolving it after the context is overwritten by the new handle
 * would discard the very credential needed to fetch the normal coordination
 * card.
 */
export function credentialForBegunSugarContext(
  mintedCredential: unknown,
  carriedCredential: string | undefined,
): string | null {
  if (typeof mintedCredential === 'string' && mintedCredential.trim()) return mintedCredential;
  return typeof carriedCredential === 'string' && carriedCredential.trim()
    ? carriedCredential
    : null;
}

export async function handleBegin(
  purpose: string | undefined,
 rest: string[],
 options: CLIOptions,
 ): Promise<void> {
  const filesOption: unknown = options.files;
  if (filesOption === true || (Array.isArray(filesOption) && filesOption.length === 0)) {
    printBeginUsage();
    throw new Error('--files requires at least one path');
  }

  // Flag takes precedence over positional
  purpose = purpose || (options.purpose as string) || undefined;

  if (shouldRunBeginWizard(purpose, options)) {
    // Show welcome briefing first!
    await fetchAndRenderWelcomeBriefing(options.harbor as string || undefined);

    // Interactive wizard
    purpose = await promptText({ label: 'What are you working on?', required: true }) || undefined;
    if (!purpose) {
      throw new Error('Purpose is required');
    }

    // Prompt for optional identity with auto-detection
    if (!options.identity) {
      const suggested = autoIdentityFromPackageJson() || undefined;
      const identity = await promptIdentity({ suggested });
      if (identity) options.identity = identity;
    }

    // Prompt for file claims
    if (!options.files) {
      const wantFiles = await promptConfirm('Claim any files?', false);
      if (wantFiles) {
        const filesStr = await promptText({ label: 'File paths (space-separated):' });
        if (filesStr) options.files = filesStr.split(/\s+/).filter(Boolean);
      }
    }

    if (options.lifecycle === undefined) {
      const lifecycle = await promptSelect({
        label: 'Session lifecycle?',
        choices: [
          { value: 'durable', label: 'Durable work context' },
          { value: 'ephemeral', label: 'Heartbeat-bound process session' },
        ],
        default: 'durable',
      });
      if (lifecycle) options.lifecycle = lifecycle;
    }
  } else if (!purpose) {
    await fetchAndRenderWelcomeBriefing(options.harbor as string || undefined);
    printBeginUsage();
    throw new Error('Purpose is required — see usage above.');
  }

  const lifecycle = resolveBeginLifecycle(options);
  if (!lifecycle.success) {
    printBeginUsage();
    throw new Error(lifecycle.error);
  }

  // Rent-at-claim (S3): one line — link if obvious, opt-out reason if not.
  let rent = resolveBeginRent(options, process.env);
  if (!rent.ok && rent.needsPrompt) {
    rent = await promptBeginRent();
  }
  if (!rent.ok) {
    // The caller has purpose text but no --roadmap slug in hand — surface
    // ranked candidates (lib/roadmap-search.ts) instead of a bare rejection,
    // only on the generic "none given" gate (a specific --roadmap/--sidequest
    // validation error already names the exact fix; suggestions would be noise).
    if (rent.error === RENT_GATE_MESSAGE) {
      await printRoadmapSuggestions(purpose, options.harbor as string | undefined);
    }
    throw new Error(rent.error || RENT_GATE_MESSAGE);
  }

  // Auto-detect identity from package.json if not provided
  const identity = (options.identity as string) || autoIdentityFromPackageJson() || undefined;

  const body: Record<string, unknown> = { purpose };
  if (identity) body.identity = identity;
  if (options.agent) body.agentId = options.agent;
  if (options.name) body.name = options.name;
  if (options.type) body.type = options.type;
  if (options.force) body.force = true;
  body.lifecycle = lifecycle.lifecycle;
  if (rent.roadmapLink) body.roadmapLink = rent.roadmapLink;
  if (rent.sidequestReason) body.sidequestReason = rent.sidequestReason;
  if (rent.roadmapNewTitle) body.roadmapNewTitle = rent.roadmapNewTitle;

  // Collect files from --files option or remaining positional args
  const files: string[] = [];
  if (options.files) {
    if (typeof options.files === 'string') files.push(options.files);
    else if (Array.isArray(options.files)) files.push(...options.files);
  }
  for (const arg of rest) {
    if (!arg.startsWith('-')) files.push(arg);
  }
  if (files.length > 0) body.files = files;

  const worktreePolicy = resolveCliSessionWorktreePolicy(options);
  if (!worktreePolicy.success) {
    if (worktreePolicy.hint) console.error(`  ${worktreePolicy.hint}`);
    throw new Error(worktreePolicy.error || 'Session worktree policy failed');
  }
  attachCliSessionWorktreePolicy(body, worktreePolicy);

  // Capture before the request updates the display agent/session context. The
  // central fetch layer will present this same credential to a repeated begin;
  // retaining it afterward keeps the derived card and its actions attributed.
  const carriedCredential = resolveCliActorCredential();
  const res: PdFetchResponse = await pdFetch('/sugar/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error((data.error as string) || 'Failed to begin');
  }

  // Write local context file. The daemon-minted actor credential (#8877 /
  // ADR-0122) is returned ONCE when this begin minted a fresh soul; persist
  // it so every subsequent attributed pd write (done, note, claims, locks)
  // can present it via pdFetch's central header injection.
  writeCurrentContext({
    agentId: data.agentId as string,
    sessionId: data.sessionId as string,
    agentName: ((data.agentName || data.name) as string | undefined) || null,
    sessionName: (data.sessionName as string | undefined) || null,
    purpose,
    identity: (data.identity as string) || null,
    startedAt: Date.now(),
    credential: credentialForBegunSugarContext(data.credential, carriedCredential),
  });

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // PD_EMIT_EXPORTS=1 — emit ONLY the export lines to stdout so the caller can
  // `eval $(pd begin ...)`. Any other stdout output would be interpreted by the
  // shell and could inject code. We return immediately after emitting; the
  // human-readable banner goes to stderr only in this mode.
  if (process.env.PD_EMIT_EXPORTS === '1') {
    try {
      const agentId = data.agentId as string;
      const sessionId = data.sessionId as string;
      assertSafeId(agentId, 'agentId');
      assertSafeId(sessionId, 'sessionId');
      const shell = process.env.SHELL || '';
      const mintedCredential = typeof data.credential === 'string' && data.credential ? data.credential : null;
      if (shell.endsWith('/fish')) {
        console.log(`set -x PD_AGENT_ID ${fishShellQuote(agentId)}`);
        console.log(`set -x PD_SESSION_ID ${fishShellQuote(sessionId)}`);
        // The minted ADR-0040 credential (#8877): exported so mutating pd
        // commands in this shell present it even when the context file is
        // bypassed via PD_AGENT_ID env resolution.
        if (mintedCredential) console.log(`set -x PD_ACTOR_CREDENTIAL ${fishShellQuote(mintedCredential)}`);
      } else {
        console.log(`export PD_AGENT_ID=${posixShellQuote(agentId)}`);
        console.log(`export PD_SESSION_ID=${posixShellQuote(sessionId)}`);
        if (mintedCredential) console.log(`export PD_ACTOR_CREDENTIAL=${posixShellQuote(mintedCredential)}`);
      }
    } catch (err) {
      // Refuse to emit — write the reason to stderr so the caller sees it but
      // eval does NOT execute it. Exit non-zero so the caller's eval fails.
      process.stderr.write(`pd begin: refusing to emit exports — ${(err as Error).message}\n`);
      process.exit(1);
    }
    // Return here: nothing else goes to stdout when eval is the consumer.
    return;
  }

  if (isQuiet(options)) {
    console.log(data.agentId);
    return;
  }

  const agentName = (data.agentName || data.name) as string | undefined;
  const agentLabel = agentName ? `${agentName} (${data.agentId as string})` : (data.agentId as string);
  const sessionName = data.sessionName as string | undefined;
  const sessionLabel = sessionName ? `${sessionName} (${data.sessionId as string})` : (data.sessionId as string);
  const rentReceipt = formatRentReceipt({
    roadmapLink: data.roadmapLink as string | undefined,
    sidequestReason: data.sidequestReason as string | undefined,
  });
  if (ui.lineworkEnabled({ stream: 'stderr' })) {
    const rows: ui.LineworkRow[] = [
      { state: 'confirmed', label: 'agent', text: String(agentLabel) },
      { state: 'active', label: 'session', text: String(sessionLabel) },
      { state: 'pending', label: 'purpose', text: String(purpose) },
      { state: lifecycle.lifecycle === 'durable' ? 'healthy' : 'info', label: 'lifecycle', text: lifecycle.lifecycle },
    ];
    if (identity) rows.push({ state: 'active', label: 'identity', text: identity });
    if (data.roadmapLink) rows.push({ state: 'confirmed', label: 'roadmap', text: String(data.roadmapLink) });
    if (data.sidequestReason) rows.push({ state: 'info', label: 'sidequest', text: String(data.sidequestReason) });
    if (rentReceipt) rows.push({ state: 'confirmed', label: 'rent', text: rentReceipt });
    if (data.worktree && typeof data.worktree === 'object') {
      const worktree = data.worktree as { name?: string; branch?: string | null; id?: string };
      const branch = worktree.branch ? `:${worktree.branch}` : '';
      rows.push({ state: 'active', label: 'worktree', text: `${worktree.name || worktree.id || 'linked'}${branch}` });
    }
    if (data.fileClaims) {
      const claims = data.fileClaims as string[];
      rows.push({ state: 'confirmed', label: 'files', text: `${claims.length} claimed` });
    }
    if (data.fileConflicts) {
      const conflicts = data.fileConflicts as Array<{ filePath: string; sessionId: string }>;
      rows.push({ state: 'conflict', label: 'conflicts', text: `${conflicts.length} file(s) claimed by other sessions` });
    }
    if (data.salvageHint) rows.push({ state: 'recovering', label: 'salvage', text: String(data.salvageHint) });
    if (data.approvalsHint) rows.push({ state: 'awaiting-human', label: 'approval', text: String(data.approvalsHint) });
    console.error(ui.renderLineworkPanel({
      title: 'Session Anchored',
      subtitle: identity || String(data.agentId || 'agent'),
      tone: 'healthy',
      zone: 'agent ready',
      rows,
      footer: 'claim files next with pd session files add <path>',
      colorLevel: ui.lineworkColorLevel('stderr'),
    }));
    await showSugarParleyExperience(
      data.agentId as string | undefined,
      data.sessionId as string | undefined,
      options,
    );
    await showHelpfulSuggestions(purpose, data.agentId as string | undefined);
    return;
  }
  ui.success(`Agent ${highlightChannel(agentLabel)} ready`);
  console.error(`  Session: ${sessionLabel}`);
  console.error(`  Purpose: ${purpose}`);
  console.error(`  Lifecycle: ${lifecycle.lifecycle}`);
  if (data.roadmapLink) {
    const suffix = data.roadmapCreated
      ? ' (draft created)'
      : data.roadmapExisting
        ? ' (existing item — linked instead of creating a duplicate)'
        : '';
    console.error(`  Roadmap: ${data.roadmapLink}${suffix}`);
  }
  if (data.sidequestReason) console.error(`  Sidequest: ${data.sidequestReason}`);
  // Rent receipt — a wrong link is never sticky (anti-Goodhart valve).
  if (rentReceipt) console.error(`  ${rentReceipt}`);
  if (identity) console.error(`  Identity: ${identity}`);
  if (data.worktree && typeof data.worktree === 'object') {
    const worktree = data.worktree as { name?: string; branch?: string | null; id?: string };
    const branch = worktree.branch ? `:${worktree.branch}` : '';
    console.error(`  Worktree: ${worktree.name || worktree.id || 'linked'}${branch}`);
  }
  if (data.fileClaims) {
    const claims = data.fileClaims as string[];
    console.error(`  Files: ${claims.length} claimed`);
  }
  if (data.fileConflicts) {
    const conflicts = data.fileConflicts as Array<{ filePath: string; sessionId: string }>;
    console.error(`  Conflicts: ${conflicts.length} file(s) claimed by other sessions`);
  }
  if (data.salvageHint) {
    console.error('');
    console.error(`  ${data.salvageHint}`);
  }
  if (data.approvalsHint) {
    console.error('');
    ui.warn(String(data.approvalsHint));
  }
  await showSugarParleyExperience(
    data.agentId as string | undefined,
    data.sessionId as string | undefined,
    options,
  );
  await showHelpfulSuggestions(purpose, data.agentId as string | undefined);
}

// =============================================================================
// handleDone — pd done ["note"] [--status STATUS]
// =============================================================================

/**
 * `pd done` as a manual confirmation point for `merge_policy='auto'`
 * dispatches. The daemon's background sweep (server.ts, lib/dispatch/
 * auto-merge.ts) merges these PRs on its own interval, but an operator
 * running `pd done` right after a dispatch finishes shouldn't have to wait
 * for the next tick — this runs the SAME check-and-complete logic inline so
 * `pd done` either confirms the merge already happened (and worktree/branch
 * are already scrapped) or reports honestly why it isn't ready yet. This is
 * always best-effort: a failure here must never block the actual session end.
 */
async function reportAutoMergeOnDone(sessionId: string | undefined): Promise<string[]> {
  if (!sessionId) return [];
  const lines: string[] = [];
  try {
    const db = initDatabase();
    const queue = createDispatchQueue({ db });
    const dispatch = queue.getBySessionId(sessionId);
    if (!dispatch || dispatch.mergePolicy !== 'auto') return [];
    const outcome = await checkAndCompleteDispatch(dispatch);
    if (outcome.outcome === 'merged') {
      lines.push(`Auto-merge: merged ${dispatch.resultArtifact} (dispatch ${dispatch.id.slice(0, 8)}).`);
      if (outcome.cleanup.worktreeReaped) lines.push('  worktree scrapped');
      if (outcome.cleanup.branchDeleted) lines.push('  local branch deleted');
    } else if (outcome.outcome === 'already_merged') {
      lines.push(`Auto-merge: PR already merged (dispatch ${dispatch.id.slice(0, 8)}); confirmed cleanup.`);
    } else if (outcome.outcome === 'not_ready') {
      lines.push(`Auto-merge: dispatch ${dispatch.id.slice(0, 8)} not ready yet — ${outcome.reasons.join('; ')}`);
      lines.push(`  the daemon's background sweep will retry, or run: pd dispatch merge-sweep`);
    } else if (outcome.outcome === 'error') {
      lines.push(`Auto-merge: check failed for dispatch ${dispatch.id.slice(0, 8)} — ${outcome.error}`);
    }
  } catch {
    // Best-effort. A DB/gh hiccup here must never block `pd done`.
  }
  return lines;
}

export async function handleDone(
  note: string | undefined,
  options: CLIOptions,
): Promise<void> {
  // Flag takes precedence over positional
  note = note || (options.note as string) || undefined;

  // Interactive mode when no note and no flags provided
  if (!note && !options.status && canPrompt()) {
    note = await promptText({ label: 'Final note (optional):' }) || undefined;
    if (!options.status) {
      const status = await promptSelect({
        label: 'Session status?',
        choices: [
          { value: 'completed', label: 'Work finished successfully' },
          { value: 'abandoned', label: 'Leaving incomplete' },
        ],
        default: 'completed',
      });
      if (status) options.status = status;
    }
  }

  // Try to read local context first
  const ctx = readCurrentContext();

  const body: Record<string, unknown> = {};
  if (ctx) {
    body.agentId = ctx.agentId;
    body.sessionId = ctx.sessionId;
  }
  if (options.agent) body.agentId = options.agent;
  if (options.session) body.sessionId = options.session;
  if (note) body.note = note;
  if (options.status) body.status = options.status;

  // pd done origin-rule escape hatch (substrate fix 2026-05-20).
  // --skip-origin-check requires --reason "<reason>". The reason is
  // stamped into the result note with a loud [OPERATOR-OVERRIDE] prefix.
  const skipOriginCheck = options.skipOriginCheck === true || options['skip-origin-check'] === true;
  const skipOriginCheckReason = (options.reason as string | undefined) || undefined;
  if (skipOriginCheck) {
    body.skipOriginCheck = true;
    if (skipOriginCheckReason) body.skipOriginCheckReason = skipOriginCheckReason;
  }

  const noPr = options.noPr === true || options['no-pr'] === true;
  const subtask = options.subtask === true || options['subtask'] === true;
  const forceIncomplete = options.forceIncomplete === true || options['force-incomplete'] === true;
  const reason = (options.reason as string | undefined) || undefined;

  // Best-effort auto-merge confirmation pass BEFORE the session actually
  // ends (the dispatch's session_id lookup only works while we still know
  // which session this is — after clearCurrentContext() below, local context
  // is gone).
  const autoMergeLines = await reportAutoMergeOnDone(
    typeof body.sessionId === 'string' ? body.sessionId : ctx?.sessionId,
  );

  // #8877 / ADR-0122: /sugar/done requires the actor credential minted at
  // begin; resolve it from env or the context store (only when the context's
  // agent matches the agent this done asserts).
  const doneAgentId = typeof body.agentId === 'string' ? body.agentId : undefined;
  const pd = new PortDaddy({
    agentId: doneAgentId,
    credential: resolveCliActorCredential(doneAgentId),
  });
  const data = await pd.done(note, {
    agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    skipOriginCheck: skipOriginCheck ? true : undefined,
    skipOriginCheckReason: skipOriginCheck ? skipOriginCheckReason : undefined,
    noPr: noPr ? true : undefined,
    subtask: subtask ? true : undefined,
    forceIncomplete: forceIncomplete ? true : undefined,
    forceIncompleteReason: forceIncomplete ? reason : undefined,
  });

  if (!data?.success) {
    // For the new precondition refusals, print the structured remediation
    // hint on its own line so operators see the actionable next step.
    ui.error(data?.error || 'Failed to end session');
    const hint = (data as unknown as { hint?: unknown } | null)?.hint;
    if (typeof hint === 'string') {
      // Indent each line for readability beneath the error header.
      console.error(hint.split('\n').map((line) => (line.startsWith('  ') ? line : `  ${line}`)).join('\n'));
    }
    process.exit(1);
  }

  // Clear local context
  clearCurrentContext();

  if (isJson(options)) {
    console.log(JSON.stringify({ ...data, autoMerge: autoMergeLines }, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.sessionId || 'done');
    return;
  }

  if (data.sessionStatus === 'abandoned') {
    ui.warn(`Session ${data.sessionId} ${data.sessionStatus}`);
  } else {
    ui.success(`Session ${data.sessionId} ${data.sessionStatus}`);
  }
  if (data.agentUnregistered) console.error(`  Agent ${data.agentId} unregistered`);
  if (data.notesCount) console.error(`  Notes: ${data.notesCount}`);
  if (note) console.error(`  Final note: "${note}"`);
  for (const line of autoMergeLines) console.error(`  ${line}`);
}

// =============================================================================
// handleWhoami — pd whoami
// =============================================================================

export async function handleWhoami(options: CLIOptions): Promise<void> {
  // Try local context first
  const ctx = readCurrentContext();
  const agentId = (options.agent as string) || ctx?.agentId;
  const sessionId = (options.session as string) || ctx?.sessionId;

  if (!agentId && !sessionId) {
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, active: false, hint: 'No active session. Use pd begin to start.' }, null, 2));
    } else if (!isQuiet(options)) {
      console.error('No active session. Use pd begin to start.');
    }
    return;
  }

  const pd = new PortDaddy({ agentId });
  const data = await pd.whoami({ agentId, sessionId });

  // Preserve local context fields when the daemon has to reconstruct from sessionId alone.
  if (ctx) {
    if (!data.purpose && ctx.purpose) data.purpose = ctx.purpose;
    if ((data.identity === undefined || data.identity === null) && ctx.identity) data.identity = ctx.identity;
    if (data.startedAt == null && ctx.startedAt != null) data.startedAt = ctx.startedAt;
    data.localContext = {
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      agentName: ctx.agentName ?? null,
      sessionName: ctx.sessionName ?? null,
      startedAt: ctx.startedAt,
      purpose: ctx.purpose,
      identity: ctx.identity ?? null,
      contextSlot: ctx.contextSlot,
    };
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!data.active) {
    if (isQuiet(options)) return;
    console.error(data.hint || 'No active session');
    return;
  }

  if (isQuiet(options)) {
    console.log(`${data.agentId}:${data.sessionId}`);
    return;
  }

  console.error('');
  const agentName = (data.agentName || data.name || ctx?.agentName) as string | undefined;
  const sessionName = (data.sessionName || ctx?.sessionName) as string | undefined;
  console.error(`  Agent:    ${agentName ? `${agentName} (${data.agentId})` : data.agentId}`);
  console.error(`  Session:  ${sessionName ? `${sessionName} (${data.sessionId})` : data.sessionId}`);
  console.error(`  Purpose:  ${data.purpose}`);
  if (data.roadmapLink) console.error(`  Roadmap:  ${data.roadmapLink}`);
  if (data.sidequestReason) console.error(`  Sidequest: ${data.sidequestReason}`);
  if (data.identity) console.error(`  Identity: ${data.identity}`);
  console.error(`  Phase:    ${data.phase}`);
  if (data.duration != null) {
    console.error(`  Duration: ${relativeTime(data.duration as number)}`);
  }
  if (data.noteCount) console.error(`  Notes:    ${data.noteCount}`);
  if (data.files && (data.files as string[]).length > 0) {
    console.error(`  Files:    ${(data.files as string[]).join(', ')}`);
  }
  console.error('');
}

// =============================================================================
// handleWithLock — pd with-lock <name> <cmd...>
// =============================================================================

export async function handleWithLock(
  name: string | undefined,
  command: string[],
  options: CLIOptions,
): Promise<void> {
  if (!name || command.length === 0) {
    console.error('Usage: pd with-lock <lock-name> <command...>');
    console.error('');
    console.error('Acquires a lock, runs the command, then releases the lock.');
    console.error('The lock is released even if the command fails.');
    console.error('');
    console.error('Examples:');
    console.error('  pd with-lock db-migrations npm run migrate');
    console.error('  pd with-lock deploy ./deploy.sh');
    process.exit(1);
  }

  const ttl = options.ttl ? parseInt(options.ttl as string, 10) : 300000;
  const current = readCurrentContext();
  const owner = (options.owner as string) || current?.agentId || `cli-${process.pid}`;
  const pd = new PortDaddy({
    agentId: owner,
    credential: resolveCliActorCredential(owner),
    pid: process.pid,
  });
  // #8877 / ADR-0122: the acquire+release pair below must present ONE
  // daemon-minted soul; mint (persisted per shell slot) when none is held.
  if (!pd.credential) {
    try {
      pd.credential = await ensureCliActorCredential(owner);
    } catch (error) {
      ui.error(`Failed to mint actor credential: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Acquire lock
  try {
    await pd.lock(name, { owner, ttl });
  } catch (error) {
    const lockData = error && typeof error === 'object' && 'body' in error ? (error as { body?: Record<string, unknown> }).body : null;
    const message = lockData && typeof lockData.error === 'string'
      ? lockData.error
      : (error as Error).message || 'lock is held';
    ui.error(`Failed to acquire lock "${name}": ${message}`);
    process.exit(1);
  }

  if (IS_TTY && !isQuiet(options)) {
    ui.success(`Lock "${name}" acquired`);
  }

  // Run the command — shell: false by default to prevent injection.
  // If the user passed a single string with pipes/&&, they need --shell.
  const useShell = !!options.shell;
  const [cmd, ...cmdArgs] = command;
  const child = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: useShell,
  });

  // Handle signals — release lock on SIGINT/SIGTERM
  const cleanup = async (signal: string) => {
    child.kill(signal as NodeJS.Signals);
    await pd.unlock(name, { owner, force: true }).catch(() => {});
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  };

  const onSigInt = () => cleanup('SIGINT');
  const onSigTerm = () => cleanup('SIGTERM');
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
  });

  // Remove signal handlers to prevent listener leak
  process.removeListener('SIGINT', onSigInt);
  process.removeListener('SIGTERM', onSigTerm);

  // Release lock
  await pd.unlock(name, { owner, force: true }).catch(() => {});

  if (IS_TTY && !isQuiet(options)) {
    ui.success(`Lock "${name}" released`);
  }

  process.exit(exitCode);
}
