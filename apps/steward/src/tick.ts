import { buildDocket, renderDocket, type DocketEntry, type PrSnapshot } from './priority.js';
import { surveyOpenPrs, type FetchLike } from './survey.js';
import { appendMergeVerdict } from './ledgers.js';
import {
  fetchPrFiles,
  isProtectedPr,
  landPr,
  landFailKey,
  shipItKey,
  LAND_FAIL_HOLD_AT,
  PR_FILES_PAGE_SIZE,
  type SeatStore,
  type ShipItGrant,
} from './landing.js';
import { isFrozen, readClusterfudge, tripClusterfudge } from './clusterfudge.js';
import type { Env, MergeLedgerEntry } from './types.js';
import { readStewardMergeLedger } from '../../shared/steward-ledgers.js';

/**
 * The tick — one bounded deliberation of the Steward's seat (P1 PR 2 + PR 3
 * of THE_FULL_WHEEL.md §11: survey → priority function → verdict → ledger +
 * deck-log write, and since PR 3, execution of LAND verdicts).
 *
 * DECISION AND ACTUATION, SEPARATED THEN SEQUENCED: the verdict is decided
 * and ledgered exactly as in PR 2 — mechanical, evidence-named, mergeable
 * from survey facts alone. Only THEN does the landing arm run, and only when
 * the seat holds `STEWARD_LAND_TOKEN`: protected paths await an operator
 * ship-it grant, repeated novel failures put the PR on hold (the clusterfudge
 * tripwire), and every outcome — landed, held, awaiting — is a sentence in
 * the deck log. An unarmed seat behaves exactly as PR 2 shipped it.
 *
 * The verdict policy is deliberately mechanical in this slice — no model in
 * the loop yet. The three-valued vocabulary maps to evidence the survey can
 * prove: approved+green+mergeable ⇒ LAND; red checks or changes-requested ⇒
 * NEEDS-WORK; anything the evidence cannot decide ⇒ SURFACE (the only verdict
 * that is always safe to over-issue). Model-graded deliberation joins later,
 * on top of this floor, never instead of it.
 */

/** What the landing arm did with one LAND verdict (deck log prints `reason`). */
export interface LandingOutcome {
  /** True when the merge API was actually called. */
  attempted: boolean;
  /** True when the PR squash-merged. */
  landed: boolean;
  /** The merge commit SHA on success. */
  sha?: string;
  /** Why it landed / held / awaited — always a full sentence for the log. */
  reason: string;
}

/**
 * How many docket entries one tick will judge.
 *
 * DESIGN — the docket is ranked, so the first N are the N most important
 * things in the repo; judging beyond that buys precision on work the seat is
 * not going to reach anyway. The bound also keeps a wake's cost flat as the
 * backlog grows: 45 open PRs and 450 cost the same tick. Deciding is pure and
 * cheap ({@link decideVerdict} does no I/O) — what this really bounds is the
 * D1 writes underneath it.
 */
export const TICK_SCAN_LIMIT = 25;

/**
 * How many verdict rows one tick will append.
 *
 * Separate from {@link TICK_SCAN_LIMIT} on purpose: the first tick over a cold
 * backlog forms an opinion on everything at once, and writing all of them in
 * one alarm is the one case that could run long. After that first pass almost
 * every judgement is unchanged and writes nothing, so this cap is invisible in
 * steady state and only smooths the cold start.
 */
export const TICK_LEDGER_LIMIT = 25;

/**
 * How far back to read the seat's own verdicts when suppressing repeats.
 *
 * Wide enough to cover a full docket several times over, so a PR's current
 * verdict has not fallen out of the window. If it has, the tick simply
 * re-records it — the failure direction is a duplicate row, never a silence.
 */
export const VERDICT_MEMORY = 200;

/** What one tick did, folded into the wake's deck-log entry by the caller. */
export interface TickResult {
  /** True when the tick ran (token present, survey succeeded). */
  ran: boolean;
  /** Why the tick did not run, when it didn't. */
  skipped?: string;
  /** The printed docket (audit block for the deck log). */
  docketText: string;
  /** The verdict the tick ACTED on — a LAND, or the first new opinion it formed. */
  verdict?: MergeLedgerEntry;
  /** How many docket entries this tick actually judged. */
  scanned?: number;
  /** How many verdicts were new information and therefore recorded. */
  ledgered?: number;
  /** How many were skipped because the seat already holds that same verdict. */
  unchanged?: number;
  /** True when the verdict row landed in D1. */
  verdictLedgered?: boolean;
  /** What the landing arm did, present exactly when the verdict was LAND. */
  landing?: LandingOutcome;
}

/**
 * Decide the verdict for the docket's top entry from survey evidence alone.
 *
 * WHY MECHANICAL: the seat's authority comes from its auditability — a
 * verdict must trace to check states and review states a stranger can
 * re-derive. Every branch below names its evidence in the row it writes.
 * Exported for direct unit-testing of the policy table.
 *
 * @param top - The docket entry the tick is handling.
 * @returns The three-valued verdict plus its evidence sentence.
 */
export function decideVerdict(top: DocketEntry): { verdict: MergeLedgerEntry['verdict']; evidence: string } {
  const pr = top.pr;
  if (pr.approved && pr.checks === 'green' && pr.mergeable === true) {
    return {
      verdict: 'LAND',
      evidence: `approved review standing, checks green, mergeable (${top.rationale})`,
    };
  }
  if (pr.checks === 'red') {
    return {
      verdict: 'NEEDS-WORK',
      evidence: `required checks red on head (${top.rationale})`,
    };
  }
  if (pr.changesRequested) {
    return {
      verdict: 'NEEDS-WORK',
      evidence: `a human review requests changes (${top.rationale})`,
    };
  }
  if (pr.mergeable === false) {
    return {
      verdict: 'NEEDS-WORK',
      evidence: `merge conflict against base (${top.rationale})`,
    };
  }
  return {
    verdict: 'SURFACE',
    evidence: `evidence cannot decide: checks=${pr.checks}, approved=${pr.approved}, mergeable=${String(pr.mergeable)} (${top.rationale})`,
  };
}

/**
 * Run one tick: survey, docket, decide the top PR, ledger the verdict.
 *
 * FAILURE POSTURE (the design rationale): a tick that cannot see (no token, survey throw) returns
 * `ran: false` with the reason — the caller's deck-log entry says the seat
 * held, rather than the seat guessing blind. A tick never throws: the wake's
 * deck-log write must always be reached (§5.3, the vital sign).
 *
 * @param env - Worker environment (DB for the ledger; tokens for survey/landing).
 * @param repo - `owner/repo` the seat serves.
 * @param nowMs - Epoch ms for the verdict row's timestamp.
 * @param fetchImpl - Injectable fetch for tests; defaults to global fetch.
 * @param surveyImpl - Injectable survey for tests; defaults to {@link surveyOpenPrs}.
 * @param store - The seat's hot storage (ship-it grants, land-fail counters);
 * absent in bare-decision tests, in which case the landing arm holds.
 * @returns What happened, for the deck-log entry.
 */
export async function runTick(
  env: Env,
  repo: string,
  nowMs: number,
  fetchImpl: FetchLike = fetch,
  surveyImpl: typeof surveyOpenPrs = surveyOpenPrs,
  store?: SeatStore,
): Promise<TickResult> {
  const token = env.STEWARD_GITHUB_TOKEN;
  if (!token) {
    return {
      ran: false,
      skipped: 'no STEWARD_GITHUB_TOKEN — the seat cannot survey; holding',
      docketText: '',
    };
  }
  const [owner, name] = repo.split('/');
  let prs: PrSnapshot[];
  try {
    prs = await surveyImpl(owner, name, token, fetchImpl);
  } catch (err) {
    return {
      ran: false,
      skipped: `survey failed: ${String(err).slice(0, 200)} — holding rather than deciding blind`,
      docketText: '',
    };
  }

  const docket = buildDocket(prs);
  const docketText = renderDocket(docket);
  if (docket.length === 0) {
    return { ran: true, docketText, scanned: 0, ledgered: 0, unchanged: 0 };
  }

  // What the seat already believes, so a re-judged PR whose answer has not
  // moved costs nothing. One read for the whole walk, not one per PR.
  const held = await lastVerdictByPr(env.DB, repo);

  let scanned = 0;
  let ledgered = 0;
  let unchanged = 0;
  let acted: MergeLedgerEntry | undefined;
  let actedLedgered: boolean | undefined;

  for (const entry of docket.slice(0, TICK_SCAN_LIMIT)) {
    scanned += 1;
    const { verdict, evidence } = decideVerdict(entry);
    const row: MergeLedgerEntry = {
      repo,
      prNumber: entry.pr.number,
      verdict,
      evidence,
      requestedBy: 'tick',
      createdAt: Math.floor(nowMs / 1000),
    };

    if (verdict === 'LAND') {
      // The one case that always gets recorded and always stops the walk: a
      // landing is an action, and an action's ledger row is the record of it.
      actedLedgered = await appendMergeVerdict(env.DB, row);
      ledgered += 1;
      const landing = await executeLanding(env, owner, name, entry.pr.number, nowMs, fetchImpl, store);
      return { ran: true, docketText, verdict: row, verdictLedgered: actedLedgered, landing,
               scanned, ledgered, unchanged };
    }

    if (held.get(entry.pr.number) === verdict) {
      unchanged += 1;
      continue;
    }
    if (ledgered < TICK_LEDGER_LIMIT) {
      const ok = await appendMergeVerdict(env.DB, row);
      ledgered += 1;
      // Report the first NEW opinion as the tick's headline when no LAND is
      // found, so the deck log names something that actually changed.
      if (!acted) { acted = row; actedLedgered = ok; }
    }
  }

  return { ran: true, docketText, verdict: acted, verdictLedgered: actedLedgered,
           scanned, ledgered, unchanged };
}

/**
 * The seat's most recent verdict per PR, for suppressing repeats.
 *
 * WHY THIS EXISTS — the livelock it fixes: the tick used to judge `docket[0]`
 * and stop. The docket ranking is stable and carries no memory, so a top PR
 * that is permanently red (a fleet-owned PR whose checks nobody fixes) was
 * re-judged identically on every single wake while the other forty-odd PRs
 * were never reached. Every individual decision was correct and the seat
 * could still never reach a LAND on anything — classic head-of-line blocking,
 * measured in production: two wakes, two identical `NEEDS-WORK on #6419`.
 *
 * Walking the docket fixes the starvation but would trade it for noise: the
 * same forty NEEDS-WORK rows re-appended every six hours would bury the merge
 * ledger, which is the repo's merge history of record and only worth having
 * if a human will still read it. So a verdict is recorded when it is NEW
 * INFORMATION — the first opinion on a PR, or a changed one — and skipped
 * when the seat already holds that exact answer.
 *
 * DEGRADES TO EMPTY, NEVER THROWS: on any read failure this returns an empty
 * map, so the tick re-records rather than going silent. Duplicate rows in an
 * append-only ledger are recoverable; a seat that skips a verdict it never
 * actually held is not.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param repo - `owner/repo` the seat serves.
 * @returns PR number → the verdict most recently recorded for it.
 */
async function lastVerdictByPr(
  db: Env['DB'],
  repo: string,
): Promise<Map<number, MergeLedgerEntry['verdict']>> {
  const seen = new Map<number, MergeLedgerEntry['verdict']>();
  const rows = await readStewardMergeLedger(db, repo, VERDICT_MEMORY);
  // Newest first, so the FIRST row seen for a PR is its current verdict.
  for (const r of rows) if (!seen.has(r.prNumber)) seen.set(r.prNumber, r.verdict);
  return seen;
}

/**
 * The landing arm — execute one ledgered LAND verdict, or say why not.
 *
 * FAILURE POSTURE MIRRORS THE TICK'S: this function never throws — every
 * path returns a {@link LandingOutcome} whose `reason` reads as a deck-log
 * sentence. The order of the gates is the safety argument: (1) an unarmed
 * seat (no `STEWARD_LAND_TOKEN`) never calls GitHub; (2) a PR on land-fail
 * hold ({@link LAND_FAIL_HOLD_AT} distinct failures) never retries until an
 * operator ship-it resets it; (3) a protected-path PR without a live grant
 * awaits the operator; only then does the merge API get called. Failures
 * accumulate DISTINCT reasons per PR — the same 409 twice is a retry story,
 * three different failures is the clusterfudge signature and the tick stops
 * touching that PR.
 *
 * @param env - Worker environment (the land token lives here).
 * @param owner - Repo owner.
 * @param name - Repo name.
 * @param prNumber - The PR the LAND verdict names.
 * @param nowMs - Epoch ms, for grant-consumption bookkeeping.
 * @param fetchImpl - Injectable fetch shared with the survey.
 * @param store - The seat's hot storage; without it the arm holds honestly.
 * @returns The outcome sentence for the deck log; never rejects.
 */
async function executeLanding(
  env: Env,
  owner: string,
  name: string,
  prNumber: number,
  nowMs: number,
  fetchImpl: FetchLike,
  store?: SeatStore,
): Promise<LandingOutcome> {
  if (!env.STEWARD_LAND_TOKEN) {
    return {
      attempted: false,
      landed: false,
      reason: 'LAND recorded; seat holds no landing capability (STEWARD_LAND_TOKEN unset)',
    };
  }
  if (!store) {
    return {
      attempted: false,
      landed: false,
      reason: 'LAND recorded; no seat store bound — cannot check ship-it grants, holding',
    };
  }

  // The breaker outranks every per-PR gate below it: a systemic freeze means
  // the seat has stopped trusting its own judgment, so no merge may proceed
  // regardless of how healthy this particular PR looks (§9's freeze semantics
  // — read-only work continued above; acting stops here).
  const breaker = await readClusterfudge(store);
  if (isFrozen(breaker)) {
    return {
      attempted: false,
      landed: false,
      reason: `CLUSTERFUDGE frozen (${breaker.tripwire ?? 'unknown'}) — no merges until an operator acks; ${breaker.evidence ?? 'no evidence recorded'}`,
    };
  }

  const failures = (await store.get<string[]>(landFailKey(prNumber))) ?? [];
  if (failures.length >= LAND_FAIL_HOLD_AT) {
    return {
      attempted: false,
      landed: false,
      reason: `land-fail hold on #${prNumber}: ${failures.length} distinct failures — SURFACE; an operator ship-it resets the hold`,
    };
  }

  const grant = await store.get<ShipItGrant>(shipItKey(prNumber));
  let files: string[];
  try {
    files = await fetchPrFiles(owner, name, prNumber, env.STEWARD_LAND_TOKEN, fetchImpl);
  } catch (err) {
    return {
      attempted: false,
      landed: false,
      reason: `could not read #${prNumber}'s files (${String(err).slice(0, 120)}) — cannot check protected paths, holding`,
    };
  }
  // A full first page means unseen files may exist — fail closed on what the
  // seat could not fully see, exactly like a protected path.
  const protectedPr = isProtectedPr(files) || files.length >= PR_FILES_PAGE_SIZE;
  if (protectedPr && !grant) {
    return {
      attempted: false,
      landed: false,
      reason: `LAND on protected path awaits operator ship-it: POST /ship-it/${prNumber}`,
    };
  }

  const result = await landPr({ owner, repo: name, prNumber, token: env.STEWARD_LAND_TOKEN, fetchImpl });
  if (result.landed) {
    // Consume the grant and clear the failure history — both are per-attempt
    // state and a landed PR's slate is closed.
    await store.delete(shipItKey(prNumber));
    await store.delete(landFailKey(prNumber));
    return { attempted: true, landed: true, sha: result.sha, reason: `LANDED #${prNumber} ${result.reason}` };
  }
  if (!failures.includes(result.reason)) {
    failures.push(result.reason);
    await store.put(landFailKey(prNumber), failures);
  }
  if (failures.length < LAND_FAIL_HOLD_AT) {
    return { attempted: true, landed: false, reason: `land attempt failed: ${result.reason}` };
  }
  // Threshold reached: this is §9's land-fail-loop tripwire, and it freezes
  // the repo rather than merely holding the PR. One PR failing three distinct
  // ways is the seat's evidence that something systemic is wrong with its
  // model of the world — exactly the case where it must stop acting.
  await tripClusterfudge(
    store,
    'land-fail-loop',
    `#${prNumber} failed to land ${failures.length}× for ${failures.length} distinct causes: ${failures.join(' | ')}`,
    nowMs,
  );
  return {
    attempted: true,
    landed: false,
    reason: `land attempt failed: ${result.reason} — ${failures.length} distinct failures; CLUSTERFUDGE tripped (land-fail-loop), seat frozen pending operator ack`,
  };
}
