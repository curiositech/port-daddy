import { mkdtempSync, writeFileSync, mkdirSync, rmSync, mkdirSync as ensureDir } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
// Legacy-source equivalence suite: the fixed 3-pile importer was supplanted by
// the general chomper (lib/roadmap-chomp.ts), and these assertions prove the
// three canonical sources still import IDENTICALLY through the new path —
// same candidates, precedence, filters, idempotency, and enriched-row
// protection the old lib/roadmap-import.ts promised.
import {
  collectImportCandidates,
  importMarkdownRoadmap,
} from '../../lib/roadmap-chomp.js';

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

  test('re-import never clobbers richer provenance/summary recorded after first import', () => {
    // First backfill stamps the import agent.
    importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet', by: 'roadmap-import' });

    // A real agent then enriches the row (as `pd roadmap promote` / an
    // interactive upsert would): a different promoter, a richer summary, and a
    // moved status.
    roadmap.upsert({
      slug: 'incremental-symbol-index-refresh',
      summaryMd: 'Hand-curated detail an agent added after triage.',
      status: 'backlog',
      promotedByAgentId: 'alice:cartographer',
      harbor: 'fleet',
    });

    // Re-running the import must NOT erase any of that.
    const second = importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet', by: 'roadmap-import' });
    expect(second.updated).toContain('incremental-symbol-index-refresh');

    const item = roadmap.get('incremental-symbol-index-refresh', 'fleet');
    expect(item.promotedByAgentId).toBe('alice:cartographer');
    expect(item.summaryMd).toBe('Hand-curated detail an agent added after triage.');
    expect(item.status).toBe('backlog');
  });

  test('dogfood entries are filtered to status:now (symmetry with ideas-trove)', () => {
    writeFixtures(root, {
      dogfood: `# Dogfood Feedback

### \`dogfood-now-entry\`

- status: \`now\`
- surface: Fleet UI
  - should be imported

### \`dogfood-backlog-entry\`

- status: \`backlog\`
- surface: nowhere
  - should NOT be imported

### \`dogfood-no-status-entry\`

- surface: nowhere
  - unknown status, should NOT be imported
`,
    });
    importMarkdownRoadmap(roadmap, { rootDir: root, harbor: 'fleet' });
    const slugs = roadmap.list({ harbor: 'fleet', status: 'all' }).map((i) => i.slug);
    expect(slugs).toContain('dogfood-now-entry');
    expect(slugs).not.toContain('dogfood-backlog-entry');
    expect(slugs).not.toContain('dogfood-no-status-entry');
  });
});
