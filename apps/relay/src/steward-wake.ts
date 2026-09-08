/**
 * apps/relay/src/steward-wake.ts — episodic wakes (P1 PR 8).
 *
 * PURPOSE: close the other half of P1 PR 1's assumption. PR 1 built a wake
 * inbox and said the wakes would come "from the existing webhook receiver".
 * They never did — nothing in `apps/relay/src` so much as mentioned the seat,
 * which is why production D1 held zero deck-log rows through four green PRs.
 * PR 5 gave the seat a heartbeat so it could not be *dead*; this gives it
 * *ears* so it does not have to wait up to six hours to hear that a PR just
 * went green.
 *
 * WHY A DURABLE OBJECT BINDING AND NOT AN HTTP CALL. The obvious wiring is
 * `fetch('https://pd-steward.../wake', { Authorization: Bearer ... })`, and it
 * is the wrong one. That bearer is `STEWARD_ADMIN_TOKEN` — the same credential
 * that authorizes `/ship-it`, `/charter`, and `/clusterfudge/ack`. Handing the
 * relay full merge authority so it can say "something happened" is a bad
 * trade, and minting a second narrow token instead just moves a secret into a
 * second Worker for a boundary that does not exist: a DO namespace is not
 * publicly addressable, so a `script_name` binding reaches the seat *inside*
 * the trust boundary with no credential at all. That is the identical argument
 * PR 5 made for the cron — `fetch` authenticates the outside world, and this
 * is not the outside world — and it is test-pinned there too.
 *
 * It is also strictly event-driven. Nothing here polls, sleeps, or schedules;
 * a wake happens because GitHub told us something, or it does not happen. The
 * 6h heartbeat remains the floor, not the mechanism.
 *
 * THE SEAT ALREADY EXPECTS THIS. `handleWake` dedupes on `deliveryId` and
 * debounces the drain by {@link STEWARD_WAKE_DEBOUNCE_NOTE} 5 seconds, which
 * is precisely what makes at-least-once webhook delivery safe to point at it:
 * GitHub's redeliveries collapse, and a push that fires eight check suites in
 * four seconds produces one tick, not eight.
 */

import type { Env } from './types.js';
import { appendAudit } from './db.js';

/**
 * The 5s drain debounce inside `StewardDO.handleWake`, named here so the
 * reasoning above cites a fact rather than a memory. Kept as prose, not an
 * import: the constant is the seat's to change, and a cross-app import would
 * make the relay's build depend on it.
 */
export const STEWARD_WAKE_DEBOUNCE_NOTE = 'StewardDO.WAKE_DEBOUNCE_MS = 5_000';

/**
 * Events that change whether a PR can land, mapped to the wake `kind` the
 * deck log will show.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY:
 *
 * - **`check_run`.** One push to this repo completes ~28 check runs but only a
 *   handful of check *suites*. Both collapse to one tick through the debounce,
 *   so the extra 20-odd deliveries buy nothing and cost a DO write each. Suite
 *   granularity is the same signal at a twentieth of the traffic.
 * - **`pull_request:edited`, `labeled`, `assigned`.** Title, body, and label
 *   churn cannot change a merge verdict. Waking on them would train the deck
 *   log to be noise, and the deck log is the vital sign — §5.3 only works if a
 *   human is still willing to read it.
 * - **`push`.** Reaches the seat as `pull_request:synchronize` for anything
 *   that has a PR, and a branch without a PR is not the seat's business.
 * - **`merge_group`.** That is the fleet's gate queue, not a merge decision;
 *   the seat enqueues and the queue owns what happens next.
 *
 * The rule behind all four: wake on a change to the *evidence a verdict rests
 * on*, never on a change to how the PR is described.
 */
const WAKE_ON: ReadonlyMap<string, string> = new Map([
  ['pull_request:opened', 'pr-opened'],
  ['pull_request:reopened', 'pr-reopened'],
  ['pull_request:synchronize', 'pr-pushed'],
  ['pull_request:ready_for_review', 'pr-ready'],
  ['pull_request:closed', 'pr-closed'],
  ['pull_request_review:submitted', 'review-submitted'],
  ['pull_request_review:dismissed', 'review-dismissed'],
  ['check_suite:completed', 'checks-completed'],
]);

/**
 * Decide whether a normalized webhook is worth a wake, and under what name.
 *
 * DESIGN — AN ALLOW-LIST, NOT A DENY-LIST: a deny-list silently admits every
 * event GitHub adds next year, and the failure mode of admitting one is a
 * merge authority woken by something it has no opinion about. Unknown is
 * therefore "no", and adding an event is a visible one-line change with a
 * stated reason.
 *
 * @param eventType - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null for actionless events.
 * @returns The wake `kind` to record, or null when this event earns no wake.
 */
export function stewardWakeKind(eventType: string, action: string | null): string | null {
  return WAKE_ON.get(action ? `${eventType}:${action}` : eventType) ?? null;
}

/**
 * Pull the PR number out of whichever payload shape this event uses.
 *
 * WHY IT MAY LEGITIMATELY BE ABSENT: `check_suite` carries `pull_requests` as
 * an array, which is empty for a suite on a branch with no PR and can hold
 * more than one when a head is shared. Rather than guess, this reports the
 * first or nothing — the number is context on the deck-log entry, not the
 * thing the seat acts on. The tick re-surveys every open PR on every wake, so
 * a missing number costs precision in the log, never correctness.
 *
 * @param payload - The verified webhook body.
 * @returns The PR number, or null when the event does not name exactly one.
 */
export function stewardWakePrNumber(payload: Record<string, unknown>): number | null {
  const pull = payload.pull_request;
  if (pull && typeof pull === 'object') {
    const n = (pull as Record<string, unknown>).number;
    if (typeof n === 'number') return n;
  }
  const suite = payload.check_suite;
  if (suite && typeof suite === 'object') {
    const prs = (suite as Record<string, unknown>).pull_requests;
    if (Array.isArray(prs) && prs.length > 0 && prs[0] && typeof prs[0] === 'object') {
      const n = (prs[0] as Record<string, unknown>).number;
      if (typeof n === 'number') return n;
    }
  }
  return null;
}

/**
 * Post one wake to the repo's Steward seat, if this delivery earns one.
 *
 * FAILS OPEN, ALWAYS. Every path here is wrapped: the seat is an *accelerant*,
 * not a dependency of webhook ingestion. A 503 from the DO must not turn a
 * verified delivery into a GitHub retry, because the retry would re-run the
 * fleet enqueue that already succeeded and duplicate real spend. If the wake
 * is lost the seat still picks the change up on its next heartbeat — that is
 * exactly the degradation the 6h beat exists to floor. Same contract
 * `maybeEnqueueFleetRun` follows for its audit write, and for the same reason.
 *
 * SILENCE IS STILL RECORDED. Failures append an audit row rather than vanish;
 * the whole P1 lesson is that an unobservable no-op looks identical to a
 * success, and this function is one `if` away from being exactly that.
 *
 * UNBOUND IS A NO-OP BY DESIGN. `env.STEWARD` is optional, mirroring the
 * relay's existing optional-queue boot contract, so the relay deploys and runs
 * before the binding is provisioned. It is also how staging stays safe: the
 * `latest` environment deliberately omits the binding, because a staging
 * delivery must never wake the production merge authority.
 *
 * @param env - Relay environment; `STEWARD` may be unbound.
 * @param eventType - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null.
 * @param deliveryId - `X-GitHub-Delivery`; the seat's dedupe key.
 * @param repoFullName - `owner/repo`, or null when the payload names no repo.
 * @param payload - The verified webhook body.
 * @returns Nothing; every failure is absorbed and audited.
 */
export async function maybeWakeSteward(
  env: Env,
  eventType: string,
  action: string | null,
  deliveryId: string,
  repoFullName: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const kind = stewardWakeKind(eventType, action);
  if (!kind) return;
  // No repo means no seat: seats are per-repo by the Single-Writer Kernel
  // rule, and there is no sensible default to fall back to.
  if (!repoFullName) return;
  if (!env.STEWARD) return;
  // An empty delivery id would collapse every event onto one dedupe key and
  // silently swallow all wakes after the first — the loudest possible failure
  // disguised as the quietest. Refuse it instead.
  if (!deliveryId) {
    await appendAudit(env.DB, {
      action: 'steward_wake_skipped',
      target: repoFullName,
      detail: `event=${eventType} action=${action ?? ''} reason=no-delivery-id`,
    }).catch(() => {});
    return;
  }

  const prNumber = stewardWakePrNumber(payload);
  try {
    const stub = env.STEWARD.get(env.STEWARD.idFromName(`steward:${repoFullName}`));
    const res = await stub.fetch(
      new Request('https://steward.internal/wake', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-steward-repo': repoFullName },
        body: JSON.stringify({
          kind,
          deliveryId,
          ...(prNumber === null ? {} : { prNumber }),
          detail: `${eventType}${action ? `:${action}` : ''} via relay webhook`,
        }),
      }),
    );
    // 202 queued and 200 deduped are both success. Anything else is the seat
    // refusing the wake, and an operator needs to be able to find out why.
    if (res.status !== 202 && res.status !== 200) {
      await appendAudit(env.DB, {
        action: 'steward_wake_failed',
        target: repoFullName,
        detail: `event=${eventType} delivery=${deliveryId} status=${res.status}`,
      }).catch(() => {});
    }
  } catch (e) {
    await appendAudit(env.DB, {
      action: 'steward_wake_failed',
      target: repoFullName,
      detail: `event=${eventType} delivery=${deliveryId} error=${String(e).slice(0, 200)}`,
    }).catch(() => {});
  }
}
