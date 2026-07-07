/**
 * Reviewer-ship findings rendering.
 *
 * The reviewer ships (code-reviewer, qa, red-team, tautology-sniffer, …) speak
 * the line-level {@link Finding} schema in verdict.ts. Until now the cloud
 * executor posted each ship's RAW model output as its PR issue comment — which
 * meant the operator saw the fenced `json` findings array verbatim, and it
 * *truncated* mid-string when the model's output ran long (the 2026-07-07 mobile
 * screenshots: every reviewer comment ended in an unterminated `"`). `red-team`,
 * which correctly found nothing, posted a bare `[]`.
 *
 * This module is the reviewer half of what {@link renderProposalComment} already
 * does for ideation ships: turn validated findings into clean, actionable
 * markdown. Findings are grouped by severity; each HIGH finding gets a one-click
 * GitHub prefilled-issue URL (the same move Spark uses, which the operator can
 * act on from mobile in one tap). Deterministic: same findings + ctx →
 * byte-identical output, so the edit-in-place comment stays idempotent on retry.
 */

import type { Finding, Severity } from './verdict.js';
import { htmlCommentSafeJson } from './machine-block.js';

/** Cap model text baked into a prefilled-issue URL so the GET URL stays sane. */
const ISSUE_URL_BODY_LIMIT = 1200;

export interface FindingsRenderCtx {
  owner: string;
  repo: string;
  prNumber: number;
  shipName: string;
}

const SEVERITY_ORDER: readonly Severity[] = ['HIGH', 'MEDIUM', 'LOW'];

const SEVERITY_BADGE: Record<Severity, string> = {
  HIGH: '🔴 HIGH',
  MEDIUM: '🟡 MEDIUM',
  LOW: '⚪ LOW',
};

/** Collapse whitespace to a single line (for issue titles / URL params). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A one-click "open as issue" URL for a HIGH finding — no backend required, the
 * operator taps it and GitHub opens a prefilled new-issue form. Mirrors the
 * roadmap-action URL in proposals.ts::renderAction so the two surfaces feel the
 * same. All interpolated text is percent-encoded, so model-provided content
 * can't break out of the query string.
 */
function issueUrl(f: Finding, ctx: FindingsRenderCtx): string {
  const title = encodeURIComponent(`fix: ${oneLine(f.body).slice(0, 80)}`);
  const body = encodeURIComponent(
    `**Source:** pd-${ctx.shipName} on PR #${ctx.prNumber} (HIGH finding)\n\n` +
      `**Location:** \`${f.path}:${f.line}\`\n\n` +
      `${f.body.slice(0, ISSUE_URL_BODY_LIMIT)}\n\n` +
      `*Auto-surfaced by Port Daddy Fleet.*`,
  );
  return (
    `https://github.com/${ctx.owner}/${ctx.repo}/issues/new` +
    `?title=${title}&body=${body}&labels=bug,from-fleet`
  );
}

/**
 * Render a reviewer ship's whole comment body from its validated findings.
 *
 * Returns '' when there are no findings — the caller then posts nothing
 * (silence), which is how a clean ship (`red-team` on an off-surface diff) stops
 * spamming a bare `[]`. Given the same findings + ctx the output is
 * byte-identical.
 */
export function renderFindingsComment(findings: Finding[], ctx: FindingsRenderCtx): string {
  if (findings.length === 0) return '';

  const bySeverity = new Map<Severity, Finding[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const f of findings) bySeverity.get(f.severity)!.push(f);

  const blocks: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const group = bySeverity.get(sev)!;
    if (group.length === 0) continue;
    blocks.push(`#### ${SEVERITY_BADGE[sev]}`);
    for (const f of group) {
      const parts = [`- \`${f.path}:${f.line}\` — ${f.body}`];
      if (sev === 'HIGH') {
        parts.push(`  [📌 Open as issue](${issueUrl(f, ctx)})`);
      }
      blocks.push(parts.join('\n'));
    }
  }

  // Hidden machine block so a future bulk-triage handler can re-materialize the
  // findings without re-parsing the prose. Mirrors proposals.ts's
  // `pd-proposals-json` convention. Model-provided text is comment-safe-escaped
  // so a body containing `-->` can't terminate the HTML comment early.
  const machine = `\n\n<!-- pd-findings-json\n${htmlCommentSafeJson(findings)}\n-->`;

  const footer =
    '\n\n---\n' +
    `*${findings.length} finding${findings.length === 1 ? '' : 's'} from pd-${ctx.shipName}. ` +
    'HIGH findings link to a one-click issue.*';

  return blocks.join('\n\n') + footer + machine;
}
