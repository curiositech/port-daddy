import { buildDocket, renderDocket, type DocketEntry, type PrSnapshot } from './priority.js';
import { surveyOpenPrs, type FetchLike } from './survey.js';
import { appendMergeVerdict } from './ledgers.js';
import type { Env, MergeLedgerEntry } from './types.js';

/**
 * The tick — one bounded deliberation of the Steward's seat (P1 PR 2 of
 * THE_FULL_WHEEL.md §11: survey → priority function → verdict → ledger +
 * deck-log write).
 *
 * SCOPE, HONESTLY: this tick DECIDES and RECORDS; it does not LAND. A LAND
 * verdict is written to the merge ledger with its evidence and the deck log
 * says so — the landing machinery (merge queue, the land-to-main macaroon,
 * the protected-path "ship it" gate) is P1 PR 3, and until it exists a LAND
 * row is a decision awaiting hands, not a merge. Keeping decision and
 * actuation in separate PRs means the judgment is reviewable and revertible
 * on its own, and the seat's first days in office are observably harmless.
 *
 * The verdict policy is deliberately mechanical in this slice — no model in
 * the loop yet. The three-valued vocabulary maps to evidence the survey can
 * prove: approved+green+mergeable ⇒ LAND; red checks or changes-requested ⇒
 * NEEDS-WORK; anything the evidence cannot decide ⇒ SURFACE (the only verdict
 * that is always safe to over-issue). Model-graded deliberation joins later,
 * on top of this floor, never instead of it.
 */

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
      evidence: `approved review standing, checks green, mergeable (${top.rationale}); landing executes in P1 PR 3`,
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
 * @param env - Worker environment (DB for the ledger; token for the survey).
 * @param repo - `owner/repo` the seat serves.
 * @param nowMs - Epoch ms for the verdict row's timestamp.
 * @param fetchImpl - Injectable fetch for tests; defaults to global fetch.
 * @param surveyImpl - Injectable survey for tests; defaults to {@link surveyOpenPrs}.
 * @returns What happened, for the deck-log entry.
 */
export async function runTick(
  env: Env,
  repo: string,
  nowMs: number,
  fetchImpl: FetchLike = fetch,
  surveyImpl: typeof surveyOpenPrs = surveyOpenPrs,
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
  return { ran: true, docketText, verdict: row, verdictLedgered };
}
