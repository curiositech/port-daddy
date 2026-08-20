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
import type { Env, MergeLedgerEntry } from './types.js';

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

/** What one tick did, folded into the wake's deck-log entry by the caller. */
export interface TickResult {
  /** True when the tick ran (token present, survey succeeded). */
  ran: boolean;
  /** Why the tick did not run, when it didn't. */
  skipped?: string;
  /** The printed docket (audit block for the deck log). */
  docketText: string;
  /** The verdict rendered on the docket's top PR, when one was. */
  verdict?: MergeLedgerEntry;
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
  const top = docket[0];
  if (!top) {
    return { ran: true, docketText };
  }

  const { verdict, evidence } = decideVerdict(top);
  const row: MergeLedgerEntry = {
    repo,
    prNumber: top.pr.number,
    verdict,
    evidence,
    requestedBy: 'tick',
    createdAt: Math.floor(nowMs / 1000),
  };
  const verdictLedgered = await appendMergeVerdict(env.DB, row);
  if (verdict !== 'LAND') {
    return { ran: true, docketText, verdict: row, verdictLedgered };
  }
  const landing = await executeLanding(env, owner, name, top.pr.number, nowMs, fetchImpl, store);
  return { ran: true, docketText, verdict: row, verdictLedgered, landing };
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
  const holdNote =
    failures.length >= LAND_FAIL_HOLD_AT
      ? ` — ${failures.length} distinct failures, land-fail hold engaged`
      : '';
  return { attempted: true, landed: false, reason: `land attempt failed: ${result.reason}${holdNote}` };
}
