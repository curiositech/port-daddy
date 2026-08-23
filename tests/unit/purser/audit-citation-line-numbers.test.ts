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
  treePaths: Set<string> | null;
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