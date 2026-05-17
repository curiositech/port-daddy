/**
 * Unit tests for lib/roadmap-pop.ts — atomic claim from the curated pile.
 * Covers: empty-pile, single-claim, kind precedence, slug targeting,
 * already-claimed (409), constraint-driven contention, release, listClaims.
 *
 * Atomicity verified through the partial UNIQUE index `roadmap_claims(slug)
 * WHERE released_at IS NULL`. Two pops on the same slug each attempt to
 * INSERT a *separate* row; the partial UNIQUE index rejects the second
 * insert (SQLITE_CONSTRAINT_UNIQUE); the module catches that error and
 * tries the next candidate (or returns slug-already-claimed when --slug
 * was targeted).
 */

import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createFeedback } from '../../lib/feedback.js';
import { createRoadmapPop } from '../../lib/roadmap-pop.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db;
let tuples;
let feedback;
let pop;
let clock;
let scratchRoot;

const HARBOR = 'port-daddy:fleet';

function writeRoadmapFiles(opts = {}) {
  // The user-level "no /tmp" rule applies to durable scratch; mkdtemp
  // gives us a per-test dir; we rm it in afterEach so it never lingers.
  scratchRoot = mkdtempSync(join(tmpdir(), 'pd-roadmap-pop-test-'));
  mkdirSync(join(scratchRoot, 'docs', 'recovery'), { recursive: true });

  if (opts.nextCuts) {
    writeFileSync(
      join(scratchRoot, 'docs', 'ROADMAP.md'),
      `# Roadmap\n\n## Next Cuts (From Curated Trove)\n\n${opts.nextCuts
        .map((c) => `- **\`${c.slug}\`** — ${c.summary}`)
        .join('\n')}\n`,
    );
  } else {
    writeFileSync(join(scratchRoot, 'docs', 'ROADMAP.md'), '# Roadmap\n\n## Next Cuts\n\n');
  }

  if (opts.ideasNow) {
    writeFileSync(
      join(scratchRoot, 'docs', 'recovery', 'IDEAS-TROVE.md'),
      `# Ideas Trove\n\n${opts.ideasNow
        .map((e) => `### \`${e.slug}\`\n\n- status: now\n- surface: ${e.surface ?? 'CLI'}\n- ${e.hook ?? e.slug}\n`)
        .join('\n')}\n`,
    );
  } else {
    writeFileSync(join(scratchRoot, 'docs', 'recovery', 'IDEAS-TROVE.md'), '# Ideas Trove\n');
  }

  if (opts.dogfood) {
    writeFileSync(
      join(scratchRoot, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'),
      `# Dogfood\n\n${opts.dogfood
        .map((e) => `### \`${e.slug}\`\n\n- status: now\n- surface: ${e.surface ?? 'CLI'}\n- ${e.hook ?? e.slug}\n`)
        .join('\n')}\n`,
    );
  }

  return scratchRoot;
}

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  feedback = createFeedback({ tuples, now: () => clock });
  pop = createRoadmapPop({ db, feedback, now: () => clock });
});

afterEach(() => {
  db.close();
  if (scratchRoot) {
    rmSync(scratchRoot, { recursive: true, force: true });
    scratchRoot = undefined;
  }
});

describe('pop()', () => {
  test('returns pile-empty when nothing is on any pile', () => {
    const root = writeRoadmapFiles({});
    const result = pop.pop({ claimedBy: 'agent-a', rootDir: root });
    expect(result).toEqual({ reason: 'pile-empty' });
  });

  test('claims a next-cut when only next-cuts have entries', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'pd-route', summary: 'Route inbound requests.' }],
    });
    const result = pop.pop({ claimedBy: 'agent-a', rootDir: root });
    expect('entry' in result).toBe(true);
    expect(result.entry.slug).toBe('pd-route');
    expect(result.entry.kind).toBe('next-cut');
    expect(result.claim.claimedBy).toBe('agent-a');
    expect(result.claim.releasedAt).toBeNull();
  });

  test('precedence: live > next-cut > now > feedback', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
      ideasNow: [{ slug: 'now-1', hook: 'now one' }],
      dogfood: [{ slug: 'fb-1', hook: 'feedback one' }],
    });
    feedback.drop({
      slug: 'live-1',
      summary: 'live one',
      droppedBy: 'agent-x',
      severity: 'high',
      source: 'agent',
      harbor: HARBOR,
    });

    const result = pop.pop({ claimedBy: 'agent-a', rootDir: root, feedbackHarbor: HARBOR });
    expect('entry' in result).toBe(true);
    expect(result.entry.kind).toBe('live');
    expect(result.entry.slug).toBe('live-1');
  });

  test('--kind filters to that pile only', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
    });
    feedback.drop({
      slug: 'live-1',
      summary: 'live one',
      droppedBy: 'agent-x',
      harbor: HARBOR,
    });
    const result = pop.pop({ claimedBy: 'agent-a', kind: 'next-cut', rootDir: root, feedbackHarbor: HARBOR });
    expect('entry' in result).toBe(true);
    expect(result.entry.kind).toBe('next-cut');
    expect(result.entry.slug).toBe('cut-1');
  });

  test('second pop skips the first claim and grabs the next candidate', () => {
    const root = writeRoadmapFiles({
      nextCuts: [
        { slug: 'cut-1', summary: 'cut one' },
        { slug: 'cut-2', summary: 'cut two' },
      ],
    });
    const first = pop.pop({ claimedBy: 'agent-a', rootDir: root });
    const second = pop.pop({ claimedBy: 'agent-b', rootDir: root });
    expect(first.entry.slug).toBe('cut-1');
    expect(second.entry.slug).toBe('cut-2');
  });

  test('returns pile-empty after every entry is claimed', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'only-1', summary: 'the only' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    const second = pop.pop({ claimedBy: 'agent-b', rootDir: root });
    expect(second).toEqual({ reason: 'pile-empty' });
  });

  test('--slug claims the specified entry', () => {
    const root = writeRoadmapFiles({
      nextCuts: [
        { slug: 'cut-1', summary: 'cut one' },
        { slug: 'cut-2', summary: 'cut two' },
      ],
    });
    const result = pop.pop({ claimedBy: 'agent-a', slug: 'cut-2', rootDir: root });
    expect(result.entry.slug).toBe('cut-2');
  });

  test('--slug returns slug-not-on-pile if missing', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
    });
    const result = pop.pop({ claimedBy: 'agent-a', slug: 'nope', rootDir: root });
    expect(result).toEqual({ reason: 'slug-not-on-pile', slug: 'nope' });
  });

  test('--slug returns slug-already-claimed when contended', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
    });
    pop.pop({ claimedBy: 'agent-a', slug: 'cut-1', rootDir: root });
    const second = pop.pop({ claimedBy: 'agent-b', slug: 'cut-1', rootDir: root });
    expect(second.reason).toBe('slug-already-claimed');
    expect(second.slug).toBe('cut-1');
    expect(second.claim).not.toBeNull();
    expect(second.claim.claimedBy).toBe('agent-a');
  });

  test('malformed payload in DB does not crash listClaims or getActiveClaim', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    // Corrupt the payload as if a manual edit or partial write happened.
    db.prepare('UPDATE roadmap_claims SET payload = ? WHERE slug = ?').run('not-json{', 'cut-1');
    expect(() => pop.listClaims()).not.toThrow();
    const claims = pop.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].payload).toBeNull();
    expect(pop.getActiveClaim('cut-1')?.payload).toBeNull();
  });

  test('two concurrent pops on identical 1-item piles cannot both succeed', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'lonely-1', summary: 'only entry' }],
    });
    // The pop module is synchronous; back-to-back calls simulate the
    // worst case (no event-loop yield between them).
    const a = pop.pop({ claimedBy: 'agent-a', rootDir: root });
    const b = pop.pop({ claimedBy: 'agent-b', rootDir: root });
    const got = [a, b].filter((r) => 'entry' in r);
    const missed = [a, b].filter((r) => 'reason' in r);
    expect(got).toHaveLength(1);
    expect(missed).toHaveLength(1);
    expect(missed[0].reason).toBe('pile-empty');
  });

  test('rejects missing claimedBy', () => {
    expect(() => pop.pop({ claimedBy: '', rootDir: scratchRoot ?? '/' })).toThrow(/claimedBy/);
  });
});

describe('release()', () => {
  test('lifts the active claim so the slug can be re-popped', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'cut one' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    clock += 1; // ensure released_at differs from claimed_at
    const released = pop.release({ slug: 'cut-1', releasedBy: 'agent-a', reason: 'abandoned' });
    expect(released.released).toBe(true);
    expect(released.claim?.releaseReason).toBe('abandoned');

    clock += 1;
    const re = pop.pop({ claimedBy: 'agent-b', rootDir: root });
    expect('entry' in re).toBe(true);
    expect(re.entry.slug).toBe('cut-1');
    expect(re.claim.claimedBy).toBe('agent-b');
  });

  test('returns released=false when slug has no active claim', () => {
    const result = pop.release({ slug: 'never-claimed', releasedBy: 'agent-a' });
    expect(result.released).toBe(false);
    expect(result.claim).toBeNull();
  });

  test('rejects missing slug or releasedBy', () => {
    expect(() => pop.release({ slug: '', releasedBy: 'a' })).toThrow(/slug/);
    expect(() => pop.release({ slug: 'x', releasedBy: '' })).toThrow(/releasedBy/);
  });
});

describe('listClaims()', () => {
  test('lists open claims by default, newest first', () => {
    const root = writeRoadmapFiles({
      nextCuts: [
        { slug: 'cut-1', summary: 'one' },
        { slug: 'cut-2', summary: 'two' },
      ],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    clock += 1000;
    pop.pop({ claimedBy: 'agent-b', rootDir: root });
    const claims = pop.listClaims();
    expect(claims).toHaveLength(2);
    expect(claims[0].slug).toBe('cut-2');
    expect(claims[1].slug).toBe('cut-1');
  });

  test('filters by claimedBy', () => {
    const root = writeRoadmapFiles({
      nextCuts: [
        { slug: 'cut-1', summary: 'one' },
        { slug: 'cut-2', summary: 'two' },
      ],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    pop.pop({ claimedBy: 'agent-b', rootDir: root });
    const mine = pop.listClaims({ claimedBy: 'agent-a' });
    expect(mine).toHaveLength(1);
    expect(mine[0].claimedBy).toBe('agent-a');
  });

  test('status=released excludes open claims', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'one' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    expect(pop.listClaims({ status: 'released' })).toHaveLength(0);
    pop.release({ slug: 'cut-1', releasedBy: 'agent-a' });
    expect(pop.listClaims({ status: 'released' })).toHaveLength(1);
    expect(pop.listClaims({ status: 'open' })).toHaveLength(0);
    expect(pop.listClaims({ status: 'all' })).toHaveLength(1);
  });
});

describe('getActiveClaim()', () => {
  test('returns null when no claim exists', () => {
    expect(pop.getActiveClaim('nope')).toBeNull();
  });
  test('returns the claim when active', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'one' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    const claim = pop.getActiveClaim('cut-1');
    expect(claim?.claimedBy).toBe('agent-a');
  });
  test('returns null after release', () => {
    const root = writeRoadmapFiles({
      nextCuts: [{ slug: 'cut-1', summary: 'one' }],
    });
    pop.pop({ claimedBy: 'agent-a', rootDir: root });
    pop.release({ slug: 'cut-1', releasedBy: 'agent-a' });
    expect(pop.getActiveClaim('cut-1')).toBeNull();
  });
});
