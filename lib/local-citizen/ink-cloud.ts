/**
 * Ink Cloud reader — the coordination hot-cache for hookless local agents.
 *
 * The Ink Cloud is a flat POSIX `KEY="value"` env file at
 * `~/.port-daddy/matrix.env`. It carries the live coordination state that the
 * Claude Code / Codex hook path would otherwise inject for you:
 *
 *   PD_LOCK_<PATHSUFFIX>="<actor>"      — actor holds a claim on a file
 *   PD_PHEROMONE_<TOPIC>="<value>"      — fading stigmergic attention trace
 *   PD_ALERT_<NAME>="<message>"         — CI verdict / budget / fleet / parley
 *   PD_HALT="<reason...>"               — repo-wide pause (reconcile-projected)
 *   PD_RECON_HEARTBEAT_TS="<epoch ms>"  — reconcile-loop liveness heartbeat
 *   PD_INBOX_<ACTOR>_<slot>="[FOR YOU]" — addressed attention items
 *   PD_PARLEY_<ACTOR>_<id>="[FOR YOU]"  — addressed parley summonses
 *   PD_CLAIM_<PATH>="OVERLAP ..."       — claim-overlap advisories
 *   PD_CI_<REPO_BRANCH>="CI RED ..."    — red default-branch latch
 *   PD_ACCOMPLISHMENT_<...>             — fleet accomplishment whispers (W3.1)
 *
 * Because OpenAI-compatible substrates (Groq, LM Studio, Ollama) have no
 * lifecycle hooks, the *runner* reads this file and injects the relevant slice
 * into the transcript on each turn. This module is that reader — the SECOND
 * reader of every projected class (the hook tentacles are the first); every
 * new class must land BOTH places.
 *
 * Enforcement parity note: there is NO enforcement on hookless backends —
 * everything this reader renders (including HALT) is advisory-only injection.
 *
 * NEVER reads or writes /tmp. The canonical path lives under ~/.port-daddy.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const INK_CLOUD_PATH = join(homedir(), '.port-daddy', 'matrix.env');

export interface InkCloud {
  /** lock-key path-suffix -> owning actor id */
  locks: Record<string, string>;
  /** pheromone topic -> value */
  pheromones: Record<string, string>;
  /** alert name -> message */
  alerts: Record<string, string>;
  /** repo-wide pause message (PD_HALT), or null when not armed */
  halt: string | null;
  /** inbox key remainder (ACTOR_slot) -> "[FOR YOU]" message */
  inbox: Record<string, string>;
  /** parley key remainder (ACTOR_PARLEYID) -> summons message */
  parley: Record<string, string>;
  /** claim-overlap key remainder -> advisory */
  claims: Record<string, string>;
  /** CI key remainder -> red-branch advisory */
  ci: Record<string, string>;
  /** accomplishment key remainder -> whisper */
  accomplishments: Record<string, string>;
  /** reconcile heartbeat (epoch ms), or null when absent/unparseable */
  heartbeatTs: number | null;
  /** every key (for diagnostics) */
  raw: Record<string, string>;
}

/**
 * Convert a file path to the Ink Cloud lock-key suffix.
 *
 * Algorithm (matches the documented Ink Cloud contract):
 *   path -> every non-alphanumeric char to "_" -> trim "_" -> UPPERCASE -> cap 80.
 *
 * So PD_LOCK_<lockKeySuffix(path)> is the env key that records who holds `path`.
 */
export function lockKeySuffix(path: string): string {
  let s = path.replace(/[^a-zA-Z0-9]+/g, '_');
  s = s.replace(/^_+/, '').replace(/_+$/, '');
  s = s.toUpperCase();
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

/** Full env key for a path's lock, e.g. PD_LOCK_LIB_FOO_TS. */
export function lockKeyFor(path: string): string {
  return `PD_LOCK_${lockKeySuffix(path)}`;
}

/**
 * Normalize an actor id to its addressed-key suffix (PD_INBOX_<HERE>_*).
 *
 * Motivation: hookless runners need to filter the addressed classes down to
 * THEIR actor, using the exact same normalization the writer used. The
 * canonical law lives in `lib/squid/matrix.ts` `actorKey()` (= keySuffix);
 * this is its byte-identical mirror on the reader side, same algorithm as
 * {@link lockKeySuffix} (which already IS the keySuffix mirror) — kept as a
 * named export so call sites say what they mean (actor addressing, not locks).
 *
 * @param actor raw actor/agent id
 * @returns the UPPERCASE key suffix for this actor
 */
export function actorKeySuffix(actor: string): string {
  return lockKeySuffix(actor);
}

/**
 * Is the reconcile-projected surface fresh?
 *
 * Design: the reconcile loop stamps PD_RECON_HEARTBEAT_TS (epoch ms) every
 * tick; any reader treating projections as CURRENT must first check this.
 * Missing/unparseable heartbeat ⇒ stale. Staleness never hides addressed
 * content (it is true history) — it only demotes it to "historical" and
 * suppresses the loud HALT banner, mirroring bin/pd-hook-prompt.
 *
 * @param cloud a parsed ink cloud
 * @param nowMs current time (injectable for tests)
 * @param staleMs freshness horizon; default matches PD_RECON_STALE_MS (60s)
 * @returns true when the heartbeat is present and younger than staleMs
 */
export function isFresh(cloud: InkCloud, nowMs: number = Date.now(), staleMs = 60_000): boolean {
  if (cloud.heartbeatTs == null) return false;
  return nowMs - cloud.heartbeatTs <= staleMs;
}

/**
 * Parse POSIX `KEY="value"` env text. Tolerant of:
 *  - comments (# ...) and blank lines
 *  - optional `export ` prefix
 *  - single- or double-quoted values, or bare values
 *  - escaped \" and \\ inside double quotes
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = body.slice(eq + 1).trim();
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (val.length >= 2 && val[0] === "'" && val[val.length - 1] === "'") {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Classify raw env keys into the Ink Cloud structure. Map keys keep the full
 *  key remainder after the class prefix (e.g. inbox["MYAGENT_1"]). */
export function classify(raw: Record<string, string>): InkCloud {
  const locks: Record<string, string> = {};
  const pheromones: Record<string, string> = {};
  const alerts: Record<string, string> = {};
  const inbox: Record<string, string> = {};
  const parley: Record<string, string> = {};
  const claims: Record<string, string> = {};
  const ci: Record<string, string> = {};
  const accomplishments: Record<string, string> = {};
  let halt: string | null = null;
  let heartbeatTs: number | null = null;
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'PD_HALT') halt = v;
    else if (k === 'PD_RECON_HEARTBEAT_TS') {
      const n = Number(v);
      heartbeatTs = Number.isFinite(n) ? n : null;
    } else if (k.startsWith('PD_LOCK_')) locks[k.slice('PD_LOCK_'.length)] = v;
    else if (k.startsWith('PD_PHEROMONE_')) pheromones[k.slice('PD_PHEROMONE_'.length)] = v;
    else if (k.startsWith('PD_ALERT_')) alerts[k.slice('PD_ALERT_'.length)] = v;
    else if (k.startsWith('PD_INBOX_')) inbox[k.slice('PD_INBOX_'.length)] = v;
    else if (k.startsWith('PD_PARLEY_')) parley[k.slice('PD_PARLEY_'.length)] = v;
    else if (k.startsWith('PD_CLAIM_')) claims[k.slice('PD_CLAIM_'.length)] = v;
    else if (k.startsWith('PD_CI_')) ci[k.slice('PD_CI_'.length)] = v;
    else if (k.startsWith('PD_ACCOMPLISHMENT_')) accomplishments[k.slice('PD_ACCOMPLISHMENT_'.length)] = v;
  }
  return { locks, pheromones, alerts, halt, inbox, parley, claims, ci, accomplishments, heartbeatTs, raw };
}

function emptyCloud(): InkCloud {
  return classify({});
}

/** Read + parse the Ink Cloud from disk. Missing file => empty (not an error). */
export function readInkCloud(path: string = INK_CLOUD_PATH): InkCloud {
  if (!existsSync(path)) return emptyCloud();
  const raw = parseEnv(readFileSync(path, 'utf8'));
  return classify(raw);
}

/** Read an Ink Cloud directly from text (used by the live proof harness). */
export function readInkCloudFromText(text: string): InkCloud {
  return classify(parseEnv(text));
}

export interface InjectionOptions {
  /** files the task intends to touch — surfaces locks held by OTHER actors */
  targetFiles?: string[];
  /** this agent's own actor id — its own locks are not "conflicts", and its
   *  addressed PD_INBOX_/PD_PARLEY_ keys render in the FOR YOU section */
  selfActor?: string;
  /** current time (injectable for freshness tests) */
  nowMs?: number;
}

/**
 * Build the LIVE COORDINATION STATE block injected into the transcript each
 * turn. Renders (in order) the HALT banner (only when armed AND the reconcile
 * heartbeat is fresh — a dead daemon must not nag forever), the addressed
 * "FOR YOU" section for `selfActor` (kept even when stale, with a historical
 * annotation — inbox content is still true history), then locks colliding with
 * target files, alerts, pheromones, and the claim/CI/accomplishment advisory
 * classes. Returns "" when there is genuinely nothing to report (so we don't
 * inject noise).
 *
 * This mirrors bin/pd-hook-prompt section-for-section; it is the hookless
 * parity surface (advisory only — no enforcement exists on hookless backends).
 */
export function buildInjectionBlock(cloud: InkCloud, opts: InjectionOptions = {}): string {
  const self = opts.selfActor;
  const targets = opts.targetFiles ?? [];
  const now = opts.nowMs ?? Date.now();
  const fresh = isFresh(cloud, now);
  const lines: string[] = [];

  // Locks colliding with intended targets, held by another actor.
  const conflicts: Array<{ file: string; actor: string }> = [];
  for (const file of targets) {
    const suffix = lockKeySuffix(file);
    const actor = cloud.locks[suffix];
    if (actor && actor !== self) conflicts.push({ file, actor });
  }

  // Addressed classes: only THIS actor's keys (the W1 addressing contract —
  // a sibling must not see them).
  const forYou: string[] = [];
  if (self) {
    const ak = `${actorKeySuffix(self)}_`;
    for (const [k, v] of Object.entries(cloud.inbox)) {
      if (k.startsWith(ak)) forYou.push(v);
    }
    for (const [k, v] of Object.entries(cloud.parley)) {
      if (k.startsWith(ak)) forYou.push(v);
    }
  }

  const showHalt = Boolean(cloud.halt) && fresh;
  const alertKeys = Object.keys(cloud.alerts);
  const pheromoneKeys = Object.keys(cloud.pheromones);
  const claimKeys = Object.keys(cloud.claims);
  const ciKeys = Object.keys(cloud.ci);
  const accomplishmentKeys = Object.keys(cloud.accomplishments);

  if (
    !showHalt &&
    forYou.length === 0 &&
    conflicts.length === 0 &&
    alertKeys.length === 0 &&
    pheromoneKeys.length === 0 &&
    claimKeys.length === 0 &&
    ciKeys.length === 0 &&
    accomplishmentKeys.length === 0
  ) {
    return '';
  }

  lines.push('=== LIVE COORDINATION STATE (Ink Cloud, read this turn) ===');

  if (showHalt) {
    lines.push(`[HALT] ${cloud.halt}`);
  }
  if (forYou.length > 0) {
    lines.push('FOR YOU (addressed to you):');
    for (const v of forYou) lines.push(`  - ${v}`);
    if (!fresh) {
      lines.push('  (coordination cache stale — daemon heartbeat >60s old; treat as historical)');
    }
  }
  if (conflicts.length > 0) {
    lines.push('FILE LOCKS held by OTHER actors on files you intend to edit:');
    for (const c of conflicts) {
      lines.push(`  - ${c.file}  ->  HELD BY actor "${c.actor}" (do NOT edit; coordinate)`);
    }
  }
  if (alertKeys.length > 0) {
    lines.push('ACTIVE ALERTS:');
    for (const k of alertKeys) lines.push(`  - PD_ALERT_${k}: ${cloud.alerts[k]}`);
  }
  if (pheromoneKeys.length > 0) {
    lines.push('PHEROMONE TRACES (hot surfaces):');
    for (const k of pheromoneKeys) lines.push(`  - PD_PHEROMONE_${k}: ${cloud.pheromones[k]}`);
  }
  if (claimKeys.length > 0) {
    lines.push('CLAIM OVERLAPS (advisory):');
    for (const k of claimKeys) lines.push(`  - PD_CLAIM_${k}: ${cloud.claims[k]}`);
  }
  if (ciKeys.length > 0) {
    lines.push('CI STATUS (advisory):');
    for (const k of ciKeys) lines.push(`  - PD_CI_${k}: ${cloud.ci[k]}`);
  }
  if (accomplishmentKeys.length > 0) {
    lines.push('FLEET ACCOMPLISHMENTS (advisory):');
    for (const k of accomplishmentKeys) lines.push(`  - PD_ACCOMPLISHMENT_${k}: ${cloud.accomplishments[k]}`);
  }
  lines.push('=== END LIVE COORDINATION STATE ===');
  return lines.join('\n');
}
