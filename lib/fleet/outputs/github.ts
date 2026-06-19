/**
 * GitHub output sink — posts PR comments, opens issues, opens draft PRs.
 *
 * This is the canonical "template" for output sinks: the personal-agent
 * sinks (notify, calendar, email, etc.) follow the same shape.
 *
 * Relationship to lib/fleet/github-output.ts
 * ─────────────────────────────────────────
 * The existing `github-output.ts` is the operator-facing helper that
 * actually shells out to `gh` (or to Octokit when the PD GitHub App
 * lands). The new sink here is the *router-side* adapter: it exposes
 * the uniform `OutputSink` contract so a `pd-fleet.yml`'s
 * `outputs: [github:pr-comment]` entry can dispatch through the same
 * pipeline that handles `outputs: [notify:os, calendar:create-event]`.
 *
 * For now we leave the actual GitHub API call STUBBED in this sink — a
 * follow-up will have it delegate to `github-output.ts` so there's one
 * code path that talks to GitHub. Splitting the work this way keeps
 * this PR additive (no behavior change for existing fleets).
 *
 * Subtypes (the part after the colon in `github:<subtype>`):
 *   pr-comment   — comment on an existing PR
 *   issue        — open a new issue
 *   draft-pr     — open a draft pull request
 */

import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export class GitHubOutputSink implements OutputSink {
  readonly kind = 'github' as const;

  async available(): Promise<OutputAvailability> {
    const hasToken = Boolean(process.env.PD_GITHUB_TOKEN || process.env.GITHUB_TOKEN);
    if (!hasToken) {
      return {
        ready: false,
        reason: 'GitHub output requires PD_GITHUB_TOKEN (or GITHUB_TOKEN) with repo scope.',
        requires: ['PD_GITHUB_TOKEN'],
      };
    }
    return { ready: true };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'github') {
      throw new Error(`GitHubOutputSink received payload for sink="${payload.sink}"`);
    }
    switch (payload.type) {
      case 'pr-comment':
        return this.postPrComment(payload);
      case 'issue':
        return this.openIssue(payload);
      case 'draft-pr':
        return this.openDraftPr(payload);
      default:
        throw new Error(`GitHubOutputSink: unknown subtype "${payload.type}"`);
    }
  }

  // ── stubs ──────────────────────────────────────────────────────────────

  /**
   * STUBBED. Real implementation posts via Octokit:
   *   octokit.rest.issues.createComment({ owner, repo, issue_number, body })
   * Operator setup: PD_GITHUB_TOKEN + PD_GITHUB_REPO_DEFAULT (or payload
   * provides the repo via `extras.owner` + `extras.repo` + `extras.issue_number`).
   */
  private async postPrComment(payload: OutputPayload): Promise<OutputResult> {
    return {
      url: `https://github.com/${payload.extras?.owner ?? 'owner'}/${payload.extras?.repo ?? 'repo'}/pull/${payload.extras?.issue_number ?? 0}#stub`,
      id: 'stub',
      deliveredAt: Date.now(),
      receipt: { stubbed: true, body: payload.body },
    };
  }

  private async openIssue(payload: OutputPayload): Promise<OutputResult> {
    return {
      url: `https://github.com/${payload.extras?.owner ?? 'owner'}/${payload.extras?.repo ?? 'repo'}/issues/new#stub`,
      id: 'stub',
      deliveredAt: Date.now(),
      receipt: { stubbed: true, title: payload.title, body: payload.body },
    };
  }

  private async openDraftPr(payload: OutputPayload): Promise<OutputResult> {
    return {
      url: `https://github.com/${payload.extras?.owner ?? 'owner'}/${payload.extras?.repo ?? 'repo'}/compare#stub`,
      id: 'stub',
      deliveredAt: Date.now(),
      receipt: { stubbed: true, title: payload.title, body: payload.body },
    };
  }
}
