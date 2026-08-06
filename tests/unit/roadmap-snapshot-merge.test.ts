import { mergeSnapshots, type Snapshot, type SnapshotItem } from '../../lib/roadmap-snapshot-merge';

function item(slug: string, status = 'now', summaryMd = `summary for ${slug}`): SnapshotItem {
  return { slug, status, summaryMd };
}

function snap(items: SnapshotItem[], generatedAt: number, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt,
    harbor: 'port-daddy',
    source: 'http://127.0.0.1:9876',
    count: items.length,
    items,
    ...extra,
  };
}

describe('mergeSnapshots', () => {
  test('two branches adding DIFFERENT new items merge into a clean union (the common case)', () => {
    const base = snap([item('a'), item('b')], 1_000);
    const ours = snap([item('a'), item('b'), item('c-only-ours')], 2_000);
    const theirs = snap([item('a'), item('b'), item('d-only-theirs')], 3_000);

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(snapshot.items.map((i) => i.slug)).toEqual(['a', 'b', 'c-only-ours', 'd-only-theirs']);
    expect(snapshot.count).toBe(4);
  });

  test('independent identical additions on both sides collapse to one entry, no conflict', () => {
    const base = snap([item('a')], 1_000);
    const same = item('new-item', 'backlog', 'same content both branches derived independently');
    const ours = snap([item('a'), same], 2_000);
    const theirs = snap([item('a'), same], 3_000);

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(snapshot.items).toEqual([item('a'), same]);
  });

  test('a real edit to the SAME slug, differently on both sides, is a reported conflict', () => {
    const base = snap([item('x', 'backlog')], 1_000);
    const ours = snap([item('x', 'now')], 2_000);
    const theirs = snap([item('x', 'done')], 3_000);

    const { conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      slug: 'x',
      base: item('x', 'backlog'),
      ours: item('x', 'now'),
      theirs: item('x', 'done'),
    });
  });

  test('ours DELETES a slug that theirs EDITED — a real conflict, and the merged file keeps theirs\' edit rather than silently dropping the item', () => {
    const base = snap([item('w', 'backlog'), item('keep')], 1_000);
    const ours = snap([item('keep')], 2_000); // ours dropped "w" entirely
    const theirs = snap([item('w', 'now'), item('keep')], 3_000); // theirs advanced "w"

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ slug: 'w', ours: null, theirs: item('w', 'now') });
    // The item must still be present in the merged output — dropping it
    // silently would make the conflict harder to notice and resolve, not
    // easier (this is the fix for the Copilot review finding on this PR).
    expect(snapshot.items.find((i) => i.slug === 'w')).toEqual(item('w', 'now'));
  });

  test('theirs DELETES a slug that ours EDITED — symmetric case, ours\' edit is kept', () => {
    const base = snap([item('v', 'backlog'), item('keep')], 1_000);
    const ours = snap([item('v', 'now'), item('keep')], 2_000); // ours advanced "v"
    const theirs = snap([item('keep')], 3_000); // theirs dropped "v" entirely

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ slug: 'v', ours: item('v', 'now'), theirs: null });
    expect(snapshot.items.find((i) => i.slug === 'v')).toEqual(item('v', 'now'));
  });

  test('one side edits a slug, the other leaves it untouched — the edit wins, no conflict', () => {
    const base = snap([item('y', 'backlog')], 1_000);
    const ours = snap([item('y', 'now')], 2_000); // ours advanced status
    const theirs = snap([item('y', 'backlog')], 1_500); // theirs untouched

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(snapshot.items).toEqual([item('y', 'now')]);
  });

  test('one side deletes an item the other left untouched — the deletion wins, no conflict', () => {
    const base = snap([item('z'), item('keep')], 1_000);
    const ours = snap([item('keep')], 2_000); // ours dropped "z"
    const theirs = snap([item('z'), item('keep')], 1_800); // theirs untouched

    const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(snapshot.items.map((i) => i.slug)).toEqual(['keep']);
  });

  test('generatedAt is the max of both sides — the freshest known regeneration wins deterministically', () => {
    const base = snap([item('a')], 1_000);
    const ours = snap([item('a')], 5_000);
    const theirs = snap([item('a')], 9_000);

    expect(mergeSnapshots(base, ours, theirs).snapshot.generatedAt).toBe(9_000);
    // Order-independence: swapping ours/theirs still yields the max.
    expect(mergeSnapshots(base, theirs, ours).snapshot.generatedAt).toBe(9_000);
  });

  test('output is always sorted by slug, regardless of input order', () => {
    const base = snap([], 1_000);
    const ours = snap([item('zeta'), item('alpha')], 2_000);
    const theirs = snap([item('mu')], 3_000);

    const { snapshot } = mergeSnapshots(base, ours, theirs);

    expect(snapshot.items.map((i) => i.slug)).toEqual(['alpha', 'mu', 'zeta']);
  });

  test('missing base (unavailable common ancestor) treats every differing slug as changed-by-both', () => {
    const ours = snap([item('a', 'now')], 2_000);
    const theirs = snap([item('a', 'done')], 3_000);

    const { conflicts } = mergeSnapshots(null, ours, theirs);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].base).toBeNull();
  });

  test('is deterministic: merging the same three inputs twice yields byte-identical JSON', () => {
    const base = snap([item('a'), item('b')], 1_000);
    const ours = snap([item('a'), item('b'), item('c')], 2_000);
    const theirs = snap([item('a'), item('b'), item('d')], 3_000);

    const first = JSON.stringify(mergeSnapshots(base, ours, theirs).snapshot);
    const second = JSON.stringify(mergeSnapshots(base, ours, theirs).snapshot);

    expect(first).toBe(second);
  });
});
