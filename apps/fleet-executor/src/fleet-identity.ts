/**
 * Who wrote this PR — the fleet, or someone else?
 *
 * MOTIVATION. Two behaviors in this Worker turn on that one question, and they
 * have OPPOSITE failure costs, so they must not share a sloppy answer:
 *
 *   1. SELF-REVIEW SKIP (src/execute.ts). The fleet must not review its own
 *      output. Left unguarded, the full roster reviewed the purser's own
 *      adversarial-test branches and filed findings on them — pd-qa was filing
 *      6–11 findings per round on this repo's PRs, several of them
 *      hallucinated, on code the fleet itself had just written. Getting this
 *      wrong in the permissive direction burns money and pollutes PRs with
 *      machine noise; getting it wrong in the restrictive direction means a
 *      HUMAN's PR goes unreviewed, which is worse.
 *   2. AUTO-MERGE (src/steward.ts). The steward may merge ONLY branches the
 *      fleet authored. Getting this wrong means a machine merges a human's PR.
 *      That is the single worst outcome in this file's blast radius.
 *
 * DESIGN — identity first, branch name second, never branch name alone.
 * `pull_request.head.ref` is attacker-controlled: anyone with push access can
 * open a PR from a branch literally named `purser/pr-1-tests`. So the branch
 * prefix is only ever a CORROBORATING signal. The authoritative signal is the
 * PR author being the fleet's own GitHub App bot user, resolved from the
 * credentials this Worker actually holds (`GET /app` under the App JWT) rather
 * than from any value the PR can influence. A human account (`type: "User"`)
 * never matches, whatever it names its branch.
 *
 * FAIL DIRECTION. When the app identity cannot be resolved (network failure,
 * missing permission) the two callers diverge deliberately, and the classifier
 * reports which signal it used so each can decide:
 *   - the review skip accepts the weaker `bot-and-branch` signal — the cost of
 *     a false positive is one unreviewed machine branch;
 *   - the steward REFUSES on anything but `app-identity` — see
 *     `steward.ts#evaluateMerge`, which treats `authorship-unknown` as a hard
 *     stop. Fail-closed where it matters.
 */

/**
 * Branch prefixes the fleet itself creates: `purser/pr-<n>-tests` (adversarial
 * test branches, src/purser.ts) and `fleet/<ship>-pr-<n>-<slug>` (stacked fix
 * proposals, src/execute.ts). SECONDARY SIGNAL ONLY — see the module doc.
 */
export const FLEET_BRANCH_PREFIXES = ['purser/', 'fleet/'] as const;

/** How confident the classifier is, and on what evidence. */
export type AuthorshipSignal =
  /** The PR author IS the fleet's own App bot user. Authoritative. */
  | 'app-identity'
  /** A bot authored it from a fleet-shaped branch, but the App login was unresolvable. */
  | 'bot-and-branch'
  /** Not the fleet. */
  | 'none';

/** The classifier's verdict, with the evidence that produced it. */
export interface FleetAuthorship {
  /** True when this PR should be treated as fleet-authored. */
  fleetAuthored: boolean;
  /** Which evidence carried the decision. */
  signal: AuthorshipSignal;
  /** One-line, human-legible justification for a transcript or check summary. */
  reason: string;
  /** True when the head branch carries a fleet prefix (corroboration only). */
  branchMatches: boolean;
}

/** Everything the classifier is allowed to look at. */
export interface AuthorshipInput {
  /** `pull_request.user.login`, e.g. `port-daddy[bot]`. */
  authorLogin: string | null | undefined;
  /**
   * `pull_request.user.type` — GitHub reports `Bot` for App-authored PRs and
   * `User` for humans. A human NEVER passes, regardless of branch name.
   */
  authorType: string | null | undefined;
  /** `pull_request.head.ref`. Untrusted: corroborating evidence only. */
  headRef: string | null | undefined;
  /**
   * The fleet App's own bot login (`<app-slug>[bot]`), resolved from this
   * Worker's own credentials. `null` when it could not be determined — which
   * DOWNGRADES the verdict rather than guessing.
   */
  fleetAppLogin: string | null | undefined;
}

/**
 * True when a head ref sits under one of the fleet's own branch prefixes.
 *
 * PURPOSE: isolates the one piece of evidence an attacker controls, so the
 * design intent — "branch name is corroboration, never proof" — is visible as a
 * separate, deliberately small function rather than buried in the classifier.
 *
 * @param headRef The PR's head branch name; null/empty is not a match.
 * @returns True when the ref starts with a {@link FLEET_BRANCH_PREFIXES} entry.
 */
function hasFleetBranchPrefix(headRef: string | null | undefined): boolean {
  if (typeof headRef !== 'string' || !headRef) return false;
  return FLEET_BRANCH_PREFIXES.some(p => headRef.startsWith(p));
}

/**
 * Decide whether a PR was authored by this fleet.
 *
 * PURPOSE: give both callers ONE answer plus the evidence behind it, so the
 * self-review skip and the auto-merge gate can apply different risk appetites
 * to the same classification instead of each re-deriving it (and drifting).
 * Pure — no I/O, no clock, trivially unit-testable.
 *
 * The decision table, in order:
 *   - not a Bot                       → `none`            (humans never match)
 *   - App login known and equal       → `app-identity`    (authoritative)
 *   - App login known and NOT equal   → `none`            (another bot, e.g.
 *                                        dependabot, even on a `fleet/` branch)
 *   - App login unknown + fleet branch→ `bot-and-branch`  (weak; steward refuses)
 *   - App login unknown + other branch→ `none`
 *
 * @param input Author login/type, head ref, and the fleet's own App login.
 * @returns The verdict plus the signal and a reason string for the transcript.
 */
export function classifyPrAuthorship(input: AuthorshipInput): FleetAuthorship {
  const login = (input.authorLogin ?? '').trim();
  const type = (input.authorType ?? '').trim();
  const branchMatches = hasFleetBranchPrefix(input.headRef);
  const appLogin = (input.fleetAppLogin ?? '').trim();

  // A human is never the fleet. This is the line that stops a person opening a
  // PR from a branch called `purser/pr-1-tests` and inheriting machine trust.
  if (type.toLowerCase() !== 'bot') {
    return {
      fleetAuthored: false,
      signal: 'none',
      reason: login
        ? `author ${login} is type "${type || 'unknown'}", not the fleet's App bot`
        : 'PR author is unknown; treated as not fleet-authored',
      branchMatches,
    };
  }

  if (appLogin) {
    if (login.toLowerCase() === appLogin.toLowerCase()) {
      return {
        fleetAuthored: true,
        signal: 'app-identity',
        reason: `authored by the fleet's own GitHub App (${login})${
          branchMatches ? ` on a fleet branch (${input.headRef})` : ''
        }`,
        branchMatches,
      };
    }
    return {
      fleetAuthored: false,
      signal: 'none',
      reason: `author ${login || '(unknown)'} is a bot but not this fleet's App (${appLogin})`,
      branchMatches,
    };
  }

  // App login unresolvable. Accept only the corroborated weak signal, and LABEL
  // it weak so the steward can refuse while the review skip may accept.
  if (branchMatches) {
    return {
      fleetAuthored: true,
      signal: 'bot-and-branch',
      reason:
        `bot author ${login || '(unknown)'} on fleet-prefixed branch ${input.headRef}; ` +
        `the fleet App login could not be resolved, so this is a WEAK signal`,
      branchMatches,
    };
  }

  return {
    fleetAuthored: false,
    signal: 'none',
    reason: `bot author ${login || '(unknown)'} on non-fleet branch ${input.headRef ?? '(unknown)'}`,
    branchMatches,
  };
}
