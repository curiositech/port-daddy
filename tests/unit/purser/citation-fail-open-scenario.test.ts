export function auditCitation(cited: string, evidence: CitationEvidence): CitationVerdict {
  if (!isPathShaped(cited)) return 'not-a-path';
  const bare = bareCitedPath(cited);
  if (evidence.changedPaths.has(bare)) return 'real';
  if (evidence.treePaths === null) return 'unknown';
  return evidence.treePaths.has(bare) ? 'real' : 'missing';
}