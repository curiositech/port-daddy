import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildIdeasIndex, parseIdeasTrove, searchIdeas } from '../../lib/ideas-trove.js';

describe('ideas trove utilities', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('parses immediate, backlog, and duplicate entries from the trove markdown', () => {
    const markdown = `
# Ideas Trove

## Immediate Implementation Candidates

### \`ipc-disconnect-instant-salvage\`

- status: \`now\`
- why it matters:
  - IPC disconnect should trigger immediate salvage.
- next cut:
  - Salvage the session when the IPC socket drops.
- provenance:
  - \`.spark/ideas/ipc-disconnect.md\`

## Secondary Backlog Families

### Harbor, Identity, And Network Surfaces

- status: \`backlog\`
- core themes:
  - Capability-aware discovery.
  - Harbor-aware spawn inheritance.
- representative provenance:
  - \`.spark/ideas/spider-capability-discovery.md\`

## Duplicate Families To Collapse

- \`salvage-briefing\`
  - \`2026-03-29-salvage-inbox-briefing\`
  - \`spider-salvage-inbox-briefing\`
`;

    const entries = parseIdeasTrove(markdown);
    expect(entries.map((entry) => entry.slug)).toEqual([
      'ipc-disconnect-instant-salvage',
      'harbor-identity-and-network-surfaces',
      'salvage-briefing',
    ]);
    expect(entries[0].status).toBe('now');
    expect(entries[0].summary).toContain('IPC disconnect');
    expect(entries[1].status).toBe('backlog');
    expect(entries[1].details).toContain('Capability-aware discovery.');
    expect(entries[2].status).toBe('merge');
    expect(entries[2].provenance).toContain('2026-03-29-salvage-inbox-briefing');
  });

  test('search ranks curated provenance and can include raw local residue', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-ideas-'));
    tempDirs.push(projectDir);

    mkdirSync(join(projectDir, 'docs', 'recovery'), { recursive: true });
    mkdirSync(join(projectDir, '.spark', 'ideas'), { recursive: true });
    mkdirSync(join(projectDir, '.spider', 'connections'), { recursive: true });

    writeFileSync(
      join(projectDir, 'docs', 'recovery', 'IDEAS-TROVE.md'),
      `
# Ideas Trove

## Immediate Implementation Candidates

### \`forensic-context-windows\`

- status: \`now\`
- why it matters:
  - Violations need narrative context windows.
- provenance:
  - \`.spark/ideas/spider-forensic-context-windows.md\`

## Secondary Backlog Families

### Briefings, Inbox, And Recovery Handoffs

- status: \`backlog\`
- core themes:
  - richer briefings mixing narrative and live state
`,
    );

    writeFileSync(
      join(projectDir, '.spider', 'connections', '20260411-tuple-fast-path.md'),
      '# Tuple Fast Path\n\nTuple-triggered fleet work over IPC.\n',
    );

    const entries = buildIdeasIndex(projectDir, { includeRaw: true });
    expect(entries.some((entry) => entry.slug === 'tuple-fast-path')).toBe(true);
    expect(entries.some((entry) => entry.slug === 'forensic-context-windows')).toBe(true);

    const tupleResults = searchIdeas(entries, 'tuple ipc', { limit: 5 });
    expect(tupleResults[0].slug).toBe('tuple-fast-path');
    expect(tupleResults[0].source).toBe('raw');

    const contextResults = searchIdeas(entries, 'forensic context', { limit: 5 });
    expect(contextResults[0].slug).toBe('forensic-context-windows');
    expect(contextResults[0].matches).toContain('slug');
  });

  test('search rewards multi-token coverage over one high-weight token coincidence', () => {
    const entries = [
      {
        slug: 'query-router',
        title: 'Query router',
        status: 'backlog',
        section: 'secondary',
        source: 'trove',
        summary: 'Only one query token matches this entry.',
        details: [],
        nextCut: [],
        provenance: [],
      },
      {
        slug: 'full-coverage',
        title: 'Full coverage',
        status: 'backlog',
        section: 'secondary',
        source: 'trove',
        summary: 'Lower-weight detail fields should still win when they satisfy the whole ask.',
        details: ['provider neutral query'],
        nextCut: [],
        provenance: [],
      },
    ];

    const results = searchIdeas(entries, 'provider neutral query', { limit: 2 });
    expect(results.map((entry) => entry.slug)).toEqual(['full-coverage', 'query-router']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
