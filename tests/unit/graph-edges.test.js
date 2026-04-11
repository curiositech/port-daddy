import { createTestDb } from '../setup-unit.js';
import { createGraphEdges } from '../../lib/graph-edges.js';

describe('graph edges', () => {
  let db;
  let graphEdges;

  beforeEach(() => {
    db = createTestDb();
    graphEdges = createGraphEdges(db);
  });

  afterEach(() => {
    db.close();
  });

  test('remember upserts an edge without deleting sibling edges in the same scope', () => {
    graphEdges.replaceScope('symbols:file:/tmp/example.ts', [
      {
        scope: 'symbols:file:/tmp/example.ts',
        projectDir: '/tmp',
        sourceType: 'file',
        sourceId: '/tmp/example.ts',
        edgeType: 'defines',
        targetType: 'symbol',
        targetId: 'greet',
      },
      {
        scope: 'symbols:file:/tmp/example.ts',
        projectDir: '/tmp',
        sourceType: 'symbol',
        sourceId: 'greet',
        edgeType: 'contains',
        targetType: 'symbol',
        targetId: 'greet.helper',
      },
    ]);

    graphEdges.remember({
      scope: 'symbols:file:/tmp/example.ts',
      projectDir: '/tmp',
      sourceType: 'file',
      sourceId: '/tmp/example.ts',
      edgeType: 'defines',
      targetType: 'symbol',
      targetId: 'farewell',
      metadata: { symbolName: 'farewell' },
    });

    const edges = graphEdges.list({ scope: 'symbols:file:/tmp/example.ts', limit: 10 });
    expect(edges).toHaveLength(3);
    expect(edges.some((edge) => edge.targetId === 'greet.helper')).toBe(true);
    expect(edges.some((edge) => edge.targetId === 'farewell')).toBe(true);
  });

  test('remember updates matching edge metadata instead of duplicating it', () => {
    graphEdges.remember({
      scope: 'merge:entry:1',
      projectDir: '/tmp/repo',
      sourceType: 'branch',
      sourceId: 'feature',
      edgeType: 'targets_base',
      targetType: 'branch',
      targetId: 'main',
      metadata: { status: 'pending' },
    });

    graphEdges.remember({
      scope: 'merge:entry:1',
      projectDir: '/tmp/repo',
      sourceType: 'branch',
      sourceId: 'feature',
      edgeType: 'targets_base',
      targetType: 'branch',
      targetId: 'main',
      metadata: { status: 'merged' },
    });

    const edges = graphEdges.list({ scope: 'merge:entry:1', limit: 10 });
    expect(edges).toHaveLength(1);
    expect(edges[0].metadata.status).toBe('merged');
  });
});
