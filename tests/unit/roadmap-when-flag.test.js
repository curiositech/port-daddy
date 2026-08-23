/**
 * Value validation at the `pd roadmap upsert` boundary: the `--start`/`--due`
 * date parser and the `--priority`/`--estimate` numeric flags.
 *
 * The contract under test: for dates, exactly three shapes parse (epoch ms,
 * ISO `YYYY-MM-DD`, `+Nd` relative days) and EVERYTHING else returns undefined;
 * for numbers, only whole numbers in band pass. Everything rejected is
 * rejected LOUDLY — the operator sees an error instead of a silently different
 * date, a silently clamped priority, or a silently cleared estimate.
 *
 * Three describes, because a parser returning undefined is only part of the
 * guarantee:
 *   1. the parser itself, including the `Date.parse` leniency it must not
 *      inherit (calendar overflow rolls `2023-02-30` into March);
 *   2. the command end to end — a bad value aborts with a non-zero exit and
 *      never reaches the daemon;
 *   3. the reason that matters — what an un-validated flag actually did once
 *      it was on the wire.
 */
import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const { parseWhenFlag, handleRoadmap } = await import('../../cli/commands/roadmap.js');

describe('parseWhenFlag', () => {
  test('parses a 13-digit epoch-ms timestamp verbatim', () => {
    expect(parseWhenFlag('1787260000000')).toBe(1_787_260_000_000);
  });

  test('parses an ISO calendar date', () => {
    const ms = parseWhenFlag('2026-09-01');
    expect(typeof ms).toBe('number');
    expect(new Date(ms).getUTCFullYear()).toBe(2026);
    expect(new Date(ms).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  test('parses +Nd as N days from now', () => {
    const before = Date.now();
    const ms = parseWhenFlag('+14d');
    expect(ms).toBeGreaterThanOrEqual(before + 14 * 86_400_000 - 1000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 14 * 86_400_000 + 1000);
  });

  test('rejects malformed inputs as undefined (loud CLI error, not 1970)', () => {
    expect(parseWhenFlag('invalid')).toBeUndefined();
    expect(parseWhenFlag('+d')).toBeUndefined();
    expect(parseWhenFlag('+abcd')).toBeUndefined();
    expect(parseWhenFlag('14d')).toBeUndefined(); // relative needs the +
    expect(parseWhenFlag('2026-13-45x')).toBeUndefined();
    expect(parseWhenFlag('')).toBeUndefined();
    expect(parseWhenFlag(undefined)).toBeUndefined();
  });

  test('rejects calendar overflow instead of rolling it forward', () => {
    // `Date.parse` does NOT fail on these — it rolls them into the next month
    // (2023-02-30 → 2023-03-02, 2026-02-29 → 2026-03-01, 2026-04-31 →
    // 2026-05-01). Rolling means the operator's typo becomes a real, wrong,
    // silently-stored date that the Gantt then schedules against. Prove the
    // leniency is real, then prove we do not inherit it.
    for (const raw of ['2023-02-30', '2026-02-29', '2026-04-31', '2026-06-31', '2026-09-31']) {
      expect(Number.isFinite(Date.parse(raw))).toBe(true); // Date.parse would accept
      expect(parseWhenFlag(raw)).toBeUndefined(); // we do not
    }
    // A day beyond 31 is the only overflow `Date.parse` catches on its own —
    // which is exactly why the day-31-and-under cases above are the dangerous
    // ones. Rejected here too, by the same round-trip.
    expect(Number.isFinite(Date.parse('2026-01-32'))).toBe(false);
    expect(parseWhenFlag('2026-01-32')).toBeUndefined();
    // …while the genuinely-existing leap day still parses.
    expect(parseWhenFlag('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
  });

  test('rejects partial and loosely-shaped dates', () => {
    // All of these are things `Date.parse` happily turns into a timestamp,
    // and none of them is the documented `YYYY-MM-DD` shape.
    for (const raw of ['2026', '2026-09', '2026-1-5', 'Mar 5 2026', '2026-09-01T10:00:00Z']) {
      expect(parseWhenFlag(raw)).toBeUndefined();
    }
    // Month/day out of range are rejected by the shape check too.
    expect(parseWhenFlag('2026-00-10')).toBeUndefined();
    expect(parseWhenFlag('2026-13-01')).toBeUndefined();
    expect(parseWhenFlag('2026-01-00')).toBeUndefined();
  });
});

describe('pd roadmap upsert — invalid --start/--due is reported, never defaulted', () => {
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    pdFetch.mockReset();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
  });

  afterAll(() => {
    exit.mockRestore();
  });

  const upsert = (key, value) =>
    handleRoadmap(['upsert', 'some-slug'], { summary: 'a summary', [key]: value });

  // `2023-02-30` is the case that used to slip through: it is not a date, but
  // `Date.parse` rolled it to 2023-03-02 and the CLI stored that.
  for (const [key, value] of [
    ['start', 'invalid'],
    ['due', 'invalid'],
    ['start', '2023-02-30'],
    ['due', '2023-02-30'],
    ['due', '2026-02-29'],
    ['start', '2026'],
  ]) {
    test(`--${key} '${value}' aborts with a non-zero exit and never reaches the daemon`, async () => {
      await expect(upsert(key, value)).rejects.toThrow('process.exit(1)');

      // Loud: the operator is told which flag and what shapes are accepted.
      const said = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).toContain(`--${key}`);
      expect(said).toContain(value);
      expect(said).toMatch(/is not a date/);
      expect(said).toMatch(/YYYY-MM-DD/);

      // Not defaulted: nothing was written. A silent fallback would have
      // POSTed the item with a wrong (or epoch-0) date attached.
      expect(pdFetch).not.toHaveBeenCalled();
    });
  }

  // Same class, numeric flags. These are NOT merely "silently ignored": a
  // NaN from `Number.parseInt` becomes `null` under `JSON.stringify`, and an
  // explicit null is this API's CLEAR sentinel — so before the fix,
  // `--estimate abc` wiped a stored estimate and `--priority xyz` reset a
  // stored priority to the default 3, from the very command that promises to
  // preserve fields it was not asked to change.
  for (const [key, value] of [
    ['estimate', 'abc'],
    ['estimate', '3.5'],
    ['estimate', '0'],
    ['estimate', '-5'],
    ['priority', 'xyz'],
    ['priority', '9'],
    ['priority', '0'],
    ['priority', '-1'],
    // --actual is the newest flag on this path and rides the SAME
    // positiveOrNull sanitizer as --estimate, so it inherits the identical
    // NaN→null→CLEAR hazard. Pinned here so the new flag cannot regress to
    // the pre-fix behaviour the two flags above were fixed for.
    ['actual', 'abc'],
    ['actual', '2.5'],
    ['actual', '0'],
    ['actual', '-5'],
  ]) {
    test(`--${key} '${value}' aborts with a non-zero exit and never reaches the daemon`, async () => {
      await expect(upsert(key, value)).rejects.toThrow('process.exit(1)');
      const said = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).toContain(`--${key}`);
      expect(said).toContain(value);
      // Nothing was written, so nothing stored could have been cleared or
      // clamped behind the operator's back.
      expect(pdFetch).not.toHaveBeenCalled();
    });
  }

  test('in-band numeric flags still reach the daemon as real numbers', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, item: { slug: 'some-slug' } }),
    });
    await handleRoadmap(['upsert', 'some-slug'], {
      summary: 'a summary',
      priority: '2',
      estimate: '5',
    });
    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body.priority).toBe(2);
    expect(body.estimate).toBe(5);
    // The bug being pinned: a rejected flag must never serialize as null,
    // because null is the API's "clear this column" sentinel.
    expect(JSON.stringify(body)).not.toContain('"estimate":null');
    expect(JSON.stringify(body)).not.toContain('"priority":null');
  });

  test('a valid --due does reach the daemon (the rejection is not blanket)', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, item: { slug: 'some-slug', dueAt: Date.UTC(2026, 8, 1) } }),
    });
    await upsert('due', '2026-09-01');
    expect(pdFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body.dueAt).toBe(Date.UTC(2026, 8, 1));
  });
});

describe('why the CLI must reject: what a NaN flag does once it is on the wire', () => {
  // This is the evidence for the rule above, pinned so it cannot rot. The
  // daemon is NOT storing anything invalid — `clampPriority` and
  // `positiveOrNull` hold, and the CHECK constraint behind them holds. The
  // damage is that the sanitizers cannot distinguish "the operator cleared
  // this" from "the operator typo'd this", because both arrive as `null`.
  test('an un-validated numeric flag arrives as null and CLEARS a stored value', async () => {
    const { createTestDb } = await import('../setup-unit.js');
    const { createTupleSpace } = await import('../../lib/tuples.js');
    const { createRoadmapItems } = await import('../../lib/roadmap-items.js');

    const db = createTestDb();
    try {
      const roadmap = createRoadmapItems({
        db,
        tuples: createTupleSpace(db),
        now: () => 1_700_000_000_000,
      });
      const seeded = roadmap.upsert({ slug: 'sized', summaryMd: 's', estimate: 8, priority: 1 });
      expect(seeded.estimate).toBe(8);
      expect(seeded.priority).toBe(1);

      // Exactly the bytes the old CLI put on the wire for `--estimate abc
      // --priority xyz`: JSON.stringify turns NaN into null.
      const wire = JSON.parse(
        JSON.stringify({
          slug: 'sized',
          summaryMd: 's',
          estimate: Number.parseInt('abc', 10),
          priority: Number.parseInt('xyz', 10),
        }),
      );
      expect(wire).toEqual({ slug: 'sized', summaryMd: 's', estimate: null, priority: null });

      const after = roadmap.upsert(wire);
      // Nothing invalid is persisted — but the sizing another surface recorded
      // is gone, and the priority is back to the default. That silent loss is
      // what the CLI-side rejection prevents.
      expect(after.estimate).toBeNull();
      expect(after.priority).toBe(3);
    } finally {
      db.close();
    }
  });
});
