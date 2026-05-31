import { mkdtempSync, writeFileSync, mkdirSync, rmSync, mkdirSync as ensureDir } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import {
  collectImportCandidates,
  importMarkdownRoadmap,
} from '../../lib/roadmap-import.js';

// Scratch dir lives under ~/coding/tmp per repo policy (NEVER /tmp — the OS
// purges it). Fixtures are cleaned in afterEach regardless.
const SCRATCH_BASE = process.env.PD_TEST_SCRATCH || join(homedir(), 'coding', 'tmp');
ensureDir(SCRATCH_BASE, { recursive: true });

const ROADMAP_MD = `# Roadmap

Some human prose.

## Next Cuts (From Curated Trove)

Intro paragraph the render preserves.

- **\`incremental-symbol-index-refresh\`** — Add filesystem-driven incremental
  refresh so merge-risk predictions stay current.
- **\`symbol-graph-visualization\`** — Add a visual graph panel and export route.
- **\`daemon-introspection-api\`** — Add GET /daemon/introspect for a unified
  daemon health view.

## Phase 1

(other stuff render must not touch)
`;

const IDEAS_TROVE_MD = `# Ideas Trove

## Immediate Implementation Candidates

### \`operator-hint-engine\`

- status: \`now\`
- surface: dashboard
  - the what-to-do-next hint layer

### \`daemon-introspection-api\`

- status: \`now\`
- surface: Crew panel
  - duplicate of a next-cut, should de-dupe

### \`some-backlog-idea\`

- status: \`backlog\`
- surface: nowhere
  - should NOT be imported (not now-status)
`;

const DOGFOOD_MD = `# Dogfood Feedback

### \`coordination-ticker-as-high-signal-feed\`

- status: \`now\`
- surface: Fleet UI
  - operator wants a ticker
`;

function writeFixtures(root, { roadmap = ROADMAP_MD, ideas = IDEAS_TROVE_MD, dogfood = DOGFOOD_MD } = {}) {
  mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
  writeFileSync(join(root, 'docs', 'ROADMAP.md'), roadmap, 'utf-8');
  writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), ideas, 'utf-8');
  writeFileSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'), dogfood, 'utf-8');
}

describe('collectImportCandidates (pure parse + de-dupe)', () => {
  test('parses next-cuts, ideas-now, and dogfood; drops non-now ideas', () => {
    const { candidates, parsed } = collectImportCandidates({
      roadmapMd: ROADMAP_MD,
      ideasTroveMd: IDEAS_TROVE_MD,
      dogfoodMd: DOGFOOD_MD,
    });
    const slugs = candidates.map((c) => c.slug);

    // 3 next-cuts + operator-hint-engine (ideas-now, not dup) + dogfood ticker.
    // daemon-introspection-api appears in BOTH next-cuts and ideas-now → one row.
    expect(slugs).toContain('incremental-symbol-index-refresh');
    expect(slugs).toContain('symbol-graph-visualization');
    expect(slugs).toContain('daemon-introspection-api');
    expect(slugs).toContain('operator-hint-engine');
    expect(slugs).toContain('coordination-ticker-as-high-signal-feed');
    expect(slugs).not.toContain('some-backlog-idea');

    // No duplicate row for the slug that appears in two piles.
    expect(slugs.filter((s) => s === 'daemon-introspection-api')).toHaveLength(1);

    expect(parsed.nextCuts).toBe(3);
    expect(parsed.ideasNow).toBe(2); // both now-status ideas counted
    expect(parsed.dogfood).toBe(1);
  });

  test('next-cut wins precedence over ideas-now for a shared slug', () => {
    const { candidates } = collectImportCandidates({
      roadmapMd: ROADMAP_MD,
      ideasTroveMd: IDEAS_TROVE_MD,
      dogfoodMd: DOGFOOD_MD,
    });
    const introspect = candidates.find((c) => c.slug === 'daemon-introspection-api');
    expect(introspect.source).toBe('next-cut');
    expect(introspect.summaryMd).toContain('GET /daemon/introspect');
  });

  test('handles missing piles gracefully', () => {
    const { candidates, parsed } = collectImportCandidates({
      roadmapMd: null,
      ideasTroveMd: null,
      dogfoodMd: null,
    });
    expect(candidates).toHaveLength(0);
    expect(parsed).toEqual({ nextCuts: 0, ideasNow: 0, dogfood: 0 });
  });
});

describe('importMarkdownRoadmap (backfill into roadmap_items)', () => {
  let db;
  let tuples;
  let roadmap;
  let root;

  beforeEach(() => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    roadmap = createRoadmapItems({ db, tuples });
    root = mkdtempSync(join(SCRATCH_BASE, 'pd-roadmap-import-'));
    writeFixtures(root);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('upserts every curated entry into the table (nothing lost)', () => {
    const result = importMarkdownRoadmap(roadmap, { root: root, rootDir: root, harbor: 'fleet' });

    // 5 unique slugs after de-dupe.
    expect(result.candidates).toHaveLength(5);
    expect(result.inserted).toHaveLength(5);
    expect(result.updated).toHaveLength(0);

    const inTable = roadmap.list({ harbor: 'fleet', status: 'all' }).map((i) => i.slug).sort();
    expect(inTable).toEqual(
      [
        'coordination-ticker-as-high-signal-feed',
        'daemon-introspection-api',
        'incremental-symbol-index-refresh',
        'operator-hint-engine',
        'symbol-graph-visualization',
      ].sort(),
    );
  });

  test('is idempotent — re-running produces no new rows and no data loss', () => {
    const first = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet' });
    const before = roadmap.list({ harbor: 'fleet', status: 'all' });

    const second = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet' });
    const after = roadmap.list({ harbor: 'fleet', status: 'all' });

    expect(second.inserted).toHaveLength(0);
    expect(second.updated).toHaveLength(first.candidates.length);
    expect(after).toHaveLength(before.length);

    // Same slugs, same summaries survive the second pass.
    const beforeSlugs = before.map((i) => i.slug).sort();
    const afterSlugs = after.map((i) => i.slug).sort();
    expect(afterSlugs).toEqual(beforeSlugs);
    for (const item of after) {
      const match = before.find((b) => b.slug === item.slug);
      expect(item.summaryMd).toBe(match.summaryMd);
    }
  });

  test('dry-run reports candidates without writing rows', () => {
    const result = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet', dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(roadmap.list({ harbor: 'fleet', status: 'all' })).toHaveLength(0);
  });

  test('reports missing files but still imports what exists', () => {
    rmSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'));
    const result = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet' });
    expect(result.missingFiles.some((p) => p.endsWith('DOGFOOD-FEEDBACK.md'))).toBe(true);
    // dogfood-only slug should be absent; the others still imported.
    const slugs = roadmap.list({ harbor: 'fleet', status: 'all' }).map((i) => i.slug);
    expect(slugs).not.toContain('coordination-ticker-as-high-signal-feed');
    expect(slugs).toContain('daemon-introspection-api');
  });

  test('imported rows are marked promotedByAgentId and status now', () => {
    importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet', by: 'roadmap-import' });
    const item = roadmap.get('incremental-symbol-index-refresh', 'fleet');
    expect(item).not.toBeNull();
    expect(item.status).toBe('now');
    expect(item.promotedByAgentId).toBe('roadmap-import');
  });
});
