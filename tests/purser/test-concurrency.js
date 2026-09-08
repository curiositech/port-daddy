import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);
const programSlugs = [
  'coordination-papers-mega-volume',
  'coordination-papers-proof-program',
  'coordination-papers-empirical-program',
  'coordination-papers-runtime-closure',
];
const programItems = snapshot.items.filter(({ slug }) => programSlugs.includes(slug));

function project(items, updates) {
  const bySlug = new Map(items.map((item) => [item.slug, structuredClone(item)]));
  for (const item of updates) bySlug.set(item.slug, structuredClone(item));
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

describe('roadmap projection idempotency', () => {
  it('is stable when the same update batch is replayed', () => {
    const once = project(snapshot.items, programItems);
    const twice = project(once, programItems);
    assert.deepEqual(twice, once);
    assert.equal(twice.length, snapshot.count);
  });

  it('converges when an equivalent batch arrives in a different order', () => {
    assert.deepEqual(
      project(snapshot.items, [...programItems].reverse()),
      project(snapshot.items, programItems),
    );
  });

  it('keeps exactly one canonical entry per program slug after replay', () => {
    const replayed = project(project(snapshot.items, programItems), [...programItems, ...programItems]);
    for (const slug of programSlugs) {
      assert.equal(replayed.filter((item) => item.slug === slug).length, 1);
    }
  });

  it('round-trips the committed projection without loss', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  });
});
