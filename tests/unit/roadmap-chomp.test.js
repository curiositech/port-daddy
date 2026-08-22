/**
 * Roadmap Chomp — general planning-doc ingestion (lib/roadmap-chomp.ts).
 *
 * Covers the operator-mandated behaviors (2026-08-22):
 *   - deterministic extraction: headings → project/epic/story/task ladder,
 *     checklists → tasks, explicit "depends on / blocked by / requires"
 *     phrasing → dependencies, filename → provenance tag
 *   - the EXACT item tree from a fixture doc (slugs, kinds, parents, deps)
 *   - idempotent re-runs and enriched-row protection (never clobber)
 *   - dry-run writes nothing (no rows, no edges)
 *   - parent_of edges land in graph_edges via the planner vocabulary
 *   - legacy 3-pile equivalence through content detection (the dedicated
 *     legacy assertions live in tests/unit/roadmap-import.test.js)
 *   - optional LLM enrichment through an injected transport is judgment-only
 *     and fail-open; no backend ⇒ deterministic output, honestly reported
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { HIERARCHY_SCOPE } from '../../lib/planner-edges.js';
import { roadmapPlugin } from '../../routes/roadmap.js';
import {
  chompMarkdownDoc,
  detectChompFormat,
  slugifyHeading,
  extractDependsOn,
  kindForDepth,
  tagForDocPath,
  collectChompDocs,
  chompRoadmap,
  enrichChompedItems,
  importMarkdownRoadmap,
} from '../../lib/roadmap-chomp.js';

const SCRATCH_BASE = process.env.PD_TEST_SCRATCH || join(homedir(), 'coding', 'tmp');
mkdirSync(SCRATCH_BASE, { recursive: true });

const PLAN_MD = `# V4 Rollout Plan

The umbrella program for the v4 cutover.

## Phase 1: Foundation

- status: \`now\`

Build the core surfaces. Depends on \`existing-anchor\` and requires \`phase-0-cleanup\`.

- [ ] Wire the daemon routes
- [x] Draft the schema

### Storage Layer

Depends on \`phase-1-foundation\`.

Durable storage for the rollout.

## Phase 2: Rollout

Ship it. Blocked by \`phase-1-foundation\`.
`;

describe('pure extraction helpers', () => {
  test('slugifyHeading kebabs headings and honors backticked slugs', () => {
    expect(slugifyHeading('Phase 1: Foundation')).toBe('phase-1-foundation');
    expect(slugifyHeading('**Bold** `code` [link](http://x)')).toBe('bold-code-link');
    expect(slugifyHeading('`already-a-slug`')).toBe('already-a-slug');
  });

  test('kindForDepth walks the ladder project→epic→story→task', () => {
    expect(kindForDepth(0)).toBe('project');
    expect(kindForDepth(1)).toBe('epic');
    expect(kindForDepth(2)).toBe('story');
    expect(kindForDepth(3)).toBe('task');
    expect(kindForDepth(7)).toBe('task');
  });

  test('extractDependsOn reads explicit phrasing only', () => {
    expect(extractDependsOn('Depends on `a-b` and requires `c-d`.')).toEqual(['a-b', 'c-d']);
    expect(extractDependsOn('Blocked by relay-fabric, then more prose.')).toEqual(['relay-fabric']);
    // Bare single words after the phrase are NOT slurped as slugs.
    expect(extractDependsOn('requires patience and coffee')).toEqual([]);
    // Prose without an explicit phrase yields nothing.
    expect(extractDependsOn('the relay-fabric is neat')).toEqual([]);
  });

  test('tagForDocPath kebabs the filename sans extension', () => {
    expect(tagForDocPath('gemini-plans/V4-DAG.md')).toBe('v4-dag');
    expect(tagForDocPath('/abs/PLAN.md')).toBe('plan');
  });

  test('detectChompFormat recognizes the two legacy pile shapes', () => {
    expect(detectChompFormat('## Next Cuts (From Curated Trove)\n- **`a`** — b')).toBe('next-cuts-pile');
    expect(detectChompFormat('### `x`\n\n- status: `now`\n')).toBe('entry-pile');
    expect(detectChompFormat(PLAN_MD)).toBe('planning-doc');
  });
});

describe('chompMarkdownDoc (planning-doc extraction)', () => {
  test('extracts the exact item tree: slugs, kinds, parents, statuses, deps', () => {
    const doc = chompMarkdownDoc(PLAN_MD, { sourcePath: 'PLAN.md' });
    expect(doc.format).toBe('planning-doc');
    expect(
      doc.items.map((i) => ({
        slug: i.slug,
        kind: i.kind,
        parent: i.parent,
        status: i.status,
        dependsOn: i.dependsOn,
      })),
    ).toEqual([
      { slug: 'v4-rollout-plan', kind: 'project', parent: null, status: 'backlog', dependsOn: [] },
      {
        slug: 'phase-1-foundation',
        kind: 'epic',
        parent: 'v4-rollout-plan',
        status: 'now', // explicit `- status: now` bullet wins over the default
        dependsOn: ['existing-anchor', 'phase-0-cleanup'],
      },
      {
        slug: 'wire-the-daemon-routes',
        kind: 'task',
        parent: 'phase-1-foundation',
        status: 'backlog',
        dependsOn: [],
      },
      {
        slug: 'draft-the-schema',
        kind: 'task',
        parent: 'phase-1-foundation',
        status: 'done', // checked checkbox = recorded as done, not re-queued
        dependsOn: [],
      },
      {
        slug: 'storage-layer',
        kind: 'story',
        parent: 'phase-1-foundation',
        status: 'backlog',
        dependsOn: ['phase-1-foundation'],
      },
      {
        slug: 'phase-2-rollout',
        kind: 'epic',
        parent: 'v4-rollout-plan',
        status: 'backlog',
        dependsOn: ['phase-1-foundation'],
      },
    ]);
    // Section bodies become description_md; tags come from the filename.
    const root = doc.items[0];
    expect(root.descriptionMd).toContain('umbrella program');
    expect(root.summaryMd).toBe('V4 Rollout Plan');
    expect(root.tags).toEqual(['plan']);
  });

  test('a doc starting at ## still gets a project root (depth normalization)', () => {
    const doc = chompMarkdownDoc('## Only Section\n\nBody.\n\n### Child\n', { sourcePath: 'x.md' });
    expect(doc.items.map((i) => [i.slug, i.kind, i.parent])).toEqual([
      ['only-section', 'project', null],
      ['child', 'epic', 'only-section'],
    ]);
  });

  test('headings inside fenced code blocks are not items', () => {
    const doc = chompMarkdownDoc('# Real\n\n```\n# not a heading\n```\n', { sourcePath: 'x.md' });
    expect(doc.items.map((i) => i.slug)).toEqual(['real']);
  });

  test('duplicate heading slugs get a numeric suffix and a warning', () => {
    const doc = chompMarkdownDoc('# Top\n\n## Same\n\n## Same\n', { sourcePath: 'x.md' });
    expect(doc.items.map((i) => i.slug)).toEqual(['top', 'same', 'same-2']);
    expect(doc.warnings.some((w) => w.includes("duplicate heading slug 'same'"))).toBe(true);
  });
});

describe('chompRoadmap (write path)', () => {
  let db;
  let tuples;
  let roadmap;
  let graphEdges;
  let root;

  beforeEach(() => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    roadmap = createRoadmapItems({ db, tuples });
    graphEdges = createGraphEdges(db);
    root = mkdtempSync(join(SCRATCH_BASE, 'pd-roadmap-chomp-'));
    writeFileSync(join(root, 'PLAN.md'), PLAN_MD, 'utf-8');
    // A slug the fixture's deps reference that already lives on the roadmap.
    roadmap.upsert({ slug: 'existing-anchor', summaryMd: 'Pre-existing item.', harbor: 'fleet' });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('writes rows with kind/description/deps, provenance note, and hierarchy edges', async () => {
    const result = await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', by: 'chomp-test', sourceCommit: 'deadbeef' },
    );

    expect(result.inserted).toHaveLength(6);
    expect(result.sourceCommit).toBe('deadbeef');
    expect(result.updated).toHaveLength(0);
    expect(result.dryRun).toBe(false);

    const epic = roadmap.get('phase-1-foundation', 'fleet');
    expect(epic.kind).toBe('epic');
    expect(epic.status).toBe('now');
    expect(epic.descriptionMd).toContain('Build the core surfaces');
    // existing-anchor resolves (already on the roadmap); phase-0-cleanup dangles.
    expect(epic.dependencies).toEqual(['existing-anchor']);
    expect(result.dangling).toEqual([{ slug: 'phase-1-foundation', missing: 'phase-0-cleanup' }]);
    expect(epic.promotedByAgentId).toBe('chomp-test');
    expect(epic.notes.some((n) => n.text.includes('chomped from PLAN.md') && n.text.includes('plan'))).toBe(true);
    // Derived items carry durable provenance: source doc + commit SHA.
    expect(epic.sourceRefs).toEqual([{ type: 'doc', path: 'PLAN.md', commit: 'deadbeef' }]);

    const story = roadmap.get('storage-layer', 'fleet');
    expect(story.kind).toBe('story');
    expect(story.dependencies).toEqual(['phase-1-foundation']);

    const doneTask = roadmap.get('draft-the-schema', 'fleet');
    expect(doneTask.status).toBe('done');
    expect(doneTask.kind).toBe('task');

    // parent_of edges live in the ADR-0086 hierarchy scope.
    const edges = graphEdges.list({ scope: HIERARCHY_SCOPE, edgeType: 'parent_of', limit: 100 });
    const pairs = edges.map((e) => `${e.sourceId}>${e.targetId}`).sort();
    expect(pairs).toEqual(
      [
        'v4-rollout-plan>phase-1-foundation',
        'v4-rollout-plan>phase-2-rollout',
        'phase-1-foundation>wire-the-daemon-routes',
        'phase-1-foundation>draft-the-schema',
        'phase-1-foundation>storage-layer',
      ].sort(),
    );
    expect(result.parentEdgesWritten).toBe(5);
  });

  test('re-running is idempotent: no new rows, no duplicate edges, no data churn', async () => {
    await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet' },
    );
    const before = roadmap.list({ harbor: 'fleet', status: 'all' });

    const second = await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet' },
    );
    expect(second.inserted).toHaveLength(0);
    expect(second.updated).toHaveLength(6);

    const after = roadmap.list({ harbor: 'fleet', status: 'all' });
    expect(after).toHaveLength(before.length);
    for (const item of after) {
      const match = before.find((b) => b.slug === item.slug);
      expect(item.summaryMd).toBe(match.summaryMd);
      expect(item.kind).toBe(match.kind);
      expect(item.descriptionMd).toBe(match.descriptionMd);
      expect(item.notes).toEqual(match.notes); // no duplicate provenance notes
    }
    const edges = graphEdges.list({ scope: HIERARCHY_SCOPE, edgeType: 'parent_of', limit: 100 });
    expect(edges).toHaveLength(5); // remember() upserts, never duplicates
  });

  test('dry-run reports the exact tree but writes neither rows nor edges', async () => {
    const result = await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', dryRun: true },
    );
    expect(result.dryRun).toBe(true);
    expect(result.items).toHaveLength(6);
    expect(result.items.map((i) => i.slug)).toContain('storage-layer');
    // Only the pre-seeded anchor row exists; nothing was written.
    expect(roadmap.list({ harbor: 'fleet', status: 'all' }).map((i) => i.slug)).toEqual([
      'existing-anchor',
    ]);
    expect(graphEdges.list({ scope: HIERARCHY_SCOPE, limit: 100 })).toHaveLength(0);
    expect(result.parentEdgesWritten).toBe(0);
  });

  test('re-chomp never clobbers rows enriched after the first chomp', async () => {
    await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', by: 'roadmap-chomp' },
    );

    // An agent enriches a chomped row: new promoter, summary, status, body.
    roadmap.upsert({
      slug: 'storage-layer',
      summaryMd: 'Hand-curated storage summary.',
      descriptionMd: 'Hand-written spec.',
      status: 'now',
      kind: 'epic',
      promotedByAgentId: 'alice:cartographer',
      harbor: 'fleet',
    });

    const second = await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', by: 'roadmap-chomp' },
    );
    expect(second.updated).toContain('storage-layer');
    const report = second.items.find((i) => i.slug === 'storage-layer');
    expect(report.protected).toBe(true);

    const item = roadmap.get('storage-layer', 'fleet');
    expect(item.summaryMd).toBe('Hand-curated storage summary.');
    expect(item.descriptionMd).toBe('Hand-written spec.');
    expect(item.status).toBe('now');
    expect(item.kind).toBe('epic');
    expect(item.promotedByAgentId).toBe('alice:cartographer');
    // Provenance survives both the hand-edit (which omitted it) and the re-chomp.
    expect(item.sourceRefs).toEqual([{ type: 'doc', path: 'PLAN.md' }]);
  });

  test('relative paths escaping rootDir are refused, not read', () => {
    const collection = collectChompDocs({ rootDir: root, paths: ['../outside.md'] });
    expect(collection.items).toHaveLength(0);
    expect(collection.warnings.some((w) => w.includes('escapes rootDir'))).toBe(true);
  });

  test('multi-doc chomp: first doc wins a duplicated slug, with a warning', async () => {
    writeFileSync(join(root, 'OTHER.md'), '# Phase 2: Rollout\n\nA competing definition.\n', 'utf-8');
    const result = await chompRoadmap(
      { roadmapItems: roadmap, graphEdges },
      { rootDir: root, paths: ['PLAN.md', 'OTHER.md'], harbor: 'fleet' },
    );
    const rollout = roadmap.get('phase-2-rollout', 'fleet');
    expect(rollout.kind).toBe('epic'); // from PLAN.md, not OTHER.md's project root
    expect(result.warnings.some((w) => w.includes("slug 'phase-2-rollout' already chomped"))).toBe(true);
  });
});

describe('legacy pile equivalence through content detection', () => {
  // The full legacy assertion suite lives in tests/unit/roadmap-import.test.js
  // (running against the same lib). This adds the generalization proof: the
  // GENERIC chomp path, with no format forcing, detects the pile shapes and
  // produces the same slugs the legacy alias imports.
  const ROADMAP_MD = `# Roadmap

## Next Cuts (From Curated Trove)

- **\`cut-one\`** — First cut summary.
- **\`shared-slug\`** — Cut wins precedence.

## Phase 1
`;
  const IDEAS_MD = `# Ideas

### \`shared-slug\`

- status: \`now\`
- surface: dashboard
  - duplicate, should de-dupe

### \`idea-now\`

- status: \`now\`
- surface: cli
  - the idea hook

### \`idea-backlog\`

- status: \`backlog\`
- surface: nowhere
  - stays in the trove
`;

  let db;
  let roadmap;
  let root;

  beforeEach(() => {
    db = createTestDb();
    roadmap = createRoadmapItems({ db, tuples: createTupleSpace(db) });
    root = mkdtempSync(join(SCRATCH_BASE, 'pd-chomp-legacy-'));
    mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ROADMAP.md'), ROADMAP_MD, 'utf-8');
    writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), IDEAS_MD, 'utf-8');
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('generic chomp (auto-detected formats) imports the same slugs as the legacy alias', async () => {
    const generic = await chompRoadmap(
      { roadmapItems: roadmap },
      {
        rootDir: root,
        paths: ['docs/ROADMAP.md', 'docs/recovery/IDEAS-TROVE.md'],
        harbor: 'fleet',
        dryRun: true,
      },
    );
    const legacy = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet', dryRun: true });

    expect(generic.docs.map((d) => d.format)).toEqual(['next-cuts-pile', 'entry-pile']);
    expect(generic.items.map((i) => i.slug).sort()).toEqual(
      legacy.candidates.map((c) => c.slug).sort(),
    );
    // Both paths de-dupe shared-slug with next-cuts precedence.
    expect(generic.items.find((i) => i.slug === 'shared-slug').summaryMd).toBe('Cut wins precedence.');
    expect(legacy.candidates.find((c) => c.slug === 'shared-slug').source).toBe('next-cut');
    // Non-now trove entries stay out of both.
    expect(generic.items.map((i) => i.slug)).not.toContain('idea-backlog');
  });
});

describe('optional LLM enrichment (judgment only, fail-open)', () => {
  const longBody = `${'Detailed rationale sentence. '.repeat(20)}`;
  const DOC = `# Program\n\n## A Long Section\n\n${longBody}\n`;

  test('an injected transport polishes weak summaries; structure is untouched', async () => {
    const doc = chompMarkdownDoc(DOC, { sourcePath: 'PLAN.md' });
    const transport = {
      label: 'fake:model',
      complete: async () => ({ ok: true, text: 'One crisp line about the section.' }),
    };
    const enrichment = await enrichChompedItems(doc.items, { transport });
    expect(enrichment.applied).toBeGreaterThan(0);
    const section = doc.items.find((i) => i.slug === 'a-long-section');
    expect(section.summaryMd).toBe('One crisp line about the section.');
    // Structure survives enrichment verbatim.
    expect(section.kind).toBe('epic');
    expect(section.parent).toBe('program');
    expect(section.descriptionMd).toContain('Detailed rationale');
  });

  test('a failing transport leaves the deterministic extraction unchanged', async () => {
    const doc = chompMarkdownDoc(DOC, { sourcePath: 'PLAN.md' });
    const transport = {
      complete: async () => ({ ok: false, error: 'backend unavailable' }),
    };
    const enrichment = await enrichChompedItems(doc.items, { transport });
    expect(enrichment.applied).toBe(0);
    expect(doc.items.find((i) => i.slug === 'a-long-section').summaryMd).toBe('A Long Section');
  });
});

describe('POST /roadmap/chomp (HTTP surface)', () => {
  let app;
  let db;
  let roadmap;
  let graphEdges;
  let root;
  const savedEnv = {};

  beforeEach(async () => {
    // Ensure no ambient fleet backend config makes `enrich` accidentally live.
    for (const key of ['PD_CHOMP_BACKEND', 'PD_FLEET_DEFAULT_BACKEND', 'PORT_DADDY_FLEET_DEFAULT_BACKEND']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    db = createTestDb();
    roadmap = createRoadmapItems({ db, tuples: createTupleSpace(db) });
    graphEdges = createGraphEdges(db);
    root = mkdtempSync(join(SCRATCH_BASE, 'pd-chomp-route-'));
    writeFileSync(join(root, 'PLAN.md'), PLAN_MD, 'utf-8');
    app = Fastify();
    await app.register(roadmapPlugin, {
      deps: {
        roadmapItems: roadmap,
        roadmapPromote: { promoteFromFeedback: () => { throw new Error('unused'); } },
        graphEdges,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (app) await app.close();
    if (db) db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('chomps docs end-to-end through the daemon route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/chomp',
      payload: { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', by: 'route-test' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.inserted).toHaveLength(6);
    expect(roadmap.get('phase-1-foundation', 'fleet').kind).toBe('epic');
    expect(graphEdges.list({ scope: HIERARCHY_SCOPE, limit: 100 })).toHaveLength(5);
  });

  test('rejects a body without rootDir or paths', async () => {
    const noRoot = await app.inject({ method: 'POST', url: '/roadmap/chomp', payload: { paths: ['x'] } });
    expect(noRoot.statusCode).toBe(400);
    const noPaths = await app.inject({ method: 'POST', url: '/roadmap/chomp', payload: { rootDir: root } });
    expect(noPaths.statusCode).toBe(400);
  });

  test('enrich with no configured backend degrades honestly to deterministic-only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/chomp',
      payload: { rootDir: root, paths: ['PLAN.md'], harbor: 'fleet', enrich: true },
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.enrichment).toEqual({ requested: true, attempted: 0, applied: 0, backend: null });
    expect(body.warnings.some((w) => w.includes('no LLM backend is configured'))).toBe(true);
    // Deterministic extraction still landed.
    expect(body.inserted).toHaveLength(6);
  });
});
