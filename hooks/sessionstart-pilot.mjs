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

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Harness-injection logging (ch.28 §28.5). Records WHAT the harness feeds the
 * agent so a transcript explorer can attribute per-turn input context to its
 * source. The canonical shared appender is `lib/harness-injection-log.ts`; this
 * hook is deliberately dependency-free ESM that runs on a cold session before
 * any build/lib is importable, so we inline a tiny, byte-compatible append.
 * FAIL-OPEN: best-effort, never throws into the SessionStart path. Stores
 * bytes + sha256, never the payload (full spill-to-blob is the ch.28 W8 job).
 */
function logInjection(payload, source) {
  try {
    const home = (process.env.PD_HOME && process.env.PD_HOME.trim())
      ? process.env.PD_HOME
      : join(homedir(), '.port-daddy');
    const path = (process.env.PD_HARNESS_INJECTION_LOG && process.env.PD_HARNESS_INJECTION_LOG.trim())
      ? process.env.PD_HARNESS_INJECTION_LOG
      : join(home, 'harness-injections.jsonl');
    const runtime = process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT
      ? 'claude'
      : (process.env.CODEX || process.env.CODEX_HOME ? 'codex' : 'unknown');
    const line = {
      ts: new Date().toISOString(),
      runtime,
      source,
      bytes: Buffer.byteLength(payload, 'utf8'),
      sha256: createHash('sha256').update(payload, 'utf8').digest('hex'),
    };
    const sid = process.env.CLAUDE_SESSION_ID || process.env.PD_SESSION_ID;
    if (sid) line.sessionId = sid;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(line) + '\n', { mode: 0o600 });
  } catch {
    // best-effort observability — must never disrupt session steering
  }
}

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
function isPortDaddyActive(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, '.portdaddy')) ||
      existsSync(join(dir, 'pd-fleet.yml')) ||
      existsSync(join(dir, 'pd-fleet.yaml'))
    ) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
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
  '2. LEAVE DURABLE EVIDENCE. Scope notes before edits, result notes after — `pd note` /',
  '   add_note, not chat. The next agent inherits your notes, not your context.',
  '3. KEEP LISTENING. Re-read sessions/claims/notes/swarm_awareness before switching scope and',
  '   before every commit/push/deploy. Fetch + rebase onto the canonical remote; `pd guard',
  '   check --staged` before commit.',
  '4. GO MULTI-AGENT WHEN THE WORK FANS OUT. One implementer per disjoint claim, an adversarial',
  '   reviewer per diff, one long-lived coordination-keeper. Solo for a single bounded change.',
  '5. Operator surface is FleetBar / the dashboard — never tell the human to run shell commands.',
  '',
  'Tools: prefer Port Daddy MCP (sessions, claims, locks, notes, ports, sorties) and WinDAGs',
  '(skill_search, next_move, validate_dag). Search skills before hand-rolling; never write',
  'keyword-based NLP. No Potemkin work — be transparently hollow if you must be hollow.',
  '',
  'To opt out for a session, set PD_PILOT_DISABLE=1 or launch with `--agent <other>`.',
].join('\n');

function main() {
  if (process.env.PD_PILOT_DISABLE) return;

  const payload = parsePayload(readStdin());
  if (explicitNonDefaultAgent(payload)) return;

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  if (!isPortDaddyActive(cwd)) return;

  // Record what the harness is about to inject into this session (ch.28 §28.5).
  logInjection(STEERING, 'sessionstart-pilot');

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: STEERING,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main();
