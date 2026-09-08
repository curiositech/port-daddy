#!/usr/bin/env node
/**
 * Port Daddy Pilot — SessionStart steering hook.
 *
 * Wired into a project's .claude/settings.json SessionStart hooks by `pd init`.
 * On every new session in a Port Daddy-active repo, it injects context steering
 * the agent to operate as the Port Daddy Pilot for the rest of the session —
 * UNLESS a non-default agent was explicitly selected, or steering is disabled.
 *
 * Deliberately dependency-free and daemon-independent: it must work on a cold
 * session before any daemon, identity, or MCP connection exists. Detection is
 * purely filesystem-local (presence of .portdaddy/ or pd-fleet.yml).
 *
 * Contract: emits the Claude Code SessionStart hook JSON on stdout:
 *   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
 * Stays silent (empty output, exit 0) when it should not steer, so it never
 * disrupts a session it doesn't apply to.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function readStdin() {
  // Read the whole SessionStart payload (small JSON) from fd 0 in one shot.
  // Throws if stdin is a TTY or closed — both fine, we just treat it as empty.
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parsePayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Walk up from a starting dir looking for a Port Daddy project marker. */
function findPortDaddyRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, '.portdaddy')) ||
      existsSync(join(dir, 'pd-fleet.yml')) ||
      existsSync(join(dir, 'pd-fleet.yaml'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function salvageNudge(projectName) {
  if (!projectName) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const base = (process.env.PD_URL || process.env.PORT_DADDY_URL || 'http://127.0.0.1:9876').replace(/\/$/, '');
    const response = await fetch(`${base}/salvage?project=${encodeURIComponent(projectName)}&limit=20`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    const agents = Array.isArray(body?.agents) ? body.agents : [];
    if (agents.length === 0) return null;
    const count = agents.length >= 20 ? '20+' : String(agents.length);
    return `SALVAGE: ${count} interrupted agent run(s) are available for ${projectName}. Run \`pd salvage --project ${projectName}\` before starting duplicate work.`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Was a specific, non-default agent explicitly requested? We honor that and
 * stay out of the way. We check the payload defensively across field names
 * since the exact SessionStart schema varies by harness version.
 */
function explicitNonDefaultAgent(payload) {
  const candidates = [payload.agent, payload.agent_id, payload.agentType, payload.selected_agent];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.trim() !== 'port-daddy-pilot') {
      return true;
    }
  }
  return false;
}

/**
 * Read the repo's per-repo SITREP dial (`sitrep.endOfTurn` in agent.config.json,
 * `.portdaddy/sitrep.json`, or `.portdaddy/project.json`), walking up from the
 * session cwd exactly like the pd-hook-prompt tentacle does.
 *
 * Why here too: SessionStart is the strongest steering surface — a session that
 * learns the end-of-turn contract at birth complies from turn one, while the
 * per-turn tentacle keeps re-compelling it. Both read the SAME dial so the
 * operator has one switch. Default is 'enforce' (operator doctrine reversal,
 * 2026-08-22: the end-of-turn SITREP is the harness's visible value surface;
 * an absent or unreadable config fails toward the full contract, and repos
 * that want quiet turns opt out explicitly with `sitrep.endOfTurn: "off"`).
 *
 * @param {string} startDir - Directory to start the parent walk from.
 * @returns {'off'|'suggest'|'enforce'} The resolved dial level.
 */
function sitrepLevel(startDir) {
  const env = (process.env.PD_SITREP || '').trim().toLowerCase();
  if (env === 'off' || env === 'suggest' || env === 'enforce') return env;
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const name of ['agent.config.json', '.portdaddy/sitrep.json', '.portdaddy/project.json']) {
      try {
        const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        let value = data && typeof data === 'object' ? data.sitrep : undefined;
        if (value && typeof value === 'object') value = value.endOfTurn;
        if (typeof value === 'string') {
          const level = value.trim().toLowerCase();
          if (level === 'off' || level === 'suggest' || level === 'enforce') return level;
        }
      } catch {
        /* missing or malformed config file: keep walking, default stays enforce */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'enforce';
}

const SITREP_DUTY = [
  '',
  'SITREP (end-of-turn, per-repo dial): end EVERY turn with a SITREP markdown table',
  '(`pd sitrep --template` prints the scaffold) tracking each idea raised this session,',
  'each roadmap claim, and work assigned by other agents, with the turn\'s progress in',
  'Status. Preserve unresolved rows in durable notes; recap them compactly with links.',
  'Link work to its existing assigned roadmap item before editing. Only create with',
  '`pd roadmap upsert` when no item exists and the selected authority permits it; verify',
  'read-back there. A local projection is not proof of remote canonical persistence.',
].join('\n');

const STEERING = [
  'This repository is **Port Daddy-active**. Operate as the **Port Daddy Pilot** agent for the',
  'remainder of this session unless the user explicitly selected a different agent.',
  '',
  'The full persona is installed at `~/.claude/agents/port-daddy-pilot.md` (Claude),',
  '`~/.codex/agents/port-daddy-pilot.toml` (Codex), and `/pd-pilot` (Gemini). Core duties:',
  '',
  '1. COORDINATE BEFORE YOU CUT. Run `pd sitrep` / coordination_preflight and claim the',
  '   smallest real edit surface before the first edit. Editing unclaimed or already-claimed',
  '   files is the cardinal sin.',
  '2. LEAVE DURABLE EVIDENCE. Use a linked worktree, commit small validated checkpoints',
  '   often, and read back a scoped `pd note` after each commit. Preserve intent outside chat.',
  '3. KEEP LISTENING. Re-read sessions/claims/notes/swarm_awareness before switching scope and',
  '   before every commit/push/deploy. Fetch + rebase onto the canonical remote; `pd guard',
  '   check --staged` before commit.',
  '4. GO MULTI-AGENT WHEN THE WORK FANS OUT. One implementer per disjoint claim, an adversarial',
  '   reviewer per diff, one long-lived coordination-keeper. Solo for a single bounded change.',
  '5. Operator surface is FleetBar / the dashboard — never tell the human to run shell commands.',
  '6. OWN DELIVERY TO MAIN. Implementation and requested research artifacts are not done',
  '   when merely saved or committed: publish a ready, non-draft App/Fleetbot PR through the',
  '   configured publisher, with responsible-agent/session/roadmap attribution. Own it through',
  '   gracious review replies, fixes and regression tests, required checks green, and normal',
  '   protected merge/queue. Record the final merged-head receipt; queue admission is not merge.',
  '   Incorporate actionable feedback unless demonstrably wrong or harmful; explain disputes.',
  '   Never substitute neutral/skipped Fleet for review, bypass a required gate, or post as the user.',
  '   Read-only answers/reviews need no PR. Findings-only reviewers without authoring authority',
  '   return findings to the author; they must not push or merge. An explicit handoff preserves ownership.',
  '7. RECOVER EXACTLY. Isolate inherited parent PD_SESSION_ID/PD_AGENT_ID only at launch of a',
  '   genuinely new child with its own context slot. Never clear an existing CONTEXT_CONFLICT',
  '   to bypass a proven contradiction or copy another actor\'s credential. Re-read exact session,',
  '   owner, worktree and branch; use supported recovery or name the missing capability and next action.',
  '   Missing publication authority is a recoverable handoff, not permission for personal GitHub writes.',
  '8. PROVE THE SURFACE. Source, built artifact, installed runtime and visual receipts differ.',
  '   This is Claude SessionStart steering; the shared turn tentacle covers Claude/Codex/Gemini/agy.',
  '   agy Stop is observe-only. Generated config/persona files do not prove live hook activation.',
  '',
  'Tools: prefer Port Daddy MCP (sessions, claims, locks, notes, ports, sorties) and native',
  'Jury-rig skill discovery. Search skills before hand-rolling; never write',
  'keyword-based NLP. No Potemkin work — be transparently hollow if you must be hollow.',
  '',
  'To opt out for a session, set PD_PILOT_DISABLE=1 or launch with `--agent <other>`.',
].join('\n');

async function main() {
  if (process.env.PD_PILOT_DISABLE) return;

  const payload = parsePayload(readStdin());
  if (explicitNonDefaultAgent(payload)) return;

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = findPortDaddyRoot(cwd);
  if (!root) return;

  // The SITREP duty rides the same envelope unless the repo dialed it off —
  // the end-of-turn table is the harness's visible value surface, and the
  // session should learn the contract at birth, not at its first turn.
  let steering = sitrepLevel(cwd) === 'off' ? STEERING : STEERING + SITREP_DUTY;
  const salvage = await salvageNudge(basename(root));
  if (salvage) steering += `\n\n${salvage}`;

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: steering,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch(() => {});
