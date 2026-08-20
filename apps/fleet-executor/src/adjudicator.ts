/**
 * BROKEN-SHIP ADJUDICATION — decide WHO a persistent breakage gates.
 *
 * WHY THIS EXISTS: the broken-ship doctrine (verdict.ts, 2026-08-19) says a
 * ship that errored or produced nothing usable fails the run. That is right —
 * and, applied naively, it failed EVERY open PR the morning it deployed,
 * because the breakage was fleet-wide (flaky cheap-tier models, a purser
 * config defect), not per-PR. A red check on an author's PR for the fleet's
 * own outage punishes the one party who cannot fix it, and teaches everyone
 * to distrust the gate all over again.
 *
 * THE ADJUDICATION RULE, applied only AFTER in-run repair (src/repair.ts) has
 * already failed:
 *
 *   - ISOLATED breakage — this ship is not breaking on other PRs. Then the
 *     breakage is plausibly CAUSED by this PR (a pathological diff shape, a
 *     prompt-hostile payload), and the failure STANDS. The author sees a red
 *     check that names the ship and the reason.
 *
 *   - EPIDEMIC breakage — the same ship has broken on ≥{@link EPIDEMIC_MIN_OTHER_PRS}
 *     OTHER PRs within {@link EPIDEMIC_LOOKBACK_SEC}. Then the fault is the
 *     FLEET's, and it gates the fleet, not each author: the run resolves
 *     `neutral` (never success — the breakage stays visible on every surface),
 *     ONE deduplicated GitHub issue (label `fleet:broken-ship`) tracks the
 *     repair, and a HITL interruption pages the operator the first time the
 *     epidemic is declared. This is the "press pause and escalate to the
 *     human" moment: the fleet stops pretending it can judge PRs while its own
 *     machinery is down, says so in one place, and hands the decision up.
 *
 * Evidence comes from the fleet's own D1 transcript (fleet_run_steps joined to
 * fleet_runs), counting DISTINCT other PRs with broken-marker steps for the
 * ship. No D1 binding, or a query failure, adjudicates NOTHING — the failure
 * stands (fail-closed: without evidence of an epidemic, the doctrine applies
 * unmodified).
 *
 * Every adjudicated result also WRITES a `ship-broken` marker step, so the
 * evidence base builds run over run and the epidemic test needs no separate
 * bookkeeping.
 */

import type { ExecutorEnv } from './env.js';
import type { ShipResult } from './verdict.js';
import { createIssue, findOpenIssueByTitlePrefix } from './github.js';
import { emitInterruption } from './interruptions.js';

/** How far back the epidemic test looks for broken-marker steps (72 h). */
export const EPIDEMIC_LOOKBACK_SEC = 72 * 3600;

/**
 * How many DISTINCT OTHER PRs must show the same ship broken before the
 * breakage is adjudicated fleet-wide. 2 is deliberate: one other PR could be
 * two pathological diffs; three PRs breaking the same ship is an outage.
 */
export const EPIDEMIC_MIN_OTHER_PRS = 2;

/**
 * Transcript step kinds that mark a ship as broken. `ship-broken` is the
 * dedicated marker this module writes; `ship-no-output` and `ship-finding`
 * (the malformed-block marker) predate it and are counted so the epidemic
 * test has history from day one instead of a cold start.
 */
export const BROKEN_STEP_KINDS = ['ship-broken', 'ship-no-output', 'ship-finding'] as const;

/** Issue-title prefix for one ship's tracked fleet fault (dedupe key). */
export function brokenShipIssueTitle(ship: string): string {
  return `fleet-broken-ship: pd-${ship}`;
}

/** Structural transcript dependency (mirrors purser.ts's TranscriptLike). */
interface TranscriptLike {
  step(kind: string, ship: string | null, title: string, detail: unknown): Promise<void>;
}

/** A broken result's human-legible reason, derived from its flags. */
export function brokenReason(r: ShipResult): string {
  return r.noUsableOutput === true
    ? 'no usable output — the model answered nothing its contract asked for'
    : 'errored — crashed, or emitted a malformed block the fleet could not parse';
}

/**
 * Count DISTINCT other PRs (same repo) whose recent runs carry broken-marker
 * steps for this ship.
 *
 * @returns The count, or null when there is no DB / the query failed — which
 *   the caller treats as "no epidemic evidence" (the failure stands).
 */
export async function countOtherBrokenPrs(
  db: D1Database | undefined,
  repoFullName: string,
  ship: string,
  prNumber: number,
  nowEpochSec: number,
): Promise<number | null> {
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(DISTINCT r.pr_number) AS n
           FROM fleet_run_steps s
           JOIN fleet_runs r ON r.id = s.run_id
          WHERE s.ship = ?
            AND s.kind IN (${BROKEN_STEP_KINDS.map(() => '?').join(', ')})
            AND s.created_at >= ?
            AND r.repo_full_name = ?
            AND r.pr_number != ?`,
      )
      .bind(ship, ...BROKEN_STEP_KINDS, nowEpochSec - EPIDEMIC_LOOKBACK_SEC, repoFullName, prNumber)
      .first<{ n: number }>();
    return row && typeof row.n === 'number' ? row.n : 0;
  } catch (err) {
    console.error(`[fleet-executor] epidemic query failed ship=${ship}: ${String(err)}`);
    return null;
  }
}

/**
 * Adjudicate every broken result in a run, in place. See the module doc for
 * the rule. Never throws; every failure mode degrades to "the broken-ship
 * failure stands", which is the doctrine's own default.
 *
 * @param results The run's ship results (mutated: epidemic ones gain
 *   `brokenAdjudicated`).
 * @param opts.nowEpochSec Injected clock (testability; matches nowSec()).
 * @returns The number of results adjudicated as fleet-wide faults.
 */
export async function adjudicateBrokenShips(
  results: ShipResult[],
  opts: {
    env: ExecutorEnv;
    owner: string;
    repo: string;
    prNumber: number;
    runId: string;
    token: string;
    transcript: TranscriptLike;
    nowEpochSec: number;
    installationId?: number;
  },
): Promise<number> {
  const repoFullName = `${opts.owner}/${opts.repo}`;
  let adjudicated = 0;

  for (const r of results) {
    const broken = r.errored || r.noUsableOutput === true;
    if (!broken) continue;
    const reason = brokenReason(r);

    // Marker FIRST, unconditionally — this run is evidence for the next one's
    // epidemic test whatever we decide here.
    await opts.transcript.step('ship-broken', r.ship, `pd-${r.ship}: BROKEN — ${reason}`, {
      reason,
      blocking: r.blocking,
      noUsableOutput: r.noUsableOutput === true,
    });

    const otherPrs = await countOtherBrokenPrs(
      opts.env.DB,
      repoFullName,
      r.ship,
      opts.prNumber,
      opts.nowEpochSec,
    );
    if (otherPrs == null || otherPrs < EPIDEMIC_MIN_OTHER_PRS) {
      await opts.transcript.step(
        'ship-adjudicated',
        r.ship,
        `pd-${r.ship}: adjudicated ISOLATED — broken here${otherPrs ? ` and on only ${otherPrs} other PR` : ''}, so the failure stands on this PR`,
        { verdict: 'isolated', otherPrs: otherPrs ?? 'unknown (no evidence available)' },
      );
      continue;
    }

    // EPIDEMIC: the fleet is at fault. Track it ONCE, page the operator on
    // first declaration, and mark the result so aggregation resolves neutral.
    const title = brokenShipIssueTitle(r.ship);
    let issueNumber: number | undefined;
    let newlyDeclared = false;
    try {
      const existing = await findOpenIssueByTitlePrefix(opts.owner, opts.repo, title, opts.token);
      if (existing) {
        issueNumber = existing;
      } else {
        const issue = await createIssue(
          opts.owner,
          opts.repo,
          `${title} — ${reason}`,
          `pd-${r.ship} is broken across the fleet: broken on ${otherPrs} other PR(s) within the last ` +
            `${Math.round(EPIDEMIC_LOOKBACK_SEC / 3600)}h (latest: run \`${opts.runId}\` on #${opts.prNumber}).\n\n` +
            `Reason: ${reason}.\n\n` +
            `While this issue is open, runs where ONLY this breakage occurs resolve **neutral** with an ` +
            `adjudication note instead of failing every author's PR — the fault gates the fleet, not each PR. ` +
            `Close this issue once the ship is fixed; the broken-ship doctrine then applies unmodified.\n\n` +
            `@erichowens\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`,
          ['fleet:broken-ship', `pd-${r.ship}`],
          opts.token,
        );
        issueNumber = issue.number;
        newlyDeclared = true;
      }
    } catch (err) {
      // Issue plumbing failing must not change the adjudication itself — the
      // evidence for the epidemic is real either way.
      console.error(`[fleet-executor] broken-ship issue failed for pd-${r.ship}: ${String(err)}`);
    }

    r.brokenAdjudicated = {
      scope: 'fleet',
      reason: `broken on ${otherPrs} other PR(s) in the last ${Math.round(EPIDEMIC_LOOKBACK_SEC / 3600)}h`,
      ...(issueNumber != null ? { issueNumber } : {}),
    };
    adjudicated += 1;

    await opts.transcript.step(
      'ship-adjudicated',
      r.ship,
      `pd-${r.ship}: adjudicated FLEET-WIDE fault (${otherPrs} other PR(s) affected)` +
        `${issueNumber != null ? ` — tracked in #${issueNumber}` : ''} — not gating this PR`,
      { verdict: 'fleet', otherPrs, issueNumber: issueNumber ?? null },
    );

    if (newlyDeclared) {
      // First declaration of THIS epidemic ⇒ one page, not one per run.
      emitInterruption(opts.env, {
        title: `Fleet epidemic: pd-${r.ship} broken across PRs on ${repoFullName}`,
        body:
          `pd-${r.ship} has produced broken output (${reason}) on ${otherPrs} other PR(s) in the last ` +
          `${Math.round(EPIDEMIC_LOOKBACK_SEC / 3600)}h. The fleet has adjudicated this a fleet-wide fault: ` +
          `affected runs resolve neutral with a visible adjudication note instead of failing each author's PR` +
          `${issueNumber != null ? `, tracked in #${issueNumber}` : ''}. ` +
          `A human decision is needed: fix the ship (model tier, prompt, or config), or pause it in pd-fleet.yml.`,
        urgency: 'high',
        sourceAgent: `fleet-executor/adjudicator`,
        ...(opts.runId ? { sourceSession: opts.runId } : {}),
        ...(opts.installationId ? { installationId: opts.installationId } : {}),
      });
    }
  }

  return adjudicated;
}
