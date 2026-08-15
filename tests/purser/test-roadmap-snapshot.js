import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);

// Doc-authority (the human narrative registry) per docs/roadmap/AUTHORITY.md.
// The Coordination Papers program is the one place where the narrative doc and
// the registry projection carry the SAME join keys and statuses, so we read it
// as an independent second source rather than freezing prose in this file.
const programDoc = readFileSync(
  new URL('../../docs/roadmap/whitepaper-research-program.md', import.meta.url),
  'utf8',
);

/** Parse the `| \`link:<slug>\` | <status> | ... |` rows out of the narrative registry table. */
function parseNarrativeRegistry(md) {
  const rows = new Map();
  const re = /^\|\s*`link:([A-Za-z0-9-]+)`\s*\|\s*([a-z]+)\s*\|/gm;
  let m;
  while ((m = re.exec(md)) !== null) rows.set(m[1], m[2]);
  return rows;
}

/**
 * AUTHORITY.md rule 1: the snapshot is an APPEND-ONLY projection of the daemon
 * `roadmap_items` table. The roadmap is expected to grow, so an equality
 * assertion on the item count is a treadmill that has to be edited on every
 * addition and therefore tests nothing. This floor is a one-way ratchet
 * instead: additions never require touching it, and it can only fail if the
 * projection SHRINKS — which is precisely the DB-fragmentation regression
 * AUTHORITY.md names ("never regenerate it via a full export — that is the
 * fragmentation hazard that drops live upserts"). Lowering it must be a
 * conscious, reviewed act.
 */
const APPEND_ONLY_FLOOR = 270;

/** Slugs are lowercase-kebab, but ADR phase slugs legitimately carry L1/L2/L3. */
const SLUG_RE = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
const STATUS_RE = /^[a-z][a-z-]*$/;

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    // The count field is written by scripts/export-roadmap-snapshot.ts as
    // `count: items.length` in the same object literal, so it is a
    // self-consistency field, not an independent cross-check. Assert the
    // invariant it actually encodes.
    assert.equal(
      snapshot.count,
      snapshot.items.length,
      'snapshot.count must agree with the projected item array',
    );

    assert.ok(
      snapshot.items.length >= APPEND_ONLY_FLOOR,
      `append-only projection shrank: ${snapshot.items.length} items < floor ${APPEND_ONLY_FLOOR}. ` +
        'Per docs/roadmap/AUTHORITY.md the snapshot may only grow; a drop means a full ' +
        'export overwrote live upserts.',
    );

    assert.equal(snapshot.harbor, 'port-daddy', 'snapshot must project the port-daddy harbor');

    for (const item of snapshot.items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['slug', 'status', 'summaryMd'],
        `item ${item.slug} must carry exactly slug/status/summaryMd`,
      );
      assert.match(item.slug, SLUG_RE, `malformed slug: ${JSON.stringify(item.slug)}`);
      assert.match(item.status, STATUS_RE, `malformed status on ${item.slug}: ${item.status}`);
      assert.equal(typeof item.summaryMd, 'string', `${item.slug} summaryMd must be a string`);
      assert.ok(
        item.summaryMd.trim().length > 0,
        `${item.slug} must carry a non-empty summary — an empty projection row is not a link oracle`,
      );
    }

    const slugs = snapshot.items.map(({ slug }) => slug);
    assert.equal(new Set(slugs).size, slugs.length, 'snapshot must not contain duplicate slugs');
    assert.deepEqual(
      slugs,
      [...slugs].sort((a, b) => a.localeCompare(b)),
      'items must be emitted in the deterministic localeCompare slug order the exporter guarantees',
    );
  });

  it('preserves the append-only durable spawn receipts projection', () => {
    // Deliberately kept, and currently RED. `durable-asynchronous-spawn-receipts`
    // was projected into the mirror on purpose by 45c67731b ("chore(roadmap):
    // project durable spawn receipts") and covered by 74941cd61 ("test(roadmap):
    // cover spawn receipt projection"). It was then silently dropped by
    // bd9ff781e, whose own commit body says the snapshot was "Regenerated with
    // scripts/export-roadmap-snapshot.ts" — the exact full-export move
    // docs/roadmap/AUTHORITY.md rule 1 forbids because it drops live upserts.
    // The repair belongs in the daemon table / projection path, NOT in
    // hand-editing this mirror. See the note in this test's report.
    const matches = snapshot.items.filter(
      ({ slug }) => slug === 'durable-asynchronous-spawn-receipts',
    );
    assert.equal(
      matches.length,
      1,
      'durable-asynchronous-spawn-receipts vanished from the append-only projection ' +
        '(dropped by the full re-export in bd9ff781e; see docs/roadmap/AUTHORITY.md rule 1)',
    );
    assert.deepEqual(matches, [
      {
        slug: 'durable-asynchronous-spawn-receipts',
        status: 'now',
        summaryMd:
          'Durable idempotent admission, lifecycle, liveness, cancellation, and collection receipts for background agent runs.',
      },
    ]);
  });

  it('contains the exact four-item Coordination Papers program', () => {
    const narrative = parseNarrativeRegistry(programDoc);
    assert.equal(
      narrative.size,
      4,
      'the narrative registry table in whitepaper-research-program.md must list exactly four items',
    );

    // "Exact" means set equality in both directions: the program is neither
    // missing an item nor quietly grown a fifth one. Nothing here freezes
    // editorial prose, which the daemon rewrites as items are refined.
    const snapshotProgram = snapshot.items.filter(({ slug }) =>
      slug.startsWith('coordination-papers-'),
    );
    assert.deepEqual(
      snapshotProgram.map(({ slug }) => slug).sort(),
      [...narrative.keys()].sort(),
      'the coordination-papers-* slugs in the registry projection must exactly match the ' +
        'narrative registry table — no unlanded item silently absent, no fifth item silently added',
    );

    for (const [slug, docStatus] of narrative) {
      const matches = snapshot.items.filter((item) => item.slug === slug);
      assert.equal(matches.length, 1, `${slug} must occur exactly once`);
      // Doc-authority and registry-authority must agree on status. This is the
      // real cross-source check AUTHORITY.md rule 3 names as the reconciliation
      // gate; it fails if either surface drifts from the other.
      assert.equal(
        matches[0].status,
        docStatus,
        `${slug} status drift: snapshot says "${matches[0].status}", ` +
          `docs/roadmap/whitepaper-research-program.md says "${docStatus}"`,
      );
      assert.ok(
        matches[0].summaryMd.trim().length >= 40,
        `${slug} must carry a substantive summary, got: ${JSON.stringify(matches[0].summaryMd)}`,
      );
    }
  });

  it('preserves an unrelated roadmap item', () => {
    const item = snapshot.items.find(({ slug }) => slug === 'workintent-dispatch-isolation');
    assert.deepEqual(
      { status: item?.status, summaryMd: item?.summaryMd },
      { status: 'backlog', summaryMd: 'fix(dispatch): isolate WorkIntent worktrees' },
    );
  });

  it('has a fresh, well-formed generation timestamp', () => {
    assert.ok(Number.isSafeInteger(snapshot.generatedAt));
    assert.ok(snapshot.generatedAt > 1_784_852_769_105);
  });
});
