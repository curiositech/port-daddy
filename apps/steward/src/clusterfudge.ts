import type { SeatStore } from './landing.js';

/**
 * The clusterfudge protocol — the seat's circuit breaker (THE_FULL_WHEEL.md
 * §9), P1 PR 4.
 *
 * WHAT IT IS FOR: every other safety mechanism in the seat assumes the seat's
 * own judgment is sound. This one assumes it is not. CLUSTERFUDGE is reserved
 * for *systemic* wrongness — the situation where an agent must stop trusting
 * itself — as distinct from the single-issue escalations (a red check, a
 * protected path) that the ordinary ladder already handles without freezing
 * anything.
 *
 * FREEZE SEMANTICS, EXACTLY AS SPEC'D: while tripped, no merges happen and no
 * permission grants are consumed, but **read-only work continues** — the tick
 * still surveys, still dockets, still records verdicts. A frozen seat is a
 * seat that keeps watching and stops acting, which is what makes the freeze
 * safe to leave engaged while a human sleeps. Only an operator ack releases
 * it; nothing in the seat can release itself, because a breaker a component
 * can reset on its own is not a breaker.
 *
 * TRIPWIRES OVER INTROSPECTION (§'s design principle): a trip is computed
 * from ledger-visible facts, never from the seat's opinion about its own
 * health. §9 names six; this slice ARMS the one whose evidence the seat
 * already holds — the land-fail loop, seeded by P1 PR 3's per-PR distinct-
 * cause counter — and registers the other five with the data source each is
 * waiting on, so the registry stays an honest inventory rather than an
 * aspirational list. An unarmed tripwire never fires; it also never silently
 * looks armed.
 */

/** The six tripwires §9 names. Ids are stable — the console keys off them. */
export type TripwireId =
  | 'land-fail-loop'
  | 'epidemic-breakage'
  | 'budget-breach'
  | 'contradiction'
  | 'evidence-divergence'
  | 'salvage-pile-up';

/** One tripwire's definition — its threshold, arming state, and page menu. */
export interface TripwireSpec {
  /** Stable id. */
  id: TripwireId;
  /** §9's threshold, verbatim enough that a reader can check the code against the plan. */
  threshold: string;
  /** True when this slice can actually compute the tripwire from data the seat holds. */
  armed: boolean;
  /** For an unarmed tripwire: the data source it is waiting on. */
  awaits?: string;
  /**
   * The decision menu the page offers. §9 is emphatic that a page carries a
   * decision menu, NOT a wall of logs — a human woken at 3am needs options,
   * not evidence to sift.
   */
  decisionMenu: string[];
}

/**
 * The tripwire registry — §9's table, as data.
 *
 * WHY A REGISTRY RATHER THAN SCATTERED CHECKS: the console (P4) renders
 * tripwire history, and the operator needs one place that answers "what can
 * freeze this repo, and which of those are actually live right now". Scattered
 * `if` statements cannot answer the second half.
 */
export const TRIPWIRES: Record<TripwireId, TripwireSpec> = {
  'land-fail-loop': {
    id: 'land-fail-loop',
    threshold: 'Same PR fails landing 3× for 3 distinct causes',
    armed: true,
    decisionMenu: ['abandon the PR', 'hand to a human', 'ack and retry once'],
  },
  'epidemic-breakage': {
    id: 'epidemic-breakage',
    threshold: '≥2 ships fleet-adjudicated broken simultaneously, or 1 for >24h',
    armed: false,
    awaits: "the fleet adjudicator's broken-ship board (fleet_run_* in D1)",
    decisionMenu: ['pause the ship', 'swap the model', 'ack and continue'],
  },
  'budget-breach': {
    id: 'budget-breach',
    threshold: 'Repo daily spend >150% of cap, or any sailor >2× its envelope',
    armed: false,
    awaits: 'per-repo spend accounting (fleet_run_spend) and sailor envelopes (P2)',
    decisionMenu: ['kill the overspender', 'raise the cap', 'ack and continue'],
  },
  contradiction: {
    id: 'contradiction',
    threshold: 'A standing preference and a live instruction conflict, or two Cartographer Questions block the same item',
    armed: false,
    awaits: 'the Cartographer and its question ledger (P2)',
    decisionMenu: ['pick the standing preference', 'pick the live instruction'],
  },
  'evidence-divergence': {
    id: 'evidence-divergence',
    threshold: "Daemon-witnessed state disagrees with a role's ledger (attestation split)",
    armed: false,
    awaits: 'daemon attestation records to compare the seat ledgers against (P3)',
    decisionMenu: ['quarantine the role', 'trust the daemon', 'trust the ledger'],
  },
  'salvage-pile-up': {
    id: 'salvage-pile-up',
    threshold: '≥3 sailor bodies dead-without-memo in 24h',
    armed: false,
    awaits: 'sailor lifecycle records (P2)',
    decisionMenu: ['resume all', 'triage individually', 'ack and continue'],
  },
};

/** DO-storage key holding the breaker's state. */
export const CLUSTERFUDGE_KEY = 'clusterfudge';

/** The breaker's persisted state. */
export interface ClusterfudgeState {
  /** True while frozen — the whole point of the record. */
  tripped: boolean;
  /** Which tripwire fired. */
  tripwire?: TripwireId;
  /** The ledger-visible facts that fired it; goes verbatim into the page. */
  evidence?: string;
  /** Epoch ms of the trip. */
  trippedAt?: number;
  /** Epoch ms of the operator's ack, on a released breaker. */
  ackedAt?: number;
  /** Who acked. */
  ackedBy?: string;
  /** The decision the operator recorded when releasing — the audit's point. */
  ackDecision?: string;
}

/** A never-tripped breaker; also what a corrupt/absent record degrades to. */
const CLEAR: ClusterfudgeState = { tripped: false };

/**
 * Read the breaker's state.
 *
 * DEGRADATION CHOICE, and the rationale for it: an absent or non-object record reads as CLEAR rather
 * than throwing. A breaker that crashes the tick when its own record is
 * unreadable would convert "we might be in trouble" into "nothing works",
 * and the tick's no-throw contract (§5.3's vital sign) outranks the
 * breaker's own bookkeeping.
 *
 * @param store - The seat's hot storage.
 * @returns The current state, or a clear one.
 */
export async function readClusterfudge(store: SeatStore): Promise<ClusterfudgeState> {
  const raw = await store.get<ClusterfudgeState>(CLUSTERFUDGE_KEY);
  if (!raw || typeof raw !== 'object' || typeof raw.tripped !== 'boolean') return { ...CLEAR };
  return raw;
}

/**
 * Is the seat frozen? The one predicate every acting path consults.
 *
 * WHY A NAMED PREDICATE FOR ONE FIELD: the freeze must be checked identically
 * everywhere, and the design intent is that adding a new acting path (P2's
 * sailor spawns, P5's DAG dispatch) means calling this — not re-deriving what
 * "frozen" means from the record's shape. One predicate is also one place to
 * extend if the state ever grows beyond a boolean.
 *
 * @param state - The breaker's state.
 * @returns True when merges and grant consumption must not happen.
 */
export function isFrozen(state: ClusterfudgeState): boolean {
  return state.tripped === true;
}

/**
 * Trip the breaker.
 *
 * IDEMPOTENT BY DESIGN: an already-tripped breaker keeps its ORIGINAL
 * tripwire, evidence and timestamp. The first cause is the diagnostic one —
 * later tripwires firing while frozen are consequences, and overwriting would
 * destroy the very evidence the page exists to show.
 *
 * @param store - The seat's hot storage.
 * @param tripwire - Which tripwire fired.
 * @param evidence - The ledger-visible facts, for the page.
 * @param nowMs - Epoch ms.
 * @returns The resulting state (unchanged when already tripped).
 */
export async function tripClusterfudge(
  store: SeatStore,
  tripwire: TripwireId,
  evidence: string,
  nowMs: number,
): Promise<ClusterfudgeState> {
  const current = await readClusterfudge(store);
  if (current.tripped) return current;
  const next: ClusterfudgeState = { tripped: true, tripwire, evidence, trippedAt: nowMs };
  await store.put(CLUSTERFUDGE_KEY, next);
  return next;
}

/**
 * Release the breaker on an operator's ack.
 *
 * WHY THE DECISION IS MANDATORY: §9 releases on "an operator ack" — but an
 * ack that records no decision leaves the next reader unable to tell whether
 * the systemic problem was fixed or merely dismissed. Storing the decision
 * beside the release makes the breaker's history a record of judgments, not
 * of button presses. Acking a clear breaker is a no-op, not an error: the
 * operator may be racing a release that already happened.
 *
 * @param store - The seat's hot storage.
 * @param ackedBy - The operator identity from the admin-gated route.
 * @param decision - What the operator decided; recorded verbatim.
 * @param nowMs - Epoch ms.
 * @returns The released state, carrying the ack provenance.
 */
export async function ackClusterfudge(
  store: SeatStore,
  ackedBy: string,
  decision: string,
  nowMs: number,
): Promise<ClusterfudgeState> {
  const current = await readClusterfudge(store);
  const next: ClusterfudgeState = {
    tripped: false,
    ...(current.tripwire ? { tripwire: current.tripwire } : {}),
    ...(current.evidence ? { evidence: current.evidence } : {}),
    ...(current.trippedAt ? { trippedAt: current.trippedAt } : {}),
    ackedAt: nowMs,
    ackedBy,
    ackDecision: decision,
  };
  await store.put(CLUSTERFUDGE_KEY, next);
  return next;
}

/**
 * Render the page — a decision menu, not a wall of logs.
 *
 * PURPOSE, and §9's requirement made literal: a human woken by a freeze needs
 * options, not evidence to sift, so the page states what fired, the facts
 * that fired it, and the numbered choices — in that order, and nothing else.
 * The rationale for keeping it a plain string is that the deck log can carry
 * it verbatim, which makes the freeze visible in the seat's vital sign rather
 * than only to whoever thinks to GET /status.
 *
 * @param state - The breaker's state.
 * @returns The page text, or a one-line all-clear.
 */
export function renderClusterfudgePage(state: ClusterfudgeState): string {
  if (!state.tripped) return 'CLUSTERFUDGE: clear.';
  const spec = state.tripwire ? TRIPWIRES[state.tripwire] : undefined;
  const options = (spec?.decisionMenu ?? ['hand to a human'])
    .map((o, i) => `  ${i + 1}. ${o}`)
    .join('\n');
  return [
    `CLUSTERFUDGE — FROZEN pending human decision.`,
    `Tripwire: ${state.tripwire ?? 'unknown'} (${spec?.threshold ?? 'threshold unrecorded'})`,
    `Evidence: ${state.evidence ?? 'none recorded'}`,
    `Decide:`,
    options,
    `Release: POST /clusterfudge/ack {"ackedBy":"...","decision":"..."}`,
  ].join('\n');
}
