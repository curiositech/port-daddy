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
 *
 * Because OpenAI-compatible substrates (Groq, LM Studio, Ollama) have no
 * lifecycle hooks, the *runner* reads this file and injects the relevant slice
 * into the transcript on each turn. This module is that reader.
 *
 * NEVER reads or writes /tmp. The canonical path lives under ~/.port-daddy.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseMatrix } from '../squid/matrix.js';

export const INK_CLOUD_PATH = join(homedir(), '.port-daddy', 'matrix.env');

export interface InkCloud {
  /** lock-key path-suffix -> owning actor id */
  locks: Record<string, string>;
  /** pheromone topic -> value */
  pheromones: Record<string, string>;
  /** alert name -> message */
  alerts: Record<string, string>;
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

/** Classify raw env keys into the Ink Cloud structure. */
export function classify(raw: Record<string, string>): InkCloud {
  const locks: Record<string, string> = {};
  const pheromones: Record<string, string> = {};
  const alerts: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('PD_LOCK_')) locks[k.slice('PD_LOCK_'.length)] = v;
    else if (k.startsWith('PD_PHEROMONE_')) pheromones[k.slice('PD_PHEROMONE_'.length)] = v;
    else if (k.startsWith('PD_ALERT_')) alerts[k.slice('PD_ALERT_'.length)] = v;
  }
  return { locks, pheromones, alerts, raw };
}

/**
 * Read + parse the Ink Cloud from disk. Missing file => empty (not an error).
 * Delegates line-parsing to `lib/squid/matrix.ts`'s `parseMatrix`, the single
 * source of truth for the `KEY="value"` format (ADR-0091 PR1: parser
 * consolidation), instead of re-implementing it here.
 */
export function readInkCloud(path: string = INK_CLOUD_PATH): InkCloud {
  if (!existsSync(path)) return { locks: {}, pheromones: {}, alerts: {}, raw: {} };
  const raw = parseMatrix(readFileSync(path, 'utf8'));
  return classify(raw);
}

/** Read an Ink Cloud directly from text (used by the live proof harness). */
export function readInkCloudFromText(text: string): InkCloud {
  return classify(parseMatrix(text));
}

export interface InjectionOptions {
  /** files the task intends to touch — surfaces locks held by OTHER actors */
  targetFiles?: string[];
  /** this agent's own actor id — its own locks are not "conflicts" */
  selfActor?: string;
}

/**
 * Build the LIVE COORDINATION STATE block injected into the transcript each
 * turn. Surfaces every alert, every lock that collides with a target file
 * (owned by someone other than self), and recent pheromones. Returns "" when
 * there is genuinely nothing to report (so we don't inject noise).
 */
export function buildInjectionBlock(cloud: InkCloud, opts: InjectionOptions = {}): string {
  const self = opts.selfActor;
  const targets = opts.targetFiles ?? [];
  const lines: string[] = [];

  // Locks colliding with intended targets, held by another actor.
  const conflicts: Array<{ file: string; actor: string }> = [];
  for (const file of targets) {
    const suffix = lockKeySuffix(file);
    const actor = cloud.locks[suffix];
    if (actor && actor !== self) conflicts.push({ file, actor });
  }

  const alertKeys = Object.keys(cloud.alerts);
  const pheromoneKeys = Object.keys(cloud.pheromones);

  if (conflicts.length === 0 && alertKeys.length === 0 && pheromoneKeys.length === 0) {
    return '';
  }

  lines.push('=== LIVE COORDINATION STATE (Ink Cloud, read this turn) ===');

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
  lines.push('=== END LIVE COORDINATION STATE ===');
  return lines.join('\n');
}
