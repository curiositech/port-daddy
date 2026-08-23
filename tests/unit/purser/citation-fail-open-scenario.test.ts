// tests/unit/purser/citation-fail-open-scenario.test.ts
//
// Obligations 4 and 8 of the #9764 contract, fail-open half: when the head
// tree could not be fetched (treePaths === null) the audit must not eat
// findings — a silently dropped real finding is worse than a posted bogus one
// — and it must SAY it did not run (audited: false), so the output is labeled.
import {
  auditCitation,
  auditFindings,
  auditProposals,
  type CitationEvidence,
} from '../../../apps/fleet-executor/src/citation-audit.ts';
import type { Finding } from '../../../apps/fleet-executor/src/verdict.ts';
import type { Proposal } from '../../../apps/fleet-executor/src/proposals.ts';

const fabricated: Finding = {
  path: 'csp-validator.ts', // a literal fabricated path from the 2026-08-23 audit
  line: 12,
  severity: 'HIGH',
  body: 'cites a file that exists on no ref',
};
const real: Finding = {
  path: 'apps/fleet-executor/src/citation-audit.ts',
  line: 1,
  severity: 'LOW',
  body: 'cites the module under test',
};

describe('citation audit fails OPEN when tree evidence is unavailable', () => {
  it('premise: with tree evidence present, the fabricated finding IS rejected', () => {
    const evidence: CitationEvidence = {
      treePaths: new Set<string>([real.path]),
      changedPaths: new Set<string>(),
    };
    const audit = auditFindings([fabricated, real], evidence);
    expect(audit.audited).toBe(true);
    expect(audit.rejected).toEqual([fabricated]);
    expect(audit.kept).toEqual([real]);
  });

  it('null tree: every finding is kept and the audit says it did not run', () => {
    const evidence: CitationEvidence = { treePaths: null, changedPaths: new Set<string>() };
    const audit = auditFindings([fabricated, real], evidence);
    expect(audit.audited).toBe(false);
    expect(audit.kept).toEqual([fabricated, real]);
    expect(audit.rejected).toEqual([]);
  });

  it('null tree: a single citation audits as unknown, never missing', () => {
    const evidence: CitationEvidence = { treePaths: null, changedPaths: new Set<string>() };
    expect(auditCitation('csp-validator.ts', evidence)).toBe('unknown');
  });

  it('null tree: proposals pass through unstripped, audit marked not-run', () => {
    const proposal: Proposal = {
      title: 'Harden the validator',
      rationale: 'grounded only in a fabricated file',
      evidence: ['path-validator.ts'],
      action: 'roadmap',
    };
    const audit = auditProposals([proposal], { treePaths: null, changedPaths: new Set<string>() });
    expect(audit.audited).toBe(false);
    expect(audit.kept).toEqual([proposal]);
    expect(audit.dropped).toEqual([]);
    expect(audit.strippedFrom).toEqual([]);
  });
});
