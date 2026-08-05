/**
 * Tests for the VoiceLog reader (`lib/squid/voice-log.ts`) and the operator
 * command over it (`cli/commands/squid-voice.ts`).
 *
 * These assert the four properties that decide whether `pd squid voice` can be
 * BELIEVED, which is the only thing an observability surface is for:
 *
 *   1. Parsing tolerance — the log is appended by a POSIX-sh script from every
 *      agent concurrently and rotated by head-truncation, so torn/garbage lines
 *      are routine. One bad line must cost one line, never the command, and must
 *      be COUNTED so the operator knows the answer is lossy.
 *   2. The quiet-rate math, including the partial-suppression case: a turn where
 *      the drop order sacrificed accomplishments but a halt still got through is
 *      NOT a quiet turn, because the agent heard the harness.
 *   3. The filters, since every view shares them and a filter that silently does
 *      nothing manufactures a false "the fleet was busy".
 *   4. Empty-state honesty — a missing log says "no data yet" and NEVER 0%.
 *      "Never measured" and "measured zero" are opposite diagnoses.
 *
 * Fixtures are written as raw JSONL text, byte-for-byte in the shape
 * `bin/pd-hook-prompt` emits, rather than serialized from the TS types — a test
 * that round-trips its own writer would pass even if the two ends disagreed.
 */
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  DEFAULT_VOICE_LOG_READ_BYTES,
  describeVoiceLogEvent,
  parseVoiceLogLine,
  readVoiceLog,
  readVoiceLogFrom,
  summarize,
  voiceLogPath,
  VOICE_LOG_FILENAME,
} from '../../lib/squid/voice-log.js';
import type { VoiceLogEvent } from '../../lib/squid/reconcile-contract.js';
import { handleSquidVoice, parseSince, voiceReadOptions } from '../../cli/commands/squid-voice.js';

// Isolated scratch under ~/coding/tmp (NEVER /tmp — macOS purges it, and the
// repo's matrix doctrine forbids it).
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-voice-cli', `jest-${process.pid}`);
const HOME_DIR = join(SCRATCH, 'pd-home');
const LOG = join(HOME_DIR, VOICE_LOG_FILENAME);

const savedHome = process.env.PD_HOME;
const savedVoiceLog = process.env.PD_SQUID_VOICE_LOG;

/** Exactly the line shape the shell tentacle writes for a `spoke` turn. */
function spokeLine(ts: number, actor: string, bytes: number, classes: string[]): string {
  const counts = Object.fromEntries(classes.map((c) => [c, 1]));
  return JSON.stringify({
    ts,
    actor,
    hookEvent: 'UserPromptSubmit',
    outcome: 'spoke',
    counts,
    bytes,
    classes,
  });
}

/** Exactly the line shape the shell tentacle writes for a `silent` turn. */
function silentLine(ts: number, actor: string, reason: string): string {
  return JSON.stringify({ ts, actor, hookEvent: 'UserPromptSubmit', outcome: 'silent', reason });
}

/** Exactly the line shape the shell tentacle writes for a `suppressed` turn. */
function suppressedLine(
  ts: number,
  actor: string,
  reason: string,
  opts: { bytes: number; emittedBytes: number; counts?: Record<string, number>; dropped?: string[] },
): string {
  return JSON.stringify({
    ts,
    actor,
    hookEvent: 'UserPromptSubmit',
    outcome: 'suppressed',
    reason,
    counts: opts.counts ?? { CLAIM: 2 },
    bytes: opts.bytes,
    droppedClasses: opts.dropped ?? ['ACCOMPLISHMENT'],
    emittedBytes: opts.emittedBytes,
  });
}

function writeLog(lines: string[]): void {
  writeFileSync(LOG, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  process.env.PD_HOME = HOME_DIR;
  delete process.env.PD_SQUID_VOICE_LOG;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedHome;
  if (savedVoiceLog === undefined) delete process.env.PD_SQUID_VOICE_LOG;
  else process.env.PD_SQUID_VOICE_LOG = savedVoiceLog;
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ─── 1. Path resolution ───────────────────────────────────────────────────────

describe('voiceLogPath', () => {
  test('honors PD_HOME the way the tentacle does', () => {
    expect(voiceLogPath()).toBe(LOG);
  });

  test('PD_SQUID_VOICE_LOG wins over PD_HOME', () => {
    const explicit = join(SCRATCH, 'elsewhere.jsonl');
    expect(voiceLogPath({ ...process.env, PD_SQUID_VOICE_LOG: explicit })).toBe(explicit);
  });
});

// ─── 2. Parsing tolerance ─────────────────────────────────────────────────────

describe('parseVoiceLogLine — tolerance', () => {
  test('parses each of the three real tentacle line shapes', () => {
    const spoke = parseVoiceLogLine(spokeLine(1000, 'a:1', 812, ['HALT', 'CLAIM']));
    expect(spoke).toMatchObject({ outcome: 'spoke', bytes: 812, actor: 'a:1' });
    expect(parseVoiceLogLine(silentLine(1000, '', 'no-entries'))).toMatchObject({
      outcome: 'silent',
      reason: 'no-entries',
      actor: '',
    });
    expect(parseVoiceLogLine(suppressedLine(1000, 'a:1', 'over-budget', { bytes: 5000, emittedBytes: 0 })))
      .toMatchObject({ outcome: 'suppressed', reason: 'over-budget', emittedBytes: 0 });
  });

  test('keeps the legacy ALERT/PHEROMONE classes the registry does not own', () => {
    const event = parseVoiceLogLine(spokeLine(1, 'a', 10, ['ALERT', 'PHEROMONE']));
    expect(event?.outcome).toBe('spoke');
    const counts = (event as { counts: Record<string, number> }).counts;
    expect(counts).toEqual({ ALERT: 1, PHEROMONE: 1 });
  });

  test.each([
    ['not json at all', 'PD_HALT="stop"'],
    ['a truncated write', '{"ts":1,"actor":"a","hookEv'],
    ['two lines spliced together', '{"ts":1}{"ts":2}'],
    ['a JSON array', '[1,2,3]'],
    ['JSON null', 'null'],
    ['a missing ts', '{"actor":"a","hookEvent":"UserPromptSubmit","outcome":"silent","reason":"no-entries"}'],
    ['a non-numeric ts', '{"ts":"soon","actor":"a","hookEvent":"UserPromptSubmit","outcome":"silent","reason":"no-entries"}'],
    ['an unknown hookEvent', '{"ts":1,"actor":"a","hookEvent":"Telepathy","outcome":"silent","reason":"no-entries"}'],
    ['an unknown outcome', '{"ts":1,"actor":"a","hookEvent":"UserPromptSubmit","outcome":"mumbled"}'],
    ['an unknown silence reason', '{"ts":1,"actor":"a","hookEvent":"UserPromptSubmit","outcome":"silent","reason":"bored"}'],
    ['a spoke line missing bytes', '{"ts":1,"actor":"a","hookEvent":"UserPromptSubmit","outcome":"spoke","counts":{},"classes":[]}'],
    ['a suppressed line missing emittedBytes', '{"ts":1,"actor":"a","hookEvent":"UserPromptSubmit","outcome":"suppressed","reason":"over-budget","counts":{},"bytes":10,"droppedClasses":[]}'],
  ])('returns undefined (never throws) for %s', (_label, line) => {
    expect(() => parseVoiceLogLine(line)).not.toThrow();
    expect(parseVoiceLogLine(line)).toBeUndefined();
  });

  test('blank and whitespace-only lines are not events', () => {
    expect(parseVoiceLogLine('')).toBeUndefined();
    expect(parseVoiceLogLine('   \t ')).toBeUndefined();
  });
});

describe('readVoiceLog — malformed lines are skipped AND counted', () => {
  test('a garbage line costs one line, not the read', () => {
    writeLog([
      spokeLine(1000, 'a', 100, ['HALT']),
      '{"ts":1,"actor":"a","hookEv',           // torn write
      silentLine(2000, 'a', 'no-entries'),
      '',                                       // blank line: not an event, not malformed
      'total garbage',
      suppressedLine(3000, 'a', 'over-budget', { bytes: 9000, emittedBytes: 0 }),
    ]);
    const result = readVoiceLog({ path: LOG });
    expect(result.exists).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.malformed).toBe(2);
    expect(result.linesRead).toBe(5); // the blank line is not counted as a line read
    expect(result.events.map((e) => e.outcome)).toEqual(['spoke', 'silent', 'suppressed']);
  });

  test('a log of nothing but garbage reads as zero events with a malformed count', () => {
    writeLog(['{', 'nope', '}}']);
    const result = readVoiceLog({ path: LOG });
    expect(result.events).toHaveLength(0);
    expect(result.malformed).toBe(3);
    // Crucially: the file EXISTS. "unreadable" and "never ran" stay distinct.
    expect(result.exists).toBe(true);
  });

  test('a tail-truncated read does not count the clipped head line as malformed', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) lines.push(silentLine(1000 + i, 'actor-with-a-long-id', 'no-entries'));
    writeLog(lines);
    const result = readVoiceLog({ path: LOG, maxBytes: 2000 });
    expect(result.headTruncated).toBe(true);
    expect(result.malformed).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThan(200);
  });
});

// ─── 3. Quiet-rate math ───────────────────────────────────────────────────────

describe('summarize — the quiet rate', () => {
  function events(): VoiceLogEvent[] {
    writeLog([
      spokeLine(1000, 'a', 100, ['HALT']),
      spokeLine(1001, 'a', 200, ['CLAIM', 'CI']),
      silentLine(1002, 'a', 'no-entries'),
      silentLine(1003, 'b', 'no-entries'),
      silentLine(1004, 'b', 'matrix-absent'),
      // fully suppressed — the model heard NOTHING
      suppressedLine(1005, 'b', 'over-budget', { bytes: 9000, emittedBytes: 0 }),
      // partially suppressed — accomplishments dropped, but a halt got through
      suppressedLine(1006, 'a', 'over-entry-cap', { bytes: 5000, emittedBytes: 3000 }),
    ]);
    return [...readVoiceLog({ path: LOG }).events];
  }

  test('counts each outcome', () => {
    const s = summarize(events());
    expect(s.total).toBe(7);
    expect(s.spoke).toBe(2);
    expect(s.silent).toBe(3);
    expect(s.suppressed).toBe(2);
  });

  test('quiet = silent + FULLY suppressed; a partial suppression is not quiet', () => {
    const s = summarize(events());
    expect(s.saidNothing).toBe(4);
    expect(s.partiallySuppressed).toBe(1);
    expect(s.quietRate).toBeCloseTo((4 / 7) * 100, 6);
    expect(s.spokeRate).toBeCloseTo((3 / 7) * 100, 6);
    expect(s.suppressedRate).toBeCloseTo((2 / 7) * 100, 6);
  });

  test('breaks suppression down by reason and by dropped class', () => {
    const s = summarize(events());
    expect(s.suppressionReasons).toEqual({ 'over-budget': 1, 'over-entry-cap': 1 });
    expect(s.silenceReasons).toEqual({ 'no-entries': 2, 'matrix-absent': 1 });
    expect(s.droppedByClass).toEqual({ ACCOMPLISHMENT: 2 });
  });

  test('per-class injection counts come from what was EMITTED, not what was held', () => {
    const s = summarize(events());
    expect(s.injectedByClass).toEqual({ HALT: 1, CLAIM: 1, CI: 1 });
    // Held-but-undelivered is tracked separately; conflating them would report
    // context as injected that no agent ever saw.
    expect(s.withheldByClass).toEqual({ CLAIM: 4 });
    expect(s.bytesInjected).toBe(300);
    expect(s.bytesWithheld).toBe(9000 + 2000);
  });

  test('tracks the window and the actor count', () => {
    const s = summarize(events());
    expect(s.firstTs).toBe(1000);
    expect(s.lastTs).toBe(1006);
    expect(s.actors).toBe(2);
    expect(s.byHookEvent).toEqual({ UserPromptSubmit: 7 });
  });

  test('EMPTY INPUT: every rate is null, never 0', () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.quietRate).toBeNull();
    expect(s.spokeRate).toBeNull();
    expect(s.suppressedRate).toBeNull();
    expect(s.firstTs).toBeNull();
    expect(s.lastTs).toBeNull();
  });

  test('an all-quiet fleet really does report 100% — the null is about absence, not calm', () => {
    const s = summarize([...readVoiceLog({ path: LOG }).events]);
    writeLog([silentLine(1, 'a', 'no-entries'), silentLine(2, 'a', 'no-entries')]);
    expect(s.quietRate).toBeNull(); // no file yet at the time of that read
    expect(summarize([...readVoiceLog({ path: LOG }).events]).quietRate).toBe(100);
  });
});

// ─── 4. Filters ───────────────────────────────────────────────────────────────

describe('readVoiceLog — filters', () => {
  beforeEach(() => {
    writeLog([
      spokeLine(1000, 'alpha', 100, ['HALT']),
      silentLine(2000, 'beta', 'no-entries'),
      suppressedLine(3000, 'alpha', 'stale-matrix', { bytes: 400, emittedBytes: 0 }),
      silentLine(4000, '', 'harness-disabled'),
    ]);
  });

  test('since keeps only events at or after the bound', () => {
    const result = readVoiceLog({ path: LOG, since: 3000 });
    expect(result.events.map((e) => e.ts)).toEqual([3000, 4000]);
    expect(result.filteredOut).toBe(2);
  });

  test('until keeps only events at or before the bound', () => {
    expect(readVoiceLog({ path: LOG, until: 2000 }).events.map((e) => e.ts)).toEqual([1000, 2000]);
  });

  test('actor filters exactly — and "" isolates unidentified turns', () => {
    expect(readVoiceLog({ path: LOG, actor: 'alpha' }).events.map((e) => e.ts)).toEqual([1000, 3000]);
    expect(readVoiceLog({ path: LOG, actor: '' }).events.map((e) => e.ts)).toEqual([4000]);
  });

  test('outcome filter drives the --suppressed view', () => {
    const result = readVoiceLog({ path: LOG, outcome: 'suppressed' });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ outcome: 'suppressed', reason: 'stale-matrix' });
  });

  test('hookEvent filter accepts one or many surfaces', () => {
    expect(readVoiceLog({ path: LOG, hookEvent: 'UserPromptSubmit' }).events).toHaveLength(4);
    expect(readVoiceLog({ path: LOG, hookEvent: ['Stop'] }).events).toHaveLength(0);
  });

  test('limit keeps the NEWEST n and reports what it dropped', () => {
    const result = readVoiceLog({ path: LOG, limit: 2 });
    expect(result.events.map((e) => e.ts)).toEqual([3000, 4000]);
    expect(result.droppedByLimit).toBe(2);
  });

  test('filters compose', () => {
    const result = readVoiceLog({ path: LOG, actor: 'alpha', outcome: 'spoke' });
    expect(result.events.map((e) => e.ts)).toEqual([1000]);
  });
});

// ─── 5. Empty-state honesty ───────────────────────────────────────────────────

describe('empty state is "no data yet", not zero activity', () => {
  test('a missing file reports exists:false with no events and no malformed lines', () => {
    const result = readVoiceLog({ path: join(SCRATCH, 'never-written.jsonl') });
    expect(result.exists).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.malformed).toBe(0);
    expect(result.sizeBytes).toBe(0);
  });

  test('a directory in the log path is treated as absent, not as a crash', () => {
    expect(() => readVoiceLog({ path: HOME_DIR })).not.toThrow();
    expect(readVoiceLog({ path: HOME_DIR }).exists).toBe(false);
  });

  test('an empty file is distinguishable from a missing one', () => {
    writeLog([]);
    const result = readVoiceLog({ path: LOG });
    expect(result.exists).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});

// ─── 6. Incremental tail (the --follow core) ──────────────────────────────────

describe('readVoiceLogFrom — the follow cursor', () => {
  test('returns only what was appended since the cursor', () => {
    writeLog([silentLine(1, 'a', 'no-entries')]);
    const first = readVoiceLogFrom(LOG, { offset: 0 });
    expect(first.events).toHaveLength(1);

    appendFileSync(LOG, `${spokeLine(2, 'a', 10, ['HALT'])}\n`, 'utf8');
    const second = readVoiceLogFrom(LOG, first.cursor);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].outcome).toBe('spoke');
    expect(readVoiceLogFrom(LOG, second.cursor).events).toHaveLength(0);
  });

  test('holds a partial line back instead of counting it malformed', () => {
    writeFileSync(LOG, `${silentLine(1, 'a', 'no-entries')}\n{"ts":2,"acto`, 'utf8');
    const first = readVoiceLogFrom(LOG, { offset: 0 });
    expect(first.events).toHaveLength(1);
    expect(first.malformed).toBe(0);

    // The writer finishes the line; the follow must now see it whole.
    appendFileSync(LOG, 'r":"a","hookEvent":"UserPromptSubmit","outcome":"silent","reason":"no-entries"}\n', 'utf8');
    const second = readVoiceLogFrom(LOG, first.cursor);
    expect(second.malformed).toBe(0);
    expect(second.events.map((e) => e.ts)).toEqual([2]);
  });

  test('resets the cursor when the tentacle rotates the log', () => {
    writeLog([silentLine(1, 'a', 'no-entries'), silentLine(2, 'a', 'no-entries')]);
    const first = readVoiceLogFrom(LOG, { offset: 0 });
    expect(first.rotated).toBe(false);

    // Rotation: the tentacle keeps the tail and the file gets smaller.
    writeLog([silentLine(3, 'a', 'no-entries')]);
    const second = readVoiceLogFrom(LOG, first.cursor);
    expect(second.rotated).toBe(true);
    expect(second.events.map((e) => e.ts)).toEqual([3]);
  });

  test('a missing file is not an error for the follower', () => {
    const chunk = readVoiceLogFrom(join(SCRATCH, 'gone.jsonl'), { offset: 40 });
    expect(chunk.exists).toBe(false);
    expect(chunk.events).toHaveLength(0);
    expect(chunk.cursor.offset).toBe(0);
  });
});

// ─── 7. describeVoiceLogEvent ─────────────────────────────────────────────────

describe('describeVoiceLogEvent', () => {
  test('the three outcomes never read alike', () => {
    const spoke = parseVoiceLogLine(spokeLine(1, 'a', 812, ['HALT']))!;
    const silent = parseVoiceLogLine(silentLine(1, 'a', 'no-entries'))!;
    const full = parseVoiceLogLine(suppressedLine(1, 'a', 'over-budget', { bytes: 9000, emittedBytes: 0 }))!;
    const partial = parseVoiceLogLine(suppressedLine(1, 'a', 'over-entry-cap', { bytes: 9000, emittedBytes: 100 }))!;
    expect(describeVoiceLogEvent(spoke)).toContain('spoke');
    expect(describeVoiceLogEvent(spoke)).toContain('812B');
    expect(describeVoiceLogEvent(silent)).toBe('silent — no-entries');
    expect(describeVoiceLogEvent(full)).toContain('all 9000B withheld');
    expect(describeVoiceLogEvent(partial)).toContain('100B of 9000B survived');
  });
});

// ─── 8. CLI flag parsing ──────────────────────────────────────────────────────

describe('parseSince', () => {
  const NOW = 1_700_000_000_000;

  test.each([
    ['45s', NOW - 45_000],
    ['30m', NOW - 1_800_000],
    ['2h', NOW - 7_200_000],
    ['7d', NOW - 604_800_000],
    ['1w', NOW - 604_800_000],
  ])('parses the duration %s', (input, expected) => {
    expect(parseSince(input, NOW)).toBe(expected);
  });

  test('accepts a bare epoch-ms number and an ISO stamp', () => {
    expect(parseSince('1699999999999', NOW)).toBe(1699999999999);
    expect(parseSince('2026-08-04T00:00:00.000Z', NOW)).toBe(Date.parse('2026-08-04T00:00:00.000Z'));
  });

  test('undefined means no filter', () => {
    expect(parseSince(undefined, NOW)).toBeUndefined();
  });

  test('THROWS on an unparseable window rather than silently returning everything', () => {
    expect(() => parseSince('last tuesday', NOW)).toThrow(/Unrecognized --since/);
  });
});

describe('voiceReadOptions', () => {
  test('maps flags onto reader filters and keeps the read bounded', () => {
    const opts = voiceReadOptions({ since: '1h', actor: 'alpha', event: 'Stop', path: LOG }, 1000 + 3_600_000);
    expect(opts).toMatchObject({ since: 1000, actor: 'alpha', hookEvent: 'Stop', path: LOG });
    expect(opts.maxBytes).toBe(DEFAULT_VOICE_LOG_READ_BYTES);
  });

  test('a valueless --actor flag is not treated as an actor named "true"', () => {
    expect(voiceReadOptions({ actor: true } as never).actor).toBeUndefined();
  });
});

// ─── 9. The command itself ────────────────────────────────────────────────────

describe('pd squid voice', () => {
  let out: string[];
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    out = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  /** Everything printed, ANSI stripped, as one blob. */
  function text(): string {
    // eslint-disable-next-line no-control-regex
    return out.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  }

  function json(): Record<string, unknown> {
    return JSON.parse(out.join('\n')) as Record<string, unknown>;
  }

  test('MISSING LOG (human): says "no data yet" and prints no percentage at all', async () => {
    await handleSquidVoice([], { path: join(SCRATCH, 'absent.jsonl') } as never);
    const rendered = text();
    expect(rendered).toContain('no data yet');
    expect(rendered).not.toMatch(/\d+(\.\d+)?%/);
    expect(rendered).toContain('pd squid on');
  });

  test('MISSING LOG (--stats, human): still refuses to report a 0% quiet rate', async () => {
    await handleSquidVoice([], { stats: true, path: join(SCRATCH, 'absent.jsonl') } as never);
    expect(text()).toContain('no data yet');
    expect(text()).not.toContain('0.0%');
  });

  test('MISSING LOG (--json): hasData false with a reason, not a zeroed summary', async () => {
    await handleSquidVoice([], { json: true, path: join(SCRATCH, 'absent.jsonl') } as never);
    const payload = json();
    expect(payload.hasData).toBe(false);
    expect(payload.reason).toBe('no-log-file');
    expect(payload.summary).toBeUndefined();
  });

  test('EXISTING BUT UNPARSEABLE LOG (--json): reason distinguishes it from a missing file', async () => {
    writeLog(['garbage', 'more garbage']);
    await handleSquidVoice([], { json: true, path: LOG } as never);
    const payload = json();
    expect(payload.hasData).toBe(false);
    expect(payload.reason).toBe('log-empty');
    expect(payload.exists).toBe(true);
    expect(payload.malformed).toBe(2);
  });

  test('recent (human): newest last, with relative ages and the quiet rate', async () => {
    const now = Date.now();
    writeLog([
      spokeLine(now - 600_000, 'alpha', 100, ['HALT']),
      silentLine(now - 60_000, 'alpha', 'no-entries'),
    ]);
    await handleSquidVoice([], { path: LOG } as never);
    const rendered = text();
    expect(rendered).toContain('recent turns');
    expect(rendered.indexOf('spoke')).toBeLessThan(rendered.indexOf('silent'));
    expect(rendered).toMatch(/\d+m ago/);
    expect(rendered).toContain('quiet on 50.0% of these turns');
  });

  test('recent (human): an actorless turn is named, not blank', async () => {
    writeLog([silentLine(Date.now(), '', 'no-entries')]);
    await handleSquidVoice([], { path: LOG } as never);
    expect(text()).toContain('(unidentified)');
  });

  test('--stats (--json): reports the real quiet rate over the whole window', async () => {
    writeLog([
      spokeLine(1000, 'a', 100, ['HALT']),
      silentLine(2000, 'a', 'no-entries'),
      silentLine(3000, 'a', 'no-entries'),
      suppressedLine(4000, 'a', 'over-budget', { bytes: 9000, emittedBytes: 0 }),
    ]);
    await handleSquidVoice([], { stats: true, json: true, path: LOG } as never);
    const payload = json();
    const summary = payload.summary as Record<string, unknown>;
    expect(payload.view).toBe('stats');
    expect(summary.total).toBe(4);
    expect(summary.quietRate).toBe(75);
    expect(summary.suppressionReasons).toEqual({ 'over-budget': 1 });
  });

  test('--stats is NOT capped by the recent-list limit', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i += 1) lines.push(silentLine(1000 + i, 'a', 'no-entries'));
    writeLog(lines);
    await handleSquidVoice([], { stats: true, json: true, path: LOG } as never);
    expect((json().summary as Record<string, unknown>).total).toBe(40);
  });

  test('--suppressed shows only turns with diagnosed context loss', async () => {
    writeLog([
      spokeLine(1000, 'a', 100, ['HALT']),
      silentLine(2000, 'a', 'no-entries'),
      suppressedLine(3000, 'a', 'stale-matrix', { bytes: 400, emittedBytes: 0 }),
    ]);
    await handleSquidVoice(['suppressed'], { json: true, path: LOG } as never);
    const payload = json();
    expect(payload.view).toBe('suppressed');
    const events = payload.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('stale-matrix');
  });

  test('--suppressed (human) names the bytes that never reached an agent', async () => {
    writeLog([suppressedLine(Date.now(), 'a', 'over-budget', { bytes: 9000, emittedBytes: 0 })]);
    await handleSquidVoice([], { suppressed: true, path: LOG } as never);
    const rendered = text();
    expect(rendered).toContain('candidate context did not fully reach the prompt');
    expect(rendered).toContain('9000B of coordination context never reached an agent');
  });

  test('--suppressed with no suppressed turns says so instead of inventing a finding', async () => {
    writeLog([spokeLine(1000, 'a', 100, ['HALT'])]);
    await handleSquidVoice([], { suppressed: true, json: true, path: LOG } as never);
    const payload = json();
    expect(payload.hasData).toBe(false);
    expect(payload.reason).toBe('no-matching-events');
  });

  test('--limit caps the recent list and the read reports the drop', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i += 1) lines.push(silentLine(1000 + i, 'a', 'no-entries'));
    writeLog(lines);
    await handleSquidVoice([], { json: true, limit: 3, path: LOG } as never);
    const payload = json();
    expect((payload.events as unknown[])).toHaveLength(3);
    expect(payload.droppedByLimit).toBe(7);
  });

  test('a bad --since is refused loudly instead of silently returning everything', async () => {
    writeLog([silentLine(Date.now(), 'a', 'no-entries')]);
    await handleSquidVoice([], { since: 'yesterday-ish', path: LOG } as never);
    expect(process.exitCode).toBe(1);
    expect(text()).not.toContain('recent turns');
  });

  test('help explains what suppressed means', async () => {
    await handleSquidVoice(['help'], {} as never);
    expect(text()).toContain('pd squid voice --suppressed');
    expect(text()).toContain('stale matrix');
    expect(text()).toContain('expired or cwd-irrelevant evidence');
    expect(text()).toContain('byte/entry caps');
    expect(text()).toContain('partial clip');
  });
});
