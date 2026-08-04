/**
 * Ink Cloud reader — the coordination hot-cache for hookless local agents.
 *
 * The Ink Cloud is a flat POSIX `KEY="value"` env file (`~/.port-daddy/matrix.env`
 * by default). It carries the live coordination state that the Claude Code /
 * Codex hook path injects for you via `bin/pd-hook-prompt`. OpenAI-compatible
 * substrates (Groq, LM Studio, Ollama) have no lifecycle hooks at all, so the
 * *runner* must read the file and inject the relevant slice into the transcript
 * on each turn. This module is that reader — the **second reader**, and the one
 * that historically fell behind.
 *
 * ## Why this file is a standing hazard
 *
 * Until this slice it hard-coded exactly three prefixes — `PD_LOCK_`,
 * `PD_PHEROMONE_`, `PD_ALERT_` — while the Reconcile Loop shipped five more
 * classes (`PD_HALT`, `PD_INBOX_`, `PD_PARLEY_`, `PD_CLAIM_`, `PD_CI_`,
 * `PD_ACCOMPLISHMENT_`). The result was not an error anywhere: an agent on Ollama
 * simply coordinated on less information than an agent on Claude Code, and
 * nothing in either process could tell. A halt the operator pulled reached the
 * hook-capable half of the fleet and silently missed the rest.
 *
 * The structural fix is that classification now goes through
 * `classifyReconcileKey()` from `lib/squid/reconcile-contract.ts` — the single
 * registry both readers share. Adding a class to that registry is now enough to
 * reach hookless backends; it is no longer possible to add one and reach only
 * half the fleet.
 *
 * ## Parity with `bin/pd-hook-prompt`, and where it deliberately stops
 *
 * Matched: the key classes, the emission order (`RECONCILE_PROJECTION_ORDER`),
 * per-class entry caps, the shared entry/byte budget spent most-important-first,
 * `| ts:` TTL filtering, the exact-project-root filter on pheromones, per-actor
 * addressing with the `__` boundary, and the fail-open staleness rule.
 *
 * Not matched, on purpose: the once-per-hour standing-plan nag (a hookless
 * runner composes its own system prompt, so a nag belongs there, not here) and
 * the hook's `hookSpecificOutput` JSON framing (there is no hook runtime to
 * frame for). {@link projectInkCloud} does return a `VoiceLogEvent` with
 * `hookEvent: 'local-citizen-turn'`, so a hookless turn is auditable through the
 * same `pd squid voice` surface as a hooked one.
 *
 * NEVER reads or writes /tmp. The canonical path lives under `$PD_HOME`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { keySuffix, matrixPath } from '../squid/matrix.js';
import {
  RECONCILE_KEY_CLASSES,
  RECONCILE_MAX_PROJECTED_ENTRIES,
  RECONCILE_PROJECTION_ORDER,
  RECONCILE_TOTAL_BUDGET_BYTES,
  classifyReconcileKey,
  isMatrixStale,
  perActorKeyPrefix,
  readHeartbeatTs,
  reconcileKeyActor,
  type ReconcileClassCounts,
  type ReconcileKeyClassName,
  type VoiceLogEvent,
} from '../squid/reconcile-contract.js';

/**
 * Static fallback location, kept only for callers that predate `PD_HOME`.
 *
 * @deprecated Use {@link inkCloudPath}. This constant is frozen at module load,
 * so a test (or a fleet) that relocates `PD_HOME` afterwards would read the
 * wrong file — which is exactly the drift `matrixPath()` exists to prevent.
 */
export const INK_CLOUD_PATH = join(homedir(), '.port-daddy', 'matrix.env');

/**
 * Resolve the Ink Cloud path the way every other Port Daddy component does.
 *
 * **Motivation.** `lib/squid/matrix.ts` honors `PD_MATRIX_FILE` and `PD_HOME`;
 * this module used to hard-code `~/.port-daddy/matrix.env`. A hermetic test or a
 * relocated fleet therefore moved the writer and left this reader pointed at the
 * operator's real matrix — reading a stranger's coordination state, or (more
 * often) an empty file, and reporting the calm that implies.
 *
 * @returns Absolute path to the matrix file this process should read.
 */
export function inkCloudPath(): string {
  return matrixPath();
}

/** One entry of a per-actor class, with its addressing already resolved. */
export interface AddressedEntry {
  /** Raw matrix key. */
  readonly key: string;
  /** Normalized actor the entry is addressed to (see `reconcileKeyActor`). */
  readonly actor: string;
  /** The entry's value. */
  readonly value: string;
}

export interface InkCloud {
  /** lock-key path-suffix -> owning actor id */
  locks: Record<string, string>;
  /** pheromone topic -> value */
  pheromones: Record<string, string>;
  /** LEGACY steering alert name -> message (excludes the reconciled approvals key) */
  alerts: Record<string, string>;
  /** The fleet-wide stop, when armed. */
  halt?: string;
  /** The reconciled pending-spawn-approvals summary, when any are waiting. */
  fleetApprovals?: string;
  /** Unread mail, across every actor — filter with {@link forActor}. */
  inbox: AddressedEntry[];
  /** Open parley summonses, across every actor. */
  parley: AddressedEntry[];
  /** claim-key suffix -> contested-path summary */
  claims: Record<string, string>;
  /** ci-key suffix -> red-check summary */
  ci: Record<string, string>;
  /** accomplishment-key suffix -> completion note */
  accomplishments: Record<string, string>;
  /** `PD_RECON_HEARTBEAT_TS`, when present and parseable. */
  heartbeatTs?: number;
  /**
   * Whether the reconcile loop has gone quiet for four ticks. When `true`,
   * consumers MUST fail open: inject nothing, block nothing.
   */
  stale: boolean;
  /**
   * Whether a matrix file was actually found.
   *
   * Distinct from "it had no keys" on purpose, and for the same reason the
   * VoiceLog separates `matrix-absent` from `no-entries`: an absent cache means
   * the harness has never run here, an empty one means it ran and found a calm
   * fleet. Collapsing them would report a broken install as good news.
   */
  present: boolean;
  /** every key (for diagnostics) */
  raw: Record<string, string>;
}

/**
 * Convert a file path to the Ink Cloud lock-key suffix.
 *
 * **Design: this now delegates to `matrix.keySuffix` instead of reimplementing
 * it.** The local copy was subtly different — it returned the empty string for
 * an input with no alphanumerics, where `keySuffix` returns the literal `X`. So
 * `lockKeyFor('---')` produced `PD_LOCK_` while `matrix.lockKeyForPath('---')`
 * produced `PD_LOCK_X`, and the reader looked for a key the writer never wrote.
 * Two normalizers that "should" agree is a latent bug; one function cannot
 * disagree with itself.
 *
 * @param path A file path (repo-relative or absolute).
 * @returns The uppercase, underscore-collapsed suffix, capped at 80 chars.
 */
export function lockKeySuffix(path: string): string {
  return keySuffix(path);
}

/**
 * Full env key for a path's lock, e.g. `PD_LOCK_LIB_FOO_TS`.
 *
 * Exists so no caller retypes the `PD_LOCK_` literal: the design intent across
 * this whole subsystem is that a prefix appears in exactly one builder, because
 * a mistyped prefix produces a key nobody reads and no error anywhere.
 *
 * @param path A file path.
 * @returns The matrix key recording who holds that path.
 */
export function lockKeyFor(path: string): string {
  return `PD_LOCK_${lockKeySuffix(path)}`;
}

/**
 * Parse POSIX `KEY="value"` env text.
 *
 * **Design: tolerance is deliberate, not sloppiness.** This file is appended to
 * by POSIX shell hooks and by K≥8 parallel agents while a reconcile tick may be
 * renaming a replacement into place. Junk lines are therefore expected traffic,
 * and the rule is to skip what does not parse rather than reject the file — one
 * torn line must not cost an agent every fact in the matrix. Tolerated:
 *  - comments (`# ...`) and blank lines
 *  - an optional `export ` prefix
 *  - single- or double-quoted values, or bare values
 *  - escaped `\"` and `\\` inside double quotes
 *
 * @param text Raw matrix file contents.
 * @returns Key→value map of every line that parsed.
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

/**
 * Build an empty cloud.
 *
 * Its purpose is that "the matrix is absent", "the matrix was unreadable", and
 * "the matrix is empty" all produce the SAME shape, so no caller has to
 * null-check its way through a degraded read. The design intent is fail-open:
 * a torn write must yield a quiet harness, never a thrown turn.
 *
 * @param raw Optional raw key→value map to retain for diagnostics.
 * @param present Whether a matrix file was found; defaults to "yes iff it had keys".
 * @returns A fully-populated {@link InkCloud} with no entries in any class.
 */
function emptyCloud(raw: Record<string, string> = {}, present?: boolean): InkCloud {
  return {
    locks: {},
    pheromones: {},
    alerts: {},
    inbox: [],
    parley: [],
    claims: {},
    ci: {},
    accomplishments: {},
    stale: false,
    present: present ?? Object.keys(raw).length > 0,
    raw,
  };
}

/**
 * Classify raw env keys into the Ink Cloud structure.
 *
 * **Design.** Every reconcile-owned key is routed by `classifyReconcileKey`
 * rather than by a prefix test written here, because the prefix tests written
 * here are precisely what fell three classes behind the daemon. `PD_LOCK_` and
 * `PD_PHEROMONE_` keep local prefix tests: they are NOT reconcile classes (the
 * loop only decays pheromones; it does not own them), and the registry
 * deliberately does not claim them.
 *
 * @param raw Parsed key→value map.
 * @param now Epoch ms used for the staleness verdict; injected so tests can pin
 *            the boundary instead of racing a real clock.
 * @returns The classified cloud, including its own staleness verdict.
 */
export function classify(raw: Record<string, string>, now: number = Date.now()): InkCloud {
  const cloud = emptyCloud(raw);
  for (const [k, v] of Object.entries(raw)) {
    const cls = classifyReconcileKey(k);
    if (cls) {
      switch (cls) {
        case 'HALT':
          cloud.halt = v;
          continue;
        case 'FLEET_APPROVALS':
          cloud.fleetApprovals = v;
          continue;
        case 'INBOX':
        case 'PARLEY': {
          const actor = reconcileKeyActor(k);
          // No resolvable address means the key predates the `__` boundary. It
          // is addressed to NOBODY rather than to everybody: fail closed, or a
          // legacy key leaks into every actor's mailbox at once.
          if (!actor) continue;
          (cls === 'INBOX' ? cloud.inbox : cloud.parley).push({ key: k, actor, value: v });
          continue;
        }
        case 'CLAIM':
          cloud.claims[k.slice(RECONCILE_KEY_CLASSES.CLAIM.prefix.length)] = v;
          continue;
        case 'CI':
          cloud.ci[k.slice(RECONCILE_KEY_CLASSES.CI.prefix.length)] = v;
          continue;
        case 'ACCOMPLISHMENT':
          cloud.accomplishments[k.slice(RECONCILE_KEY_CLASSES.ACCOMPLISHMENT.prefix.length)] = v;
          continue;
        case 'HEARTBEAT':
          continue; // read below, from the raw map, via the shared parser
      }
    }
    if (k.startsWith('PD_LOCK_')) cloud.locks[k.slice('PD_LOCK_'.length)] = v;
    else if (k.startsWith('PD_PHEROMONE_')) cloud.pheromones[k.slice('PD_PHEROMONE_'.length)] = v;
    else if (k.startsWith('PD_ALERT_')) cloud.alerts[k.slice('PD_ALERT_'.length)] = v;
  }
  cloud.heartbeatTs = readHeartbeatTs(raw);
  // An ABSENT heartbeat is deliberately NOT stale here, matching
  // bin/pd-hook-prompt: a matrix that predates the reconcile loop (or a fleet
  // that never enabled it) must not be muted fleet-wide. isMatrixStale() stays
  // strict for enforcement rungs; this reader is advisory, so absence of a
  // heartbeat means "no verdict", not "go quiet".
  cloud.stale =
    cloud.heartbeatTs === undefined ? false : isMatrixStale(cloud.heartbeatTs, now);
  return cloud;
}

/**
 * Read + parse the Ink Cloud from disk. Missing file => empty (not an error).
 *
 * The design intent behind the "missing is empty" rule is the same fail-open
 * posture `bin/pd-hook-prompt` encodes with `exit 0`: a hookless agent whose
 * coordination cache has not been written yet must still get its turn.
 *
 * @param path Explicit matrix path; defaults to {@link inkCloudPath} resolved at
 *             CALL time so `PD_HOME` set after import is still honored.
 * @param now Epoch ms for the staleness verdict.
 * @returns The classified cloud; an unreadable file yields an empty cloud
 *          rather than a throw, because a torn write must not break a turn.
 */
export function readInkCloud(path: string = inkCloudPath(), now: number = Date.now()): InkCloud {
  if (!existsSync(path)) return emptyCloud({}, false);
  try {
    const cloud = classify(parseEnv(readFileSync(path, 'utf8')), now);
    // The file was there, even if every line of it was a comment.
    return { ...cloud, present: true };
  } catch {
    // Unreadable is NOT absent: the harness IS installed here, we just could not
    // read it this turn. Reporting it as absent would send an operator hunting
    // an install problem that does not exist.
    return emptyCloud({}, true);
  }
}

/**
 * Read an Ink Cloud directly from text, bypassing the filesystem.
 *
 * Its purpose is provability: the live proof harness and the unit tests must be
 * able to exercise the exact classification path a real turn takes without
 * writing to the operator's `~/.port-daddy`. Sharing {@link classify} rather
 * than a test-only parser is what keeps the proof about the shipped behaviour.
 *
 * @param text Raw matrix contents.
 * @param now Epoch ms for the staleness verdict.
 * @returns The classified cloud.
 */
export function readInkCloudFromText(text: string, now: number = Date.now()): InkCloud {
  return classify(parseEnv(text), now);
}

/**
 * Select the entries of a per-actor class addressed to one actor.
 *
 * **Purpose.** Addressed mail must stay addressed; this is the hookless mirror
 * of the anchored `grep -E` the POSIX hook uses, and it exists as a named
 * function so the "is this mine?" rule is implemented once rather than inlined
 * at each call site where it could drift.
 *
 * The comparison is against the NORMALIZED actor produced by
 * `perActorKeyPrefix`, not against the raw id, so `port-daddy:contrib:a` and
 * `PORT_DADDY_CONTRIB_A` resolve to the same mailbox — the same equivalence the
 * daemon used when it minted the key.
 *
 * @param entries `cloud.inbox` or `cloud.parley`.
 * @param cls The per-actor class those entries came from.
 * @param actor Raw actor id. An empty/absent id matches NOTHING: an
 *              unidentified agent is addressed by nobody, and guessing would
 *              hand it a neighbour's mail.
 * @returns The subset addressed to `actor`.
 */
export function forActor(
  entries: readonly AddressedEntry[],
  cls: ReconcileKeyClassName,
  actor: string | undefined,
): AddressedEntry[] {
  if (!actor || !actor.trim()) return [];
  const prefix = perActorKeyPrefix(cls, actor);
  return entries.filter((e) => e.key.startsWith(prefix));
}

// ─── Projection ───────────────────────────────────────────────────────────────

export interface InjectionOptions {
  /** files the task intends to touch — surfaces locks held by OTHER actors */
  targetFiles?: string[];
  /** this agent's own actor id — its own locks are not "conflicts" */
  selfActor?: string;
  /**
   * Project root used for the exact-root pheromone filter. Defaults to
   * `process.cwd()`; pass it explicitly in tests and in multi-repo runners.
   */
  projectRoot?: string;
  /** Epoch ms for TTL arithmetic. Defaults to `Date.now()`. */
  now?: number;
  /** Entry ceiling for the whole turn. Defaults to the contract's 12. */
  maxEntries?: number;
  /** Byte ceiling for the whole turn. Defaults to the contract's 4096. */
  maxBytes?: number;
  /** Default TTL (ms) for classes the registry gives no `ttlMs`. Default 30 min. */
  defaultTtlMs?: number;
}

/** Default freshness window, matching `PD_SQUID_PROMPT_TTL_SECONDS` (1800s). */
const DEFAULT_ENTRY_TTL_MS = 1_800_000;

/**
 * Recover the `| ts:<ISO>` stamp every reconcile-written value carries.
 *
 * Design intent matches `is_fresh()` in `bin/pd-hook-prompt`: an UNSTAMPED value
 * is treated as legacy and always fresh, rather than as infinitely old. Hiding
 * every pre-reconcile entry the first time a fleet upgrades would read as the
 * harness breaking, not as the harness tightening.
 *
 * @param value A matrix value.
 * @returns Epoch ms, or `undefined` when the value carries no parseable stamp.
 */
function entryTs(value: string): number | undefined {
  const m = /\| ts:([^ |]+)/.exec(value);
  if (!m) return undefined;
  const parsed = Date.parse(m[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** One candidate line, before the budget decides whether it is spoken. */
interface Candidate {
  readonly cls: ReconcileKeyClassName | 'ALERT' | 'PHEROMONE';
  readonly line: string;
  readonly ts?: number;
}

/**
 * Measure a candidate the way its consumer will.
 *
 * **Design rationale.** Budgeting against the raw value under-counts by the
 * bullet and newline that every emitted entry carries, and an under-counted
 * budget is one that overruns silently. Counting exactly what will be printed
 * keeps this module's priority order — not a downstream truncation — in charge
 * of what survives.
 *
 * @param line The candidate's text.
 * @returns UTF-8 byte length of the bullet line it will become.
 */
function candidateBytes(line: string): number {
  return Buffer.byteLength(`  - ${line}\n`, 'utf8');
}

/**
 * Per-class entry cap for the projection.
 *
 * The two legacy classes get the turn-wide ceiling rather than a registry cap:
 * the registry does not own them, and inventing a number here would be a policy
 * decision disguised as an implementation detail. The intent is that only the
 * shared budget bounds them.
 *
 * @param cls The class being capped.
 * @param maxEntries The turn-wide entry ceiling, used for the legacy classes.
 * @returns The maximum entries this class may contribute.
 */
function capForClass(cls: Candidate['cls'], maxEntries: number): number {
  if (cls === 'ALERT' || cls === 'PHEROMONE') return maxEntries;
  return RECONCILE_KEY_CLASSES[cls].entryCap;
}

/**
 * Freshness window for a class, in ms; `0` disables the check.
 *
 * HALT is deliberately exempt. Its GC rule is `mirror-source`, so its lifetime
 * belongs to the reconcile tick — the motivation being that a stop the operator
 * pulled must not expire out from under the fleet on a clock technicality.
 *
 * @param cls The class being aged.
 * @param defaultTtlMs Fallback for classes the registry gives no `ttlMs`.
 * @returns The TTL in ms, or `0` when the class is exempt.
 */
function ttlForClass(cls: Candidate['cls'], defaultTtlMs: number): number {
  if (cls === 'HALT') return 0;
  if (cls === 'ALERT' || cls === 'PHEROMONE') return defaultTtlMs;
  return RECONCILE_KEY_CLASSES[cls].ttlMs ?? defaultTtlMs;
}

/**
 * Increment a per-class tally in place.
 *
 * A named helper rather than an inline `??= 0` purely so the two tallies this
 * module keeps (held vs emitted) are incremented by identical code; the design
 * intent is that "held" and "emitted" can never drift through a typo, because
 * the divergence between them is the number an operator reads.
 *
 * @param tally The counts object to mutate.
 * @param key The class name being counted.
 * @returns Nothing; mutates `tally`.
 */
function bumpTally(tally: Record<string, number | undefined>, key: string): void {
  tally[key] = (tally[key] ?? 0) + 1;
}

/**
 * The result of projecting a cloud into one turn: what to say, and the receipt.
 *
 * The receipt is not decoration. A hookless backend has no `pd-hook-prompt` to
 * write a VoiceLog line, so without this the entire Groq/Ollama/LM Studio half
 * of a fleet would be invisible to `pd squid voice` — and "the harness never
 * spoke to the local agents" would be indistinguishable from "the local agents
 * were never run".
 */
export interface InkCloudProjection {
  /** The block to inject, or `''` when there is genuinely nothing to say. */
  readonly text: string;
  /** The contract-shaped audit record for this turn. */
  readonly event: VoiceLogEvent;
}

/**
 * Project the Ink Cloud into one hookless turn, bounded and audited.
 *
 * **Purpose.** This is the hookless mirror of `bin/pd-hook-prompt`. It applies
 * the same emission order, the same per-class caps, the same shared budget, the
 * same TTL and project-root filters, and the same fail-open staleness rule — so
 * an agent on Ollama and an agent on Claude Code are told the same things in the
 * same priority order, and a class dropped for budget is dropped in
 * `RECONCILE_DROP_ORDER` rather than wherever the string happened to be cut.
 *
 * **Design: the budget is spent most-important-first, not truncated at the end.**
 * Cutting the assembled string at N bytes lets an accomplishment note that
 * sorted early cost the operator a HALT. Spending the budget in projection order
 * makes the drop ordered and, via the returned event, countable.
 *
 * @param cloud A classified cloud from {@link readInkCloud}.
 * @param opts Addressing, project root, clock, and bounds.
 * @returns The bounded injection text plus its {@link VoiceLogEvent} receipt.
 */
export function projectInkCloud(cloud: InkCloud, opts: InjectionOptions = {}): InkCloudProjection {
  const now = opts.now ?? Date.now();
  const self = opts.selfActor;
  const maxEntries = opts.maxEntries ?? RECONCILE_MAX_PROJECTED_ENTRIES;
  const maxBytes = opts.maxBytes ?? RECONCILE_TOTAL_BUDGET_BYTES;
  const defaultTtl = opts.defaultTtlMs ?? DEFAULT_ENTRY_TTL_MS;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const targets = opts.targetFiles ?? [];

  const base = { ts: now, actor: self ?? '', hookEvent: 'local-citizen-turn' as const };

  if (!cloud.present) {
    return { text: '', event: { ...base, outcome: 'silent', reason: 'matrix-absent' } };
  }

  const held: ReconcileClassCounts & { ALERT?: number; PHEROMONE?: number } = {};
  const emitted: ReconcileClassCounts & { ALERT?: number; PHEROMONE?: number } = {};

  // ── Gather candidates in RECONCILE_PROJECTION_ORDER ────────────────────────
  const byClass = new Map<Candidate['cls'], Candidate[]>();
  /**
   * Record one candidate line under its class and count it as HELD.
   *
   * Purpose: every candidate must be counted the moment it is seen, before any
   * bound can eat it — that is what makes a `suppressed` receipt report the size
   * of the thing that went unsaid rather than the size of what survived.
   *
   * @param cls The class the line belongs to.
   * @param line The candidate's text.
   * @returns Nothing; mutates the enclosing `byClass` / `held` collections.
   */
  const push = (cls: Candidate['cls'], line: string): void => {
    const list = byClass.get(cls) ?? [];
    list.push({ cls, line, ts: entryTs(line) });
    byClass.set(cls, list);
    bumpTally(held as Record<string, number | undefined>, cls);
  };

  if (cloud.halt) push('HALT', cloud.halt);
  for (const e of forActor(cloud.parley, 'PARLEY', self)) push('PARLEY', e.value);
  if (cloud.fleetApprovals) push('FLEET_APPROVALS', cloud.fleetApprovals);
  for (const [suffix, v] of Object.entries(cloud.claims)) push('CLAIM', `${suffix}: ${v}`);
  for (const v of Object.values(cloud.ci)) push('CI', v);
  for (const e of forActor(cloud.inbox, 'INBOX', self)) push('INBOX', e.value);
  for (const v of Object.values(cloud.accomplishments)) push('ACCOMPLISHMENT', v);

  // Legacy classes the registry does not own, seated at the priority the hook
  // emits them at: steering alerts alongside FLEET_APPROVALS, pheromones last.
  for (const [name, v] of Object.entries(cloud.alerts)) push('ALERT', `PD_ALERT_${name}: ${v}`);

  // Locks are surfaced only where they COLLIDE with a file this turn intends to
  // touch and are held by someone else — an uncontested lock is not news.
  const conflicts: Array<{ file: string; actor: string }> = [];
  for (const file of targets) {
    const actor = cloud.locks[lockKeySuffix(file)];
    if (actor && actor !== self) conflicts.push({ file, actor });
  }

  // Pheromones carry the extra exact-project-root filter: `app` must never
  // receive traces from `other-app`. Counted as held either way so the receipt
  // can say "held 14, none of them yours".
  let rootDropped = 0;
  for (const v of Object.values(cloud.pheromones)) {
    bumpTally(held as Record<string, number | undefined>, 'PHEROMONE');
    const subject = v.split(' | ')[0]?.trim() ?? '';
    if (subject !== projectRoot && !subject.startsWith(`${projectRoot}/`)) {
      rootDropped += 1;
      continue;
    }
    const list = byClass.get('PHEROMONE') ?? [];
    list.push({ cls: 'PHEROMONE', line: v, ts: entryTs(v) });
    byClass.set('PHEROMONE', list);
  }

  const heldTotal = Object.values(held).reduce((a, b) => a + (b ?? 0), 0);

  // ── Spend the budget, most-important-first ─────────────────────────────────
  // Emission order is the contract's, with the two legacy classes seated where
  // the hook emits them: ALERT immediately after FLEET_APPROVALS, PHEROMONE last.
  const order: Candidate['cls'][] = [];
  for (const c of RECONCILE_PROJECTION_ORDER) {
    order.push(c);
    if (c === 'FLEET_APPROVALS') order.push('ALERT');
  }
  order.push('PHEROMONE');

  const kept = new Map<Candidate['cls'], string[]>();
  const droppedClasses: ReconcileKeyClassName[] = [];
  let entries = 0;
  let bytes = 0;
  let ttlDropped = 0;
  let capDropped = 0;

  for (const cls of order) {
    const list = byClass.get(cls) ?? [];
    const ttl = ttlForClass(cls, defaultTtl);
    const cap = capForClass(cls, maxEntries);
    let taken = 0;
    let droppedHere = 0;
    for (const c of list) {
      if (ttl > 0 && c.ts !== undefined && now - c.ts > ttl) {
        ttlDropped += 1;
        droppedHere += 1;
        continue;
      }
      const cost = candidateBytes(c.line);
      if (taken >= cap || entries >= maxEntries || bytes + cost > maxBytes) {
        capDropped += 1;
        droppedHere += 1;
        continue;
      }
      const lines = kept.get(cls) ?? [];
      lines.push(c.line);
      kept.set(cls, lines);
      taken += 1;
      entries += 1;
      bytes += cost;
      bumpTally(emitted as Record<string, number | undefined>, cls);
    }
    if (droppedHere > 0 && cls !== 'ALERT' && cls !== 'PHEROMONE') droppedClasses.push(cls);
  }
  // droppedClasses is reported in RECONCILE_DROP_ORDER (lowest priority first).
  droppedClasses.reverse();

  // ── Assemble ──────────────────────────────────────────────────────────────
  /**
   * The surviving lines of one class.
   *
   * @param cls The class to read.
   * @returns Its kept lines, or `[]` — the design intent is that assembly never
   *          has to distinguish "class dropped" from "class had nothing".
   */
  const sec = (cls: Candidate['cls']): string[] => kept.get(cls) ?? [];

  const lines: string[] = [];
  /**
   * Append a titled section, or nothing at all when it is empty.
   *
   * Purpose: an empty heading is worse than no heading — it spends prompt
   * budget asserting a category exists and then says nothing about it, which
   * reads to a model as "checked, all clear" rather than "not applicable".
   *
   * @param title Section heading.
   * @param body Lines to render under it.
   * @returns Nothing; appends to the enclosing `lines`.
   */
  const section = (title: string, body: string[]): void => {
    if (body.length === 0) return;
    lines.push(title);
    for (const b of body) lines.push(`  - ${b}`);
  };

  section('HALT — stop work and await instructions:', sec('HALT'));
  section('FOR YOU (addressed to this agent):', [...sec('PARLEY'), ...sec('INBOX')]);
  section('ACTIVE ALERTS:', [...sec('FLEET_APPROVALS'), ...sec('ALERT')]);
  section('FLEET:', [...sec('CLAIM'), ...sec('CI'), ...sec('ACCOMPLISHMENT')]);
  if (conflicts.length > 0) {
    lines.push('FILE LOCKS held by OTHER actors on files you intend to edit:');
    for (const c of conflicts) {
      lines.push(`  - ${c.file}  ->  HELD BY actor "${c.actor}" (do NOT edit; coordinate)`);
    }
  }
  section('PHEROMONE TRACES (hot surfaces):', sec('PHEROMONE'));

  // ── Fail open on a stale matrix, but keep the receipt ─────────────────────
  // The projection runs first so the event can report the counts it HELD; the
  // text is then discarded. A 10-minute-old halt is not proof the operator still
  // wants the fleet stopped (isMatrixStale's fail-open rule).
  if (cloud.stale) {
    return {
      text: '',
      event: {
        ...base,
        outcome: 'suppressed',
        reason: 'stale-matrix',
        counts: held,
        bytes,
        droppedClasses,
        emittedBytes: 0,
      },
    };
  }

  if (entries === 0 && conflicts.length === 0) {
    if (heldTotal === 0) {
      return { text: '', event: { ...base, outcome: 'silent', reason: 'no-entries' } };
    }
    const reason = ttlDropped > 0 ? 'ttl-expired' : rootDropped > 0 ? 'not-relevant-to-cwd' : capDropped > 0 ? 'over-entry-cap' : undefined;
    if (!reason) {
      return { text: '', event: { ...base, outcome: 'silent', reason: 'no-entries' } };
    }
    return {
      text: '',
      event: {
        ...base,
        outcome: 'suppressed',
        reason,
        counts: held,
        bytes,
        droppedClasses,
        emittedBytes: 0,
      },
    };
  }

  const text = [
    '=== LIVE COORDINATION STATE (Ink Cloud, read this turn) ===',
    ...lines,
    '=== END LIVE COORDINATION STATE ===',
  ].join('\n');
  const emittedBytes = Buffer.byteLength(text, 'utf8');

  if (capDropped > 0 || ttlDropped > 0 || rootDropped > 0) {
    return {
      text,
      event: {
        ...base,
        outcome: 'suppressed',
        reason: capDropped > 0 ? 'over-entry-cap' : ttlDropped > 0 ? 'ttl-expired' : 'not-relevant-to-cwd',
        counts: held,
        bytes,
        droppedClasses,
        emittedBytes,
      },
    };
  }

  const classes = order.filter((c) => (emitted as Record<string, number | undefined>)[c]) as ReconcileKeyClassName[];
  return {
    text,
    event: { ...base, outcome: 'spoke', counts: emitted, bytes: emittedBytes, classes },
  };
}

/**
 * Build the LIVE COORDINATION STATE block injected into the transcript each turn.
 *
 * Back-compatible wrapper over {@link projectInkCloud} for callers that only
 * want the string. Its purpose is migration, not convenience:
 * `lib/local-citizen/runner.ts` and the live proof harness both call it by this
 * name, and changing their call sites in the same slice that changed the
 * projection would have made a behaviour regression indistinguishable from a
 * rename. New callers should prefer `projectInkCloud`, so the turn is auditable
 * through `pd squid voice` rather than invisible.
 *
 * @param cloud A classified cloud.
 * @param opts Addressing, project root, clock, and bounds.
 * @returns The injection block, or `''` when there is genuinely nothing to say.
 */
export function buildInjectionBlock(cloud: InkCloud, opts: InjectionOptions = {}): string {
  return projectInkCloud(cloud, opts).text;
}
