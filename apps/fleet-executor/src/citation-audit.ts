/**
 * Citation integrity for fleet emitters — the machine-checkable half.
 *
 * MEASURED, NOT SUSPECTED. A 2026-08-23 audit of 268 findings posted across
 * five PRs found 36 citing a path that exists on no ref (`csp-validator.ts`,
 * `path-validator.ts`, `cli/visibility.py`, `harbors-page.js`, `docs/roadmap.md`
 * — each presented as "evidence"), and 84 of the 120 line citations landing on
 * code unrelated to the claim. Two disjoint leaks let the paths through:
 *
 *   1. Proposal ships (spark, spider, snipe, lookout) post `evidence` arrays
 *      that nothing validated at all.
 *   2. The reviewer-ship changed-files filter FAILS OPEN when the /files list
 *      may be truncated (>= one page), which is precisely the big PRs where
 *      chunked review misattributes most.
 *
 * This module closes both with the same evidence the purser already trusts:
 * the repo tree at the PR head (stacked-pr.ts::fetchRepoTreePaths). It audits
 * PATH-SHAPED citations only — a proposal is allowed to cite a concept ("the
 * scope-honesty section"), and judging concepts is a human task (the same
 * boundary scripts/check-doc-citations.mjs draws for docs). A path-shaped
 * citation that resolves nowhere is not a concept; it is a fabricated file.
 *
 * FAIL OPEN on missing evidence, loudly: when the tree could not be fetched
 * (or was truncated), nothing is dropped — a silently eaten real finding is
 * worse than a posted bogus one — and the audit says it could not run.
 */

import type { Finding } from './verdict.js';
import type { Proposal } from './proposals.js';

/**
 * Does a citation CLAIM to be a repo file path?
 *
 * Mirrors check-doc-citations.mjs's posture: a token is a path citation when
 * it looks like one — contains a directory separator or a file extension, and
 * no spaces (prose has spaces; `public/Untitled 2.png` style paths are rare in
 * citations and a miss there fails open, not closed). Everything else is a
 * concept and stays out of scope.
 */
export function isPathShaped(cited: string): boolean {
  const c = cited.trim();
  if (!c || /\s/.test(c)) return false;
  if (c.includes('*') || c.includes('<') || c.includes('>')) return false; // globs/placeholders
  return c.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(c);
}

/** Strip the `:NN` / `:NN-MM` line suffix a citation may carry. */
export function bareCitedPath(cited: string): string {
  return cited.trim().replace(/:\d+(?:-\d+)?$/, '');
}

export interface CitationEvidence {
  /** Full recursive path set at the PR HEAD sha, or null when unfetchable/truncated. */
  treePaths: Set<string> | null;
  /** Filenames from the PR's /files listing — always additionally trusted. */
  changedPaths: ReadonlySet<string>;
}

export type CitationVerdict = 'real' | 'missing' | 'unknown' | 'not-a-path';

/** Audit ONE citation against the head tree. */
export function auditCitation(cited: string, evidence: CitationEvidence): CitationVerdict {
  if (!isPathShaped(cited)) return 'not-a-path';
  const bare = bareCitedPath(cited);
  if (evidence.changedPaths.has(bare)) return 'real';
  if (evidence.treePaths === null) return 'unknown';
  return evidence.treePaths.has(bare) ? 'real' : 'missing';
}

export interface FindingsAudit {
  kept: Finding[];
  /** Findings whose cited path exists nowhere at the PR head. */
  rejected: Finding[];
  /** True when tree evidence was available and the audit actually ran. */
  audited: boolean;
}

/**
 * Second-layer path audit for reviewer findings.
 *
 * Runs AFTER the existing changed-files filter and exists for the case that
 * filter fails open on (a possibly-truncated /files list): a finding citing a
 * path that is neither changed NOR anywhere in the head tree cannot be about
 * this repository, let alone this PR.
 */
export function auditFindings(findings: Finding[], evidence: CitationEvidence): FindingsAudit {
  if (evidence.treePaths === null) return { kept: findings, rejected: [], audited: false };
  const kept: Finding[] = [];
  const rejected: Finding[] = [];
  for (const f of findings) {
    (auditCitation(f.path, evidence) === 'missing' ? rejected : kept).push(f);
  }
  return { kept, rejected, audited: true };
}

export interface ProposalsAudit {
  kept: Proposal[];
  /** Proposals dropped because EVERY path-shaped evidence entry was fabricated. */
  dropped: Array<{ title: string; missing: string[] }>;
  /** Per-proposal fabricated entries that were stripped while the proposal survived. */
  strippedFrom: Array<{ title: string; missing: string[] }>;
  audited: boolean;
}

/**
 * Audit proposal `evidence` arrays.
 *
 * A fabricated path is stripped from the rendered evidence; a proposal whose
 * path-shaped evidence is ENTIRELY fabricated and which offers no concept
 * evidence is dropped outright — with nothing real underneath it, there is
 * nothing for an operator to act on. Concept evidence keeps a proposal alive:
 * the prompt explicitly allows "<file or concept from the diff>".
 */
export function auditProposals(proposals: Proposal[], evidence: CitationEvidence): ProposalsAudit {
  if (evidence.treePaths === null) {
    return { kept: proposals, dropped: [], strippedFrom: [], audited: false };
  }
  const kept: Proposal[] = [];
  const dropped: ProposalsAudit['dropped'] = [];
  const strippedFrom: ProposalsAudit['strippedFrom'] = [];
  for (const p of proposals) {
    const missing = p.evidence.filter(e => auditCitation(e, evidence) === 'missing');
    if (missing.length === 0) {
      kept.push(p);
      continue;
    }
    const surviving = p.evidence.filter(e => auditCitation(e, evidence) !== 'missing');
    if (surviving.length === 0) {
      dropped.push({ title: p.title, missing });
      continue;
    }
    strippedFrom.push({ title: p.title, missing });
    kept.push({ ...p, evidence: surviving });
  }
  return { kept, dropped, strippedFrom, audited: true };
}

/**
 * Render the audit's rejections as a short, named section — visible, so the
 * emitter's defect is legible in the thread instead of silently vanishing,
 * and never carrying a one-click issue button for a file that does not exist.
 */
export function renderCitationAuditNote(
  rejectedPaths: string[],
  droppedProposals: Array<{ title: string; missing: string[] }>,
): string {
  if (rejectedPaths.length === 0 && droppedProposals.length === 0) return '';
  const lines: string[] = ['', '---', ''];
  if (rejectedPaths.length > 0) {
    lines.push(
      `⚠ **${rejectedPaths.length} finding(s) withheld — cited path does not exist at this PR's head:** ` +
        rejectedPaths.map(p => `\`${p}\``).join(', ') +
        `. A finding pinned to a fabricated file is evidence about the reviewer, not the PR.`,
    );
  }
  for (const d of droppedProposals) {
    lines.push(
      `⚠ **Proposal withheld — every cited file is fabricated:** "${d.title}" ` +
        `(cited ${d.missing.map(p => `\`${p}\``).join(', ')}).`,
    );
  }
  return lines.join('\n');
}
