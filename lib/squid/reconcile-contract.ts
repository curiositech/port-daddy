/**
 * The Reconcile Loop Contract — what the harness is allowed to say, and when
 * ==========================================================================
 *
 * This module is the **single shared vocabulary** for the Giant Squid Reconcile
 * Loop (ADR-0091, the Ink Cloud). It contains no I/O, no timers, and no daemon
 * wiring — only types, constants, and pure functions. That is deliberate: the
 * reconcile daemon, the projector, the POSIX hook tentacles (`bin/pd-hook-*`),
 * and the hookless reader (`lib/local-citizen/ink-cloud.ts`) each own a
 * *different* half of this pipeline, and the only thing that keeps them honest
 * is agreeing on one description of the wire format. If a key class lives only
 * in the daemon's head, the hookless backends silently never see it.
 *
 * ## The pipeline this contract describes
 *
 * ```text
 *   durable truth              reconcile loop           hot cache            agent turn
 *   ────────────────           ──────────────           ─────────            ──────────
 *   approvals stream           every RECONCILE_         ~/.port-daddy/       pd-hook-prompt
 *   panic armed state    ──▶   INTERVAL_MS tick:  ──▶   matrix.env      ──▶  (grep + bound)
 *   tube/attention             project + GC             KEY="value"          local-citizen
 *   claims / CI / parley                                                     (read + inject)
 * ```
 *
 * The matrix is a **hot cache, never a source of truth**. Every key class below
 * names the durable store it is projected FROM. A reconcile tick is idempotent:
 * it recomputes the full projected set for a class and deletes what the durable
 * source no longer justifies. Nothing in the matrix is ever the last copy of
 * anything.
 *
 * ## Why a registry instead of scattered string literals
 *
 * The path this replaced — `syncApprovalAlert`, formerly in `lib/fleet-daemon.ts`
 * and now retired in favour of this loop — was ~20 lines that wrote one
 * hard-coded key. That shape does not survive being copy-pasted seven times:
 * each copy re-invents its own GC rule, forgets its own cap, and drifts from the
 * shell hook's `grep -E` pattern. The registry makes
 * "what keys exist, who addresses them, when do they die, how many may there
 * be" a single readable table that a test can assert against and a shell hook
 * can be generated from.
 *
 * ## The three rules a reader of this file must internalize
 *
 * 1. **FAIL OPEN.** See {@link isMatrixStale}. A stale or absent matrix means the
 *    harness knows nothing — it must go quiet, never block.
 * 2. **BOUNDED.** See {@link RECONCILE_TOTAL_BUDGET_BYTES} and the per-class
 *    {@link ReconcileKeyClass.entryCap}. The prompt envelope is a shared budget,
 *    not a per-feature allowance.
 * 3. **AUDIBLE.** See {@link VoiceLogEvent}. Every turn the harness either spoke,
 *    had nothing to say, or *was silenced by its own bounds*. The third case is
 *    the interesting one and must never be indistinguishable from the second.
 *
 * @module lib/squid/reconcile-contract
 */

import { keySuffix, posixCksum } from './matrix.js';

// ─── 1. Actor key normalization ───────────────────────────────────────────────

/**
 * Canonicalize a session/actor identifier into a matrix-key-safe address.
 *
 * **Motivation.** Per-actor key classes (`PD_INBOX_<actorKey>__<msgId>`,
 * `PD_PARLEY_<actorKey>__<convId>` — see {@link PER_ACTOR_SEPARATOR} for why the
 * boundary is doubled) embed the actor id directly in the env key,
 * because that is the only addressing scheme a `grep -E '^PD_INBOX_'` in a POSIX
 * hook can filter on without a parser. Session ids in the wild contain `:`, `-`,
 * `/`, and `.` — none of which are legal in a shell env key
 * (`[A-Za-z_][A-Za-z0-9_]*`, enforced by `setKey` in `lib/squid/matrix.ts`).
 * This function is the one place that transformation is defined.
 *
 * **Design — a readable body plus a digest, and why the digest is mandatory.**
 * Normalization alone cannot address an actor safely, because it is lossy: it
 * collapses every run of non-alphanumerics to one `_` and truncates, so
 * `agent-one`/`agent.one`/`agent_one` all become `AGENT_ONE`, and `你好`/`привет`
 * both become `X`. Two agents on one address is not a cosmetic collision — it is
 * one agent reading another's mail, and `PER_ACTOR_SEPARATOR` cannot help
 * because both keys are genuinely, identically addressed. Truncation makes it
 * worse at the boundary: with 80-char normalization, `a×79 + "-x"` and `a×79`
 * both truncate to the same 79 `A`s.
 *
 * So the address is `<normalized body>_<cksum of the RAW id>`. The body keeps
 * the key legible to an operator reading `matrix.env`; the digest is what makes
 * distinct ids distinct. See {@link posixCksum} for why `cksum` specifically —
 * it is the one checksum POSIX standardizes, so the shell mirror below computes
 * the same number without a Node runtime.
 *
 * **The exact transformation**, which shell hooks MUST mirror:
 *
 * 1. every run of one-or-more non-`[A-Za-z0-9]` characters → a single `_`
 * 2. strip leading and trailing `_`
 * 3. uppercase
 * 4. truncate to {@link ACTOR_KEY_BODY_MAX} characters
 * 5. strip trailing `_` AGAIN — step 4 can expose one that was interior before
 *    the cut, and a body ending in `_` abutting the appended `__` separator
 *    yields `___`, which moves the first `__` one character left of the true
 *    boundary and hands the neighbouring address a matching anchored prefix
 * 6. if the result is empty, use the literal `X`
 * 7. append `_` and the decimal POSIX `cksum` CRC of the **raw, untransformed**
 *    input — raw, because hashing the normalized form would inherit exactly the
 *    collisions the digest exists to break
 *
 * The POSIX-sh mirror. This exact snippet is executed against the same input
 * corpus in `tests/unit/squid-reconcile-contract.test.ts` and asserted to agree
 * character-for-character with this function — the shell mirror is proven, not
 * asserted. Note the BRE interval `\{1,\}` rather than `*`: the star form would
 * close this doc comment, and more importantly the interval form is what keeps
 * the substitutions readable as "one or more".
 *
 * ```sh
 * pd_actor_key() {
 *   k=$(printf '%s' "$1" \
 *     | sed -e 's/[^A-Za-z0-9]\{1,\}/_/g' -e 's/^_\{1,\}//' -e 's/_\{1,\}$//' \
 *     | tr '[:lower:]' '[:upper:]' \
 *     | cut -c1-64 \
 *     | sed -e 's/_\{1,\}$//')
 *   [ -n "$k" ] || k=X
 *   printf '%s_%s' "$k" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
 * }
 * ```
 *
 * @param actor Raw actor/session identifier (e.g. `port-daddy:contrib:squid-1`).
 * @returns A non-empty string matching `/^[A-Za-z0-9][A-Za-z0-9_]*$/`, never
 *          containing or ending with `_`-runs, safe to embed in a matrix key.
 */
export function actorKey(actor: string): string {
  const body = keySuffix(actor).slice(0, ACTOR_KEY_BODY_MAX).replace(/_+$/g, '') || 'X';
  return `${body}_${posixCksum(actor)}`;
}

/**
 * How much of the human-readable actor id survives into its matrix address.
 *
 * **Why 64 and not 80.** The address is body + `_` + up to ten digits of CRC, and
 * `keySuffix`'s own ceiling is 80; budgeting 64 for the body keeps the whole
 * actor segment under 80 so it stays comfortably inside the `cut -c` arithmetic
 * the shell hooks do and leaves the key readable at a glance. The body is a
 * courtesy to whoever is reading `matrix.env` with their eyes — the digest, not
 * the body, is what carries identity, so trimming the body costs legibility and
 * never correctness.
 */
export const ACTOR_KEY_BODY_MAX = 64;

// ─── 2. Key class registry ────────────────────────────────────────────────────

/** Every matrix key class the Reconcile Loop owns and is allowed to write. */
export type ReconcileKeyClassName =
  | 'FLEET_APPROVALS'
  | 'HALT'
  | 'INBOX'
  | 'CLAIM'
  | 'CI'
  | 'PARLEY'
  | 'ACCOMPLISHMENT'
  | 'HEARTBEAT';

/**
 * How a class's keys are addressed, which determines both the shape of the key
 * and how a cap is counted.
 *
 * - `singleton` — the prefix IS the whole key; there is exactly one.
 * - `global-addressed` — `<prefix><subjectKey>`; fleet-wide, one entry per subject.
 * - `per-actor` — `<prefix><actorKey>__<subjectKey>`; each actor sees only its
 *   own. The doubled separator is load-bearing: see {@link PER_ACTOR_SEPARATOR}.
 */
export type ReconcileAddressing = 'singleton' | 'global-addressed' | 'per-actor';

/**
 * The garbage-collection contract for a class. Motivation: an append-only hot
 * cache becomes a landfill within hours at K≥8 agent parallelism, and a landfill
 * blows the prompt budget with facts that stopped being true before lunch.
 *
 * - `mirror-source` — the key exists **iff** the durable source still asserts it.
 *   The reconcile tick recomputes the whole class and deletes the difference.
 *   This is the strongest rule and the default preference.
 * - `ttl` — mirror-source, *plus* an absolute age ceiling so a wedged durable
 *   source cannot pin a stale summons in front of every turn forever.
 * - `cap-evict-oldest` — mirror-source, plus keep only the newest `entryCap`
 *   entries per address; older ones are deleted, not merely hidden.
 * - `decay-by-age` — ranked by age; oldest dropped first as the cap bites, and
 *   everything past `ttlMs` is dropped regardless of cap.
 * - `never` — infrastructure key, never collected (exactly one class).
 */
export type ReconcileGcRule =
  | 'mirror-source'
  | 'ttl'
  | 'cap-evict-oldest'
  | 'decay-by-age'
  | 'never';

/** One row of the registry: the complete contract for a single key class. */
export interface ReconcileKeyClass {
  /** Registry name (the discriminant used everywhere else in this module). */
  readonly name: ReconcileKeyClassName;
  /**
   * Literal key prefix. For `singleton` classes this is the entire key; for the
   * others, the key is `prefix` + address. This string is what the shell hooks
   * `grep -E '^<prefix>'` for, so it must never change without changing
   * `bin/pd-hook-prompt` and `lib/local-citizen/ink-cloud.ts` in the same slice.
   */
  readonly prefix: string;
  /** How keys in this class are addressed. */
  readonly addressing: ReconcileAddressing;
  /**
   * Convenience mirror of `addressing === 'per-actor'`. Present because "is this
   * per-actor addressed?" is the question every consumer actually asks, and a
   * boolean read is harder to get wrong than a string comparison.
   */
  readonly perActor: boolean;
  /** When and how entries in this class die. */
  readonly gc: ReconcileGcRule;
  /** Absolute age ceiling in ms, for `ttl` / `decay-by-age` classes only. */
  readonly ttlMs?: number;
  /** Maximum simultaneous entries, counted over {@link capScope}. */
  readonly entryCap: number;
  /** Whether `entryCap` is counted fleet-wide or once per actor. */
  readonly capScope: 'global' | 'per-actor';
  /**
   * Projection rank: 1 is the most important, dropped last. `null` means the
   * class is infrastructure and is NEVER projected into an agent's context.
   */
  readonly projectionPriority: number | null;
  /** One line naming the durable store this class is projected from. */
  readonly durableSource: string;
}

/**
 * TTL for an open parley summons, in ms. Chosen to match the hook's own
 * `PD_SQUID_PROMPT_TTL_SECONDS` default (1800s) so a summons never outlives the
 * window in which `bin/pd-hook-prompt` would have shown it anyway — otherwise
 * the daemon keeps a key the hook has already decided is too old to read, and
 * the two layers disagree about what the agent "was told".
 */
export const RECONCILE_PARLEY_TTL_MS = 1_800_000;

/**
 * TTL for a recent-completion note, in ms. Much shorter than parley: an
 * accomplishment is a morale/awareness signal with no action attached, so its
 * value decays fast and it is the first thing the budget throws overboard.
 */
export const RECONCILE_ACCOMPLISHMENT_TTL_MS = 900_000;

/**
 * The registry. This table IS the contract — the daemon writes only these
 * prefixes, the hooks read only these prefixes, and the tests below assert the
 * table is internally consistent (unique prefixes, unique priorities, sane caps).
 *
 * Priority rationale, top to bottom: a HALT means the operator has pulled the
 * cord and every further token is waste; a PARLEY is a human waiting on a reply;
 * an APPROVAL is a spawn frozen mid-flight; a CLAIM prevents two agents
 * destroying each other's work; CI is a fact about work already done; INBOX is
 * asynchronous by nature; an ACCOMPLISHMENT is pure ambience.
 */
export const RECONCILE_KEY_CLASSES: {
  readonly [K in ReconcileKeyClassName]: ReconcileKeyClass;
} = {
  HALT: {
    name: 'HALT',
    prefix: 'PD_HALT',
    addressing: 'singleton',
    perActor: false,
    gc: 'mirror-source',
    entryCap: 1,
    capScope: 'global',
    projectionPriority: 1,
    durableSource: 'panic armed state — fast-path mirror; deleted the tick panic disarms',
  },
  PARLEY: {
    name: 'PARLEY',
    prefix: 'PD_PARLEY_',
    addressing: 'per-actor',
    perActor: true,
    gc: 'ttl',
    ttlMs: RECONCILE_PARLEY_TTL_MS,
    entryCap: 2,
    capScope: 'per-actor',
    projectionPriority: 2,
    durableSource: 'open parley summons addressed to this actor, still within TTL',
  },
  FLEET_APPROVALS: {
    name: 'FLEET_APPROVALS',
    prefix: 'PD_ALERT_FLEET_APPROVALS',
    addressing: 'singleton',
    perActor: false,
    gc: 'mirror-source',
    entryCap: 1,
    capScope: 'global',
    projectionPriority: 3,
    durableSource: 'shared approval stream pending list (migrated from fleet-daemon syncApprovalAlert)',
  },
  CLAIM: {
    name: 'CLAIM',
    prefix: 'PD_CLAIM_',
    addressing: 'global-addressed',
    perActor: false,
    gc: 'mirror-source',
    entryCap: 4,
    capScope: 'global',
    projectionPriority: 4,
    durableSource: 'overlapping file claims held by two or more live sessions',
  },
  CI: {
    name: 'CI',
    prefix: 'PD_CI_',
    addressing: 'global-addressed',
    perActor: false,
    gc: 'mirror-source',
    entryCap: 1,
    capScope: 'global',
    projectionPriority: 5,
    durableSource: 'red required check on the current branch; deleted on green',
  },
  INBOX: {
    name: 'INBOX',
    prefix: 'PD_INBOX_',
    addressing: 'per-actor',
    perActor: true,
    gc: 'cap-evict-oldest',
    entryCap: 3,
    capScope: 'per-actor',
    projectionPriority: 6,
    durableSource: 'unread tube / attention messages addressed to this actor',
  },
  ACCOMPLISHMENT: {
    name: 'ACCOMPLISHMENT',
    prefix: 'PD_ACCOMPLISHMENT_',
    addressing: 'global-addressed',
    perActor: false,
    gc: 'decay-by-age',
    ttlMs: RECONCILE_ACCOMPLISHMENT_TTL_MS,
    entryCap: 2,
    capScope: 'global',
    projectionPriority: 7,
    durableSource: 'recently completed sessions/notes across the fleet',
  },
  HEARTBEAT: {
    name: 'HEARTBEAT',
    prefix: 'PD_RECON_HEARTBEAT_TS',
    addressing: 'singleton',
    perActor: false,
    gc: 'never',
    entryCap: 1,
    capScope: 'global',
    projectionPriority: null,
    durableSource: 'the reconcile loop itself — epoch ms written every tick, never GC-d',
  },
} as const;

/** All registry names, in declaration order. Convenience for iteration. */
export const RECONCILE_KEY_CLASS_NAMES = Object.keys(
  RECONCILE_KEY_CLASSES,
) as ReconcileKeyClassName[];

/**
 * Resolve which key class (if any) owns a raw matrix key.
 *
 * **Motivation.** There are two independent matrix readers — the POSIX hooks and
 * `lib/local-citizen/ink-cloud.ts` for hookless backends — and historically a
 * new key class reached only the first one, so agents on Ollama/LM Studio
 * silently coordinated on less information than agents on Claude Code. Exporting
 * one classifier means adding a class to the registry is enough to reach both.
 *
 * **Design.** `singleton` classes match on exact equality, not prefix: a
 * hypothetical `PD_HALTED_AT` must not be mistaken for `PD_HALT`. Addressed
 * classes require at least one character after the prefix, so a bare `PD_INBOX_`
 * with no address is treated as junk rather than as a zero-length actor.
 *
 * @param key A raw matrix key (e.g. `PD_INBOX_SESS_7_M12`).
 * @returns The owning class name, or `undefined` if the key belongs to some
 *          other subsystem (`PD_LOCK_*`, `PD_PHEROMONE_*`, an unrelated
 *          `PD_ALERT_*`) or to nothing at all.
 */
export function classifyReconcileKey(key: string): ReconcileKeyClassName | undefined {
  for (const name of RECONCILE_KEY_CLASS_NAMES) {
    const cls = RECONCILE_KEY_CLASSES[name];
    if (cls.addressing === 'singleton') {
      if (key === cls.prefix) return name;
    } else if (key.startsWith(cls.prefix) && key.length > cls.prefix.length) {
      return name;
    }
  }
  return undefined;
}

// ─── Key builders (the only sanctioned way to mint a reconcile key) ───────────

/** The one and only halt key. Exported so no caller retypes the literal. */
export const PD_HALT_KEY = RECONCILE_KEY_CLASSES.HALT.prefix;

/** The one and only fleet-approvals key (kept byte-identical to the migrated original). */
export const PD_ALERT_FLEET_APPROVALS_KEY = RECONCILE_KEY_CLASSES.FLEET_APPROVALS.prefix;

/** The one and only reconcile heartbeat key. */
export const PD_RECON_HEARTBEAT_TS_KEY = RECONCILE_KEY_CLASSES.HEARTBEAT.prefix;

/**
 * Separator between the actor address and the subject in a per-actor key.
 *
 * **Why two underscores, and why this is a correctness fix rather than style.**
 * A single `_` made per-actor addressing *ambiguous by construction*: actor
 * `alpha` greps `^PD_INBOX_ALPHA_[A-Za-z0-9_]+=` and that pattern also matches
 * `PD_INBOX_ALPHA_TWO_M1`, which is actor `alpha-two`'s mail. No anchored shell
 * pattern can disambiguate, because the boundary between the actor and the
 * subject is unmarked — so agent `alpha` silently read a neighbour's inbox and
 * neither side could tell.
 *
 * `__` is the one separator {@link actorKey} can never emit: it collapses every
 * run of non-alphanumerics to a *single* `_` and strips leading/trailing ones,
 * so a normalized actor or subject contains no `__` and never begins or ends
 * with `_`. The first `__` after the class prefix is therefore an unambiguous
 * boundary for both a shell `grep -E` and a TypeScript `indexOf`.
 */
export const PER_ACTOR_SEPARATOR = '__';

/**
 * Build the inbox key for one unread message addressed to one actor.
 *
 * The design intent is that an actor's whole inbox is greppable with a single
 * anchored pattern (`^PD_INBOX_<actorKey>__`) so a shell hook can filter to
 * "mine" without parsing values — which is why the actor comes before the
 * message id in the key, and why {@link PER_ACTOR_SEPARATOR} sits between them.
 *
 * @param actor Raw actor/session id; normalized via {@link actorKey}.
 * @param msgId Raw message id; normalized with the same rules.
 * @returns A matrix key of the form `PD_INBOX_<ACTOR>__<MSGID>`.
 */
export function inboxKey(actor: string, msgId: string): string {
  return `${RECONCILE_KEY_CLASSES.INBOX.prefix}${actorKey(actor)}${PER_ACTOR_SEPARATOR}${keySuffix(msgId)}`;
}

/**
 * Build the claim-overlap key for a contested path.
 *
 * Global rather than per-actor by design: an overlap is a fact about a *file*,
 * and both parties need to see the same key so neither believes it is alone.
 *
 * @param path Repo-relative or absolute path under contention.
 * @returns A matrix key of the form `PD_CLAIM_<PATHKEY>`.
 */
export function claimKey(path: string): string {
  return `${RECONCILE_KEY_CLASSES.CLAIM.prefix}${keySuffix(path)}`;
}

/**
 * Build the CI key for a branch.
 *
 * Capped at one entry fleet-wide on purpose: the useful signal is "the branch
 * you are on is red", not a scoreboard of every branch in the repo. The
 * motivation is budget — a CI roll-up that grows with the branch count would
 * crowd out halts and summonses on a busy repo.
 *
 * @param branch Git branch name (e.g. `feat/squid-reconcile-loop`).
 * @returns A matrix key of the form `PD_CI_<BRANCHKEY>`.
 */
export function ciKey(branch: string): string {
  return `${RECONCILE_KEY_CLASSES.CI.prefix}${keySuffix(branch)}`;
}

/**
 * Build the parley key for one open summons in one conversation.
 *
 * Per-actor by design, and for a different reason than INBOX: a summons is
 * *addressed*, and showing agent B that agent A has been summoned is both noise
 * and a small privacy leak across sessions. The rationale for keying on the
 * conversation rather than the message is that a summons is a standing state
 * ("you owe this thread a reply"), not an event — re-summoning in the same
 * conversation must overwrite, never accumulate.
 *
 * @param actor Raw actor/session id being summoned; normalized via {@link actorKey}.
 * @param convId Raw conversation id; normalized with the same rules.
 * @returns A matrix key of the form `PD_PARLEY_<ACTOR>__<CONVID>`.
 */
export function parleyKey(actor: string, convId: string): string {
  return `${RECONCILE_KEY_CLASSES.PARLEY.prefix}${actorKey(actor)}${PER_ACTOR_SEPARATOR}${keySuffix(convId)}`;
}

/**
 * Build the anchored key prefix that selects exactly one actor's entries in a
 * per-actor class.
 *
 * **Motivation.** Three independent consumers need "is this key addressed to
 * me?" — the POSIX hook (as a `grep -E` pattern), the hookless reader in
 * `lib/local-citizen/ink-cloud.ts` (as a `startsWith`), and the reconcile loop's
 * own tests. Each of them previously hand-assembled the string, which is how the
 * single-underscore ambiguity survived review in the first place. One builder
 * means the separator can never be forgotten at a call site.
 *
 * @param name A per-actor class (`INBOX` or `PARLEY`). Passing a non-per-actor
 *             class is a programming error and throws, because silently
 *             returning a global prefix would read as "everything is mine".
 * @param actor Raw actor id; normalized via {@link actorKey}.
 * @returns e.g. `PD_INBOX_PORT_DADDY_CONTRIB_SQUID_1__`.
 */
export function perActorKeyPrefix(name: ReconcileKeyClassName, actor: string): string {
  const cls = RECONCILE_KEY_CLASSES[name];
  if (!cls.perActor) {
    throw new Error(`[reconcile-contract] ${name} is not a per-actor class`);
  }
  return `${cls.prefix}${actorKey(actor)}${PER_ACTOR_SEPARATOR}`;
}

/**
 * Recover the normalized actor address a per-actor key is directed at.
 *
 * Purpose: the hookless reader must decide "is this mine?" without a grep, and
 * an operator surface wants to render "3 messages waiting for SESS_7". Design
 * intent is to answer from the KEY alone — values are free text written by
 * several producers, and trusting them for addressing would make delivery
 * depend on formatting.
 *
 * @param key A raw matrix key.
 * @returns The normalized actor segment, or `undefined` when the key does not
 *          belong to a per-actor class or carries no
 *          {@link PER_ACTOR_SEPARATOR} boundary (a pre-migration key, which is
 *          deliberately treated as addressed to nobody rather than to everybody).
 */
export function reconcileKeyActor(key: string): string | undefined {
  const name = classifyReconcileKey(key);
  if (!name) return undefined;
  const cls = RECONCILE_KEY_CLASSES[name];
  if (!cls.perActor) return undefined;
  const rest = key.slice(cls.prefix.length);
  const at = rest.indexOf(PER_ACTOR_SEPARATOR);
  if (at <= 0) return undefined;
  return rest.slice(0, at);
}

/**
 * Build the key for a recent completion.
 *
 * The purpose of this class is fleet awareness, not action: it tells an agent
 * what its neighbours just finished so it does not redo the work. That is also
 * the design rationale for it sitting at the bottom of
 * {@link RECONCILE_DROP_ORDER} — an unheard accomplishment costs a little
 * duplicated effort, while an unheard halt costs the operator's whole intent.
 *
 * @param id Raw accomplishment/session id; normalized via `keySuffix`.
 * @returns A matrix key of the form `PD_ACCOMPLISHMENT_<ID>`.
 */
export function accomplishmentKey(id: string): string {
  return `${RECONCILE_KEY_CLASSES.ACCOMPLISHMENT.prefix}${keySuffix(id)}`;
}

// ─── 3. Staleness ─────────────────────────────────────────────────────────────

/**
 * How often the reconcile loop projects durable state into the matrix (ms).
 *
 * Chosen against the hook budget rather than against freshness for its own sake:
 * a tick rewrites the whole projected key set under the matrix lock, and at K≥8
 * parallel agents a sub-second tick would spend the fleet's lock budget on
 * bookkeeping. 15s is comfortably inside a human's "did it notice yet?" window
 * while leaving the lock free for agent-driven appends.
 */
export const RECONCILE_INTERVAL_MS = 15_000;

/**
 * Age past which the matrix is declared stale and enforcement must fail open (ms).
 *
 * Exactly four missed ticks. One missed tick is normal (GC pause, a slow durable
 * read); four in a row means the loop is dead, the daemon is gone, or the clock
 * moved — none of which the *agent* can fix, and all of which make every key in
 * the matrix a claim about a world that may no longer exist.
 */
export const RECONCILE_STALE_AFTER_MS = 60_000;

/**
 * Decide whether the matrix must be treated as stale.
 *
 * The design intent is to give every consumer — projector, hook, hookless
 * reader, enforcement rung — one shared answer to "is what I am reading still
 * true?", so that the fail-open policy below is implemented once instead of
 * re-derived (and eventually mis-derived) at each call site.
 *
 * **THE FAIL-OPEN RULE — read this before wiring any enforcement rung.**
 * When this returns `true`, the harness knows *nothing*. It must:
 *
 * - inject nothing (or, at most, a single "coordination state unavailable" line),
 * - and **never block, deny, or gate** a tool call, a commit, or a turn.
 *
 * A stale matrix is the absence of evidence, not evidence of absence. A halt key
 * that is 10 minutes old is not proof the operator still wants the fleet
 * stopped; an *absent* claim key is not proof no one holds the file. Refusing
 * work on stale data converts a dead background loop into a wedged fleet, and an
 * agent that cannot commit because a daemon died is a broken product. A quiet
 * harness is merely degraded coordination — that is the trade the ADR takes, and
 * it is the same posture `bin/pd-hook-prompt` already encodes with `exit 0`.
 *
 * **Boundary semantics**, asserted by the unit tests:
 * - `undefined` heartbeat (never written / unparseable) → `true` (stale).
 * - `NaN` or non-finite → `true` (stale). An unreadable clock is not a fresh one.
 * - `now - heartbeatTs === RECONCILE_STALE_AFTER_MS` → `true`. The comparison is
 *   `>=`: at exactly four intervals the fourth tick's deadline has already
 *   passed, so the boundary belongs to the stale side.
 * - a heartbeat in the future (clock skew, NTP step) → `false` (fresh). Skew is
 *   not a reason to go silent, and treating it as staleness would let a
 *   mis-set clock mute the harness fleet-wide.
 *
 * @param heartbeatTs Epoch-ms value of `PD_RECON_HEARTBEAT_TS`, or `undefined`
 *                    when the key is missing or did not parse as a number.
 * @param now Current epoch ms — injected rather than read from `Date.now()` so
 *            this stays a pure function the tests can pin to exact boundaries.
 * @returns `true` when callers must fail open and treat the matrix as unknown.
 */
export function isMatrixStale(heartbeatTs: number | undefined, now: number): boolean {
  if (heartbeatTs === undefined || !Number.isFinite(heartbeatTs)) return true;
  return now - heartbeatTs >= RECONCILE_STALE_AFTER_MS;
}

/**
 * Extract the reconcile heartbeat from a parsed matrix snapshot.
 *
 * **Motivation.** Both matrix readers need this and both would otherwise write
 * their own `parseInt` with their own idea of what a bad value means. Design
 * intent: any value that is not a finite number collapses to `undefined`, which
 * {@link isMatrixStale} then reads as "stale" — so a corrupted heartbeat fails
 * open exactly like a missing one, with no special case at the call site.
 *
 * The empty-string guard is load-bearing and not obvious: `Number('')` and
 * `Number('   ')` are **0**, not `NaN`. Without the guard, a truncated matrix
 * line (`PD_RECON_HEARTBEAT_TS=""` — exactly what a torn write leaves behind)
 * would parse as epoch 0 rather than "unknown". That happens to still be judged
 * stale today, but only by the accident that 1970 is more than 60 seconds ago;
 * it would report a heartbeat age of ~56 years to any operator surface that
 * renders one. Unknown must read as unknown.
 *
 * @param kv A parsed matrix key→value map (from `readMatrix` or `parseEnv`).
 * @returns Epoch ms, or `undefined` when absent, empty, or unparseable.
 */
export function readHeartbeatTs(kv: Record<string, string>): number | undefined {
  const raw = kv[PD_RECON_HEARTBEAT_TS_KEY];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

// ─── 4. Projection budget + truncation priority ───────────────────────────────

/**
 * Total byte budget for everything the Reconcile Loop projects into one turn.
 *
 * Deliberately equal to `PD_SQUID_PROMPT_MAX_BYTES`'s default (4096) in
 * `bin/pd-hook-prompt`. The motivation is that a producer which budgets ABOVE
 * its consumer's cap gets truncated by `head -c` mid-line, at a boundary chosen
 * by byte arithmetic rather than by importance — so the fleet's most urgent
 * signal can be cut in half by an accomplishment note that happened to sort
 * first. Matching the caps means this module's priority order, not `head`,
 * decides what survives.
 */
export const RECONCILE_TOTAL_BUDGET_BYTES = 4096;

/**
 * Entry-count ceiling for one projection, matching `PD_SQUID_PROMPT_MAX_ENTRIES`'s
 * default (12) in `bin/pd-hook-prompt`.
 *
 * **Known and intentional tension:** the sum of every class's `entryCap` is 14,
 * which exceeds this. That is not an oversight — the per-class caps bound each
 * *source*, while this bounds the *turn*. It means a fully-loaded fleet WILL
 * exceed the entry budget, and the projector must therefore apply
 * {@link RECONCILE_DROP_ORDER} itself and emit a `suppressed` VoiceLog with
 * reason `over-entry-cap`. If it instead lets the shell's `break` truncate, the
 * drop is silent, unordered, and invisible to the operator — the exact failure
 * this contract exists to prevent.
 *
 * **Scope: ONE agent's turn, never the fleet.** This number and
 * {@link RECONCILE_TOTAL_BUDGET_BYTES} describe what fits in a single prompt, so
 * they must be measured against a single agent's slice of the matrix — the
 * global classes plus that actor's own `PD_INBOX_<ME>__` / `PD_PARLEY_<ME>__`
 * entries, which is exactly what `bin/pd-hook-prompt` greps. Summing every
 * actor's per-actor entries into one pool and comparing THAT to this number is a
 * category error: it made five agents holding three messages each (each inside
 * the `INBOX` cap of 3) read as a 15-entry overflow and silenced all five. The
 * matrix is a shared cache with its own, far larger, absolute ceiling; this is a
 * prompt budget. See `perAgentTally` in `lib/squid/reconcile.ts`.
 */
export const RECONCILE_MAX_PROJECTED_ENTRIES = 12;

/**
 * Collect the registry rows that are actually projected into an agent's context.
 *
 * Module-private helper whose purpose is to keep the two exported orderings
 * derived from the registry rather than hand-maintained. The design intent is
 * that adding a class to {@link RECONCILE_KEY_CLASSES} with a priority is the
 * *only* edit needed to place it in both orderings — a hand-written array would
 * silently omit the new class and the omission would look like a policy choice.
 *
 * @returns The classes whose `projectionPriority` is not `null`, unsorted.
 */
function projectedClasses(): ReconcileKeyClass[] {
  return RECONCILE_KEY_CLASS_NAMES.map((n) => RECONCILE_KEY_CLASSES[n]).filter(
    (c) => c.projectionPriority !== null,
  );
}

/**
 * Classes in **emission order**: most important first, so a prefix-truncated
 * projection still leads with the thing that mattered most.
 *
 * `HEARTBEAT` is absent because it is infrastructure — projecting the loop's own
 * liveness into the agent's context would spend budget telling the agent
 * something only the harness needs to know.
 */
export const RECONCILE_PROJECTION_ORDER: readonly ReconcileKeyClassName[] = projectedClasses()
  .slice()
  .sort((a, b) => (a.projectionPriority as number) - (b.projectionPriority as number))
  .map((c) => c.name);

/**
 * Classes in **drop order**: the first entry is sacrificed first when the
 * projection exceeds {@link RECONCILE_TOTAL_BUDGET_BYTES} or
 * {@link RECONCILE_MAX_PROJECTED_ENTRIES}.
 *
 * This is exactly the reverse of {@link RECONCILE_PROJECTION_ORDER} (asserted by
 * test), so there is one ranking in the system rather than two that can drift.
 * Concretely: ACCOMPLISHMENT → INBOX → CI → CLAIM → FLEET_APPROVALS → PARLEY →
 * HALT. A HALT is dropped only if a HALT alone cannot fit, which cannot happen
 * within a 4 KiB budget — i.e. the stop signal is effectively undroppable.
 *
 * Dropping is per-class and total: a class is either fully emitted or fully
 * dropped, never half-emitted. Partial classes produce a projection that reads
 * as complete while lying by omission ("2 claims" when there were 5), which is
 * worse than saying nothing about claims this turn and logging why.
 */
export const RECONCILE_DROP_ORDER: readonly ReconcileKeyClassName[] =
  RECONCILE_PROJECTION_ORDER.slice().reverse();

// ─── 5. VoiceLog — the operator-facing record of when the harness spoke ───────

/** Hook (or hookless) surface a projection was attempted on. */
export type VoiceLogHookEvent =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'Stop'
  | 'local-citizen-turn';

/**
 * Per-class entry counts for one projection attempt. Partial because a class
 * with nothing to say is meaningfully different from a class with zero entries
 * *after* filtering, and the projector records only what it actually considered.
 */
export type ReconcileClassCounts = Partial<Record<ReconcileKeyClassName, number>>;

/**
 * Why the harness had genuinely nothing to say. Distinct from
 * {@link VoiceLogSuppressionReason}: these mean "no signal existed", not
 * "signal existed and we ate it".
 */
export type VoiceLogSilenceReason =
  | 'no-entries'
  | 'matrix-absent'
  | 'harness-disabled';

/**
 * Why a projection that HAD content emitted nothing (or less than it held).
 *
 * This enum is the whole point of the VoiceLog. "The harness was quiet" is
 * ambiguous between a calm fleet and a harness strangled by its own bounds; an
 * operator debugging "why didn't it warn me about the claim overlap?" needs the
 * second case to be a distinguishable, countable event.
 *
 * - `over-budget` — total bytes would have exceeded {@link RECONCILE_TOTAL_BUDGET_BYTES}.
 * - `over-entry-cap` — entry count would have exceeded a per-class cap or
 *   {@link RECONCILE_MAX_PROJECTED_ENTRIES}.
 * - `stale-matrix` — {@link isMatrixStale} was true; the fail-open rule applied.
 * - `ttl-expired` — every candidate entry was older than its class TTL.
 * - `not-relevant-to-cwd` — entries existed but none matched this session's
 *   project root (the exact-root filter `bin/pd-hook-prompt` already applies).
 */
export type VoiceLogSuppressionReason =
  | 'over-budget'
  | 'over-entry-cap'
  | 'stale-matrix'
  | 'ttl-expired'
  | 'not-relevant-to-cwd';

/** Fields present on every VoiceLog event regardless of outcome. */
export interface VoiceLogBase {
  /** Epoch ms at which the projection was attempted. */
  readonly ts: number;
  /** Raw actor/session id (NOT normalized — the operator reads this). */
  readonly actor: string;
  /** Which surface attempted the projection. */
  readonly hookEvent: VoiceLogHookEvent;
}

/** The harness injected context this turn. */
export interface VoiceLogSpoke extends VoiceLogBase {
  readonly outcome: 'spoke';
  /** Entries actually injected, per class. */
  readonly counts: ReconcileClassCounts;
  /** Bytes actually injected. */
  readonly bytes: number;
  /** Classes actually injected, in emission order. */
  readonly classes: readonly ReconcileKeyClassName[];
}

/** The harness had nothing to say. Quiet fleet, working harness. */
export interface VoiceLogSilent extends VoiceLogBase {
  readonly outcome: 'silent';
  readonly reason: VoiceLogSilenceReason;
}

/**
 * The harness HAD something and a bound dropped it — the "should still talk"
 * case. Carries what it *held*, not what it emitted, so the operator can see the
 * size of the thing that went unsaid.
 */
export interface VoiceLogSuppressed extends VoiceLogBase {
  readonly outcome: 'suppressed';
  readonly reason: VoiceLogSuppressionReason;
  /** Entries the projector HELD, per class, before the bound applied. */
  readonly counts: ReconcileClassCounts;
  /** Bytes the projector WANTED to emit. */
  readonly bytes: number;
  /** Classes sacrificed, in {@link RECONCILE_DROP_ORDER}. */
  readonly droppedClasses: readonly ReconcileKeyClassName[];
  /** Bytes that did make it out (0 when everything was suppressed). */
  readonly emittedBytes: number;
}

/**
 * The operator-facing record of when the harness spoke, stayed quiet, or was
 * silenced. Discriminate on `outcome`.
 *
 * Logging discipline (per `skills/responsible-logging`): this fires on EVERY
 * turn of EVERY agent, which is a loop by definition. Writers must route it
 * through the per-key log governor with a **stable, low-cardinality key** —
 * `voicelog_<outcome>` or `voicelog_suppressed_<reason>`. The actor id, byte
 * counts, and per-class counts belong in `meta`, never in the governor key;
 * keying on the actor rebuilds the storm one agent at a time.
 */
export type VoiceLogEvent = VoiceLogSpoke | VoiceLogSilent | VoiceLogSuppressed;
