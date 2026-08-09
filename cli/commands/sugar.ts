/**
 * CLI Sugar Commands — Compound commands for common workflows
 *
 * Handles: begin, done, whoami, with-lock
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { highlightChannel } from '../../lib/maritime.js';
import PortDaddy from '../../lib/client.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY, relativeTime } from '../utils/output.js';
import { canPrompt, promptText, promptSelect, promptIdentity, promptConfirm, printRoger } from '../utils/prompt.js';
import { autoIdentityFromPackageJson } from './services.js';
import { assertSafeId, posixShellQuote, fishShellQuote } from '../../lib/shell-quote.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { clearCurrentContext, readCurrentContext, writeCurrentContext } from '../utils/current-context.js';
import {
  attachCliSessionWorktreePolicy,
  resolveCliSessionWorktreePolicy,
} from '../utils/session-worktree-policy.js';
import { initDatabase } from '../../lib/db.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { checkAndCompleteDispatch } from '../../lib/dispatch/auto-merge.js';

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

function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return 'unknown';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 60_000 * 60) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 60_000 * 60 * 24) return Math.floor(diff / (60_000 * 60)) + 'h ago';
  return Math.floor(diff / (60_000 * 60 * 24)) + 'd ago';
}

async function showHelpfulSuggestions(purpose: string, identity: string | undefined): Promise<void> {
  const suggestions: string[] = [];

  // 1. Salvageable sessions
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/salvage/pending`);
    if (res.ok) {
      const data = await res.json();
      const agents = (data.agents || []) as any[];
      const terms = purpose.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      
      const matched = agents.filter((a: any) => {
        const p = (a.purpose || '').toLowerCase();
        return terms.some(t => p.includes(t));
      });

      if (matched.length > 0) {
        suggestions.push(
          `♻️  ${ui.fmtCyan('Salvageable Sessions')}: Found ${matched.length} stale agent(s) with similar purpose:\n` +
          matched.map((a: any) => `     - ${ui.fmtYellow(a.id)}: "${a.purpose}" (run \`pd salvage claim ${a.id}\`)`).join('\n')
        );
      }
    }
  } catch (err) {
    // Fail silently
  }

  // 2. Roadmap items
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/roadmap/items`);
    if (res.ok) {
      const data = await res.json();
      const items = (Array.isArray(data) ? data : (data.items || [])) as any[];
      const terms = purpose.toLowerCase().split(/\s+/).filter(w => w.length > 3);

      const matched = items.filter((item: any) => {
        const title = (item.title || '').toLowerCase();
        const slug = (item.slug || '').toLowerCase();
        const summary = (item.summary || '').toLowerCase();
        return terms.some(t => title.includes(t) || slug.includes(t) || summary.includes(t));
      });

      if (matched.length > 0) {
        suggestions.push(
          `🗺️  ${ui.fmtCyan('Roadmap Items')}: Found matching items to link/take on:\n` +
          matched.map((item: any) => `     - ${ui.fmtYellow(item.slug)}: "${item.title}"`).join('\n')
        );
      }
    }
  } catch (err) {
    // Fail silently
  }

  // 3. Staged/modified files to claim
  try {
    const gitStatus = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8' });
    if (gitStatus.status === 0 && gitStatus.stdout) {
      const lines = gitStatus.stdout.split('\n').filter(Boolean);
      const files = lines.map(line => line.substring(3).trim());
      const terms = purpose.toLowerCase().split(/\s+/).filter(w => w.length > 3);

      const matchedFiles = files.filter(f => {
        const lower = f.toLowerCase();
        return terms.some(t => lower.includes(t));
      });

      const filesToShow = matchedFiles.length > 0 ? matchedFiles : files.slice(0, 3);
      if (filesToShow.length > 0) {
        suggestions.push(
          `📂  ${ui.fmtCyan('Suggested Files to Claim')}:\n` +
          filesToShow.map(f => `     - ${f} (run \`pd session files add ${f}\`)`).join('\n')
        );
      }
    }
  } catch (err) {
    // Fail silently
  }

  // 4. Docs and Skills to read
  try {
    const docFiles: string[] = [];
    const scanDirs = ['docs', 'skills'];
    for (const dir of scanDirs) {
      if (existsSync(dir)) {
        const list = readdirSync(dir, { recursive: true });
        for (const entry of list) {
          const entryStr = String(entry);
          if (entryStr.endsWith('.md')) {
            docFiles.push(join(dir, entryStr));
          }
        }
      }
    }

    const terms = purpose.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchedDocs = docFiles.filter(df => {
      const lower = df.toLowerCase();
      return terms.some(t => lower.includes(t));
    }).slice(0, 3);

    if (matchedDocs.length > 0) {
      suggestions.push(
        `📖  ${ui.fmtCyan('Recommended Docs/Skills to Read')}:\n` +
        matchedDocs.map(df => `     - [${basename(df)}](${df})`).join('\n')
      );
    }
  } catch (err) {
    // Fail silently
  }

  // 5. Active/Skillful Agents to Talk To (from talent phonebook, falling back to active sessions)
  let foundAgents = false;
  try {
    const params = new URLSearchParams();
    params.set('q', purpose);
    params.set('kind', 'any');
    params.set('limit', '3');
    const res = await pdFetch(`${PORT_DADDY_URL}/whois?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      const hits = (data.hits || []) as any[];
      if (hits.length > 0) {
        suggestions.push(
          `💬  ${ui.fmtCyan('Active/Skillful Agents to Talk To')}:\n` +
          hits.map((h: any) => {
            const timeStr = h.lastHeartbeat ? `last active ${formatTimeAgo(h.lastHeartbeat)}` : 'active';
            return `     - ${ui.fmtYellow(h.agentId)}: "${h.phrase}" (similarity: ${h.similarity.toFixed(2)}, ${timeStr})`;
          }).join('\n')
        );
        foundAgents = true;
      }
    }
  } catch (err) {
    // Fail silently, fallback below
  }

  if (!foundAgents) {
    try {
      const res = await pdFetch(`${PORT_DADDY_URL}/sessions?status=active&all=true`);
      if (res.ok) {
        const data = await res.json();
        const sessions = (Array.isArray(data) ? data : (data.sessions || [])) as any[];
        const otherActive = sessions.filter((s: any) => s.status === 'active');
        
        if (otherActive.length > 0) {
          const terms = purpose.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const matched = otherActive.filter((s: any) => {
            const p = (s.purpose || '').toLowerCase();
            return terms.some(t => p.includes(t));
          });

          const toShow = matched.length > 0 ? matched : otherActive.slice(0, 3);
          suggestions.push(
            `💬  ${ui.fmtCyan('Active Agents/Sessions to Talk To')}:\n` +
            toShow.map((s: any) => `     - ${ui.fmtYellow(s.agent_id || s.id)}: "${s.purpose}" (active in worktree: ${s.worktree_id || 'default'})`).join('\n')
          );
        }
      }
    } catch (err) {
      // Fail silently
    }
  }

  if (suggestions.length > 0) {
    console.error(`\n${ui.fmtCyan('💡 HELPFUL SUGGESTIONS FOR YOUR SESSION:')}`);
    console.error(suggestions.join('\n\n') + '\n');
  }
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

export async function handleBegin(
  purpose: string | undefined,
  rest: string[],
  options: CLIOptions,
 ): Promise<void> {
  // Flag takes precedence over positional
  purpose = purpose || (options.purpose as string) || undefined;

  if (!purpose && canPrompt()) {
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

  const res: PdFetchResponse = await pdFetch('/sugar/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error((data.error as string) || 'Failed to begin');
  }

  // Write local context file
  writeCurrentContext({
    agentId: data.agentId as string,
    sessionId: data.sessionId as string,
    agentName: ((data.agentName || data.name) as string | undefined) || null,
    sessionName: (data.sessionName as string | undefined) || null,
    purpose,
    identity: (data.identity as string) || null,
    startedAt: Date.now(),
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
      if (shell.endsWith('/fish')) {
        console.log(`set -x PD_AGENT_ID ${fishShellQuote(agentId)}`);
        console.log(`set -x PD_SESSION_ID ${fishShellQuote(sessionId)}`);
      } else {
        console.log(`export PD_AGENT_ID=${posixShellQuote(agentId)}`);
        console.log(`export PD_SESSION_ID=${posixShellQuote(sessionId)}`);
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
    await showHelpfulSuggestions(purpose, identity);
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
  await showHelpfulSuggestions(purpose, identity);
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

  const pd = new PortDaddy({ agentId: typeof body.agentId === 'string' ? body.agentId : undefined });
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
    pid: process.pid,
  });

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
