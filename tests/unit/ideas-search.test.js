import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveIdeaSearchSources, searchMarkdownFiles } from '../../lib/ideas-search.js';

describe('ideas federated search utilities', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('resolveIdeaSearchSources keeps default sources and adds raw when requested', () => {
    expect(resolveIdeaSearchSources(undefined, false)).toEqual([
      'trove',
      'notes',
      'tuples',
      'markdown',
    ]);
    expect(resolveIdeaSearchSources(undefined, true)).toEqual([
      'trove',
      'notes',
      'tuples',
      'markdown',
      'raw',
    ]);
    expect(resolveIdeaSearchSources(['markdown,notes'], false)).toEqual([
      'markdown',
      'notes',
    ]);
    expect(resolveIdeaSearchSources(['all'], false)).toEqual([
      'trove',
      'notes',
      'tuples',
      'markdown',
      'raw',
    ]);
  });

  test('searchMarkdownFiles finds random markdown in the repo tree while ignoring Spark/Spider residue', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-idea-markdown-'));
    tempDirs.push(projectDir);

    mkdirSync(join(projectDir, 'docs'), { recursive: true });
    mkdirSync(join(projectDir, '.spark', 'ideas'), { recursive: true });
    mkdirSync(join(projectDir, '.spider', 'connections'), { recursive: true });

    writeFileSync(
      join(projectDir, 'docs', 'operator-notes.md'),
      '# Operator Notes\n\nNeed a tuple fast path for agent mailboxes.\n',
    );
    writeFileSync(
      join(projectDir, '.spark', 'ideas', 'hidden.md'),
      '# Hidden Spark\n\nTuple fast path should not show up via markdown search.\n',
    );

    const hits = searchMarkdownFiles(projectDir, 'tuple fast path', { limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0].location).toBe('docs/operator-notes.md');
    expect(hits[0].summary).toContain('tuple fast path');
  });
});
