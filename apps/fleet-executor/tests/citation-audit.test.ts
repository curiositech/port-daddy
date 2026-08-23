import { describe, expect, it } from 'vitest';
import {
  auditCitation,
  auditFindings,
  auditProposals,
  bareCitedPath,
  isPathShaped,
  renderCitationAuditNote,
  type CitationEvidence,
} from '../src/citation-audit.js';
import type { Finding } from '../src/verdict.js';
import type { Proposal } from '../src/proposals.js';

// Every fabricated path below was ACTUALLY POSTED as evidence on 2026-08-23,
// which is why this module exists — these are regression pins, not invented
// examples.

const TREE = new Set([
  'apps/relay/src/harbors-page.ts',
  'apps/relay/src/index.ts',
  'lib/shipwright/skill-visibility.ts',
  'docs/adr/0128-mandatory-harbors.md',
]);

const evidence = (treePaths: Set<string> | null = TREE): CitationEvidence => ({
  treePaths,
  changedPaths: new Set(['apps/relay/src/new-file.ts']),
});

describe('isPathShaped', () => {
  it('accepts real path citations, with or without a line suffix', () => {
    expect(isPathShaped('apps/relay/src/harbors-page.ts')).toBe(true);
    expect(isPathShaped('apps/relay/src/harbors-page.ts:616')).toBe(true);
    expect(isPathShaped('CHANGELOG.md')).toBe(true);
  });

  it('leaves concepts alone — the proposal prompt explicitly allows them', () => {
    expect(isPathShaped('PR description')).toBe(false);
    expect(isPathShaped('scope honesty section')).toBe(false);
    expect(isPathShaped('the fleet context')).toBe(false);
  });

  it('leaves globs and placeholders alone', () => {
    expect(isPathShaped('apps/pd-ios/PortDaddy/Resources/*.fixture.json')).toBe(false);
    expect(isPathShaped('skills/<name>/SKILL.md')).toBe(false);
  });
});

describe('bareCitedPath', () => {
  it('strips :NN and :NN-MM suffixes only', () => {
    expect(bareCitedPath('a/b.ts:12')).toBe('a/b.ts');
    expect(bareCitedPath('a/b.ts:12-40')).toBe('a/b.ts');
    expect(bareCitedPath('a/b.ts')).toBe('a/b.ts');
  });
});

describe('auditCitation', () => {
  it('a tree path is real; a changed-but-new path is real; a fabricated one is missing', () => {
    expect(auditCitation('apps/relay/src/index.ts', evidence())).toBe('real');
    expect(auditCitation('apps/relay/src/new-file.ts', evidence())).toBe('real');
    // Posted verbatim by pd-spark on #9224 — the file exists on no ref.
    expect(auditCitation('apps/relay/src/csp-validator.ts', evidence())).toBe('missing');
    expect(auditCitation('apps/relay/src/path-validator.ts', evidence())).toBe('missing');
  });

  it('fails OPEN as unknown when the tree could not be fetched', () => {
    expect(auditCitation('apps/relay/src/csp-validator.ts', evidence(null))).toBe('unknown');
  });
});

const finding = (path: string): Finding => ({ path, line: 1, severity: 'HIGH', body: 'x' });

describe('auditFindings', () => {
  it('withholds only findings citing nonexistent paths', () => {
    const audit = auditFindings(
      [finding('apps/relay/src/index.ts'), finding('apps/relay/src/csp-validator.ts')],
      evidence(),
    );
    expect(audit.audited).toBe(true);
    expect(audit.kept.map(f => f.path)).toEqual(['apps/relay/src/index.ts']);
    expect(audit.rejected.map(f => f.path)).toEqual(['apps/relay/src/csp-validator.ts']);
  });

  it('drops NOTHING when tree evidence is unavailable — a silently eaten real finding is the worse failure', () => {
    const all = [finding('apps/relay/src/csp-validator.ts')];
    const audit = auditFindings(all, evidence(null));
    expect(audit.audited).toBe(false);
    expect(audit.kept).toEqual(all);
    expect(audit.rejected).toEqual([]);
  });
});

const proposal = (title: string, evidenceList: string[]): Proposal =>
  ({ title, rationale: 'r', evidence: evidenceList, action: 'roadmap' }) as Proposal;

describe('auditProposals', () => {
  it('strips fabricated paths but keeps a proposal that still has real ground', () => {
    const audit = auditProposals(
      [proposal('mixed', ['apps/relay/src/index.ts', 'apps/relay/src/csp-validator.ts'])],
      evidence(),
    );
    expect(audit.kept).toHaveLength(1);
    expect(audit.kept[0].evidence).toEqual(['apps/relay/src/index.ts']);
    expect(audit.strippedFrom).toHaveLength(1);
    expect(audit.dropped).toHaveLength(0);
  });

  it('withholds a proposal whose every citation is fabricated', () => {
    // The pd-spider #9370 shape: cli/visibility.py and database/schema.sql,
    // neither of which exists in this repository at all.
    const audit = auditProposals(
      [proposal('phantom', ['cli/visibility.py', 'database/schema.sql'])],
      evidence(),
    );
    expect(audit.kept).toHaveLength(0);
    expect(audit.dropped).toEqual([
      { title: 'phantom', missing: ['cli/visibility.py', 'database/schema.sql'] },
    ]);
  });

  it('concept evidence keeps a proposal alive even beside a fabricated path', () => {
    const audit = auditProposals(
      [proposal('concepty', ['PR description', 'docs/roadmap.md'])],
      evidence(),
    );
    expect(audit.kept).toHaveLength(1);
    expect(audit.kept[0].evidence).toEqual(['PR description']);
  });

  it('audits nothing when the tree is unavailable', () => {
    const props = [proposal('p', ['cli/visibility.py'])];
    const audit = auditProposals(props, evidence(null));
    expect(audit.audited).toBe(false);
    expect(audit.kept).toEqual(props);
  });
});

describe('renderCitationAuditNote', () => {
  it('names the withheld paths and proposals; renders nothing when clean', () => {
    expect(renderCitationAuditNote([], [])).toBe('');
    const note = renderCitationAuditNote(
      ['apps/relay/src/csp-validator.ts'],
      [{ title: 'phantom', missing: ['cli/visibility.py'] }],
    );
    expect(note).toContain('csp-validator.ts');
    expect(note).toContain('phantom');
    expect(note).toContain('does not exist');
  });
});
