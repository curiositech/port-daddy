/**
 * The STEWARD — a bounded auto-landing path for the fleet's OWN pull requests.
 *
 * THE ASK, IN THE OPERATOR'S WORDS: "Can we have an agent who accepts and
 * merges and responds to feedback?" Yes — but an agent with write access to
 * `main` is the most dangerous thing in this Worker, so the whole design is
 * organized around what it must REFUSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAFETY ARGUMENT
 * ─────────────────────────────────────────────────────────────────────────────
 * The steward may merge a PR only if EVERY one of these holds. Each is checked
 * in {@link evaluateMerge}, which is pure and unit-tested, and the two that
 * matter most (fleet authorship, guardrail files) are RE-ASSERTED inside
 * {@link mergeFleetPr} immediately before the network call — because a
 * precondition enforced only at the caller is one refactor away from being
 * enforced nowhere.
 *
 *  1. OPT-IN.  The tenant's `pd-fleet.yml` on the TRUSTED DEFAULT BRANCH sets
 *     `steward: true`. Off by default for every tenant, same idiom as `xo:` and
 *     `squidEvents:`. Zero-trust is unchanged: config never comes from PR head.
 *  2. NOT PAUSED.  `fleet:paused` in CONTROL_KV is the operator's kill switch.
 *     A paused fleet merges nothing. A CONTROL_KV read FAILURE is treated as
 *     PAUSED here — note this INVERTS the reviewer's fail-safe default, because
 *     the failure costs differ: a review that cannot read the switch should
 *     still gate the PR, whereas a merger that cannot read the switch must not
 *     merge.
 *  3. FLEET-AUTHORED, ON THE STRONG SIGNAL.  The PR author must be this fleet's
 *     own GitHub App, established via `app-identity` (see fleet-identity.ts).
 *     The weak `bot-and-branch` signal — accepted by the review skip — is
 *     REFUSED here. It must never merge a human's PR; a branch name alone can
 *     never satisfy it.
 *  4. OPEN, NOT DRAFT.  A draft is an explicit "not yet".
 *  5. NO GUARDRAIL SELF-MODIFICATION.  A PR touching `.github/workflows/**`,
 *     `scripts/check-pr-*.mjs`, `cli/permission-tiers.ts`, or the steward's own
 *     source is refused LOUDLY. An agent that can edit the rules that bind it
 *     is not bound. This refusal has no override flag on purpose.
 *  6. EVERY REPORTED CHECK CONCLUSIVELY GREEN.  Not red, and not pending. We
 *     cannot enumerate the repo's REQUIRED checks without branch-protection
 *     read access, so instead of guessing we require ALL reported contexts to
 *     be terminal and non-failing — strictly stronger than "required ones
 *     pass". Zero checks reported is a REFUSAL, not a pass: silence is not
 *     evidence of health.
 *  7. MERGEABLE.  GitHub says `MERGEABLE`. `UNKNOWN` (mergeability still being
 *     computed) is a refusal — the steward does not merge on a maybe.
 *  8. NO CHANGES-REQUESTED REVIEW outstanding.
 *  9. NO UNRESOLVED DISPUTE.  Any open, non-outdated review thread is a hard
 *     stop. See DISPUTES below.
 * 10. UNDER THE RATE LIMIT.  A bug that satisfies 1–9 should cost a handful of
 *     merges, not a repository.
 *
 * FAIL-CLOSED AND HONEST. Every refusal carries a machine code and a sentence
 * of prose, written to the run transcript. If the steward cannot DETERMINE a
 * precondition — snapshot fetch failed, config unreadable, kill switch
 * unreadable, authorship unconfirmed — it does not merge, and it says which
 * fact it could not establish. There is no "assume green" path anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DETERMINISM INVARIANT — the merge gate cannot be talked into anything
 * ─────────────────────────────────────────────────────────────────────────────
 * NO MODEL OUTPUT MAY DECIDE A MERGE. Every precondition above is evaluated in
 * plain TypeScript against GitHub API responses, and the merge call happens if
 * and only if that boolean is true. No model is ever asked "should I merge
 * this?", and no model output is ever parsed into a merge/don't-merge signal.
 *
 * This is enforced STRUCTURALLY, not by convention: {@link evaluateMerge} and
 * {@link evaluateBranchUpdate}, together with everything they call
 * ({@link guardrailFilesIn}, {@link partitionChecks}), are SYNCHRONOUS pure
 * functions. A synchronous function cannot await a network call, so it cannot
 * consult a model — the guarantee is visible from the signature alone, and
 * `tests/steward.test.ts` asserts none of them is an `AsyncFunction`, then
 * exercises every precondition violation independently against an `env.AI`
 * binding that throws if touched.
 *
 * WHERE THE MODEL IS ALLOWED, and nowhere else: drafting the PROSE of a dispute
 * reply ({@link draftDisputeReply}). That is real language work, and being
 * wrong there is cheap and visible on the thread.
 *
 * Dispute classification ({@link isSubstantiveDispute}) is deliberately a
 * deterministic heuristic rather than a model call — but the important property
 * is that it could safely be either, because it is structurally incapable of
 * unblocking a merge. It can only ADD an obligation to reply. What BLOCKS is
 * {@link classifyDisputes}'s `openThreads`: the count of unresolved,
 * non-outdated threads, computed from GitHub's own resolution state. A judgment
 * of "this objection is not substantive" — by heuristic or by model — never
 * clears that block, and a CHANGES_REQUESTED review is a separate hard stop
 * that no judgment touches at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DISPUTES
 * ─────────────────────────────────────────────────────────────────────────────
 * The purser's own test-PR body invites contradiction: "Dispute a test here,
 * with reasons, if it misreads the contract." Honoring that invitation is a
 * duty, not a nicety. When a human raises a SUBSTANTIVE dispute on a thread
 * (see {@link isSubstantiveDispute}) and the fleet has not answered, the
 * steward replies on that thread with a Workers-AI-drafted response that either
 * concedes the test is wrong or explains why it is right.
 *
 * IT THEN STILL REFUSES TO MERGE. Replying does not "clear" a dispute — a
 * machine that answered its own objection and immediately merged would simply
 * be overruling the human with extra steps. The thread must be RESOLVED (a
 * human action) before the merge precondition is satisfied. Never silently
 * ignore; never merge over an unaddressed dispute; and never let answering
 * count as agreement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LIVES IN THE EXECUTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * The executor is the only component that already holds all four things a
 * merger needs: the fleet's GitHub App identity and KV token cache, the
 * CONTROL_KV kill switch, the trusted-branch `pd-fleet.yml` fetch, and the D1
 * run transcript. The relay is an outbound-only event relay — putting merge
 * authority there would mean duplicating App-token minting, the pause read, and
 * the audit trail into a second Worker, i.e. two places to get the safety
 * argument right instead of one. It is driven by a Cloudflare cron
 * (`scheduled()` in src/index.ts) rather than the webhook path because merging
 * requires WAITING for checks: at `pull_request:opened` every check is pending,
 * so a webhook-only steward would be structurally incapable of ever merging.
 */

import type { ExecutorEnv } from './env.js';
import { classifyPrAuthorship, type FleetAuthorship } from './fleet-identity.js';
import {
  compareBranches,
  fetchRepoFile,
  fetchStewardPrSnapshot,
  mergePullRequest,
  replyToReviewThread,
  resolveFleetAppLogin,
  getInstallationTokenCached,
  updatePullRequestBody,
  updatePullRequestBranch,
  type BranchComparison,
  type ReviewThread,
  type StewardPrSnapshot,
} from './github.js';
import { parseFleetSteward } from './fleet.js';
import { extractAiText } from './ai-response.js';
import type { TranscriptLike } from './purser.js';

// ---------------------------------------------------------------------------
// Constants

/** CONTROL_KV key carrying the operator kill switch (shared with execute.ts). */
const PAUSE_KEY = 'fleet:paused';

/** KV key prefix for steward candidates recorded by the executor. */
export const CANDIDATE_PREFIX = 'steward:cand:';

/** KV key prefix for the per-hour merge counter. */
const MERGE_COUNTER_PREFIX = 'steward:merges:';

/** KV key prefix for the per-hour branch-update counter. */
const UPDATE_COUNTER_PREFIX = 'steward:updates:';

/** Hard ceiling on merges per rolling hour bucket, across all repos. */
export const MAX_MERGES_PER_HOUR = 4;

/** Hard ceiling on merges within a single cron sweep. */
export const MAX_MERGES_PER_SWEEP = 2;

/**
 * Hard ceiling on branch updates per hour. Higher than the merge cap because an
 * update is reversible and lands nothing on the default branch, but still
 * capped: each update pushes a commit and re-triggers the tenant's whole CI.
 */
export const MAX_UPDATES_PER_HOUR = 8;

/** Hard ceiling on branch updates within a single cron sweep. */
export const MAX_UPDATES_PER_SWEEP = 3;

/** How many steward log lines a fleet PR body retains before dropping the oldest. */
export const MAX_CHANGELOG_ENTRIES = 10;

/** Marks the machine-maintained log section inside a fleet-authored PR body. */
export const CHANGELOG_MARKER = '<!-- steward-changelog -->';

/** Hard ceiling on candidates inspected per sweep (bounds API spend). */
export const MAX_CANDIDATES_PER_SWEEP = 10;

/** A candidate lives this long before the sweep forgets it (7 days). */
const CANDIDATE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Default model for drafting dispute replies. A Workers AI `@cf/` id — the
 * steward runs entirely on Cloudflare primitives and has no Anthropic or
 * Claude-Code dependency of any kind.
 */
export const DEFAULT_STEWARD_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

/** Output cap for a dispute reply — a reply is a paragraph, not an essay. */
const REPLY_MAX_TOKENS = 512;

/**
 * Paths whose modification the steward refuses to merge, ever.
 *
 * PHILOSOPHY: these files ARE the guardrails — the CI workflows that run the
 * gates, the gate scripts themselves, the CLI permission tiers, and the
 * steward's own decision code. An agent permitted to land changes to its own
 * constraints has no constraints; it merely has a longer path to the same
 * place. There is deliberately no config flag to relax this. A human merges
 * these by hand or they do not merge.
 */
export const GUARDRAIL_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.github\/workflows\//,
  /^scripts\/check-pr-[^/]*\.mjs$/,
  /^cli\/permission-tiers\.ts$/,
  /^apps\/fleet-executor\/src\/steward\.ts$/,
  /^apps\/fleet-executor\/src\/fleet-identity\.ts$/,
];

// ---------------------------------------------------------------------------
// Pure decision core

/**
 * Which of a PR's changed files touch the fleet's own guardrails.
 *
 * PURPOSE: returns the offending paths rather than a boolean so the refusal can
 * NAME them. "Refused loudly" means a reader learns which file tripped the wire
 * without having to re-derive it; a bare `true` would make the loudest possible
 * refusal the least informative one.
 *
 * @param files Repo-relative changed paths (leading `./` tolerated).
 * @returns Every path matching {@link GUARDRAIL_PATTERNS}, possibly empty.
 */
export function guardrailFilesIn(files: readonly string[] | null | undefined): string[] {
  return (files ?? [])
    .map(f => String(f ?? '').replace(/^\.\//, ''))
    .filter(f => GUARDRAIL_PATTERNS.some(re => re.test(f)));
}

/** Check conclusions that are terminal AND acceptable. */
const GREEN_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * Partition a check rollup into pending and failing contexts.
 *
 * DESIGN: "do not merge red, do not merge on pending" are two DIFFERENT
 * refusals with two different remedies (fix it vs. wait), so they are reported
 * separately rather than collapsed into one "not green". Anything neither green
 * nor pending — FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE
 * or an unrecognized future value — counts as FAILING. Unknown states fail
 * closed on purpose: a conclusion this code has never heard of is not evidence
 * of success.
 *
 * @param checks Normalized contexts from the status-check rollup.
 * @returns The names of pending and failing contexts.
 */
export function partitionChecks(
  checks: ReadonlyArray<{ name: string; status: string; conclusion: string }>,
): { pending: string[]; failing: string[] } {
  const pending: string[] = [];
  const failing: string[] = [];
  for (const c of checks) {
    const status = (c.status ?? '').toUpperCase();
    const conclusion = (c.conclusion ?? '').toUpperCase();
    if (status !== 'COMPLETED' || !conclusion) {
      pending.push(c.name);
      continue;
    }
    if (!GREEN_CONCLUSIONS.has(conclusion)) failing.push(c.name);
  }
  return { pending, failing };
}

/** Words that mark a comment as contesting the change rather than chatting. */
const DISPUTE_MARKERS = [
  'dispute',
  'disagree',
  'this test is wrong',
  'the test is wrong',
  'misread',
  'misreads',
  'incorrect',
  'not correct',
  'wrong',
  'false positive',
  'bogus',
  'nack',
  'does not hold',
  "doesn't hold",
  'contract says',
  'remove this test',
  'delete this test',
];

/** Minimum words before a comment is treated as reasoned rather than a quip. */
const MIN_DISPUTE_WORDS = 8;

/**
 * Does this comment contest the change, with reasons?
 *
 * MOTIVATION: the purser asked for disputes "with reasons", so the steward owes
 * a reply to arguments, not to every drive-by. The floor is two-part —
 * a contesting marker AND enough words to constitute a reason — which keeps
 * "wrong" or "nope" from triggering a generated rebuttal while letting a real
 * paragraph through.
 *
 * HONEST LIMITATION, stated because a reader will otherwise assume more: this
 * is a keyword-and-length heuristic, not comprehension. It will miss a politely
 * phrased objection that uses none of these words. That miss is bounded by the
 * surrounding rule — ANY unresolved, non-outdated thread blocks the merge
 * regardless of what this function decides. Misclassification costs a missing
 * reply, never an unnoticed objection.
 *
 * @param body The comment's markdown body.
 * @returns True when the comment reads as a reasoned objection.
 */
export function isSubstantiveDispute(body: string | null | undefined): boolean {
  const text = String(body ?? '').trim();
  if (!text) return false;
  const words = text.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w));
  if (words.length < MIN_DISPUTE_WORDS) return false;
  const lower = text.toLowerCase();
  return DISPUTE_MARKERS.some(m => lower.includes(m));
}

/** A thread the steward should answer, with the comment id to reply under. */
export interface PendingDispute {
  threadIndex: number;
  path: string;
  /** REST id of the thread ROOT comment — the reply endpoint keys on this. */
  rootCommentId: number | null;
  /** The disputing comment's text, passed to the reply drafter. */
  disputeBody: string;
  /** Who raised it. */
  disputerLogin: string;
}

/**
 * Every open review thread, split into "needs a reply from us" and "just open".
 *
 * DESIGN: a thread needs a REPLY when it is unresolved, not outdated, carries a
 * substantive dispute from someone other than the fleet, and the fleet did not
 * speak last. That last clause is what makes the steward idempotent across
 * sweeps — once it has answered, the next sweep sees its own comment at the end
 * and does not answer again, so a cron running every fifteen minutes cannot
 * spam a thread.
 *
 * `openThreads` is the SEPARATE, broader count that actually gates the merge:
 * every unresolved non-outdated thread blocks, whether or not it parsed as a
 * dispute. Reply detection may be imperfect; the block must not be.
 *
 * @param threads Review threads from the PR snapshot.
 * @param fleetLogin The fleet App's bot login, used to tell "us" from "them".
 * @returns Threads awaiting a reply, and the count of all blocking open threads.
 */
export function classifyDisputes(
  threads: readonly ReviewThread[] | null | undefined,
  fleetLogin: string | null,
): { needsReply: PendingDispute[]; openThreads: number } {
  const list = threads ?? [];
  const needsReply: PendingDispute[] = [];
  let openThreads = 0;
  const us = (fleetLogin ?? '').toLowerCase();

  list.forEach((t, threadIndex) => {
    if (!t || t.isResolved || t.isOutdated) return;
    openThreads += 1;
    const comments = t.comments ?? [];
    if (comments.length === 0) return;
    const last = comments[comments.length - 1];
    // The fleet already had the last word — answered, awaiting a human.
    if (us && (last.authorLogin ?? '').toLowerCase() === us) return;
    // Find the most recent substantive dispute NOT written by the fleet.
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i];
      if (us && (c.authorLogin ?? '').toLowerCase() === us) continue;
      if (!isSubstantiveDispute(c.body)) continue;
      needsReply.push({
        threadIndex,
        path: t.path,
        rootCommentId: comments[0]?.databaseId ?? null,
        disputeBody: c.body,
        disputerLogin: c.authorLogin,
      });
      break;
    }
  });

  return { needsReply, openThreads };
}

/** Machine-readable reason a merge was refused (or allowed). */
export type MergeCode =
  | 'merge'
  | 'steward-disabled'
  | 'fleet-paused'
  | 'pause-unreadable'
  | 'snapshot-unavailable'
  | 'not-fleet-authored'
  | 'authorship-unknown'
  | 'pr-not-open'
  | 'pr-draft'
  | 'guardrail-modification'
  | 'no-checks-reported'
  | 'checks-pending'
  | 'checks-failing'
  | 'not-mergeable'
  | 'mergeability-unknown'
  | 'changes-requested'
  | 'unresolved-thread'
  | 'rate-limited';

/** The decision, always with a code and a sentence of prose. */
export interface MergeDecision {
  merge: boolean;
  code: MergeCode;
  reason: string;
}

/** Everything {@link evaluateMerge} is allowed to consider. */
export interface MergeInputs {
  /** Tenant opt-in from the trusted-branch pd-fleet.yml. */
  stewardEnabled: boolean;
  /** Kill switch. `null` means UNREADABLE, which refuses (see module doc). */
  paused: boolean | null;
  /** The authorship verdict, or `null` when the snapshot never arrived. */
  authorship: FleetAuthorship | null;
  /** The PR snapshot, or `null` when it could not be fetched. */
  pr: StewardPrSnapshot | null;
  /** Count of unresolved, non-outdated review threads. */
  openThreads: number;
  /** Merges already performed in this hour bucket. */
  mergesThisHour: number;
  /** Merges already performed in this sweep. */
  mergesThisSweep: number;
}

/**
 * THE merge gate. Pure, total, SYNCHRONOUS, and the single place the safety
 * argument lives.
 *
 * PURPOSE / PHILOSOPHY: making this a pure function of an explicit input record
 * is the whole point — every precondition in the module doc is one branch here,
 * each branch is directly unit-testable, and no I/O can hide a decision. The
 * order is deliberate: cheapest and most categorical refusals first (disabled,
 * paused, not ours), then state, then the guardrail hard stop BEFORE any check
 * inspection — so a PR that edits the gates is refused even if it is otherwise
 * flawless, and the transcript names that as the reason rather than something
 * incidental.
 *
 * DETERMINISM: this function is deliberately NOT `async`. It takes already-
 * fetched facts and returns a boolean; it cannot await, therefore it cannot
 * call a model, therefore no model output can produce a merge. Everything it
 * calls ({@link guardrailFilesIn}, {@link partitionChecks}) is synchronous and
 * pure for the same reason. Keep it that way — making this function `async`
 * would silently destroy the guarantee that a reviewer can verify by reading
 * one signature. `tests/steward.test.ts` asserts the signature stays sync.
 *
 * Every unknown resolves to a refusal. There is no input value for which this
 * function returns `merge: true` without having positively established all ten
 * preconditions.
 *
 * @param input The full decision record; see {@link MergeInputs}.
 * @returns `{merge, code, reason}` — never throws, never returns undefined.
 */
export function evaluateMerge(input: MergeInputs): MergeDecision {
  /**
   * Build a refusal. PURPOSE: every `return` below is a refusal with a code AND
   * a sentence, and funnelling them through one constructor is what makes that
   * uniformity impossible to forget.
   *
   * @param code Machine-readable refusal code.
   * @param reason One sentence of prose for the transcript.
   * @returns The refusing decision.
   */
  const no = (code: MergeCode, reason: string): MergeDecision => ({ merge: false, code, reason });

  if (!input.stewardEnabled) {
    return no('steward-disabled', 'the steward is not enabled for this repo (pd-fleet.yml `steward: true`)');
  }
  if (input.paused === null) {
    return no('pause-unreadable', 'could not read the fleet kill switch; refusing to merge on an unknown control state');
  }
  if (input.paused) {
    return no('fleet-paused', 'the fleet is paused by the operator (fleet:paused); the steward merges nothing while paused');
  }
  if (!input.pr) {
    return no('snapshot-unavailable', 'could not fetch the PR snapshot; refusing to merge on facts I could not establish');
  }
  if (!input.authorship) {
    return no('authorship-unknown', 'PR authorship could not be classified; the steward merges only PRs the fleet itself authored');
  }
  if (!input.authorship.fleetAuthored) {
    return no('not-fleet-authored', `this PR is not fleet-authored (${input.authorship.reason}); the steward never merges a human's PR`);
  }
  if (input.authorship.signal !== 'app-identity') {
    return no(
      'authorship-unknown',
      `authorship rests on the weak "${input.authorship.signal}" signal (${input.authorship.reason}); ` +
        'a merge requires confirmation from the App identity, not a branch name',
    );
  }
  if (input.pr.state !== 'OPEN') {
    return no('pr-not-open', `PR state is ${input.pr.state || 'unknown'}, not OPEN`);
  }
  if (input.pr.isDraft) {
    return no('pr-draft', 'the PR is a draft; a draft is an explicit "not yet"');
  }

  // HARD STOP — before anything else about health. Self-modification of the
  // guardrails is out of bounds regardless of how green the build is.
  const guardrails = guardrailFilesIn(input.pr.changedFiles);
  if (guardrails.length > 0) {
    return no(
      'guardrail-modification',
      `REFUSED LOUDLY: this PR modifies the fleet's own guardrails (${guardrails.join(', ')}). ` +
        'An agent that can land changes to the rules binding it is not bound by them. A human must merge this.',
    );
  }

  if (!input.pr.checksReported) {
    return no('no-checks-reported', 'no status checks were reported for the head commit; silence is not evidence of a green build');
  }
  const { pending, failing } = partitionChecks(input.pr.checks);
  if (failing.length > 0) {
    return no('checks-failing', `${failing.length} check(s) are not green: ${failing.slice(0, 5).join(', ')}`);
  }
  if (pending.length > 0) {
    return no('checks-pending', `${pending.length} check(s) are still running: ${pending.slice(0, 5).join(', ')}`);
  }

  if (input.pr.mergeable === 'UNKNOWN') {
    return no('mergeability-unknown', 'GitHub has not finished computing mergeability; the steward does not merge on a maybe');
  }
  if (input.pr.mergeable !== 'MERGEABLE') {
    return no('not-mergeable', `GitHub reports mergeable=${input.pr.mergeable} (conflicts must be resolved first)`);
  }
  if (input.pr.reviewDecision === 'CHANGES_REQUESTED') {
    return no('changes-requested', 'a reviewer requested changes and has not withdrawn that review');
  }
  if (input.openThreads > 0) {
    return no(
      'unresolved-thread',
      `${input.openThreads} review thread(s) are unresolved. The steward never merges over an unaddressed dispute; ` +
        'it may reply, but only a human resolving the thread clears it.',
    );
  }
  if (input.mergesThisSweep >= MAX_MERGES_PER_SWEEP) {
    return no('rate-limited', `already merged ${input.mergesThisSweep} PR(s) this sweep (cap ${MAX_MERGES_PER_SWEEP})`);
  }
  if (input.mergesThisHour >= MAX_MERGES_PER_HOUR) {
    return no('rate-limited', `already merged ${input.mergesThisHour} PR(s) this hour (cap ${MAX_MERGES_PER_HOUR})`);
  }

  return {
    merge: true,
    code: 'merge',
    reason:
      `all preconditions met: fleet-authored via App identity, open and not draft, no guardrail files, ` +
      `${input.pr.checks.length} check(s) green, mergeable, no changes-requested review, no unresolved threads`,
  };
}

// ---------------------------------------------------------------------------
// I/O layer

/** A PR the sweep should consider landing. */
export interface StewardCandidate {
  owner: string;
  repo: string;
  prNumber: number;
  installationId: number;
  /** Epoch ms the candidate was recorded, for staleness in the transcript. */
  recordedAt: number;
}

/**
 * KV key for one steward candidate.
 *
 * DESIGN: keyed by `owner/repo#pr` so the registry is naturally idempotent —
 * re-recording the same PR overwrites rather than duplicating, and the sweep
 * cannot process one PR twice in a page.
 *
 * @param c The candidate's identity (owner, repo, PR number).
 * @returns The full KV key, under {@link CANDIDATE_PREFIX}.
 */
function candidateKey(c: Pick<StewardCandidate, 'owner' | 'repo' | 'prNumber'>): string {
  return `${CANDIDATE_PREFIX}${c.owner}/${c.repo}#${c.prNumber}`;
}

/**
 * Register a fleet-authored PR for the steward's next sweep.
 *
 * MOTIVATION / DESIGN: the sweep needs to know WHICH PRs to look at, and there
 * is no cheap way to ask GitHub "every open PR my App authored, across every
 * installation". The executor already sees each fleet-authored PR exactly once,
 * at the moment it declines to self-review it — so that is where the candidate
 * is recorded. The registry is deliberately a KV key per PR with a TTL: it
 * self-cleans, it needs no schema migration, and a lost write costs a delayed
 * merge, never a wrong one.
 *
 * Best-effort: a KV failure is swallowed. The steward is an optimization on top
 * of a human merge, never a dependency of the review path that calls this.
 *
 * @param env Executor environment (uses the FLEET_TOKENS namespace).
 * @param candidate The PR to consider on the next sweep.
 * @returns Nothing; failures are intentionally invisible to the caller.
 */
export async function recordStewardCandidate(
  env: ExecutorEnv,
  candidate: StewardCandidate,
): Promise<void> {
  try {
    await env.FLEET_TOKENS.put(candidateKey(candidate), JSON.stringify(candidate), {
      expirationTtl: CANDIDATE_TTL_SECONDS,
    });
  } catch {
    /* best-effort registry; a missed candidate delays a merge, never forces one */
  }
}

/**
 * Drop a candidate once it is landed or terminally refused.
 *
 * PURPOSE: keeps the sweep's bounded page full of PRs that can still change
 * state, so a merged or closed PR cannot crowd out live work forever. Failures
 * are swallowed by design — the candidate's TTL collects it either way, and an
 * audit-only cleanup must never affect a merge outcome.
 *
 * @param env Executor environment (FLEET_TOKENS namespace).
 * @param c The candidate to forget.
 * @returns Nothing; deletion failures are intentionally invisible.
 */
async function forgetStewardCandidate(env: ExecutorEnv, c: StewardCandidate): Promise<void> {
  try {
    await env.FLEET_TOKENS.delete(candidateKey(c));
  } catch {
    /* the TTL will collect it anyway */
  }
}

/**
 * Read the operator kill switch for the STEWARD, which fails CLOSED.
 *
 * WHY THIS DIFFERS FROM execute.ts's reader: there, an unreadable switch means
 * "not paused" so the review gate keeps running — the fail-SAFE direction for a
 * gate. Here the action is a merge, so the same unreadable switch must mean
 * "do not act". Returning a tri-state (`null` = unknown) rather than a boolean
 * forces {@link evaluateMerge} to confront that difference explicitly instead of
 * inheriting the wrong default.
 *
 * @param env Executor environment carrying the optional CONTROL_KV binding.
 * @returns `true` paused, `false` running, `null` when it could not be read.
 */
export async function readPauseForSteward(env: ExecutorEnv): Promise<boolean | null> {
  // An ABSENT binding is a deployment shape, not a read failure: the executor
  // documents CONTROL_KV as optional and "absent ⇒ not paused". Treating an
  // unconfigured binding as unknown would disable the steward everywhere it is
  // deployed without the relay's KV, which is a different bug from a flaky read.
  if (!env.CONTROL_KV) return false;
  let raw: string | null;
  try {
    raw = await env.CONTROL_KV.get(PAUSE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return false;
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  try {
    return (JSON.parse(trimmed) as { paused?: boolean }).paused === true;
  } catch {
    // A corrupt flag is an unknown control state. For a merger that is a refusal.
    return null;
  }
}

/**
 * Current hour bucket key for a counter prefix.
 *
 * DESIGN: an ISO hour prefix (`2026-08-04T21`) makes the bucket self-describing
 * in a KV listing and lets the entry expire on its own — the rationale for
 * choosing a coarse time bucket over a sliding window is that a rate limit here
 * only needs to bound blast radius, not to be precise.
 *
 * @param prefix Counter family prefix (merges vs. branch updates).
 * @param now Epoch ms.
 * @returns The KV key for the hour containing `now`.
 */
function counterKey(prefix: string, now: number): string {
  return `${prefix}${new Date(now).toISOString().slice(0, 13)}`;
}

/**
 * Read one hourly action budget.
 *
 * DESIGN / HONEST LIMITATION: KV is eventually consistent, so under concurrent
 * sweeps this counter can undercount and let an hourly cap be exceeded
 * slightly. It is a budget, not a lock. The HARD bound is the per-sweep cap,
 * enforced from in-memory state within a single invocation, which cannot be
 * raced. Both are always checked.
 *
 * An unreadable counter returns `exhausted` — a budget we cannot read is
 * treated as spent, so the failure refuses rather than acts.
 *
 * @param env Executor environment (FLEET_TOKENS namespace).
 * @param prefix Counter key prefix (merges vs. branch updates).
 * @param exhausted The value to report when the read fails.
 * @param now Epoch ms, injectable for tests.
 * @returns Actions already performed in the current hour bucket.
 */
async function readBudget(
  env: ExecutorEnv,
  prefix: string,
  exhausted: number,
  now: number,
): Promise<number> {
  try {
    const raw = await env.FLEET_TOKENS.get(counterKey(prefix, now));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : exhausted;
  } catch {
    return exhausted;
  }
}

/**
 * Record one action against an hour bucket.
 *
 * PURPOSE: charges the budget only AFTER an action actually succeeded, so a
 * refused or failed attempt never consumes headroom. Best-effort by design: if
 * the write fails the cap is merely less tight for an hour, which is far
 * preferable to an accounting failure blocking real work.
 *
 * @param env Executor environment (FLEET_TOKENS namespace).
 * @param prefix Counter family prefix.
 * @param now Epoch ms, injectable for tests.
 * @returns Nothing; write failures are swallowed on purpose.
 */
async function bumpBudget(env: ExecutorEnv, prefix: string, now = Date.now()): Promise<void> {
  try {
    const current = await readBudget(env, prefix, 0, now);
    await env.FLEET_TOKENS.put(counterKey(prefix, now), String(current + 1), {
      expirationTtl: 2 * 60 * 60,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * How many merges this fleet has already performed in the current hour.
 *
 * @param env Executor environment (FLEET_TOKENS namespace).
 * @param now Epoch ms, injectable for tests.
 * @returns The count, or {@link MAX_MERGES_PER_HOUR} when unreadable — see
 *   {@link readBudget} for why an unreadable budget refuses.
 */
export async function readMergeBudget(env: ExecutorEnv, now = Date.now()): Promise<number> {
  return readBudget(env, MERGE_COUNTER_PREFIX, MAX_MERGES_PER_HOUR, now);
}

/**
 * How many branch updates this fleet has already pushed in the current hour.
 *
 * PURPOSE: branch updates get their own budget because their cost profile
 * differs from a merge's — nothing lands on the default branch, but each one
 * re-triggers a full CI run, so the design intent is a looser cap on a
 * different resource rather than sharing the merge allowance.
 *
 * @param env Executor environment (FLEET_TOKENS namespace).
 * @param now Epoch ms, injectable for tests.
 * @returns The count, or {@link MAX_UPDATES_PER_HOUR} when unreadable.
 */
export async function readUpdateBudget(env: ExecutorEnv, now = Date.now()): Promise<number> {
  return readBudget(env, UPDATE_COUNTER_PREFIX, MAX_UPDATES_PER_HOUR, now);
}

/**
 * Resolve the steward's reply-drafting model, refusing anything off Workers AI.
 *
 * PURPOSE / PHILOSOPHY: identical rationale to
 * {@link import('./xo.js').resolveXoModel} — the override is a plaintext var an
 * operator can swap per deploy, but ONLY a `@cf/` id is honored. A typo, a
 * pasted OpenAI id, or an `claude-*` id silently falls back to the Workers AI
 * default rather than routing this Worker's inference to a foreign provider.
 * The fleet's inference is Cloudflare-only by construction, not by promise, and
 * that property should not depend on an operator typing carefully.
 *
 * @param configured The `STEWARD_MODEL` var, if set.
 * @returns The configured id when it is a `@cf/` model, else
 *   {@link DEFAULT_STEWARD_MODEL}.
 */
export function resolveStewardModel(configured: string | undefined): string {
  if (typeof configured === 'string' && configured.trim().startsWith('@cf/')) {
    return configured.trim();
  }
  return DEFAULT_STEWARD_MODEL;
}

/**
 * Draft a reply to a dispute on Workers AI.
 *
 * PURPOSE: the reply must be a real answer — either "you are right, this test
 * misreads the contract and should go" or "the test is right, and here is the
 * obligation it enforces". A canned "thanks for the feedback" would technically
 * satisfy "reply on the thread" while betraying the purser's invitation to
 * argue, which is the whole point of the dispute channel.
 *
 * WORKERS AI ONLY — the call goes through the `env.AI` binding with a `@cf/`
 * id from {@link resolveStewardModel}. There is no Anthropic API, no
 * `@anthropic-ai` SDK, no `claude-*` id, and no Claude Code / external agent
 * runner anywhere in this module: the steward must work at 3am with no session
 * running anywhere. On any failure this returns a
 * short, honest fallback that states the machine could not compose a reasoned
 * answer, rather than inventing agreement. The merge stays blocked either way,
 * so a bad reply can never become a bad merge.
 *
 * @param env Executor environment (the `AI` binding).
 * @param dispute The thread the steward is answering.
 * @param prTitle Title of the fleet PR under dispute, for context.
 * @returns Markdown reply text; never throws, never empty.
 */
export async function draftDisputeReply(
  env: ExecutorEnv,
  dispute: PendingDispute,
  prTitle: string,
): Promise<string> {
  const fallback =
    `I could not compose a reasoned reply to this dispute automatically, so I am not going to ` +
    `pretend to one. I have NOT merged, and I will not merge while this thread is open — a human ` +
    `needs to weigh in on whether the test misreads the contract.`;
  try {
    const system =
      `You are the Port Daddy fleet's steward, replying to a reviewer who disputed a test on a ` +
      `machine-authored PR titled "${prTitle}". The PR's own body invited disputes "with reasons, ` +
      `if it misreads the contract" — honor that.\n\n` +
      `Reply in at most 120 words, in one of exactly two modes:\n` +
      `  (a) CONCEDE — the reviewer is right; say so plainly, say the test should be fixed or ` +
      `removed, and say WHY it misread the contract.\n` +
      `  (b) HOLD — the test is right; name the specific obligation it enforces and why the ` +
      `reviewer's reading would let that obligation go untested.\n\n` +
      `Never hedge between the two. Never claim you have run anything. Never claim the dispute is ` +
      `resolved — a human resolves the thread, not you. End by stating that you have not merged ` +
      `and will not merge while the thread is open. Output only the reply prose.`;
    const user = `File: ${dispute.path || '(unknown)'}\nReviewer: ${dispute.disputerLogin || '(unknown)'}\n\nTheir comment:\n${dispute.disputeBody.slice(0, 4000)}`;
    const res = await env.AI.run(
      resolveStewardModel(env.STEWARD_MODEL) as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: REPLY_MAX_TOKENS,
      },
      { extraHeaders: { 'x-session-affinity': 'pd-fleet-steward' } },
    );
    const { text } = extractAiText(res);
    const trimmed = (text ?? '').trim();
    return trimmed || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Merge a fleet PR — the ONLY place in this Worker that calls the merge API.
 *
 * WHY THE ASSERTIONS ARE REPEATED HERE: {@link evaluateMerge} already checked
 * fleet authorship and guardrail files, and this function checks them AGAIN
 * against the same snapshot before touching the network. That is not
 * belt-and-braces theater — it is the difference between "the current caller
 * checks" and "this cannot happen". A future refactor that adds a second call
 * site, or reorders the gate, cannot turn this into a function that merges a
 * human's PR: it throws instead.
 *
 * @param env Executor environment.
 * @param snapshot The PR snapshot the preconditions were evaluated against.
 * @param authorship The authorship verdict for that same snapshot.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param token Installation access token.
 * @returns GitHub's merge outcome.
 * @throws If invoked for a PR that is not fleet-authored on the strong signal,
 *   or whose diff touches the guardrails. These are programmer errors, and they
 *   are meant to be loud.
 */
export async function mergeFleetPr(
  env: ExecutorEnv,
  snapshot: StewardPrSnapshot,
  authorship: FleetAuthorship,
  owner: string,
  repo: string,
  token: string,
): Promise<{ merged: boolean; status: number; detail: string }> {
  assertFleetWriteAllowed('merge', snapshot, authorship, owner, repo);
  if (!snapshot.headSha) {
    throw new Error(
      `steward invariant violated: refusing to merge ${owner}/${repo}#${snapshot.number} — ` +
        'head sha unknown, so the merge cannot be pinned to the commit I evaluated',
    );
  }
  const outcome = await mergePullRequest(owner, repo, snapshot.number, snapshot.headSha, 'squash', token);
  if (outcome.merged) await bumpBudget(env, MERGE_COUNTER_PREFIX);
  return outcome;
}

// ---------------------------------------------------------------------------
// Branch freshness + body freshness
//
// MOTIVATION (operator, 2026-08): "do you automatically update PRs?" — no, and
// that was friction worth removing for the fleet's OWN PRs. A machine-authored
// branch can sit behind `main` until a conflict surfaces at the worst possible
// moment, and a body written when the branch was cut stops describing the diff
// as soon as anything is pushed. Both are chores the machine should absorb for
// its own work — and neither is ever performed on a human's PR.

/** Machine-readable reason a branch update was refused (or allowed). */
export type UpdateCode =
  | 'update'
  | 'steward-disabled'
  | 'fleet-paused'
  | 'pause-unreadable'
  | 'snapshot-unavailable'
  | 'not-fleet-authored'
  | 'authorship-unknown'
  | 'pr-not-open'
  | 'pr-draft'
  | 'guardrail-modification'
  | 'comparison-unavailable'
  | 'already-current'
  | 'would-conflict'
  | 'mergeability-unknown'
  | 'rate-limited';

/** The branch-update decision, with a code and a sentence of prose. */
export interface UpdateDecision {
  update: boolean;
  code: UpdateCode;
  reason: string;
}

/** Everything {@link evaluateBranchUpdate} is allowed to consider. */
export interface UpdateInputs {
  stewardEnabled: boolean;
  /** Kill switch. `null` means UNREADABLE, which refuses. */
  paused: boolean | null;
  authorship: FleetAuthorship | null;
  pr: StewardPrSnapshot | null;
  /** Base-vs-head comparison, or `null` when it could not be established. */
  comparison: BranchComparison | null;
  updatesThisHour: number;
  updatesThisSweep: number;
}

/**
 * Should the steward refresh this PR's branch from its base?
 *
 * PURPOSE / DESIGN: a second pure gate, deliberately sharing the merge gate's
 * safety envelope rather than inheriting a weaker one. Updating a branch is a
 * WRITE — it pushes a commit and re-runs the tenant's whole CI — so it demands
 * the same opt-in, the same kill switch, the same strong `app-identity`
 * authorship, the same open/non-draft state, and the same guardrail hard stop.
 * The only relaxation is the check state: a stale branch's checks are stale by
 * definition, so requiring them green before refreshing would be a deadlock.
 *
 * CONFLICTS ARE A REFUSAL, NOT A TASK. `CONFLICTING` mergeability stops the
 * update with a code that says so, and `UNKNOWN` stops it too — the steward
 * does not push a merge commit into a branch whose merge outcome GitHub has not
 * finished computing. Resolving conflicts is left to a human or a follow-up
 * agent, because a machine guessing at a conflict resolution is a machine
 * silently authoring code in exactly the place two changes already disagreed.
 *
 * @param input The full decision record; see {@link UpdateInputs}.
 * @returns `{update, code, reason}` — never throws.
 */
export function evaluateBranchUpdate(input: UpdateInputs): UpdateDecision {
  /**
   * Build a refusal. PURPOSE: mirrors {@link evaluateMerge}'s constructor so
   * both gates report refusals in one shape, by design.
   *
   * @param code Machine-readable refusal code.
   * @param reason One sentence of prose for the transcript.
   * @returns The refusing decision.
   */
  const no = (code: UpdateCode, reason: string): UpdateDecision => ({ update: false, code, reason });

  if (!input.stewardEnabled) {
    return no('steward-disabled', 'the steward is not enabled for this repo (pd-fleet.yml `steward: true`)');
  }
  if (input.paused === null) {
    return no('pause-unreadable', 'could not read the fleet kill switch; refusing to push on an unknown control state');
  }
  if (input.paused) {
    return no('fleet-paused', 'the fleet is paused by the operator; the steward pushes nothing while paused');
  }
  if (!input.pr) {
    return no('snapshot-unavailable', 'could not fetch the PR snapshot; refusing to push against facts I could not establish');
  }
  if (!input.authorship) {
    return no('authorship-unknown', 'PR authorship could not be classified; the steward only touches PRs the fleet authored');
  }
  if (!input.authorship.fleetAuthored) {
    return no('not-fleet-authored', `this PR is not fleet-authored (${input.authorship.reason}); the steward never pushes to a human's branch`);
  }
  if (input.authorship.signal !== 'app-identity') {
    return no(
      'authorship-unknown',
      `authorship rests on the weak "${input.authorship.signal}" signal; a push requires App-identity confirmation`,
    );
  }
  if (input.pr.state !== 'OPEN') return no('pr-not-open', `PR state is ${input.pr.state || 'unknown'}, not OPEN`);
  if (input.pr.isDraft) return no('pr-draft', 'the PR is a draft; the steward leaves drafts alone');

  const guardrails = guardrailFilesIn(input.pr.changedFiles);
  if (guardrails.length > 0) {
    return no(
      'guardrail-modification',
      `REFUSED LOUDLY: this PR modifies the fleet's own guardrails (${guardrails.join(', ')}); the steward will not touch it at all`,
    );
  }

  if (input.pr.mergeable === 'CONFLICTING') {
    return no(
      'would-conflict',
      'the PR conflicts with its base. The steward does NOT guess at conflict resolutions — ' +
        'a human or a follow-up agent needs to rebase this branch.',
    );
  }
  if (input.pr.mergeable === 'UNKNOWN') {
    return no('mergeability-unknown', 'GitHub has not finished computing mergeability; refusing to push on a maybe');
  }
  if (!input.comparison) {
    return no('comparison-unavailable', 'could not compare the head branch to its base; staleness is unknown, so nothing is pushed');
  }
  if (input.comparison.behindBy <= 0) {
    return no('already-current', 'the branch already contains every commit on its base');
  }
  if (input.updatesThisSweep >= MAX_UPDATES_PER_SWEEP) {
    return no('rate-limited', `already updated ${input.updatesThisSweep} branch(es) this sweep (cap ${MAX_UPDATES_PER_SWEEP})`);
  }
  if (input.updatesThisHour >= MAX_UPDATES_PER_HOUR) {
    return no('rate-limited', `already updated ${input.updatesThisHour} branch(es) this hour (cap ${MAX_UPDATES_PER_HOUR})`);
  }

  return {
    update: true,
    code: 'update',
    reason: `the branch is ${input.comparison.behindBy} commit(s) behind ${input.pr.baseRef || 'its base'} and merges cleanly`,
  };
}

/**
 * Append one honest line to a fleet PR body's machine-maintained log.
 *
 * MOTIVATION: once the steward pushes to a branch, the description written when
 * the branch was cut no longer describes the diff. Rather than regenerate prose
 * — which risks a machine quietly rewriting a claim into something it prefers —
 * the body gains an APPEND-ONLY log of what the machine did to it. Additive
 * beats revisionist: the original claim stays legible and readers can see
 * exactly what changed after it.
 *
 * FORMAT INVARIANT (load-bearing): every entry begins with `- `, so no entry can
 * ever parse as a `Roadmap-Item:`-style trailer. `lib/roadmap-link-core.ts`
 * takes the LAST matching trailer in the body, so an entry that accidentally
 * looked like one would silently retarget the roadmap gate. The tests re-run
 * the real guard scripts against a body with a log appended for exactly this
 * reason.
 *
 * @param body The current PR body (may be empty or lack a log section).
 * @param entry One line of prose describing what the steward just did.
 * @param now Epoch ms for the timestamp, injectable for deterministic tests.
 * @returns The new body, with the log section created or extended and trimmed
 *   to {@link MAX_CHANGELOG_ENTRIES}.
 */
export function appendStewardChangelog(body: string, entry: string, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  const line = `- ${stamp}Z — ${entry.replace(/\s+/g, ' ').trim()}`;
  const base = String(body ?? '');
  const markerAt = base.indexOf(CHANGELOG_MARKER);

  if (markerAt === -1) {
    const header =
      `${CHANGELOG_MARKER}\n**Steward log** — machine-maintained, append-only. This PR is ` +
      `fleet-authored; the steward records here anything it pushes so the description never ` +
      `silently describes an older diff.\n`;
    return `${base.trimEnd()}\n\n${header}\n${line}\n`;
  }

  const head = base.slice(0, markerAt + CHANGELOG_MARKER.length);
  const tail = base.slice(markerAt + CHANGELOG_MARKER.length);
  const tailLines = tail.split('\n');
  const entries = tailLines.filter(l => l.startsWith('- '));
  const preamble = tailLines.filter(l => !l.startsWith('- ') && l.trim()).join('\n');
  const kept = [...entries, line].slice(-MAX_CHANGELOG_ENTRIES);
  return `${head}\n${preamble}\n\n${kept.join('\n')}\n`;
}

/**
 * Refresh a fleet PR's branch from its base — the ONLY branch-update call site.
 *
 * WHY THE ASSERTIONS REPEAT {@link evaluateBranchUpdate}: same reasoning as
 * {@link mergeFleetPr}. A precondition enforced only by the current caller is
 * one refactor from being enforced nowhere. This function is incapable of
 * pushing to a PR that is not fleet-authored on the strong signal, or whose
 * diff touches the guardrails — it throws instead.
 *
 * @param env Executor environment (for the rate-limit counter).
 * @param snapshot The PR snapshot the decision was evaluated against.
 * @param authorship The authorship verdict for that same snapshot.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param token Installation access token.
 * @returns GitHub's outcome, including whether it refused for a conflict.
 * @throws When invoked outside the safety envelope — deliberately loud.
 */
export async function updateFleetPrBranch(
  env: ExecutorEnv,
  snapshot: StewardPrSnapshot,
  authorship: FleetAuthorship,
  owner: string,
  repo: string,
  token: string,
): Promise<{ updated: boolean; conflicted: boolean; status: number; detail: string }> {
  assertFleetWriteAllowed('update the branch of', snapshot, authorship, owner, repo);
  const outcome = await updatePullRequestBranch(owner, repo, snapshot.number, snapshot.headSha, token);
  if (outcome.updated) await bumpBudget(env, UPDATE_COUNTER_PREFIX);
  return outcome;
}

/**
 * Record a steward-authored push in a fleet PR's body — the ONLY body-edit site.
 *
 * PURPOSE / SCOPE: fleet-authored PRs only, asserted here and not merely at the
 * caller. A human's PR description is their words; the steward has no business
 * editing them, and the design intent is that this function throws rather than
 * trusting that no future caller will ever point it at one.
 *
 * @param snapshot The PR snapshot (supplies the body being appended to).
 * @param authorship The authorship verdict for that snapshot.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param entry What the steward just did, in one honest sentence.
 * @param token Installation access token.
 * @param now Epoch ms for the log timestamp.
 * @returns True when GitHub accepted the body edit.
 * @throws When invoked outside the safety envelope — deliberately loud.
 */
export async function refreshFleetPrBody(
  snapshot: StewardPrSnapshot,
  authorship: FleetAuthorship,
  owner: string,
  repo: string,
  entry: string,
  token: string,
  now = Date.now(),
): Promise<boolean> {
  assertFleetWriteAllowed('edit the body of', snapshot, authorship, owner, repo);
  const next = appendStewardChangelog(snapshot.body, entry, now);
  return updatePullRequestBody(owner, repo, snapshot.number, next, token);
}

/**
 * The shared write-invariant assertion behind every steward mutation.
 *
 * PURPOSE: merge, branch update, and body edit are three different writes with
 * one identical precondition — this PR belongs to the fleet, confirmed by App
 * identity, and its diff does not touch the guardrails. Factoring the assertion
 * out means a fourth write added later cannot accidentally ship with a weaker
 * version of it, and the failure message names the operation so a thrown
 * invariant is diagnosable from the transcript alone.
 *
 * @param operation Human-readable verb phrase, e.g. `merge`.
 * @param snapshot The PR being written to.
 * @param authorship The authorship verdict for that snapshot.
 * @param owner Repository owner (for the message).
 * @param repo Repository name (for the message).
 * @throws Always, when any part of the envelope is unmet.
 */
function assertFleetWriteAllowed(
  operation: string,
  snapshot: StewardPrSnapshot,
  authorship: FleetAuthorship,
  owner: string,
  repo: string,
): void {
  const where = `${owner}/${repo}#${snapshot.number}`;
  if (!authorship.fleetAuthored || authorship.signal !== 'app-identity') {
    throw new Error(
      `steward invariant violated: refusing to ${operation} ${where} — ` +
        `authorship signal "${authorship.signal}" (${authorship.reason})`,
    );
  }
  const guardrails = guardrailFilesIn(snapshot.changedFiles);
  if (guardrails.length > 0) {
    throw new Error(
      `steward invariant violated: refusing to ${operation} ${where} — ` +
        `diff touches the fleet's own guardrails (${guardrails.join(', ')})`,
    );
  }
}

/** Result of one candidate's pass through the steward. */
export interface StewardPassResult {
  owner: string;
  repo: string;
  prNumber: number;
  decision: MergeDecision;
  merged: boolean;
  /** Number of dispute replies posted this pass. */
  repliesPosted: number;
  /** The branch-freshness decision, when one was reached this pass. */
  updateDecision?: UpdateDecision;
  /** True when the steward pushed a base merge into the head branch. */
  branchUpdated: boolean;
  /** True when the candidate should be dropped from the registry. */
  terminal: boolean;
}

/**
 * Run the steward against ONE candidate PR.
 *
 * DESIGN: fetch → classify → decide → (reply) → (merge). Replies are attempted
 * BEFORE the merge decision is acted on but AFTER it is computed, so the
 * transcript records the same refusal a reader would compute by hand, and so a
 * reply can never be mistaken for a precondition that the reply itself cleared.
 *
 * Never throws for ordinary failures — a repo whose config is unreadable, whose
 * snapshot 500s, or whose token is stale yields a refusal with a code, not an
 * exception that would abort the sweep for every other repo.
 *
 * @param env Executor environment.
 * @param candidate The PR to consider.
 * @param transcript Best-effort step recorder (same shape the ships use).
 * @param mergesThisSweep Merges already performed in this sweep, for the cap.
 * @returns What happened, including the decision and whether to forget the PR.
 */
export async function runStewardPass(
  env: ExecutorEnv,
  candidate: StewardCandidate,
  transcript: TranscriptLike,
  mergesThisSweep: number,
  updatesThisSweep = 0,
): Promise<StewardPassResult> {
  const { owner, repo, prNumber } = candidate;
  const base = {
    owner,
    repo,
    prNumber,
    merged: false,
    repliesPosted: 0,
    branchUpdated: false,
    terminal: false,
  };

  /**
   * Record a refusal in the transcript and shape the pass result.
   *
   * PURPOSE: the steward's most valuable output is the REASON it did not merge.
   * Routing every non-merge exit through one recorder is the design that makes
   * "why has this PR not landed?" answerable by reading, not by re-deriving.
   *
   * @param decision The refusing decision.
   * @param terminal Whether the candidate should be dropped from the registry.
   * @param extra Additional transcript detail for this refusal.
   * @returns The pass result carrying that decision.
   */
  const refuse = async (
    decision: MergeDecision,
    terminal = false,
    extra: Record<string, unknown> = {},
  ): Promise<StewardPassResult> => {
    await transcript.step(
      'steward-decision',
      'steward',
      `steward: ${owner}/${repo}#${prNumber} NOT merged — ${decision.code}`,
      { owner, repo, prNumber, code: decision.code, reason: decision.reason, ...extra },
    );
    return { ...base, decision, terminal };
  };

  // Kill switch first: cheapest, and the most categorical.
  const paused = await readPauseForSteward(env);
  if (paused !== false) {
    return refuse(
      evaluateMerge({
        stewardEnabled: true,
        paused,
        authorship: null,
        pr: null,
        openThreads: 0,
        mergesThisHour: 0,
        mergesThisSweep,
      }),
    );
  }

  let token: string;
  try {
    token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      candidate.installationId,
      env.FLEET_TOKENS,
    );
  } catch (err) {
    return refuse({
      merge: false,
      code: 'snapshot-unavailable',
      reason: `could not mint an installation token (${String(err).slice(0, 120)})`,
    });
  }

  // ZERO-TRUST: consent is read from the TRUSTED default branch, never PR head.
  const branch = env.DEFAULT_BRANCH || 'main';
  let stewardEnabled = false;
  try {
    const yaml = await fetchRepoFile(owner, repo, 'pd-fleet.yml', branch, token);
    stewardEnabled = yaml ? parseFleetSteward(yaml) : false;
  } catch {
    // Unreadable config is not consent. Refuse rather than assume opted-in.
    stewardEnabled = false;
  }

  const snapshot = await fetchStewardPrSnapshot(owner, repo, prNumber, token);
  const fleetAppLogin = await resolveFleetAppLogin(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.FLEET_TOKENS,
  );
  const authorship = snapshot
    ? classifyPrAuthorship({
        authorLogin: snapshot.authorLogin,
        authorType: snapshot.authorType,
        headRef: snapshot.headRef,
        fleetAppLogin,
      })
    : null;

  const { needsReply, openThreads } = classifyDisputes(snapshot?.threads, fleetAppLogin);
  const mergesThisHour = await readMergeBudget(env);

  const decision = evaluateMerge({
    stewardEnabled,
    paused: false,
    authorship,
    pr: snapshot,
    openThreads,
    mergesThisHour,
    mergesThisSweep,
  });

  // Answer disputes even when (especially when) the merge is refused — but only
  // on PRs the fleet actually authored and is allowed to steward, so the
  // steward never starts arguing on a stranger's PR.
  let repliesPosted = 0;
  if (stewardEnabled && snapshot && authorship?.fleetAuthored && needsReply.length > 0) {
    for (const dispute of needsReply) {
      if (dispute.rootCommentId === null) continue;
      const body = await draftDisputeReply(env, dispute, snapshot.title);
      const ok = await replyToReviewThread(owner, repo, prNumber, dispute.rootCommentId, body, token);
      if (ok) repliesPosted += 1;
      await transcript.step(
        'steward-dispute-reply',
        'steward',
        ok
          ? `steward: replied to a dispute on ${owner}/${repo}#${prNumber} (${dispute.path || 'thread'})`
          : `steward: dispute reply FAILED to post on ${owner}/${repo}#${prNumber}`,
        {
          owner,
          repo,
          prNumber,
          path: dispute.path,
          disputer: dispute.disputerLogin,
          posted: ok,
          // The reply never unblocks the merge — recorded so the transcript
          // cannot be misread as "answered, therefore merged".
          clearsMerge: false,
        },
      );
    }
  }

  // --- BRANCH FRESHNESS ---------------------------------------------------
  // Attempted BEFORE acting on the merge decision, because a successful update
  // changes the head commit — and every precondition above was evaluated
  // against the OLD one. So an update ends the pass: the next sweep re-derives
  // everything against the commit that now exists. Merging after a push we just
  // made would be merging a diff whose checks have not run.
  const wantsCompare =
    stewardEnabled && !!snapshot && authorship?.fleetAuthored === true && snapshot.state === 'OPEN';
  const comparison = wantsCompare
    ? await compareBranches(owner, repo, snapshot!.baseRef, snapshot!.headRef, token)
    : null;
  const updateDecision = evaluateBranchUpdate({
    stewardEnabled,
    paused: false,
    authorship,
    pr: snapshot,
    comparison,
    updatesThisHour: wantsCompare ? await readUpdateBudget(env) : 0,
    updatesThisSweep,
  });

  if (updateDecision.update) {
    const outcome = await updateFleetPrBranch(env, snapshot!, authorship!, owner, repo, token);
    await transcript.step(
      'steward-branch-update',
      'steward',
      outcome.updated
        ? `steward: refreshed ${owner}/${repo}#${prNumber} from ${snapshot!.baseRef}`
        : `steward: branch refresh NOT applied to ${owner}/${repo}#${prNumber}` +
          (outcome.conflicted ? ' — CONFLICT, left for a human' : ''),
      {
        owner,
        repo,
        prNumber,
        updated: outcome.updated,
        conflicted: outcome.conflicted,
        status: outcome.status,
        detail: outcome.detail,
        behindBy: comparison?.behindBy ?? null,
        // An update invalidates the merge evaluation above; recorded so the
        // transcript cannot be read as "refreshed, therefore ready".
        mergeDeferredToNextSweep: outcome.updated,
      },
    );
    if (outcome.updated) {
      // Body freshness: the description was written for the pre-update diff.
      // Append-only, fleet-authored PRs only, asserted inside the call.
      const noted = await refreshFleetPrBody(
        snapshot!,
        authorship!,
        owner,
        repo,
        `steward merged \`${snapshot!.baseRef}\` into this branch (it was ` +
          `${comparison?.behindBy ?? 'some'} commit(s) behind). No files were resolved by hand; ` +
          `CI re-runs against the new head.`,
        token,
      );
      const deferred: MergeDecision = {
        merge: false,
        code: 'checks-pending',
        reason:
          'the branch was just refreshed from its base, so the commit evaluated above no longer ' +
          'exists; the next sweep re-derives every precondition against the new head',
      };
      const result = await refuse(deferred, false, { repliesPosted, bodyNoteAdded: noted });
      return { ...result, repliesPosted, branchUpdated: true, updateDecision };
    }
    if (outcome.conflicted) {
      const blocked: MergeDecision = {
        merge: false,
        code: 'not-mergeable',
        reason:
          'refreshing this branch from its base would CONFLICT. The steward does not guess at ' +
          'conflict resolutions — a human or a follow-up agent must rebase it.',
      };
      const result = await refuse(blocked, false, { repliesPosted, conflicted: true });
      return { ...result, repliesPosted, updateDecision };
    }
  }

  if (!decision.merge) {
    // A closed/merged PR is terminal — stop re-inspecting it every sweep.
    const terminal = decision.code === 'pr-not-open';
    const result = await refuse(decision, terminal, { repliesPosted, updateCode: updateDecision.code });
    return { ...result, repliesPosted, updateDecision };
  }

  // Non-null by construction: `merge: true` requires both.
  const outcome = await mergeFleetPr(env, snapshot!, authorship!, owner, repo, token);
  await transcript.step(
    'steward-merge',
    'steward',
    outcome.merged
      ? `steward: MERGED ${owner}/${repo}#${prNumber}`
      : `steward: merge REJECTED by GitHub for ${owner}/${repo}#${prNumber} (${outcome.status})`,
    {
      owner,
      repo,
      prNumber,
      merged: outcome.merged,
      status: outcome.status,
      detail: outcome.detail,
      headSha: snapshot!.headSha,
      reason: decision.reason,
    },
  );
  return {
    ...base,
    decision,
    merged: outcome.merged,
    repliesPosted,
    updateDecision,
    terminal: outcome.merged,
  };
}

/**
 * One cron sweep: inspect up to {@link MAX_CANDIDATES_PER_SWEEP} registered
 * fleet PRs and land the ones that clear every precondition.
 *
 * DESIGN / MOTIVATION: bounded by construction. The sweep reads a capped page
 * of candidates, stops merging at {@link MAX_MERGES_PER_SWEEP}, and keeps
 * evaluating the rest only so their refusals are recorded — a stuck PR should
 * produce a legible "why not" every sweep, not silence. Individual candidate
 * failures are isolated so one bad repo cannot starve the others.
 *
 * @param env Executor environment.
 * @param transcript Best-effort step recorder for the sweep's audit trail.
 * @returns Per-candidate results, in the order they were inspected.
 */
export async function runStewardSweep(
  env: ExecutorEnv,
  transcript: TranscriptLike,
): Promise<StewardPassResult[]> {
  let keys: Array<{ name: string }> = [];
  try {
    const listed = await env.FLEET_TOKENS.list({
      prefix: CANDIDATE_PREFIX,
      limit: MAX_CANDIDATES_PER_SWEEP,
    });
    keys = listed.keys ?? [];
  } catch (err) {
    await transcript.step('steward-sweep', 'steward', 'steward: candidate list unavailable', {
      error: String(err).slice(0, 200),
    });
    return [];
  }

  const results: StewardPassResult[] = [];
  let merged = 0;
  let updated = 0;
  for (const key of keys) {
    let candidate: StewardCandidate | null = null;
    try {
      const raw = await env.FLEET_TOKENS.get(key.name);
      candidate = raw ? (JSON.parse(raw) as StewardCandidate) : null;
    } catch {
      candidate = null;
    }
    if (
      !candidate ||
      typeof candidate.owner !== 'string' ||
      typeof candidate.repo !== 'string' ||
      typeof candidate.prNumber !== 'number' ||
      typeof candidate.installationId !== 'number'
    ) {
      // A corrupt registry entry is dropped, never guessed at.
      try {
        await env.FLEET_TOKENS.delete(key.name);
      } catch {
        /* TTL collects it */
      }
      continue;
    }

    try {
      const result = await runStewardPass(env, candidate, transcript, merged, updated);
      if (result.merged) merged += 1;
      if (result.branchUpdated) updated += 1;
      if (result.terminal) await forgetStewardCandidate(env, candidate);
      results.push(result);
    } catch (err) {
      // Includes the mergeFleetPr invariant throws — loud in the transcript,
      // and isolated so one candidate cannot abort the sweep.
      await transcript.step(
        'steward-error',
        'steward',
        `steward: pass FAILED for ${candidate.owner}/${candidate.repo}#${candidate.prNumber}`,
        { error: String(err).slice(0, 300) },
      );
    }
  }

  await transcript.step(
    'steward-sweep',
    'steward',
    `steward: sweep complete (${merged} merged, ${updated} branch(es) refreshed)`,
    { inspected: keys.length, merged, updated },
  );
  return results;
}
