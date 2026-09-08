import { createTestDb } from '../setup-unit.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { createGraphEdges } from '../../lib/graph-edges.js';

describe('episodic memory', () => {
  let db;
  let memory;

  beforeEach(() => {
    db = createTestDb();
    memory = createEpisodicMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  test('filters by project dir, project, and harbor', () => {
    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      harbor: 'port-daddy:fleet',
      agentId: 'documentarian',
      episodeType: 'handoff',
      title: 'Port Daddy handoff',
      summary: 'Updated tuples docs.',
      sourceType: 'session',
      sourceId: 'session-1',
    });
    memory.remember({
      projectDir: '/tmp/workgroup-ai',
      project: 'workgroup-ai',
      harbor: 'workgroup-ai:fleet',
      agentId: 'qa',
      episodeType: 'finding',
      title: 'Workgroup issue',
      summary: 'Found stale status output.',
      sourceType: 'session',
      sourceId: 'session-2',
    });

    expect(memory.list({ projectDir: '/tmp/port-daddy' })).toHaveLength(1);
    expect(memory.list({ project: 'workgroup-ai' })).toHaveLength(1);
    expect(memory.list({ harbor: 'port-daddy:fleet' })).toHaveLength(1);
    expect(memory.list({ query: 'stale status' })).toHaveLength(1);
  });

  test('reads one durable episode by its canonical id', () => {
    const created = memory.remember({
      project: 'port-daddy',
      episodeType: 'handoff',
      title: 'Continuation source',
      summary: 'Sanitized capsule source.',
      sourceType: 'handoff-capsule',
      sourceId: 'capsule-source-1',
    });

    expect(memory.get(created.id)).toEqual(expect.objectContaining({
      id: created.id,
      sourceId: 'capsule-source-1',
    }));
    expect(memory.get(0)).toBeNull();
    expect(memory.get(999_999)).toBeNull();
  });

  test('stats can scope by project dir and logical project name', () => {
    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      episodeType: 'handoff',
      title: 'First',
      summary: 'First summary',
      sourceType: 'session',
      sourceId: 'session-1',
    });
    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      episodeType: 'finding',
      title: 'Second',
      summary: 'Second summary',
      sourceType: 'sortie',
      sourceId: 'sortie-1',
    });
    memory.remember({
      projectDir: '/tmp/other',
      project: 'other',
      episodeType: 'finding',
      title: 'Elsewhere',
      summary: 'Elsewhere summary',
      sourceType: 'session',
      sourceId: 'session-3',
    });

    const byDir = memory.stats('/tmp/port-daddy');
    expect(byDir.total).toBe(2);

    const byProject = memory.stats(undefined, 'port-daddy');
    expect(byProject.total).toBe(2);
    expect(byProject.episodeTypes).toBe(2);
  });

  test('project-scoped queries still return rows when only one of projectDir or project was recorded', () => {
    memory.remember({
      project: 'port-daddy',
      episodeType: 'handoff',
      title: 'Logical project only',
      summary: 'Captured before projectDir was available.',
      sourceType: 'session',
      sourceId: 'session-logical-only',
    });
    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      episodeType: 'finding',
      title: 'Project dir and logical project',
      summary: 'Captured with the richer context.',
      sourceType: 'session',
      sourceId: 'session-both',
    });

    const scoped = memory.list({ projectDir: '/tmp/port-daddy', project: 'port-daddy' });
    expect(scoped).toHaveLength(2);

    const scopedStats = memory.stats('/tmp/port-daddy', 'port-daddy');
    expect(scopedStats.total).toBe(2);
  });

  test('projects episodes into tuples and semantic alias graph edges', () => {
    const tupleWrites = [];
    const graphEdges = createGraphEdges(db);
    memory = createEpisodicMemory(db, {
      tuples: {
        out(fields, options) {
          tupleWrites.push({ fields, options });
          return { id: tupleWrites.length, fields, harbor: options?.harbor ?? null };
        },
      },
      graphEdges,
    });

    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      harbor: 'port-daddy:fleet',
      agentId: 'designer',
      episodeType: 'handoff',
      title: 'Writing the CSS for Port Daddy website design system',
      summary: 'Need the site design system and CSS tokens aligned.',
      sourceType: 'session',
      sourceId: 'session-css-1',
    });

    expect(tupleWrites.some((entry) => entry.fields[0] === 'memory:episode')).toBe(true);
    const semanticTuples = tupleWrites.filter((entry) => entry.fields[0] === 'semantic:alias');
    expect(semanticTuples.length).toBeGreaterThan(0);
    expect(semanticTuples[0].fields[3]).toContain('css');

    const aboutEdges = graphEdges.list({ sourceType: 'memory_episode' });
    expect(aboutEdges.some((edge) => edge.targetType === 'semantic_term')).toBe(true);
    const aliasEdges = graphEdges.list({ edgeType: 'alias_of' });
    expect(aliasEdges.length).toBeGreaterThan(0);
  });

  test('forwards episode aliases into the semantic resolver review stream', () => {
    const observed = [];
    memory = createEpisodicMemory(db, {
      semanticResolver: {
        observeAliases(input) {
          observed.push(input);
        },
      },
    });

    memory.remember({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      harbor: 'port-daddy:fleet',
      agentId: 'designer',
      episodeType: 'handoff',
      title: 'Writing the CSS for Port Daddy website design system',
      summary: 'Need the site design system and CSS tokens aligned.',
      sourceType: 'session',
      sourceId: 'session-css-2',
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      projectDir: '/tmp/port-daddy',
      harbor: 'port-daddy:fleet',
      sourceType: 'session',
      sourceId: 'session-css-2:handoff',
      agentId: 'designer',
    });
    expect(observed[0].aliases[0].canonical).toContain('css');
  });
});
