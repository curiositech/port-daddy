/**
 * Integration tests for the Giant Squid reconcile slice — the seams BETWEEN the
 * four modules that were built in parallel.
 *
 * The unit suites each prove their own module. Nothing proved that they fit:
 *
 *   1. DAEMON WIRING. `lib/fleet-daemon.ts` used to write and delete
 *      `PD_ALERT_FLEET_APPROVALS` itself. It must now have exactly ONE writer —
 *      the reconcile tick — or the key acquires a ghost: whichever path wrote
 *      last wins and neither knows the other exists.
 *   2. SECOND READER. `lib/local-citizen/ink-cloud.ts` serves hookless backends
 *      (Groq / Ollama / LM Studio). Every class the POSIX hook projects must
 *      reach it too, or half the fleet coordinates on less information and
 *      nothing anywhere reports an error.
 *   3. HOOK → READER. `bin/pd-hook-prompt` WRITES the VoiceLog;
 *      `lib/squid/voice-log.ts` READS it. Two agents wrote those independently
 *      against a prose description of the shape. This suite runs the real hook
 *      and feeds its real output to the real reader.
 *   4. ONE CLI OWNER. `pd squid voice` must be routed from exactly one place.
 *
 * Everything here runs the real thing: a real fleet daemon over a real temp
 * matrix, the real `/bin/sh` hook, the real reader.
 */

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFleetDaemon } from '../../lib/fleet-daemon.js';
import {
  getSharedApprovalStream,
  setSharedApprovalStream,
} from '../../lib/fleet/approval-stream.js';
import { readMatrix, setKey } from '../../lib/squid/matrix.js';
import {
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_HALT_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  accomplishmentKey,
  ciKey,
  claimKey,
  inboxKey,
  parleyKey,
} from '../../lib/squid/reconcile-contract.js';
import { readInkCloud, projectInkCloud, lockKeyFor } from '../../lib/local-citizen/ink-cloud.js';
import { readVoiceLog } from '../../lib/squid/voice-log.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const HOOK = join(repoRoot, 'bin', 'pd-hook-prompt');

// Scratch under ~/coding/tmp, never /tmp — the matrix doctrine forbids /tmp
// (macOS purges it) and these tests exercise the real path resolution.
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-integration', `jest-${process.pid}`);
const HOME_DIR = join(SCRATCH, 'pd-home');
const WORKSPACE = join(SCRATCH, 'workspace');
const MATRIX = join(HOME_DIR, 'matrix.env');

const savedEnv = {
  PD_HOME: process.env.PD_HOME,
  PD_MATRIX_FILE: process.env.PD_MATRIX_FILE,
  PD_ACTOR: process.env.PD_ACTOR,
};

const iso = (ms: number): string => new Date(ms).toISOString();

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
  process.env.PD_HOME = HOME_DIR;
  process.env.PD_MATRIX_FILE = MATRIX;
  setSharedApprovalStream(null);
});

afterEach(() => {
  setSharedApprovalStream(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ─── 1. Daemon wiring ─────────────────────────────────────────────────────────

/** Minimal but REAL dependency set — no daemon internals are mocked away. */
function makeDaemon(opts: { panic?: () => { armed: boolean; reason?: string } | null } = {}) {
  const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const daemon = createFleetDaemon({
    projects: { list: () => [] },
    messaging: { publish: () => undefined, subscribe: () => null },
    logger: {
      info: () => {},
      warn: (msg, meta) => warnings.push({ msg, meta }),
      error: () => {},
      debug: () => {},
    },
    daemonDir: WORKSPACE,
    locks: {
      acquire: () => ({ success: true }),
      release: () => ({ success: true }),
      extend: () => ({ success: true }),
      check: () => ({ success: true, held: false }),
    },
    ...(opts.panic ? { panic: opts.panic } : {}),
  });
  return { daemon, warnings };
}

function enqueueApproval(id: string, agent: string, trigger: string): void {
  getSharedApprovalStream().enqueue({
    id,
    project: 'port-daddy',
    agent,
    trigger,
    tier: 'ANONYMOUS_EXTERNAL',
    reason: 'integration test',
    safeTools: [],
    context: { source: 'trigger', messageContent: id },
    timestamp: Date.now(),
  } as Parameters<ReturnType<typeof getSharedApprovalStream>['enqueue']>[0]);
}

describe('fleet daemon wires the reconcile loop (and stops being a second writer)', () => {
  test('lib/fleet-daemon.ts no longer writes the matrix directly', () => {
    // The structural guarantee. If this ever fails, PD_ALERT_FLEET_APPROVALS has
    // two owners again and the reconcile tick will fight the direct write.
    const src = readFileSync(join(repoRoot, 'lib', 'fleet-daemon.ts'), 'utf8');
    expect(src).not.toContain('setMatrixKey');
    expect(src).not.toContain('deleteMatrixKey');
    expect(src).not.toContain("from './squid/matrix.js'");
    expect(src).toContain("from './squid/reconcile.js'");
  });

  test('start() projects pending approvals into the matrix, byte-identical to the migrated wording', () => {
    enqueueApproval('a-1', 'scout', 'push:main');
    const { daemon } = makeDaemon();
    daemon.start();
    try {
      const kv = readMatrix();
      expect(kv[PD_ALERT_FLEET_APPROVALS_KEY]).toContain(
        'HITL: 1 spawn approval(s) waiting — scout ← push:main',
      );
      expect(kv[PD_ALERT_FLEET_APPROVALS_KEY]).toContain(
        'Decide: pd fleet approvals | pd fleet approve <id> | pd fleet reject <id>',
      );
      // The reconcile writer stamps freshness so the hook's is_fresh() accepts
      // it; the legacy direct write did not, which made every alert immortal.
      expect(kv[PD_ALERT_FLEET_APPROVALS_KEY]).toMatch(/\| ts:\d{4}-\d{2}-\d{2}T/);
    } finally {
      daemon.stop();
    }
  });

  test('every tick stamps the reconcile heartbeat', () => {
    const { daemon } = makeDaemon();
    daemon.start();
    try {
      const ts = Number(readMatrix()[PD_RECON_HEARTBEAT_TS_KEY]);
      expect(Number.isFinite(ts)).toBe(true);
      expect(Math.abs(Date.now() - ts)).toBeLessThan(30_000);
    } finally {
      daemon.stop();
    }
  });

  test('an emptied approval queue DELETES the key — the GC half of the loop', async () => {
    enqueueApproval('a-1', 'scout', 'push:main');
    const { daemon } = makeDaemon();
    daemon.start();
    try {
      expect(readMatrix()[PD_ALERT_FLEET_APPROVALS_KEY]).toBeDefined();
      // Drain the queue the way the TTL sweep does, then let the fast-path
      // trigger (debounced) fire.
      getSharedApprovalStream().expireOlderThan(0);
      await new Promise((r) => setTimeout(r, 400));
      expect(readMatrix()[PD_ALERT_FLEET_APPROVALS_KEY]).toBeUndefined();
      // ...and the heartbeat is still there: GC is per-class, not a wipe.
      expect(readMatrix()[PD_RECON_HEARTBEAT_TS_KEY]).toBeDefined();
    } finally {
      daemon.stop();
    }
  });

  test('a new approval reaches the matrix via the fast-path trigger, not a 15s wait', async () => {
    const { daemon } = makeDaemon();
    daemon.start();
    try {
      expect(readMatrix()[PD_ALERT_FLEET_APPROVALS_KEY]).toBeUndefined();
      enqueueApproval('a-2', 'navigator', 'issue:412');
      await new Promise((r) => setTimeout(r, 400));
      expect(readMatrix()[PD_ALERT_FLEET_APPROVALS_KEY]).toContain('navigator ← issue:412');
    } finally {
      daemon.stop();
    }
  });

  test('stop() halts the loop: later approvals no longer move the matrix', async () => {
    const { daemon } = makeDaemon();
    daemon.start();
    daemon.stop();
    enqueueApproval('a-3', 'ghost', 'after:stop');
    await new Promise((r) => setTimeout(r, 400));
    expect(readMatrix()[PD_ALERT_FLEET_APPROVALS_KEY]).toBeUndefined();
  });

  test('an injected panic source projects PD_HALT with its reason', () => {
    const { daemon } = makeDaemon({
      panic: () => ({ armed: true, reason: 'operator pulled the cord (drill)' }),
    });
    daemon.start();
    try {
      expect(readMatrix()[PD_HALT_KEY]).toContain('operator pulled the cord (drill)');
    } finally {
      daemon.stop();
    }
  });

  test('NO panic source degrades HALT — an existing key is left alone, not deleted', () => {
    // This is the property that makes an incremental cutover safe. A daemon that
    // has not wired a source must never conclude "there is no halt" and delete
    // a key some other writer owns.
    setKey(PD_HALT_KEY, `HALT: written by another surface | ts:${iso(Date.now())}`);
    const { daemon } = makeDaemon(); // no panic dep
    daemon.start();
    try {
      expect(readMatrix()[PD_HALT_KEY]).toContain('written by another surface');
    } finally {
      daemon.stop();
    }
  });

  test('a disarmed panic source DOES delete the halt (answered sources may GC)', () => {
    setKey(PD_HALT_KEY, `HALT: stale | ts:${iso(Date.now())}`);
    const { daemon } = makeDaemon({ panic: () => ({ armed: false }) });
    daemon.start();
    try {
      expect(readMatrix()[PD_HALT_KEY]).toBeUndefined();
    } finally {
      daemon.stop();
    }
  });

  test('a constructed-but-never-started daemon writes nothing', () => {
    makeDaemon();
    expect(existsSync(MATRIX)).toBe(false);
  });
});

// ─── 2. The second reader ─────────────────────────────────────────────────────

describe('hookless backends see every key class the POSIX hook sees', () => {
  const ACTOR = 'agent-alpha';
  const seedAll = (now = Date.now()): void => {
    setKey(PD_HALT_KEY, `HALT: all stop | ts:${iso(now)}`);
    setKey(parleyKey(ACTOR, 'conv-7'), `PARLEY conv-7: reply owed | ts:${iso(now)}`);
    setKey(PD_ALERT_FLEET_APPROVALS_KEY, `HITL: 1 spawn approval(s) waiting | ts:${iso(now)}`);
    setKey(claimKey('lib/foo.ts'), `CLAIM OVERLAP lib/foo.ts — held by a, b | ts:${iso(now)}`);
    setKey(ciKey('main'), `CI RED on main: typecheck | ts:${iso(now)}`);
    setKey(inboxKey(ACTOR, 'm1'), `INBOX from bosun: migration is yours | ts:${iso(now)}`);
    setKey(accomplishmentKey('n9'), `DONE shipped the relay | ts:${iso(now)}`);
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
  };

  test('all seven reconcile classes are classified, none silently dropped', () => {
    seedAll();
    const cloud = readInkCloud();
    expect(cloud.halt).toContain('all stop');
    expect(cloud.fleetApprovals).toContain('HITL');
    expect(cloud.parley).toHaveLength(1);
    expect(cloud.inbox).toHaveLength(1);
    expect(Object.keys(cloud.claims)).toHaveLength(1);
    expect(Object.keys(cloud.ci)).toHaveLength(1);
    expect(Object.keys(cloud.accomplishments)).toHaveLength(1);
    expect(cloud.heartbeatTs).toBeDefined();
    expect(cloud.stale).toBe(false);
    // The reconciled approvals key is NOT double-counted as a legacy alert.
    expect(cloud.alerts).toEqual({});
  });

  test('the injection block leads with HALT, then FOR YOU, then FLEET', () => {
    const now = Date.now();
    seedAll(now);
    const { text } = projectInkCloud(readInkCloud(), {
      selfActor: ACTOR,
      projectRoot: WORKSPACE,
      now,
    });
    const iHalt = text.indexOf('HALT — stop work');
    const iYou = text.indexOf('FOR YOU');
    const iFleet = text.indexOf('FLEET:');
    expect(iHalt).toBeGreaterThan(-1);
    expect(iYou).toBeGreaterThan(iHalt);
    expect(iFleet).toBeGreaterThan(iYou);
    expect(text).toContain('migration is yours');
    expect(text).toContain('CI RED on main');
    expect(text).toContain('shipped the relay');
  });

  test("addressed mail stays addressed — another actor's inbox is invisible", () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(inboxKey('agent-alpha', 'm1'), `INBOX: alpha only | ts:${iso(now)}`);
    setKey(inboxKey('agent-beta', 'm2'), `INBOX: beta only | ts:${iso(now)}`);
    const cloud = readInkCloud();
    const alpha = projectInkCloud(cloud, { selfActor: 'agent-alpha', projectRoot: WORKSPACE, now });
    expect(alpha.text).toContain('alpha only');
    expect(alpha.text).not.toContain('beta only');
  });

  test('the alpha / alpha-two prefix leak is closed in the hookless reader too', () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(inboxKey('alpha-two', 'm1'), `INBOX: NOT for alpha | ts:${iso(now)}`);
    const out = projectInkCloud(readInkCloud(), {
      selfActor: 'alpha',
      projectRoot: WORKSPACE,
      now,
    });
    expect(out.text).not.toContain('NOT for alpha');
  });

  test('an unidentified agent reads NO per-actor class', () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(inboxKey('agent-alpha', 'm1'), `INBOX: somebody's mail | ts:${iso(now)}`);
    const out = projectInkCloud(readInkCloud(), { projectRoot: WORKSPACE, now });
    expect(out.text).toBe('');
    expect(out.event.outcome).toBe('silent');
  });

  test('a stale matrix fails OPEN: nothing injected, but the receipt keeps the counts', () => {
    const now = Date.now();
    seedAll(now - 5 * 60_000);
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now - 5 * 60_000));
    const out = projectInkCloud(readInkCloud(undefined, now), {
      selfActor: ACTOR,
      projectRoot: WORKSPACE,
      now,
    });
    expect(out.text).toBe('');
    expect(out.event.outcome).toBe('suppressed');
    if (out.event.outcome === 'suppressed') {
      expect(out.event.reason).toBe('stale-matrix');
      expect(out.event.counts.HALT).toBe(1);
      expect(out.event.emittedBytes).toBe(0);
    }
  });

  test('an ABSENT heartbeat is not stale — pre-reconcile fleets are not muted', () => {
    const now = Date.now();
    setKey(PD_HALT_KEY, `HALT: legacy fleet | ts:${iso(now)}`);
    const out = projectInkCloud(readInkCloud(undefined, now), {
      selfActor: ACTOR,
      projectRoot: WORKSPACE,
      now,
    });
    expect(out.text).toContain('legacy fleet');
  });

  test('pheromones are filtered to the exact project root', () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(
      'PD_PHEROMONE_MINE_1',
      `${WORKSPACE}/lib/a.ts | hot surface | intensity:2 | ts:${iso(now)}`,
    );
    setKey(
      'PD_PHEROMONE_THEIRS_1',
      `/somewhere/else/lib/b.ts | not yours | intensity:2 | ts:${iso(now)}`,
    );
    const out = projectInkCloud(readInkCloud(), { projectRoot: WORKSPACE, now });
    expect(out.text).toContain('hot surface');
    expect(out.text).not.toContain('not yours');
  });

  test('the entry cap is enforced by priority, not by truncation', () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(PD_HALT_KEY, `HALT: keep me | ts:${iso(now)}`);
    for (let i = 0; i < 20; i += 1) {
      setKey(
        `PD_PHEROMONE_NOISE_${i}`,
        `${WORKSPACE}/n${i}.ts | ambience ${i} | intensity:1 | ts:${iso(now)}`,
      );
    }
    const out = projectInkCloud(readInkCloud(), {
      projectRoot: WORKSPACE,
      now,
      maxEntries: 3,
    });
    // The HALT survives a budget 20 pheromones would otherwise have eaten.
    expect(out.text).toContain('keep me');
    expect(out.event.outcome).toBe('suppressed');
  });

  test('lockKeySuffix now agrees with matrix.keySuffix on the empty-ish case', () => {
    // Regression: the local copy returned '' where keySuffix returns 'X', so the
    // reader looked for PD_LOCK_ and the writer wrote PD_LOCK_X.
    expect(lockKeyFor('---')).toBe('PD_LOCK_X');
    expect(lockKeyFor('lib/foo.ts')).toBe('PD_LOCK_LIB_FOO_TS');
  });

  test('an absent matrix is distinguishable from an empty one', () => {
    // "The harness has never run here" and "the harness ran and the fleet is
    // calm" are opposite diagnoses; both used to read as `matrix-absent`.
    const absent = projectInkCloud(readInkCloud(), { projectRoot: WORKSPACE });
    expect(absent.event.outcome).toBe('silent');
    if (absent.event.outcome === 'silent') expect(absent.event.reason).toBe('matrix-absent');

    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(Date.now())); // creates the file
    const cloud = readInkCloud();
    expect(cloud.present).toBe(true);
    const empty = projectInkCloud(cloud, { projectRoot: WORKSPACE });
    expect(empty.event.outcome).toBe('silent');
    if (empty.event.outcome === 'silent') expect(empty.event.reason).toBe('no-entries');
  });

  test('the reader honors PD_HOME instead of the operator’s real matrix', () => {
    const now = Date.now();
    setKey(PD_HALT_KEY, `HALT: temp home | ts:${iso(now)}`);
    // readInkCloud() with no argument must resolve through matrixPath() at CALL
    // time; a module-load constant would have missed this file entirely.
    expect(readInkCloud().halt).toContain('temp home');
  });
});

// ─── 3. Hook writes the VoiceLog, lib/squid/voice-log.ts reads it ─────────────

describe('the shell writer and the TS reader agree on the VoiceLog wire shape', () => {
  const runHook = (env: Record<string, string> = {}): void => {
    const res = spawnSync(HOOK, {
      input: JSON.stringify({ cwd: WORKSPACE }),
      encoding: 'utf8',
      env: {
        ...process.env,
        PD_HOME: HOME_DIR,
        PD_MATRIX_FILE: MATRIX,
        ...env,
      },
    });
    expect(res.status).toBe(0);
  };

  test('a "spoke" line written by /bin/sh parses cleanly in the TS reader', () => {
    const now = Date.now();
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(now));
    setKey(PD_HALT_KEY, `HALT: all stop | ts:${iso(now)}`);
    setKey(inboxKey('agent-alpha', 'm1'), `INBOX from bosun: yours | ts:${iso(now)}`);
    runHook({ PD_ACTOR: 'agent-alpha' });

    const read = readVoiceLog({ path: join(HOME_DIR, 'squid-voice-log.jsonl') });
    expect(read.exists).toBe(true);
    expect(read.malformed).toBe(0);
    expect(read.events).toHaveLength(1);
    const ev = read.events[0];
    expect(ev.hookEvent).toBe('UserPromptSubmit');
    expect(ev.actor).toBe('agent-alpha');
    expect(ev.outcome).toBe('spoke');
    if (ev.outcome === 'spoke') {
      expect(ev.classes).toContain('HALT');
      expect(ev.classes).toContain('INBOX');
      expect(ev.bytes).toBeGreaterThan(0);
      expect(ev.counts.HALT).toBe(1);
    }
  });

  test('a "silent" line parses, and the reader distinguishes it from suppressed', () => {
    // Burn the first-turn nag so the second turn is genuinely quiet.
    runHook({ PD_ACTOR: 'agent-quiet' });
    runHook({ PD_ACTOR: 'agent-quiet' });
    const read = readVoiceLog({ path: join(HOME_DIR, 'squid-voice-log.jsonl') });
    expect(read.malformed).toBe(0);
    const last = read.events[read.events.length - 1];
    expect(last.outcome).toBe('silent');
    if (last.outcome === 'silent') {
      expect(['no-entries', 'matrix-absent']).toContain(last.reason);
    }
  });

  test('a "suppressed" line carries the superset counts the reader must not narrow away', () => {
    const old = Date.now() - 40 * 60_000;
    // Burn the actor's first turn: the standing-plan directive fires once per
    // actor per NAG interval, and on turn 1 it emits bytes of its own — which
    // would make `emittedBytes` non-zero for reasons unrelated to the alert.
    runHook({ PD_ACTOR: 'agent-alpha' });
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(Date.now()));
    setKey('PD_ALERT_ANCIENT', `stale steering alert | ts:${iso(old)}`);
    runHook({ PD_ACTOR: 'agent-alpha' });

    const read = readVoiceLog({ path: join(HOME_DIR, 'squid-voice-log.jsonl') });
    expect(read.malformed).toBe(0);
    const ev = read.events[read.events.length - 1];
    expect(ev.outcome).toBe('suppressed');
    if (ev.outcome === 'suppressed') {
      expect(ev.reason).toBe('ttl-expired');
      // ALERT is one of the two legacy classes outside ReconcileKeyClassName.
      // If the reader ever narrows it away, this reads `counts: {}`.
      expect((ev.counts as Record<string, number>).ALERT).toBe(1);
      expect(ev.emittedBytes).toBe(0);
    }
  });

  test('every outcome the hook can emit survives a round trip with zero malformed lines', () => {
    const path = join(HOME_DIR, 'squid-voice-log.jsonl');
    runHook({ PD_ACTOR: 'a-one' }); // matrix-absent or silent
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(Date.now()));
    setKey(PD_HALT_KEY, `HALT: x | ts:${iso(Date.now())}`);
    runHook({ PD_ACTOR: 'a-one' }); // spoke
    runHook({ PD_ACTOR: 'a-one', PD_SQUID_DISABLED: '1' }); // silent/harness-disabled
    const read = readVoiceLog({ path });
    expect(read.malformed).toBe(0);
    expect(read.events.length).toBe(3);
    const outcomes = read.events.map((e) => e.outcome);
    expect(outcomes).toContain('spoke');
    expect(outcomes).toContain('silent');
  });

  test('an actor id with shell-hostile characters round-trips through JSON', () => {
    const nasty = 'port-daddy:contrib:squid "1" \\ back';
    runHook({ PD_ACTOR: nasty });
    const read = readVoiceLog({ path: join(HOME_DIR, 'squid-voice-log.jsonl') });
    expect(read.malformed).toBe(0);
    expect(read.events[0].actor).toBe(nasty);
  });
});

// ─── 4. One CLI owner ─────────────────────────────────────────────────────────

describe('pd squid voice has exactly one route', () => {
  test('bin/port-daddy-cli.ts does not intercept the subcommand', () => {
    const src = readFileSync(join(repoRoot, 'bin', 'port-daddy-cli.ts'), 'utf8');
    expect(src).not.toContain('squid-voice.js');
  });

  test('cli/commands/squid.ts owns it, and its help text says so', () => {
    const src = readFileSync(join(repoRoot, 'cli', 'commands', 'squid.ts'), 'utf8');
    expect(src).toContain("case 'voice':");
    expect(src).toContain('./squid-voice.js');
    expect(src).toContain('pd squid voice');
  });

  test('the fish completion lists it (a subcommand nobody can tab to is half-shipped)', () => {
    const src = readFileSync(join(repoRoot, 'completions', 'port-daddy.fish'), 'utf8');
    expect(src).toMatch(/__pd_using_command squid" -x -a '[^']*\bvoice\b/);
  });

  test('routing through handleSquid actually reaches the voice handler', async () => {
    const { handleSquid } = await import('../../cli/commands/squid.js');
    const lines: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      // Flags arrive parsed in `options`, exactly as bin/port-daddy-cli.ts
      // hands them over; `rest` carries only the positional subcommand.
      await handleSquid(['voice'], { stats: true, json: true } as never);
    } finally {
      console.log = realLog;
    }
    const parsed = JSON.parse(lines.join('\n'));
    // No log file under the temp PD_HOME yet: the honest empty state, not a 0%.
    expect(parsed.hasData).toBe(false);
    expect(parsed.reason).toBe('no-log-file');
  });
});
