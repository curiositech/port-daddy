/**
 * The Reconcile Loop — projecting durable coordination state INTO the Ink Cloud
 * =============================================================================
 *
 * `lib/squid/matrix.ts` gave the fleet a POSIX-greppable hot cache
 * (`~/.port-daddy/matrix.env`). `lib/squid/reconcile-contract.ts` gave it a
 * vocabulary. This module is the **daemon tick** that actually moves bytes: once
 * every {@link RECONCILE_INTERVAL_MS} it asks each durable source what is true,
 * rewrites the matrix to match, and deletes everything the sources no longer
 * justify.
 *
 * ## Why this exists (the append-only landfill)
 *
 * Before this loop, the only durable-state → matrix path in the daemon was
 * `syncApprovalAlert` in `lib/fleet-daemon.ts` (now retired in favour of this
 * module): ~20 lines that set one hard-coded key and delete it when the queue
 * empties. It worked, and it was the right shape — but it was one key. Every other writer (`appendPheromone`, `setLock`, `setAlert`)
 * only ever *adds*. At K≥8 parallel ephemeral agents (the Jamie Madrox pattern the
 * ADR is written against) `matrix.env` grows without bound, and because the hook
 * tentacle greps the whole file and injects the head of it into every turn, an
 * unbounded matrix means an agent's context fills with facts that stopped being
 * true before lunch. **The diff-and-delete in {@link createReconcileLoop} is the
 * point of this file** — projection is the easy half.
 *
 * ## The tick, in order
 *
 * ```text
 *   1. read every durable source          (OUTSIDE the lock — see below)
 *   2. build the DESIRED key set per class, apply per-class caps + TTL
 *   3. apply the per-agent-turn budget and the fleet ceiling in RECONCILE_DROP_ORDER
 *   4. take the matrix lock ONCE:
 *        read → delete what the SOURCES no longer justify → set the projection
 *        → decay + GC pheromones → stamp PD_RECON_HEARTBEAT_TS → one atomic rename
 * ```
 *
 * Durable reads happen *before* the lock is taken on purpose. A tick that held
 * the mkdir lock across a slow SQLite read would stall every `pd-hook-*` tentacle
 * on the machine, and those hooks are on the critical path of a human's keystroke.
 * The lock-held window is deliberately kept to "mutate a string, rename a file".
 *
 * ## Three rules that are easy to get wrong
 *
 * 1. **A missing or failing source is NOT an empty source.** If `claims()` throws,
 *    the loop must not conclude "there are no claims" and delete every
 *    `PD_CLAIM_*` key — that would flap the fleet's coordination state on a
 *    transient DB error. A degraded class is skipped entirely: not projected, not
 *    garbage-collected. Only a source that *answered* earns the right to delete.
 *    **A budget drop is not an answer either.** "This does not fit in one agent's
 *    prompt this turn" says nothing about whether the message still exists, so a
 *    class the budget declined to project is DEFERRED, never collected: the GC
 *    diffs against the post-cap `desired` set, the write uses the post-budget
 *    `kept` set, and the two are deliberately different objects. Conflating them
 *    is how undelivered mail got destroyed instead of waiting — see
 *    {@link applyBudget} for the full account.
 * 2. **A tick never throws.** It is called from `setInterval` inside a daemon; an
 *    escaping rejection is an unhandled error that can take the process with it.
 *    Everything funnels into a {@link ReconcileTickReport} with `ok: false`.
 * 3. **Logging is governed.** This is a loop that fires every 15 seconds forever,
 *    which is the exact shape that wrote 313 GB in the incident behind
 *    `skills/responsible-logging`. Nothing here logs at `info` per tick, and every
 *    failure path goes through a {@link LogGovernor} under a stable, low-cardinality
 *    key (`reconcile_source_failed_<CLASS>`, never `..._<sessionId>`).
 *
 * @module lib/squid/reconcile
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { LogGovernor, type LeveledSink } from '../observability/log-governor.js';
import { matrixPath, serializeMatrix, tryReadMatrix, withLock } from './matrix.js';
import {
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_HALT_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  RECONCILE_DROP_ORDER,
  RECONCILE_INTERVAL_MS,
  RECONCILE_KEY_CLASSES,
  RECONCILE_KEY_CLASS_NAMES,
  RECONCILE_MAX_PROJECTED_ENTRIES,
  RECONCILE_TOTAL_BUDGET_BYTES,
  accomplishmentKey,
  ciKey,
  claimKey,
  classifyReconcileKey,
  inboxKey,
  parleyKey,
  type ReconcileClassCounts,
  type ReconcileKeyClass,
  type ReconcileKeyClassName,
  type VoiceLogSuppressionReason,
} from './reconcile-contract.js';

// ─── 1. What each durable source must hand the loop ───────────────────────────

/**
 * One spawn approval waiting on a human. Mirrors the fields
 * `getSharedApprovalStream().list()` already returns, so the daemon-wiring agent
 * can pass that method by reference with no adapter.
 */
export interface PendingApproval {
  /** Agent whose spawn is frozen. */
  readonly agent: string;
  /** What tried to launch it (trigger name). */
  readonly trigger: string;
}

/** Whether the operator has pulled the cord, and why. */
export interface HaltState {
  /** `true` while the fleet-wide stop is armed. */
  readonly armed: boolean;
  /** Operator-facing reason; a default is supplied when omitted. */
  readonly reason?: string;
}

/** One unread message addressed to exactly one actor. */
export interface InboxMessage {
  /** Raw recipient id — normalized into the key via the contract's `actorKey`. */
  readonly actor: string;
  /** Stable message id; two ticks seeing the same message must mint the same key. */
  readonly msgId: string;
  /** One-line body the agent will actually read. */
  readonly summary: string;
  /** Sender, when known. */
  readonly from?: string;
  /** Epoch ms the message was sent; drives cap-evict-oldest. Defaults to tick time. */
  readonly ts?: number;
}

/** A file two or more live sessions have both claimed. */
export interface ClaimOverlap {
  /** Contested path (repo-relative or absolute). */
  readonly path: string;
  /** Session/agent ids holding it. */
  readonly holders: readonly string[];
  /** Epoch ms the overlap was observed; drives which 4 survive the cap. */
  readonly ts?: number;
}

/** A red required check on the branch the fleet is working. */
export interface CiFailure {
  /** Branch name. */
  readonly branch: string;
  /** What is red, in one line. */
  readonly summary: string;
  /** Epoch ms observed. */
  readonly ts?: number;
}

/** An open summons: a human is waiting for this actor to reply in a thread. */
export interface ParleySummons {
  /** Raw actor id being summoned. */
  readonly actor: string;
  /** Conversation id — re-summoning the same thread OVERWRITES, never accumulates. */
  readonly convId: string;
  /** One-line ask. */
  readonly summary: string;
  /** Epoch ms the summons was raised; drives the class TTL. Defaults to tick time. */
  readonly ts?: number;
}

/** Something a neighbour just finished — pure fleet ambience, first overboard. */
export interface Accomplishment {
  /** Stable id (session id, note id). */
  readonly id: string;
  /** One-line description. */
  readonly summary: string;
  /** Epoch ms completed; drives decay-by-age. Defaults to tick time. */
  readonly ts?: number;
}

/**
 * A pheromone trace as the loop found it in the matrix, after decay.
 *
 * Handed to the optional `pheromones` sink so the daemon can fold shell-appended
 * traces into the durable store (`lib/pheromone.ts`) before the loop fades them
 * out of the hot cache. Purpose: the shell hooks can only ever append to a flat
 * file; something has to be the reader that gives those appends a durable home.
 */
export interface DrainedPheromone {
  /** Raw `PD_PHEROMONE_*` matrix key. */
  readonly key: string;
  /** Subject (a path or symbol) — the hook filters on this against the project root. */
  readonly subject: string;
  /** Human-readable note. */
  readonly note: string;
  /** Intensity as originally written. */
  readonly intensity: number;
  /** Intensity after age decay; below the fade floor the key is deleted. */
  readonly decayed: number;
  /** Epoch ms the trace was laid, when it could be established. */
  readonly ts?: number;
  /** Actor that laid it, when recorded. */
  readonly actor?: string;
  /** Whether this tick kept the key (`false` means it was faded out). */
  readonly retained: boolean;
}

// ─── 2. Drop receipts — what the loop silenced, and under which bound ─────────

/**
 * Which bound sacrificed a class this tick.
 *
 * **Why two scopes and not one number.** The 12-entry / 4 KiB pair matches
 * `bin/pd-hook-prompt`'s `PD_SQUID_PROMPT_MAX_ENTRIES` / `MAX_BYTES`, and those
 * describe **one agent's prompt for one turn**. The matrix, by contrast, is a
 * shared cache that every agent greps its own slice out of, so measuring the
 * whole fleet's projection against a single agent's prompt budget is a category
 * error: five agents holding three messages each is five 3-entry prompts, not a
 * 15-entry overflow. `per-agent-turn` is therefore evaluated against the
 * worst-case single agent's view, and `fleet-matrix-ceiling` is a separate,
 * deliberately enormous absolute bound whose only job is to stop the flat file
 * growing without limit if an actor-id generator runs away.
 */
export type ReconcileDropScope = 'per-agent-turn' | 'fleet-matrix-ceiling';

/**
 * The operator-facing record of a tick that held something and did not project
 * all of it.
 *
 * **Purpose.** This bound is the only one in the harness that used to leave no
 * operator trace at all — it emitted a governed daemon warn and nothing else, so
 * `pd squid voice --suppressed` (which reads the hook's per-turn VoiceLog) could
 * not see it, and an operator asking "why didn't it tell me about the claim
 * overlap?" had no surface that would answer. The receipt is delivered through
 * {@link ReconcileDeps.onDrop} so the daemon can route it to whichever operator
 * surface owns loop-scoped events, rather than this module guessing.
 *
 * **Why this is not a {@link VoiceLogEvent}.** That contract is turn-scoped and
 * actor-addressed (`actor`, `hookEvent`) and its summary statistics divide by
 * *turns*; a daemon tick has neither an actor nor a hook surface, and injecting
 * one would both require inventing values and corrupt `quietRate`/`spokeRate`
 * for every real turn in the same file. See the module note on `onDrop`.
 *
 * Nothing in this receipt was deleted. A drop is a deferral by construction —
 * the garbage collector never sees the post-budget set.
 */
export interface ReconcileDropReceipt {
  /** Epoch ms of the tick (the injected clock). */
  readonly ts: number;
  /** Which bound fired first. */
  readonly scope: ReconcileDropScope;
  /** Contract reason, reusing the VoiceLog vocabulary the operator already reads. */
  readonly reason: VoiceLogSuppressionReason;
  /** Classes sacrificed, in {@link RECONCILE_DROP_ORDER}. */
  readonly droppedClasses: readonly ReconcileKeyClassName[];
  /** Entries the sources justified, per class, before the bound applied. */
  readonly heldCounts: ReconcileClassCounts;
  /** Entries actually projected, per class. */
  readonly projectedCounts: ReconcileClassCounts;
  /** Bytes the loop wanted to project, fleet-wide. */
  readonly heldBytes: number;
  /** Bytes actually projected, fleet-wide. */
  readonly emittedBytes: number;
  /** Per-fleet matrix shard the drop happened on, or `'global'`. */
  readonly fleet: string;
}

// ─── 3. The injected dependency surface ───────────────────────────────────────

/**
 * Everything {@link createReconcileLoop} needs, all optional.
 *
 * **Design.** Every source is a plain nullary function rather than a service
 * object, and every one of them is optional. Two motivations: (a) a daemon that
 * has not wired a source yet must *degrade that class only* rather than fail to
 * boot — this loop will be adopted incrementally, class by class, alongside the
 * `syncApprovalAlert` path it has now replaced; and (b) injection is what
 * makes the loop testable without opening a database, spawning a daemon, or
 * touching the operator's real `~/.port-daddy`.
 *
 * Sources are **synchronous** by design. The daemon's durable stores are
 * `better-sqlite3` (synchronous), and a synchronous tick is deterministic enough
 * to pin to exact boundaries in tests. If a future source is genuinely async, the
 * daemon should cache its latest snapshot and hand this loop the cache — the tick
 * is the wrong place to await.
 */
export interface ReconcileDeps {
  /** Pending spawn approvals. Migrated shape of `getSharedApprovalStream().list()`. */
  readonly approvals?: () => readonly PendingApproval[];
  /** The fleet-wide panic/halt state. */
  readonly panic?: () => HaltState | null | undefined;
  /** Unread messages across all actors; the loop addresses them per-actor. */
  readonly inbox?: () => readonly InboxMessage[];
  /** Contested file claims. */
  readonly claims?: () => readonly ClaimOverlap[];
  /** Red required check on the current branch, or null/undefined when green. */
  readonly ci?: () => CiFailure | null | undefined;
  /** Open parley summonses across all actors. */
  readonly parley?: () => readonly ParleySummons[];
  /** Recently completed work across the fleet. */
  readonly accomplishments?: () => readonly Accomplishment[];
  /**
   * Durable sink for shell-appended pheromone traces. Called once per tick,
   * AFTER the matrix lock is released, with every trace the tick saw (retained
   * and faded alike). Optional: pheromone decay + GC happen regardless, because
   * an ungoverned `PD_PHEROMONE_*` prefix is the fastest way the matrix grows.
   */
  readonly pheromones?: (drained: readonly DrainedPheromone[]) => void;
  /** Leveled sink (the daemon's winston logger). Wrapped in a {@link LogGovernor}. */
  readonly logger?: LeveledSink;
  /** Injected clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Per-fleet matrix shard, or undefined for the global `matrix.env`. */
  readonly fleet?: string;
  /** Tick period for `start()`. Defaults to {@link RECONCILE_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /**
   * Entry ceiling for ONE agent's turn, measured against the worst-case single
   * agent's view of the matrix. Defaults to {@link RECONCILE_MAX_PROJECTED_ENTRIES}.
   */
  readonly maxEntries?: number;
  /** Byte budget for ONE agent's turn, same scope. Defaults to {@link RECONCILE_TOTAL_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
  /** Absolute fleet-wide entry ceiling for the whole matrix. Default {@link DEFAULT_MATRIX_ENTRY_CEILING}. */
  readonly matrixEntryCeiling?: number;
  /** Absolute fleet-wide byte ceiling for the whole matrix. Default {@link DEFAULT_MATRIX_BYTE_CEILING}. */
  readonly matrixByteCeiling?: number;
  /**
   * Operator receipt for a tick that projected less than it held.
   *
   * Called once per tick that dropped anything, AFTER the matrix lock is
   * released, with a {@link ReconcileDropReceipt}. Optional and defaulted to
   * nothing because the daemon owns the choice of operator surface; the governed
   * log line fires either way, so an unwired daemon is quieter but never silent.
   */
  readonly onDrop?: (receipt: ReconcileDropReceipt) => void;
  /** How long to wait for the matrix lock before abandoning the tick. Default 2000ms. */
  readonly lockTimeoutMs?: number;
  /** Age past which a pheromone is deleted outright. Default 30 minutes. */
  readonly pheromoneTtlMs?: number;
  /** Exponential decay half-life for pheromone intensity. Default 10 minutes. */
  readonly pheromoneHalfLifeMs?: number;
  /** How many of the freshest pheromones survive a tick. Default 6. */
  readonly pheromoneTopN?: number;
}

/**
 * What one tick did. Returned from `tick()` so tests (and the daemon's status
 * surface) can assert on real behaviour rather than on log strings.
 *
 * The `held` / `counts` split is the interesting part and mirrors the VoiceLog
 * contract's rationale: `held` is what the sources offered after per-class caps,
 * `counts` is what actually reached the matrix. When they differ, the harness
 * silenced itself and the operator deserves to know that happened.
 */
export interface ReconcileTickReport {
  /** Epoch ms of the tick (the injected clock, not `Date.now`). */
  readonly ts: number;
  /** `false` when the tick could not complete — e.g. the matrix lock was held. */
  readonly ok: boolean;
  /** Entries actually projected into the matrix, per class. */
  readonly counts: ReconcileClassCounts;
  /** Entries the sources offered after per-class caps, before the turn budget. */
  readonly held: ReconcileClassCounts;
  /** Bytes actually projected (measured as the hook would emit them). */
  readonly bytes: number;
  /**
   * Classes sacrificed to a projection bound, in {@link RECONCILE_DROP_ORDER}.
   *
   * A class named here was NOT deleted from the matrix — see
   * {@link ReconcileDropReceipt}. It was simply not projected this tick, and
   * whatever a previous tick wrote for it stands until its source retracts it.
   */
  readonly droppedClasses: readonly ReconcileKeyClassName[];
  /** Why the projection was cut, when it was. */
  readonly suppressionReason?: VoiceLogSuppressionReason;
  /** Which bound did the cutting, when there was one. */
  readonly dropScope?: ReconcileDropScope;
  /** Classes with no source, or whose source threw: neither projected nor GC'd. */
  readonly degradedClasses: readonly ReconcileKeyClassName[];
  /** Matrix keys created or changed this tick. */
  readonly keysWritten: number;
  /** Matrix keys deleted this tick (the whole point of the loop). */
  readonly keysDeleted: number;
  /** Pheromone keys that survived decay + top-N. */
  readonly pheromonesKept: number;
  /** Pheromone keys deleted because they faded, expired, or lost the top-N cut. */
  readonly pheromonesFaded: number;
  /**
   * `true` when the tick abandoned itself because the matrix file exists but
   * could not be read.
   *
   * **Why this is its own flag and not just an `error` string.** It is the one
   * failure whose correct operator response is different from every other: the
   * loop is healthy, the sources are healthy, and the *file* is the problem
   * (permissions, a full descriptor table, a failing disk). It is also the state
   * in which the loop deliberately does nothing at all — no projection, no GC,
   * not even the heartbeat — because a whole-file write derived from an unread
   * file deletes every key the loop does not own. An operator surface must be
   * able to say "the daemon cannot read the matrix" without grepping prose.
   */
  readonly matrixUnreadable?: boolean;
  /** Failure message when `ok` is false. */
  readonly error?: string;
}

/** The handle {@link createReconcileLoop} returns. */
export interface ReconcileLoop {
  /** Begin ticking on an interval, after one immediate tick. */
  start(): void;
  /** Stop ticking and flush any suppressed log rollups. */
  stop(): void;
  /** Run exactly one tick synchronously. Never throws. */
  tick(): ReconcileTickReport;
}

// ─── 3. Module-scope pure helpers ─────────────────────────────────────────────

/** Default age at which a pheromone is deleted outright, matching the hook's TTL. */
const DEFAULT_PHEROMONE_TTL_MS = 1_800_000;
/** Default half-life for pheromone intensity decay. */
const DEFAULT_PHEROMONE_HALF_LIFE_MS = 600_000;
/** Default number of freshest pheromones re-projected each tick. */
const DEFAULT_PHEROMONE_TOP_N = 6;
/** Intensity below which a decayed trace is considered faded and is deleted. */
const PHEROMONE_FADE_FLOOR = 0.05;
/** Default matrix-lock patience for one tick. */
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;

/**
 * Absolute fleet-wide entry ceiling for the reconciled part of the matrix.
 *
 * **Why a second bound at all**, when every class already has a cap. The
 * per-class caps for the two per-actor classes are counted *per actor*
 * (`INBOX` 3, `PARLEY` 2), so the reconciled key count grows linearly with the
 * number of distinct actor addresses — which is correct while those addresses
 * are agents, and catastrophic if a source ever addresses mail by ephemeral
 * session id. Then the fleet's "5 keys per actor" quietly becomes "5 keys per
 * session that has ever existed", and the flat file the hooks grep on every
 * keystroke grows without limit. This is the backstop for that class of bug.
 *
 * **Why 512 and not 12.** This is emphatically NOT the prompt budget. 512
 * entries is ~100 KiB of flat file — still a trivial `grep` and roughly 100
 * simultaneously-mailed agents, an order of magnitude past the K≥8 this module
 * is designed for. A bound that is never reached in healthy operation is the
 * only kind that is safe to make destructive-adjacent; a bound that fires during
 * normal work is a bug generator, which is exactly what applying the 12-entry
 * turn budget fleet-wide turned out to be.
 */
const DEFAULT_MATRIX_ENTRY_CEILING = 512;

/**
 * Absolute fleet-wide byte ceiling for the reconciled part of the matrix (256 KiB).
 *
 * Chosen to mirror the VoiceLog's own rotation ceiling in `bin/pd-hook-prompt`,
 * on the same reasoning: a flat file the hooks read on every turn should stay in
 * page cache comfortably, and any file that has grown past a quarter of a
 * megabyte of *coordination state* is reporting a producer bug, not a busy
 * fleet. Like {@link DEFAULT_MATRIX_ENTRY_CEILING}, it is sized never to fire in
 * healthy operation.
 */
const DEFAULT_MATRIX_BYTE_CEILING = 262_144;

/** A single key the loop wants the matrix to contain this tick. */
interface DesiredEntry {
  /** Fully-built matrix key (always minted by a contract key builder). */
  readonly key: string;
  /** Value, already stamped with `| ts:<ISO>` for the hook's freshness filter. */
  readonly value: string;
  /** Epoch ms used for TTL and cap-eviction ranking. */
  readonly ts: number;
  /** Cap-scope bucket: the normalized actor for per-actor classes, `''` otherwise. */
  readonly bucket: string;
}

/** Per-class desired sets for one tick. */
type DesiredByClass = Map<ReconcileKeyClassName, DesiredEntry[]>;

/**
 * Measure a projected entry the way its consumer will.
 *
 * **Motivation.** `RECONCILE_TOTAL_BUDGET_BYTES` exists to match
 * `PD_SQUID_PROMPT_MAX_BYTES`, which `bin/pd-hook-prompt` enforces with
 * `head -c` over lines shaped `- <value>\n`. Budgeting against the raw value
 * would under-count by the bullet and newline on every entry, and the design
 * intent of matching the caps is that this module's priority order — not
 * `head` — decides what survives. So we count exactly what the hook emits.
 *
 * @param value The matrix value that will be projected.
 * @returns UTF-8 byte length of the line the hook would print for it.
 */
function projectedBytes(value: string): number {
  return Buffer.byteLength(`- ${value}\n`, 'utf8');
}

/**
 * Stamp a message with the freshness marker every matrix reader understands.
 *
 * The design rationale is interoperability with an already-shipped consumer:
 * `bin/pd-hook-prompt`'s `is_fresh()` parses a trailing `| ts:<ISO>` and hides
 * anything older than `PD_SQUID_PROMPT_TTL_SECONDS`. An unstamped value is
 * treated as legacy and shown forever, which is precisely the staleness this
 * loop exists to end — so every value it writes carries a stamp.
 *
 * @param message The human-readable body.
 * @param ts Epoch ms to stamp.
 * @returns `"<message> | ts:<ISO>"`.
 */
function stampValue(message: string, ts: number): string {
  return `${message} | ts:${new Date(ts).toISOString()}`;
}

/**
 * Render the pending-approval summary, byte-identical to the `syncApprovalAlert`
 * line this loop supersedes.
 *
 * Purpose: operators have learned to recognize this string, and the migration
 * from `lib/fleet-daemon.ts` should change *who writes it and when it is deleted*,
 * not what the agent reads. Keeping the wording stable makes the cutover a
 * non-event for everyone downstream.
 *
 * @param pending Approvals currently waiting on a human.
 * @returns The one-line HITL alert body (unstamped; the caller stamps it).
 */
function buildApprovalsMessage(pending: readonly PendingApproval[]): string {
  const head = pending
    .slice(0, 3)
    .map((p) => `${p.agent} ← ${p.trigger}`)
    .join('; ');
  const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : '';
  return (
    `HITL: ${pending.length} spawn approval(s) waiting — ${head}${more}. ` +
    'Decide: pd fleet approvals | pd fleet approve <id> | pd fleet reject <id>'
  );
}

/**
 * Apply a class's TTL and entry cap to its candidate entries.
 *
 * **Design.** One function serves every class because the registry already
 * encodes the differences (`ttlMs`, `entryCap`, `capScope`); a per-class
 * hand-rolled trim is exactly the drift the contract's registry exists to
 * prevent. Ranking is newest-first with the key as a tiebreak so two ticks over
 * unchanged input produce an identical projection — a loop whose output flickers
 * between equally-valid orderings would rewrite the matrix forever and make
 * "what changed?" unanswerable.
 *
 * @param cls The registry row for the class being trimmed.
 * @param entries Candidate entries built from the durable source.
 * @param now Tick time in epoch ms, used for TTL arithmetic.
 * @returns The surviving entries, newest first.
 */
function applyCaps(
  cls: ReconcileKeyClass,
  entries: readonly DesiredEntry[],
  now: number,
): DesiredEntry[] {
  const ttl = cls.ttlMs;
  const alive =
    ttl === undefined ? entries.slice() : entries.filter((e) => now - e.ts < ttl);
  alive.sort((a, b) => (b.ts - a.ts) || a.key.localeCompare(b.key));

  if (cls.capScope === 'global') return alive.slice(0, cls.entryCap);

  const perBucket = new Map<string, number>();
  const kept: DesiredEntry[] = [];
  for (const e of alive) {
    const used = perBucket.get(e.bucket) ?? 0;
    if (used >= cls.entryCap) continue;
    perBucket.set(e.bucket, used + 1);
    kept.push(e);
  }
  return kept;
}

/**
 * Total the entry count and byte weight of a projection.
 *
 * Exists as its own function purely so the budget loop can re-measure after each
 * class it sacrifices; the design intent is that "how big is this projection?"
 * has exactly one answer in the module, rather than an incrementally-maintained
 * counter that can drift from the map it claims to describe.
 *
 * @param byClass The current per-class projection.
 * @returns Entry count and UTF-8 byte total as the hook would emit them.
 */
function tally(byClass: DesiredByClass): { entries: number; bytes: number } {
  let entries = 0;
  let bytes = 0;
  for (const list of byClass.values()) {
    for (const e of list) {
      entries += 1;
      bytes += projectedBytes(e.value);
    }
  }
  return { entries, bytes };
}

/**
 * Total a projection the way ONE agent will actually experience it.
 *
 * **This function is the correction at the heart of the module.** `matrix.env`
 * is a shared cache; `bin/pd-hook-prompt` greps only the global classes plus its
 * own `PD_INBOX_<ME>__` / `PD_PARLEY_<ME>__` slice and applies
 * `PD_SQUID_PROMPT_MAX_ENTRIES` to *that*. So the prompt-sized budget must be
 * measured against one agent's slice, not against the whole file: counting every
 * actor's mail into one pool made five agents with three messages each look like
 * a 15-entry overflow and silenced all five, when in truth no agent held more
 * than three.
 *
 * The per-actor contribution is the **maximum** over actors rather than the sum,
 * because that is the worst case any single hook can pull. Taking the max of
 * entries and of bytes independently (they may belong to different actors) makes
 * this a conservative upper bound, which is the right direction for a bound: it
 * can only ever be stricter than reality, never laxer.
 *
 * @param byClass The current per-class projection.
 * @returns Entry count and UTF-8 byte total for the worst-case single agent.
 */
function perAgentTally(byClass: DesiredByClass): { entries: number; bytes: number } {
  let entries = 0;
  let bytes = 0;
  for (const [name, list] of byClass) {
    if (RECONCILE_KEY_CLASSES[name].capScope !== 'per-actor') {
      for (const e of list) {
        entries += 1;
        bytes += projectedBytes(e.value);
      }
      continue;
    }
    const perBucket = new Map<string, { entries: number; bytes: number }>();
    for (const e of list) {
      const acc = perBucket.get(e.bucket) ?? { entries: 0, bytes: 0 };
      acc.entries += 1;
      acc.bytes += projectedBytes(e.value);
      perBucket.set(e.bucket, acc);
    }
    let maxEntries = 0;
    let maxBytes = 0;
    for (const acc of perBucket.values()) {
      if (acc.entries > maxEntries) maxEntries = acc.entries;
      if (acc.bytes > maxBytes) maxBytes = acc.bytes;
    }
    entries += maxEntries;
    bytes += maxBytes;
  }
  return { entries, bytes };
}

/**
 * Enforce the per-agent turn budget and the absolute fleet ceiling by
 * sacrificing whole classes in {@link RECONCILE_DROP_ORDER}.
 *
 * **Why whole classes.** The contract is explicit that a class is either fully
 * emitted or fully dropped: a half-emitted class reads as complete while lying by
 * omission ("2 claims" when there were 5). The motivation for doing this here at
 * all — rather than letting `bin/pd-hook-prompt`'s `break` truncate — is that the
 * shell's cut is silent, unordered, and invisible to the operator, so a stop
 * signal can lose its place to an accomplishment note that merely sorted first.
 *
 * **Why the result must never reach the garbage collector.** A dropped class is
 * a statement about *this turn's prompt*, not about the world: the messages are
 * still unread and their sources still assert them. Feeding this function's
 * output into the GC diff — which the loop did before this was fixed — makes a
 * budget drop indistinguishable from "the source says none", so the tick deletes
 * the very mail it declined to project, permanently and on every subsequent
 * tick. The caller therefore diffs against the pre-budget `desired` set and
 * writes from the returned `kept` set; the sum of the registry's per-class caps
 * (14) deliberately exceeds {@link RECONCILE_MAX_PROJECTED_ENTRIES} (12), so
 * this bound genuinely fires in normal operation and the distinction is load
 * bearing, not theoretical.
 *
 * The fleet ceiling is evaluated first so that, when both bounds bite, the
 * receipt names the more serious condition — a matrix growing without limit is a
 * producer bug, while a full prompt is Tuesday.
 *
 * @param desired Per-class projection after per-class caps and TTL.
 * @param limits The two scoped bounds: one agent's turn, and the whole matrix.
 * @returns The surviving projection, the classes dropped in drop order, and the
 *          scope + reason that triggered the first sacrifice.
 */
function applyBudget(
  desired: DesiredByClass,
  limits: {
    maxEntries: number;
    budgetBytes: number;
    ceilingEntries: number;
    ceilingBytes: number;
  },
): {
  kept: DesiredByClass;
  dropped: ReconcileKeyClassName[];
  reason?: VoiceLogSuppressionReason;
  scope?: ReconcileDropScope;
} {
  const kept: DesiredByClass = new Map(desired);
  const dropped: ReconcileKeyClassName[] = [];
  let reason: VoiceLogSuppressionReason | undefined;
  let scope: ReconcileDropScope | undefined;

  /**
   * Decide whether the current projection breaches either bound, and name it.
   *
   * Kept as a closure so the two bounds are evaluated in one place with one
   * precedence rule, rather than re-derived before and inside the loop where the
   * orderings could drift apart.
   *
   * @returns The breached scope and its reason, or `undefined` when both bounds hold.
   */
  const breach = (): { scope: ReconcileDropScope; reason: VoiceLogSuppressionReason } | undefined => {
    const fleet = tally(kept);
    if (fleet.entries > limits.ceilingEntries || fleet.bytes > limits.ceilingBytes) {
      return {
        scope: 'fleet-matrix-ceiling',
        // Bytes are the harder physical bound, so they name the reason when both bite.
        reason: fleet.bytes > limits.ceilingBytes ? 'over-budget' : 'over-entry-cap',
      };
    }
    const agent = perAgentTally(kept);
    if (agent.entries > limits.maxEntries || agent.bytes > limits.budgetBytes) {
      return {
        scope: 'per-agent-turn',
        reason: agent.bytes > limits.budgetBytes ? 'over-budget' : 'over-entry-cap',
      };
    }
    return undefined;
  };

  let over = breach();
  for (const name of RECONCILE_DROP_ORDER) {
    if (!over) break;
    const list = kept.get(name);
    if (!list || list.length === 0) continue;
    if (!reason) {
      reason = over.reason;
      scope = over.scope;
    }
    kept.set(name, []);
    dropped.push(name);
    over = breach();
  }
  return { kept, dropped, reason, scope };
}

// ─── 3b. Source-shape validation ──────────────────────────────────────────────
//
// **Why the loop validates what its own `ReconcileDeps` types already promise.**
// Those types bind the daemon at compile time; they bind nothing at runtime. A
// source is a closure over a durable store, and stores return `undefined` on a
// cache miss, `null` on a closed handle, and half-built rows after a partial
// migration — none of which throw. `readSource` used to guard only `throw`, so a
// malformed answer sailed past it and blew up in the `.map()` that followed,
// INSIDE the single whole-tick `try`. The blast radius was total: the tick
// reported `degradedClasses: []` (the field whose entire job is naming what
// broke) and wrote nothing at all, including `PD_RECON_HEARTBEAT_TS` — and 60s
// of frozen heartbeat makes `isMatrixStale` true for every agent on the machine,
// which silences the harness fleet-wide, HALT included. A malformed source could
// therefore disable the emergency stop. These predicates turn that into what a
// throw already was: one degraded class, everything else untouched.

/**
 * Narrow an unknown value to a plain object with readable properties.
 *
 * Purpose: every source row below is an object literal, and `typeof x ===
 * 'object'` alone still admits `null` (which throws on property access) and
 * arrays (which pass shape checks by accident when a producer nests one level
 * too deep). One helper means neither trap has to be remembered per call site.
 *
 * @param v Any value handed back by a durable source.
 * @returns `true` when `v` is a non-null, non-array object.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check an optional epoch-ms timestamp field.
 *
 * The design intent is that `ts` is not merely type-checked but *usable*: it
 * feeds TTL arithmetic and the newest-first sort in `applyCaps`, where a string
 * or a `NaN` produces a silently arbitrary ordering rather than an error. A
 * timestamp that cannot be compared is worse than an absent one, which the
 * caller already defaults to tick time.
 *
 * @param v The candidate `ts` field.
 * @returns `true` when absent or a finite number.
 */
function isOptionalTs(v: unknown): boolean {
  return v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * Check an optional free-text field.
 *
 * Exists so the row predicates below read as a flat list of field checks; the
 * motivation is legibility, since a validator nobody can skim is a validator
 * that drifts from the interface it guards.
 *
 * @param v The candidate field.
 * @returns `true` when absent or a string.
 */
function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

/**
 * Check that a source returned a list of rows that all satisfy `row`.
 *
 * **Why a whole-list verdict rather than filtering the bad rows out.** A partial
 * class is indistinguishable, in the matrix, from a class whose source retracted
 * the missing entries — and the GC would then delete them. Dropping bad rows
 * would convert a producer bug into deleted coordination state, which is the
 * failure this module is built to prevent. One malformed row therefore degrades
 * the class, exactly as a throw does: not projected, not collected, left alone.
 *
 * @param v The value the source returned.
 * @param row Predicate applied to every element.
 * @returns `true` when `v` is an array whose every element is a conforming object.
 */
function isRowArray(v: unknown, row: (r: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(v) && v.every((e) => isRecord(e) && row(e));
}

/**
 * Validate the shape of {@link ReconcileDeps.panic}'s answer.
 *
 * Design note: `null`/`undefined` are legal and mean "not armed" — the absence
 * of a halt is a real answer, unlike the absence of a source. Only a value that
 * claims to be a halt state while lacking a boolean `armed` is malformed, since
 * that is the field the projection branches on.
 *
 * @param v The value returned by the panic source.
 * @returns `true` when it is a usable {@link HaltState} or an explicit nothing.
 */
function isHaltStateShape(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return isRecord(v) && typeof v.armed === 'boolean' && isOptionalString(v.reason);
}

/**
 * Validate the shape of {@link ReconcileDeps.ci}'s answer.
 *
 * Purpose: `branch` and `summary` are both interpolated into the projected value
 * and `branch` additionally addresses the key via `ciKey`, so a non-string
 * `branch` would mint a key like `PD_CI_UNDEFINED` that no later tick can
 * recognise as its own and therefore no GC can ever remove.
 *
 * @param v The value returned by the CI source.
 * @returns `true` when it is a usable {@link CiFailure} or an explicit nothing.
 */
function isCiFailureShape(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return (
    isRecord(v) &&
    typeof v.branch === 'string' &&
    typeof v.summary === 'string' &&
    isOptionalTs(v.ts)
  );
}

/**
 * Validate {@link ReconcileDeps.approvals}'s answer.
 *
 * This is the source whose malformed return was reproduced end-to-end: an
 * `undefined` here reached `.length` and took the whole tick — and the fleet's
 * liveness signal — down with it.
 *
 * @param v The value returned by the approvals source.
 * @returns `true` when it is an array of usable {@link PendingApproval} rows.
 */
function isApprovalListShape(v: unknown): boolean {
  return isRowArray(v, (r) => typeof r.agent === 'string' && typeof r.trigger === 'string');
}

/**
 * Validate {@link ReconcileDeps.parley}'s answer.
 *
 * `actor` and `convId` are both key material (`parleyKey`), which is why they are
 * required rather than defaulted: a summons addressed to nobody is invisible to
 * the agent it was meant for and immortal in the matrix.
 *
 * @param v The value returned by the parley source.
 * @returns `true` when it is an array of usable {@link ParleySummons} rows.
 */
function isParleyListShape(v: unknown): boolean {
  return isRowArray(
    v,
    (r) =>
      typeof r.actor === 'string' &&
      typeof r.convId === 'string' &&
      typeof r.summary === 'string' &&
      isOptionalTs(r.ts),
  );
}

/**
 * Validate {@link ReconcileDeps.claims}'s answer.
 *
 * `holders` is checked as an array of strings for a concrete reason: the
 * projection calls `holders.join(', ')`, so a string or `undefined` there is a
 * `TypeError` on the happy path — and this is the class whose keys stop two
 * agents from editing the same file, so its failure mode is the worst in the
 * registry.
 *
 * @param v The value returned by the claims source.
 * @returns `true` when it is an array of usable {@link ClaimOverlap} rows.
 */
function isClaimListShape(v: unknown): boolean {
  return isRowArray(
    v,
    (r) =>
      typeof r.path === 'string' &&
      Array.isArray(r.holders) &&
      r.holders.every((h) => typeof h === 'string') &&
      isOptionalTs(r.ts),
  );
}

/**
 * Validate {@link ReconcileDeps.inbox}'s answer.
 *
 * Both `actor` and `msgId` are key material and must be stable across ticks —
 * the design intent of requiring them is that two ticks seeing the same message
 * mint the same key, which is what makes the projection idempotent instead of
 * an append-only pile.
 *
 * @param v The value returned by the inbox source.
 * @returns `true` when it is an array of usable {@link InboxMessage} rows.
 */
function isInboxListShape(v: unknown): boolean {
  return isRowArray(
    v,
    (r) =>
      typeof r.actor === 'string' &&
      typeof r.msgId === 'string' &&
      typeof r.summary === 'string' &&
      isOptionalString(r.from) &&
      isOptionalTs(r.ts),
  );
}

/**
 * Validate {@link ReconcileDeps.accomplishments}'s answer.
 *
 * Lowest-stakes class in the registry, validated to the same standard on
 * purpose: the rationale is that the tick-wide blast radius of a malformed
 * source has nothing to do with the importance of the class that carried it, so
 * an ambience feed must not be able to silence a halt.
 *
 * @param v The value returned by the accomplishments source.
 * @returns `true` when it is an array of usable {@link Accomplishment} rows.
 */
function isAccomplishmentListShape(v: unknown): boolean {
  return isRowArray(
    v,
    (r) => typeof r.id === 'string' && typeof r.summary === 'string' && isOptionalTs(r.ts),
  );
}

/** A `PD_PHEROMONE_*` line parsed back out of the flat matrix. */
interface ParsedPheromone {
  /** Raw matrix key. */
  readonly key: string;
  /** Subject the hook filters on (everything before the first ` | `). */
  readonly subject: string;
  /** Free-text note. */
  readonly note: string;
  /** Intensity as written by `appendPheromone`. */
  readonly intensity: number;
  /** Actor that laid the trace, when recorded. */
  readonly actor?: string;
  /** Epoch ms, from the value's `ts:` field or the key's trailing stamp. */
  readonly ts?: number;
}

/**
 * Parse one `PD_PHEROMONE_*` matrix line back into its parts.
 *
 * **Motivation.** Pheromones are the one key class written by *shell* hooks and
 * ephemeral agents rather than by this loop, so the loop is a reader of someone
 * else's format and must be forgiving of it. The timestamp is recovered from the
 * value's `ts:` field first and from the key's trailing `_<epochms>` stamp
 * second (that stamp is minted by `appendPheromone`), because a trace whose age
 * cannot be established can never be aged out — and an immortal trace is exactly
 * the landfill this loop is here to prevent.
 *
 * @param key Raw matrix key, e.g. `PD_PHEROMONE_SRC_AUTH_TS_1754300000000`.
 * @param value Raw matrix value in `subject | note | intensity:N | ...` form.
 * @returns The parsed trace, or `undefined` when the line has no usable subject.
 */
function parsePheromone(key: string, value: string): ParsedPheromone | undefined {
  const parts = value.split(' | ');
  const subject = (parts[0] ?? '').trim();
  if (!subject) return undefined;
  const note = (parts[1] ?? '').trim();

  let intensity = 1;
  let actor: string | undefined;
  let ts: number | undefined;
  for (const raw of parts.slice(1)) {
    const field = raw.trim();
    if (field.startsWith('intensity:')) {
      const n = Number(field.slice('intensity:'.length));
      if (Number.isFinite(n)) intensity = n;
    } else if (field.startsWith('actor:')) {
      actor = field.slice('actor:'.length);
    } else if (field.startsWith('ts:')) {
      const parsed = Date.parse(field.slice('ts:'.length));
      if (Number.isFinite(parsed)) ts = parsed;
    }
  }
  if (ts === undefined) {
    const stamp = /_(\d{10,})$/.exec(key);
    if (stamp) {
      const n = Number(stamp[1]);
      if (Number.isFinite(n)) ts = n;
    }
  }
  return { key, subject, note, intensity, actor, ts };
}

/**
 * Exponentially decay a pheromone's intensity with age.
 *
 * The philosophy is straight stigmergy: a trace is a claim about attention, and
 * attention is perishable. Half-life decay (rather than a hard cliff) is chosen
 * so a trace's influence shrinks smoothly — an agent reading the matrix sees
 * "this was important, and it is fading", which is a truer signal than a note
 * that is fully authoritative until the instant it vanishes.
 *
 * @param intensity Intensity as originally written.
 * @param ageMs Age of the trace in ms; negative ages (clock skew) count as 0.
 * @param halfLifeMs Time for intensity to halve.
 * @returns The decayed intensity, never negative.
 */
function decayedIntensity(intensity: number, ageMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return intensity;
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 0;
  return intensity * Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Re-render a decayed pheromone into the exact wire shape its readers expect.
 *
 * Design note: the field ORDER is load-bearing, not cosmetic.
 * `bin/pd-hook-prompt` derives the trace's subject with `${val%% | *}` — the
 * text before the first ` | ` — and filters it against the session's project
 * root. Reordering or omitting the leading subject would silently make every
 * trace irrelevant to every project.
 *
 * @param p The parsed trace.
 * @param decayed Its post-decay intensity.
 * @returns A matrix value of the form `subject | note | intensity:N | actor:A | ts:ISO`.
 */
function renderPheromone(p: ParsedPheromone, decayed: number): string {
  const rounded = Math.round(decayed * 100) / 100;
  let out = `${p.subject} | ${p.note} | intensity:${rounded}`;
  if (p.actor) out += ` | actor:${p.actor}`;
  if (p.ts !== undefined) out += ` | ts:${new Date(p.ts).toISOString()}`;
  return out;
}

/**
 * Write the whole matrix atomically. Caller MUST already hold the matrix lock.
 *
 * **Why this is not `setKey`.** `matrix.setKey` / `deleteKey` each take the lock
 * themselves, and the mkdir lock is not reentrant — calling them from inside a
 * tick's `withLock` would deadlock until the lock timeout fired. More
 * importantly, a tick that wrote N keys through N lock acquisitions would expose
 * N−1 intermediate states to the shell tentacles, which is precisely the torn
 * read the ADR's locking rule exists to prevent. One tick, one lock, one rename.
 *
 * @param kv The complete key→value map to persist.
 * @param fleet Optional per-fleet shard name.
 * @returns Nothing; throws only if the filesystem write itself fails.
 */
function writeMatrixAtomic(kv: Record<string, string>, fleet?: string): void {
  const p = matrixPath(fleet);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, serializeMatrix(kv), { mode: 0o600 });
  renameSync(tmp, p); // atomic on POSIX
}

/**
 * A leveled sink that discards everything — the default when no logger is injected.
 *
 * The design intent is that logging is opt-in for this module: a unit test or a
 * CLI utility that builds a loop should not have to silence a logger it never
 * asked for, and `console` must never become the fallback sink (one-logger
 * discipline, `skills/responsible-logging`).
 */
const SILENT_SINK: LeveledSink = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── 4. The loop ──────────────────────────────────────────────────────────────

/**
 * Build the Reconcile Loop: the daemon tick that makes `matrix.env` a projection
 * of durable truth instead of an append-only landfill.
 *
 * **Purpose.** Two duties, of which the second is the one that was missing.
 * *Projection*: each tick recomputes the desired key set for every class in
 * `RECONCILE_KEY_CLASSES` from its durable source and writes it. *Garbage
 * collection*: every key belonging to a reconciled class that the source no
 * longer justifies is DELETED in the same locked write. A third duty rides
 * along for the one class the loop does not own — shell-appended
 * `PD_PHEROMONE_*` traces are decayed by age, the freshest N are re-projected,
 * and the faded ones are removed.
 *
 * **Design: degradation is per-class.** A source that is absent, or that throws,
 * marks its class *degraded* — the loop neither projects nor collects it, and
 * leaves whatever is in the matrix alone. The alternative (treating a failed read
 * as an empty result) would let one transient SQLite error delete every claim key
 * in the fleet, which is a coordination outage caused by the coordination
 * system. Other classes are unaffected, and `tick()` still writes the heartbeat.
 *
 * @param deps Injected sources, clock, logger and bounds. Every field is
 *             optional; see {@link ReconcileDeps} for the per-field contract.
 * @returns A {@link ReconcileLoop} handle — `start()` / `stop()` for the daemon,
 *          `tick()` for tests and for forcing a projection after a known change.
 */
export function createReconcileLoop(deps: ReconcileDeps = {}): ReconcileLoop {
  const clock = deps.now ?? Date.now;
  const fleet = deps.fleet;
  const intervalMs = deps.intervalMs ?? RECONCILE_INTERVAL_MS;
  const maxEntries = deps.maxEntries ?? RECONCILE_MAX_PROJECTED_ENTRIES;
  const budgetBytes = deps.budgetBytes ?? RECONCILE_TOTAL_BUDGET_BYTES;
  const ceilingEntries = deps.matrixEntryCeiling ?? DEFAULT_MATRIX_ENTRY_CEILING;
  const ceilingBytes = deps.matrixByteCeiling ?? DEFAULT_MATRIX_BYTE_CEILING;
  const lockTimeoutMs = deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pheromoneTtlMs = deps.pheromoneTtlMs ?? DEFAULT_PHEROMONE_TTL_MS;
  const pheromoneHalfLifeMs = deps.pheromoneHalfLifeMs ?? DEFAULT_PHEROMONE_HALF_LIFE_MS;
  const pheromoneTopN = deps.pheromoneTopN ?? DEFAULT_PHEROMONE_TOP_N;

  // Burst 1 / 60s window: a source that fails every tick (4×/min) reports once a
  // minute plus a rollup carrying the true count, instead of 5,760 lines a day.
  const gov = new LogGovernor(deps.logger ?? SILENT_SINK, { windowMs: 60_000, burst: 1, now: clock });

  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Read one durable source without letting its failure escape the class.
   *
   * The design intent is that "this source is unavailable" and "this source says
   * nothing exists" must never be confused — the returned `degraded` flag is what
   * stops the caller from garbage-collecting a class it could not recompute.
   *
   * **A malformed answer is a failed answer.** Guarding only `throw` was the
   * whole of the bug: `ReconcileDeps` is a compile-time promise, and a durable
   * store that returns `undefined` on a cache miss or a half-built row after a
   * partial migration breaks it without ever raising. That value then reached
   * the unguarded `.map()`/`.length` below, inside the single whole-tick `try`,
   * and took every other class — and the heartbeat — down with it. `isValid` is
   * a required parameter precisely so a future class cannot opt out by
   * forgetting it.
   *
   * @param name Registry class the source feeds; also the governor key suffix,
   *             which is safe because the class enum is small and fixed.
   * @param fn The source, or `undefined` when the daemon has not wired it.
   * @param fallback Value to return when the source is missing, throws, or lies.
   * @param isValid Runtime shape check for the source's answer; a `false` verdict
   *                degrades the class exactly as a throw does.
   * @returns The source's answer plus whether the class must be treated as degraded.
   */
  const readSource = <T>(
    name: ReconcileKeyClassName,
    fn: (() => T) | undefined,
    fallback: T,
    isValid: (v: unknown) => boolean,
  ): { value: T; degraded: boolean } => {
    if (!fn) return { value: fallback, degraded: true };
    let value: T;
    try {
      value = fn();
    } catch (err) {
      gov.governed({
        key: `reconcile_source_failed_${name}`,
        level: 'warn',
        message: 'reconcile_source_failed',
        meta: { class: name, error: (err as Error)?.message ?? String(err) },
      });
      return { value: fallback, degraded: true };
    }
    if (!isValid(value)) {
      // Deliberately logged under its own message, not folded into
      // `reconcile_source_failed`: a throwing source is an outage the source
      // already knows about, while a malformed one believes it succeeded and
      // will keep lying every tick until someone is told which class it is.
      gov.governed({
        key: `reconcile_source_malformed_${name}`,
        level: 'warn',
        message: 'reconcile_source_malformed',
        meta: { class: name, received: Array.isArray(value) ? 'array' : typeof value },
      });
      return { value: fallback, degraded: true };
    }
    return { value, degraded: false };
  };

  /**
   * Ask every durable source what is true and turn the answers into desired keys.
   *
   * Runs entirely outside the matrix lock on purpose: the whole point of the
   * tick's lock discipline is that the lock-held window contains no I/O the fleet
   * has to wait on. Purpose of returning the degraded set alongside the map is to
   * let the writer distinguish "project nothing here" from "do not touch this".
   *
   * @param now Tick time in epoch ms.
   * @returns The per-class desired entries (post per-class caps) and the set of
   *          classes that could not be recomputed this tick.
   */
  const collect = (now: number): { desired: DesiredByClass; degraded: Set<ReconcileKeyClassName> } => {
    const desired: DesiredByClass = new Map();
    const degraded = new Set<ReconcileKeyClassName>();

    /**
     * Record one class's candidates, applying its registry caps and TTL.
     *
     * A tiny local closure by design: it keeps the per-class blocks below down to
     * "map the source rows into entries", so the interesting part of each class
     * (its value wording and its address) is readable in one glance.
     *
     * @param name Registry class name.
     * @param degradedFlag Whether the source failed or was absent.
     * @param entries Candidate entries built from the source's rows.
     * @returns Nothing; mutates the enclosing `desired` / `degraded` collections.
     */
    const record = (
      name: ReconcileKeyClassName,
      degradedFlag: boolean,
      entries: DesiredEntry[],
    ): void => {
      if (degradedFlag) {
        degraded.add(name);
        return;
      }
      desired.set(name, applyCaps(RECONCILE_KEY_CLASSES[name], entries, now));
    };

    // HALT — singleton, mirror-source. Highest priority; effectively undroppable.
    const halt = readSource<HaltState | null | undefined>('HALT', deps.panic, null, isHaltStateShape);
    record(
      'HALT',
      halt.degraded,
      halt.value?.armed
        ? [
            {
              key: PD_HALT_KEY,
              value: stampValue(
                `HALT: ${halt.value.reason ?? 'operator pulled the cord — stop work and await instructions'}`,
                now,
              ),
              ts: now,
              bucket: '',
            },
          ]
        : [],
    );

    // PARLEY — per-actor, TTL'd. A human is waiting on a reply.
    const parley = readSource<readonly ParleySummons[]>('PARLEY', deps.parley, [], isParleyListShape);
    record(
      'PARLEY',
      parley.degraded,
      parley.value.map((s) => {
        const ts = s.ts ?? now;
        return {
          key: parleyKey(s.actor, s.convId),
          value: stampValue(`PARLEY ${s.convId}: ${s.summary}`, ts),
          ts,
          bucket: s.actor,
        };
      }),
    );

    // FLEET_APPROVALS — singleton, mirror-source. Migrated from syncApprovalAlert.
    const approvals = readSource<readonly PendingApproval[]>(
      'FLEET_APPROVALS',
      deps.approvals,
      [],
      isApprovalListShape,
    );
    record(
      'FLEET_APPROVALS',
      approvals.degraded,
      approvals.value.length === 0
        ? []
        : [
            {
              key: PD_ALERT_FLEET_APPROVALS_KEY,
              value: stampValue(buildApprovalsMessage(approvals.value), now),
              ts: now,
              bucket: '',
            },
          ],
    );

    // CLAIM — global, mirror-source. Both parties must see the same key.
    const claims = readSource<readonly ClaimOverlap[]>('CLAIM', deps.claims, [], isClaimListShape);
    record(
      'CLAIM',
      claims.degraded,
      claims.value.map((c) => {
        const ts = c.ts ?? now;
        return {
          key: claimKey(c.path),
          value: stampValue(
            `CLAIM OVERLAP ${c.path} — held by ${c.holders.join(', ')}`,
            ts,
          ),
          ts,
          bucket: '',
        };
      }),
    );

    // CI — global, capped at one: the useful signal is "your branch is red".
    const ci = readSource<CiFailure | null | undefined>('CI', deps.ci, null, isCiFailureShape);
    record(
      'CI',
      ci.degraded,
      ci.value
        ? [
            {
              key: ciKey(ci.value.branch),
              value: stampValue(`CI RED on ${ci.value.branch}: ${ci.value.summary}`, ci.value.ts ?? now),
              ts: ci.value.ts ?? now,
              bucket: '',
            },
          ]
        : [],
    );

    // INBOX — per-actor, cap-evict-oldest.
    const inbox = readSource<readonly InboxMessage[]>('INBOX', deps.inbox, [], isInboxListShape);
    record(
      'INBOX',
      inbox.degraded,
      inbox.value.map((m) => {
        const ts = m.ts ?? now;
        return {
          key: inboxKey(m.actor, m.msgId),
          value: stampValue(`INBOX${m.from ? ` from ${m.from}` : ''}: ${m.summary}`, ts),
          ts,
          bucket: m.actor,
        };
      }),
    );

    // ACCOMPLISHMENT — global, decay-by-age. Pure ambience; first overboard.
    const acc = readSource<readonly Accomplishment[]>(
      'ACCOMPLISHMENT',
      deps.accomplishments,
      [],
      isAccomplishmentListShape,
    );
    record(
      'ACCOMPLISHMENT',
      acc.degraded,
      acc.value.map((a) => {
        const ts = a.ts ?? now;
        return {
          key: accomplishmentKey(a.id),
          value: stampValue(`DONE ${a.summary}`, ts),
          ts,
          bucket: '',
        };
      }),
    );

    return { desired, degraded };
  };

  /**
   * Decay, rank and garbage-collect shell-appended pheromone traces in place.
   *
   * This is the duty the matrix module's original RECONCILE TODO described:
   * agents and hooks only ever append `PD_PHEROMONE_*`, so without a reader that
   * fades them the flat file grows for as long as the fleet sails. The design
   * keeps three bounds rather than one — an absolute TTL, an intensity floor
   * after half-life decay, and a top-N cut — because each catches a failure the
   * others miss: a wedged clock, a low-confidence trace, and a burst of fresh
   * traces that would otherwise crowd the whole prompt budget.
   *
   * @param kv The in-flight matrix map, mutated in place (caller holds the lock).
   * @param now Tick time in epoch ms.
   * @returns Every trace seen this tick, each flagged retained or faded.
   */
  const reconcilePheromones = (kv: Record<string, string>, now: number): DrainedPheromone[] => {
    const parsed: Array<{ p: ParsedPheromone; decayed: number; expired: boolean }> = [];
    for (const key of Object.keys(kv)) {
      if (!key.startsWith('PD_PHEROMONE_')) continue;
      const p = parsePheromone(key, kv[key]);
      if (!p) {
        // Unparseable junk under our prefix: remove it rather than carry it forever.
        delete kv[key];
        continue;
      }
      const age = p.ts === undefined ? 0 : Math.max(0, now - p.ts);
      const expired = p.ts !== undefined && age >= pheromoneTtlMs;
      parsed.push({ p, decayed: decayedIntensity(p.intensity, age, pheromoneHalfLifeMs), expired });
    }

    // Freshest first; traces with no establishable age rank last so the top-N cut
    // preferentially keeps the ones we can actually reason about.
    parsed.sort((a, b) => ((b.p.ts ?? -1) - (a.p.ts ?? -1)) || a.p.key.localeCompare(b.p.key));

    const out: DrainedPheromone[] = [];
    let kept = 0;
    for (const row of parsed) {
      const faded = row.expired || row.decayed < PHEROMONE_FADE_FLOOR;
      const overCut = kept >= pheromoneTopN;
      const retained = !faded && !overCut;
      if (retained) {
        kept += 1;
        kv[row.p.key] = renderPheromone(row.p, row.decayed);
      } else {
        delete kv[row.p.key];
      }
      out.push({
        key: row.p.key,
        subject: row.p.subject,
        note: row.p.note,
        intensity: row.p.intensity,
        decayed: row.decayed,
        ts: row.p.ts,
        actor: row.p.actor,
        retained,
      });
    }
    return out;
  };

  /**
   * Run exactly one reconcile tick.
   *
   * **Contract: this never throws**, and the rationale matters more than the
   * rule. It is invoked from `setInterval` inside a long-lived daemon, where an
   * escaping error is an unhandled exception that can take the process down — and
   * the design position of the whole Ink Cloud is that a hot cache is never worth
   * the daemon it decorates. Every failure becomes a report with `ok: false` plus
   * one governed log line.
   *
   * **The phases are separated on purpose.** Reading the clock, asking the
   * sources, and writing the file each get their own guard rather than sharing
   * one `try`, because a failure in an earlier phase must not cancel the later
   * ones. Concretely: a source that answers nonsense degrades its class and the
   * tick still stamps `PD_RECON_HEARTBEAT_TS`, since that key is the fleet's
   * liveness signal and a frozen heartbeat silences every agent on the machine
   * within `RECONCILE_STALE_AFTER_MS` — including the halt. The one failure that
   * legitimately cancels everything is an unreadable matrix, because there the
   * only available write would be a whole-file rewrite derived from a file we
   * could not read.
   *
   * @returns A {@link ReconcileTickReport} describing what was projected,
   *          dropped, deleted and degraded.
   */
  function tick(): ReconcileTickReport {
    const held: ReconcileClassCounts = {};
    const counts: ReconcileClassCounts = {};
    let drained: DrainedPheromone[] = [];

    // Phase 0 — the clock. Injected, therefore capable of throwing, and it sat
    // outside the guard below where an exception escaped tick() into
    // setInterval and out of start(), contradicting the never-throws contract.
    let now: number;
    try {
      now = clock();
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      try {
        gov.governed({
          key: 'reconcile_clock_failed',
          level: 'error',
          message: 'reconcile_clock_failed',
          meta: { error: message },
        });
      } catch {
        // The governor shares this same injected clock, so the log attempt can
        // fail for exactly the reason we are already reporting. Swallowing here
        // is what keeps the never-throws contract true in the one case where
        // the reporting channel is itself broken.
      }
      return {
        // Last-resort stamp: the injected clock is the contract, but a receipt
        // with no timestamp is unreadable, and this path proves that clock is
        // unusable. The `error` field says which clock produced this `ts`.
        ts: Date.now(),
        ok: false,
        counts,
        held,
        bytes: 0,
        droppedClasses: [],
        degradedClasses: [],
        keysWritten: 0,
        keysDeleted: 0,
        pheromonesKept: 0,
        pheromonesFaded: 0,
        error: `reconcile clock threw (ts is Date.now, not the injected clock): ${message}`,
      };
    }

    // Phase 1 — ask the sources. Isolated from the write phase so that even a
    // total collapse here (which the per-source validation above should already
    // have reduced to per-class degradation) still leaves a tick that can write
    // the heartbeat. Everything degraded means everything left alone.
    let desired: DesiredByClass;
    let degraded: Set<ReconcileKeyClassName>;
    let collectError: string | undefined;
    try {
      ({ desired, degraded } = collect(now));
    } catch (err) {
      collectError = (err as Error)?.message ?? String(err);
      desired = new Map();
      degraded = new Set(RECONCILE_KEY_CLASS_NAMES.filter((n) => n !== 'HEARTBEAT'));
      gov.governed({
        key: 'reconcile_collect_failed',
        level: 'error',
        message: 'reconcile_collect_failed',
        meta: { error: collectError },
      });
    }

    try {
      for (const [name, list] of desired) held[name] = list.length;

      const { kept, dropped, reason, scope } = applyBudget(desired, {
        maxEntries,
        budgetBytes,
        ceilingEntries,
        ceilingBytes,
      });
      for (const [name, list] of kept) counts[name] = list.length;
      const projected = tally(kept);

      let keysWritten = 0;
      let keysDeleted = 0;
      let unreadable: NodeJS.ErrnoException | undefined;

      // ONE lock, ONE read-modify-write, ONE rename. See writeMatrixAtomic.
      withLock(
        fleet,
        () => {
          const snapshot = tryReadMatrix(fleet);
          if (snapshot.state === 'unreadable') {
            // NEVER rewrite a file we could not read. `writeMatrixAtomic`
            // serializes the WHOLE matrix from this map, so proceeding on an
            // empty read would delete every key this loop does not own —
            // `PD_LOCK_*` (what stops two agents editing the same file),
            // foreign `PD_ALERT_*`, every pheromone — and it would do so
            // *outside* the counted GC path, reporting `ok: true,
            // keysDeleted: 0`. Absence of evidence is not evidence of absence:
            // we abandon the tick, say so, and leave the file exactly as found.
            unreadable = snapshot.error;
            return;
          }
          const next: Record<string, string> = { ...snapshot.kv };

          for (const name of RECONCILE_KEY_CLASS_NAMES) {
            if (name === 'HEARTBEAT') continue;
            // Degraded: we could not recompute this class, so we must not judge
            // its existing keys. Silence beats deleting the fleet's coordination.
            if (degraded.has(name)) continue;
            // GC diffs against `desired` — the post-cap, post-TTL set the SOURCE
            // still justifies. A class the budget dropped is absent from `kept`
            // but present here, so its keys are left standing: deferred, not
            // destroyed. Only a key the source stopped reporting (or that a
            // registry cap/TTL evicted) is missing from `desired` and deleted.
            const justified = desired.get(name) ?? [];
            const justifiedKeys = new Set(justified.map((e) => e.key));
            for (const existing of Object.keys(next)) {
              if (classifyReconcileKey(existing) !== name) continue;
              if (justifiedKeys.has(existing)) continue;
              delete next[existing];
              keysDeleted += 1;
            }
            // The WRITE uses `kept`: what fits one agent's turn this tick.
            for (const e of kept.get(name) ?? []) {
              if (next[e.key] !== e.value) keysWritten += 1;
              next[e.key] = e.value;
            }
          }

          drained = reconcilePheromones(next, now);
          next[PD_RECON_HEARTBEAT_TS_KEY] = String(now);
          writeMatrixAtomic(next, fleet);
        },
        { timeoutMs: lockTimeoutMs },
      );

      if (unreadable) {
        gov.governed({
          key: 'reconcile_matrix_unreadable',
          level: 'error',
          message: 'reconcile_matrix_unreadable',
          meta: {
            fleet: fleet ?? 'global',
            path: matrixPath(fleet),
            code: unreadable.code ?? 'unknown',
            error: unreadable.message ?? String(unreadable),
          },
        });
        return {
          ts: now,
          ok: false,
          // Nothing was projected and nothing was collected, so the honest
          // per-class answer is "none", not the set we merely intended.
          counts: {},
          held,
          bytes: 0,
          droppedClasses: [],
          degradedClasses: [...degraded],
          keysWritten: 0,
          keysDeleted: 0,
          pheromonesKept: 0,
          pheromonesFaded: 0,
          matrixUnreadable: true,
          error:
            `matrix unreadable (${unreadable.code ?? 'unknown'}) at ${matrixPath(fleet)} — ` +
            'tick abandoned without rewriting it',
        };
      }

      const heldBytes = tally(desired).bytes;
      let receipt: ReconcileDropReceipt | undefined;
      if (reason && scope) {
        receipt = {
          ts: now,
          scope,
          reason,
          droppedClasses: dropped,
          heldCounts: held,
          projectedCounts: counts,
          heldBytes,
          emittedBytes: projected.bytes,
          fleet: fleet ?? 'global',
        };
        // A breached fleet ceiling is a producer bug and reads as an error; a
        // full agent-turn is routine and stays a warn. The governor key stays
        // low-cardinality (2 scopes × 5 reasons), never keyed on an actor.
        gov.governed({
          key: `reconcile_suppressed_${scope}_${reason}`,
          level: scope === 'fleet-matrix-ceiling' ? 'error' : 'warn',
          message: 'reconcile_projection_suppressed',
          meta: {
            scope,
            reason,
            dropped_classes: dropped,
            held_bytes: heldBytes,
            emitted_bytes: projected.bytes,
            // Stated explicitly because this is the property the operator most
            // needs to trust: a drop never destroys undelivered mail.
            keys_deleted_by_drop: 0,
          },
        });
      }

      const faded = drained.filter((d) => !d.retained).length;
      const report: ReconcileTickReport = {
        ts: now,
        // A tick that could not recompute ANY class did not do its job, even
        // though it completed the write that keeps the fleet's liveness signal
        // moving. Reporting `ok: true` here would make the collapse invisible
        // to the daemon's status surface; reporting it while still writing the
        // heartbeat is the whole point of separating the phases.
        ok: collectError === undefined,
        counts,
        held,
        bytes: projected.bytes,
        droppedClasses: dropped,
        suppressionReason: reason,
        dropScope: scope,
        degradedClasses: [...degraded],
        keysWritten,
        keysDeleted,
        pheromonesKept: drained.length - faded,
        pheromonesFaded: faded,
        ...(collectError === undefined
          ? {}
          : { error: `reconcile sources could not be collected: ${collectError}` }),
      };

      // Same lock discipline as the pheromone sink below: the operator receipt
      // is delivered only after the rename, so an operator surface that blocks
      // cannot stall every shell tentacle on the machine.
      if (deps.onDrop && receipt) {
        try {
          deps.onDrop(receipt);
        } catch (err) {
          gov.governed({
            key: 'reconcile_drop_receipt_failed',
            level: 'warn',
            message: 'reconcile_drop_receipt_failed',
            meta: { error: (err as Error)?.message ?? String(err) },
          });
        }
      }

      // The durable sink runs AFTER the lock is released: a slow or throwing
      // consumer must not extend the window every shell tentacle waits on.
      if (deps.pheromones && drained.length > 0) {
        try {
          deps.pheromones(drained);
        } catch (err) {
          gov.governed({
            key: 'reconcile_pheromone_sink_failed',
            level: 'warn',
            message: 'reconcile_pheromone_sink_failed',
            meta: { error: (err as Error)?.message ?? String(err) },
          });
        }
      }

      return report;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      gov.governed({
        key: 'reconcile_tick_failed',
        level: 'error',
        message: 'reconcile_tick_failed',
        meta: { error: message },
      });
      return {
        ts: now,
        ok: false,
        counts,
        held,
        bytes: 0,
        droppedClasses: [],
        degradedClasses: [],
        keysWritten: 0,
        keysDeleted: 0,
        pheromonesKept: 0,
        pheromonesFaded: 0,
        error: message,
      };
    }
  }

  /**
   * Start ticking, after one immediate projection.
   *
   * The immediate tick is a deliberate design choice, matching the shape
   * `syncApprovalAlert` already used (subscribe, then call once): a daemon that has just restarted
   * holds a matrix written by its dead predecessor, and waiting a full interval
   * before correcting it means the first agent turn after every restart reads
   * stale coordination state.
   *
   * @returns Nothing. Calling `start()` twice is a no-op, not a second timer.
   */
  function start(): void {
    if (timer) return;
    tick();
    timer = setInterval(tick, intervalMs);
    // Never hold the event loop open for a cache refresher — the daemon's
    // lifetime is decided by its listener, not by this timer.
    if (typeof timer.unref === 'function') timer.unref();
    gov.info('reconcile_loop_started', { interval_ms: intervalMs, fleet: fleet ?? 'global' });
  }

  /**
   * Stop ticking and flush suppressed log rollups.
   *
   * Flushing on shutdown is a rule from `skills/responsible-logging`, and its
   * motivation is evidentiary: a governor
   * that is disposed with a partial window silently discards the tail it was
   * counting, which converts "this failed 4,312 times" into no record at all —
   * exactly the evidence a post-mortem needs most.
   *
   * @returns Nothing. Safe to call when never started or already stopped — and,
   *          like `tick()`, it never throws.
   */
  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    try {
      gov.flushAll();
    } catch {
      // `flushAll` reads the injected clock to close its windows. A daemon that
      // cannot shut its reconcile loop down because the clock it was handed is
      // broken is a worse outcome than a lost log rollup, and the timer above is
      // already cleared by the time we get here — shutdown is complete either way.
    }
  }

  return { start, stop, tick };
}
