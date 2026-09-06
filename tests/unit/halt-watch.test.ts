/**
 * lib/halt-watch.ts — the daemon's ADR-0132 listening watch.
 *
 * Proves, with a fake clock and a scratch sentinel:
 *   - nominal while no sentinel exists; a missing ~/.port-daddy is not an error
 *   - the 30 s timer checks on schedule and transitions exactly once
 *   - the transition stops the sweeps (onHalt) and writes SEEN then COMPLIED in
 *     the ADR wire format to the machine-wide and repo-scoped distress files
 *   - an onHalt that throws yields PAN PAN CANNOT-STOP, not COMPLIED
 *   - removing the sentinel afterwards does NOT lift the halt (§4: absence is
 *     not all-clear); the watch logs once and stays halted
 *   - start() under an already-hoisted flag is halted synchronously
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HALT_WATCH_INTERVAL_MS,
  appendDistressLine,
  createHaltWatch,
  distressFilePath,
  formatDistressLine,
  haltSentinelPath,
  readHaltFromRegister,
  readHaltSentinel,
} from '../../lib/halt-watch.js';

const SCRATCH = join(process.cwd(), '.scratch', `halt-watch-test-${process.pid}`);
const HOME = join(SCRATCH, 'pd-home');          // stands in for ~/.port-daddy
const REPO = join(SCRATCH, 'repo');
const SENTINEL = join(HOME, 'HALT');
const DISTRESS = join(HOME, 'DISTRESS');
const REPO_DISTRESS = join(REPO, '.portdaddy', 'DISTRESS');
const HALT_LINE = '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway ref=docs/incidents/2026-09-05-port-daddy-halt.md';

function logSink() {
  const events: Array<{ level: string; event: string; meta?: Record<string, unknown> }> = [];
  return {
    events,
    logger: {
      info: (event: string, meta?: Record<string, unknown>) => { events.push({ level: 'info', event, meta }); },
      warn: (event: string, meta?: Record<string, unknown>) => { events.push({ level: 'warn', event, meta }); },
    },
  };
}

function makeWatch(overrides: Partial<Parameters<typeof createHaltWatch>[0]> = {}) {
  const sink = logSink();
  const onHalt = jest.fn();
  let clock = 1_800_000_000_000;
  const watch = createHaltWatch({
    entity: 'daemon:prod',
    sentinelPath: SENTINEL,
    distressPath: DISTRESS,
    repoDistressPath: REPO_DISTRESS,
    now: () => clock,
    logger: sink.logger,
    onHalt,
    ...overrides,
  });
  return { watch, onHalt, sink, tick: (ms: number) => { clock += ms; jest.advanceTimersByTime(ms); } };
}

beforeEach(() => {
  jest.useFakeTimers();
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
  // NOTE: HOME is deliberately NOT created — a missing sentinel dir is nominal.
});

afterEach(() => {
  jest.useRealTimers();
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('halt-watch: paths and wire format', () => {
  test('sentinel and distress paths follow PD_HOME, with explicit overrides winning', () => {
    expect(haltSentinelPath({ PD_HOME: '/x/pd' })).toBe('/x/pd/HALT');
    expect(distressFilePath({ PD_HOME: '/x/pd' })).toBe('/x/pd/DISTRESS');
    expect(haltSentinelPath({ PD_HOME: '/x/pd', PD_HALT_FILE: '/elsewhere/HALT' })).toBe('/elsewhere/HALT');
    expect(distressFilePath({ PD_DISTRESS_FILE: '/elsewhere/D' })).toBe('/elsewhere/D');
    expect(haltSentinelPath({})).toMatch(/\.port-daddy\/HALT$/);
  });

  test('formatDistressLine emits `<iso> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- text]`', () => {
    const line = formatDistressLine(
      { kind: 'daemon', id: 'prod', cls: 'control', code: 'SEEN', fields: { ref: '2026-09-05T14:02:11Z' } },
      Date.UTC(2026, 8, 5, 14, 2, 40),
    );
    expect(line).toBe('2026-09-05T14:02:40Z daemon:prod control SEEN ref=2026-09-05T14:02:11Z');
    const mayday = formatDistressLine(
      { kind: 'daemon', id: 'prod', cls: 'MAYDAY', code: 'SPLIT-BRAIN', fields: { pids: '812,9944', port: 9886 }, text: 'two\nlines' },
      Date.UTC(2026, 8, 5, 14, 3, 0),
    );
    expect(mayday).toBe('2026-09-05T14:03:00Z daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886 -- two lines');
  });

  test('readHaltSentinel: absent → null; present → first non-empty line and its timestamp as ref', () => {
    expect(readHaltSentinel(SENTINEL, () => 1)).toBeNull();
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `\n\n${HALT_LINE}\nsecond line ignored\n`);
    const info = readHaltSentinel(SENTINEL, () => 42);
    expect(info).toEqual({ line: HALT_LINE, ref: '2026-09-05T14:02:11Z', detectedAt: 42, complied: false });
    // A bare touch is still a hoisted flag: existence is the signal.
    writeFileSync(SENTINEL, '');
    const bare = readHaltSentinel(SENTINEL, () => 43);
    expect(bare?.ref).toBe('sentinel');
    expect(bare?.line).toMatch(/^SECURITE HALT/);
  });

  test('appendDistressLine never throws: missing dir is a false unless createDir', () => {
    expect(appendDistressLine(DISTRESS, 'x')).toBe(false);
    expect(existsSync(DISTRESS)).toBe(false);
    expect(appendDistressLine(DISTRESS, 'x', { createDir: true })).toBe(true);
    expect(appendDistressLine(DISTRESS, 'y', { createDir: true })).toBe(true);
    expect(readFileSync(DISTRESS, 'utf8')).toBe('x\ny\n');
  });
});

describe('halt-watch: the listening watch', () => {
  test('nominal with no sentinel; a missing ~/.port-daddy is not an error; timer checks every 30 s', () => {
    const { watch, onHalt, tick } = makeWatch();
    watch.start();
    expect(watch.state()).toBe('nominal');
    expect(watch.checks()).toBe(1);
    tick(HALT_WATCH_INTERVAL_MS - 1);
    expect(watch.checks()).toBe(1);
    tick(1);
    expect(watch.checks()).toBe(2);
    tick(HALT_WATCH_INTERVAL_MS * 3);
    expect(watch.checks()).toBe(5);
    expect(onHalt).not.toHaveBeenCalled();
    expect(watch.halt()).toBeNull();
    expect(existsSync(DISTRESS)).toBe(false);
    watch.stop();
    tick(HALT_WATCH_INTERVAL_MS * 2);
    expect(watch.checks()).toBe(5); // stopped: no more ticks
  });

  test('transition on the tick after the flag is hoisted: sweeps stopped once, SEEN then COMPLIED written', () => {
    const { watch, onHalt, sink, tick } = makeWatch();
    watch.start();
    tick(HALT_WATCH_INTERVAL_MS);
    expect(watch.state()).toBe('nominal');

    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    // Not noticed until the next listening interval — a timer, not a trigger.
    expect(watch.state()).toBe('nominal');
    tick(HALT_WATCH_INTERVAL_MS);
    expect(watch.state()).toBe('halted');
    expect(onHalt).toHaveBeenCalledTimes(1);
    expect(watch.halt()).toEqual(expect.objectContaining({ ref: '2026-09-05T14:02:11Z', line: HALT_LINE, complied: true }));

    const lines = readFileSync(DISTRESS, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z daemon:prod control SEEN ref=2026-09-05T14:02:11Z$/);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z daemon:prod control COMPLIED ref=2026-09-05T14:02:11Z$/);
    // Repo-scoped copy (its .portdaddy dir exists) carries the same two lines.
    expect(readFileSync(REPO_DISTRESS, 'utf8').trim().split('\n')).toEqual(lines);

    // Further ticks: no second transition, no extra distress lines.
    tick(HALT_WATCH_INTERVAL_MS * 5);
    expect(onHalt).toHaveBeenCalledTimes(1);
    expect(readFileSync(DISTRESS, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(sink.events.filter((e) => e.event === 'halt_sentinel_seen')).toHaveLength(1);
  });

  test('an onHalt that throws records PAN PAN CANNOT-STOP instead of COMPLIED', () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    const { watch, sink } = makeWatch({ onHalt: () => { throw new Error('reaper would not die'); } });
    watch.start();
    expect(watch.state()).toBe('halted');
    expect(watch.halt()?.complied).toBe(false);
    const lines = readFileSync(DISTRESS, 'utf8').trim().split('\n');
    expect(lines[0]).toContain(' daemon:prod control SEEN ref=');
    expect(lines[1]).toContain(' daemon:prod PAN PAN CANNOT-STOP ref=2026-09-05T14:02:11Z');
    expect(lines.some((l) => l.includes('COMPLIED'))).toBe(false);
    expect(sink.events.find((e) => e.event === 'halt_comply_failed')?.meta).toEqual({ error: 'reaper would not die' });
  });

  test('start() under an already-hoisted flag is halted synchronously, before any interval elapses', () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    const { watch, onHalt } = makeWatch();
    watch.start();
    expect(watch.state()).toBe('halted');
    expect(onHalt).toHaveBeenCalledTimes(1);
    watch.start(); // idempotent
    expect(onHalt).toHaveBeenCalledTimes(1);
  });

  test("the sentinel's later absence is not all-clear: the watch logs once and stays halted", () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    const { watch, sink, tick } = makeWatch();
    watch.start();
    expect(watch.state()).toBe('halted');
    rmSync(SENTINEL);
    tick(HALT_WATCH_INTERVAL_MS * 3);
    expect(watch.state()).toBe('halted');
    expect(watch.halt()?.ref).toBe('2026-09-05T14:02:11Z');
    expect(sink.events.filter((e) => e.event === 'halt_sentinel_removed_awaiting_all_clear')).toHaveLength(1);
    // Re-hoisting does not re-transition either: one SEEN/COMPLIED pair per process.
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    tick(HALT_WATCH_INTERVAL_MS);
    expect(readFileSync(DISTRESS, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('default reader (no sentinelPath): a deleted sentinel with an unlifted HALT on the register is still halted at boot', () => {
    const savedHome = process.env.PD_HOME;
    process.env.PD_HOME = HOME;
    try {
      mkdirSync(HOME, { recursive: true });
      // The halt was hoisted properly (sentinel + register) and then an agent removed the sentinel.
      writeFileSync(DISTRESS, `${HALT_LINE}\n`);
      expect(existsSync(SENTINEL)).toBe(false);
      const { watch, onHalt, sink } = makeWatch({ sentinelPath: undefined });
      watch.start();
      expect(watch.state()).toBe('halted');
      expect(onHalt).toHaveBeenCalledTimes(1);
      expect(watch.halt()).toMatchObject({ line: HALT_LINE, ref: '2026-09-05T14:02:11Z' });
      expect(sink.events.some((e) => e.event === 'halt_sentinel_seen')).toBe(true);
      const lines = readFileSync(DISTRESS, 'utf8').trim().split('\n');
      expect(lines[1]).toMatch(/ daemon:prod control SEEN ref=2026-09-05T14:02:11Z$/);
      expect(lines[2]).toMatch(/ daemon:prod control COMPLIED ref=2026-09-05T14:02:11Z$/);
    } finally {
      if (savedHome === undefined) delete process.env.PD_HOME; else process.env.PD_HOME = savedHome;
    }
  });

  test('default reader: an empty home is nominal, and a bare sentinel is a halt with ref=sentinel', () => {
    const savedHome = process.env.PD_HOME;
    process.env.PD_HOME = HOME;
    try {
      expect(readHaltFromRegister(() => 7)).toBeNull();
      mkdirSync(HOME, { recursive: true });
      writeFileSync(SENTINEL, '');
      expect(readHaltFromRegister(() => 7)).toEqual({ line: 'SECURITE HALT (sentinel present, no text)', ref: 'sentinel', detectedAt: 7, complied: false });
    } finally {
      if (savedHome === undefined) delete process.env.PD_HOME; else process.env.PD_HOME = savedHome;
    }
  });

  test('ROUTINE listening check-ins go to the log, never the distress file', () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SENTINEL, `${HALT_LINE}\n`);
    const { watch, sink, tick } = makeWatch();
    watch.start();
    tick(HALT_WATCH_INTERVAL_MS * 40);
    expect(sink.events.filter((e) => e.event === 'halt_watch_listening').length).toBeGreaterThanOrEqual(2);
    expect(readFileSync(DISTRESS, 'utf8')).not.toMatch(/LISTENING/);
  });
});
