/**
 * The Quiet Harness + the Voice Log — bin/pd-hook-prompt (ADR-0091).
 * ==================================================================
 * These tests spawn the REAL POSIX-sh tentacle against a real seeded Ink Cloud
 * matrix under a temp PD_HOME. Nothing here is mocked: every assertion is about
 * bytes the shell script actually wrote to stdout or to the voice log.
 *
 * What is being proven, and why each one matters:
 *
 *  1. SILENCE MEANS SOMETHING. The hook used to print a standing "maintain an
 *     active pd plan" directive on every single turn, so an operator could never
 *     distinguish "the fleet is calm" from "the harness is dead", and the model
 *     learned to skim a block that never changed. A quiet turn must now produce
 *     literally zero bytes on stdout.
 *  2. SILENCE IS AUDITABLE. Every invocation appends exactly one VoiceLog line
 *     (`spoke` / `silent` / `suppressed`) so the operator can tell a calm fleet
 *     from a harness strangled by its own TTL, byte, or entry bounds.
 *  3. ADDRESSED MAIL STAYS ADDRESSED. A PD_INBOX_/PD_PARLEY_ entry for actor A
 *     must never appear in actor B's context — the per-actor prefix computed by
 *     the shell's `pd_actor_key` must agree with the contract's `actorKey`.
 *
 * The actor keys and matrix keys below are minted with the CONTRACT's own
 * builders (`inboxKey`, `parleyKey`, `actorKey` from lib/squid/reconcile-contract),
 * so a divergence between the TS key minting and the shell's sed mirror fails
 * these tests rather than silently swallowing an agent's mail in production.
 */

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { setKey } from '../../lib/squid/matrix.js';
import {
  actorKey,
  inboxKey,
  parleyKey,
  claimKey,
  ciKey,
  accomplishmentKey,
  PD_HALT_KEY,
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  RECONCILE_STALE_AFTER_MS,
} from '../../lib/squid/reconcile-contract.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const HOOK = join(repoRoot, 'bin', 'pd-hook-prompt');

// Isolated scratch under ~/coding/tmp (NEVER /tmp — macOS purges /tmp, and the
// repo's own matrix doctrine forbids it).
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-voice', `jest-${process.pid}`);
const HOME_DIR = join(SCRATCH, 'pd-home');
const WORKSPACE = join(SCRATCH, 'workspace');
const MATRIX = join(HOME_DIR, 'matrix.env');
const VOICE_LOG = join(HOME_DIR, 'squid-voice-log.jsonl');

const savedMatrixFile = process.env.PD_MATRIX_FILE;
const savedHome = process.env.PD_HOME;

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
  // Seeding goes through lib/squid/matrix.ts pointed at the same file the hook
  // reads, so the tests exercise the real serializer, not a hand-rolled format.
  process.env.PD_MATRIX_FILE = MATRIX;
  process.env.PD_HOME = HOME_DIR;
});

afterEach(() => {
  if (savedMatrixFile === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedMatrixFile;
  if (savedHome === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedHome;
  rmSync(SCRATCH, { recursive: true, force: true });
});

interface RunOptions {
  actor?: string;
  cwd?: string;
  home?: string;
  matrix?: string;
  env?: Record<string, string>;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Invoke the real tentacle with a Claude Code UserPromptSubmit event on stdin.
 *
 * Every PD_* variable is stripped from the inherited environment first: the
 * suite itself runs under a Port Daddy session, and an inherited PD_ACTOR would
 * silently make the per-actor isolation tests pass for the wrong reason.
 */
function runHook(opts: RunOptions = {}): RunResult {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('PD_')) continue;
    if (v !== undefined) clean[k] = v;
  }
  const env: Record<string, string> = {
    ...clean,
    PD_HOME: opts.home ?? HOME_DIR,
    PD_MATRIX_FILE: opts.matrix ?? MATRIX,
    ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
    ...(opts.env ?? {}),
  };
  const r = spawnSync(HOOK, [], {
    input: JSON.stringify({ prompt: 'do the thing', cwd: opts.cwd ?? WORKSPACE }),
    env,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Unwrap the sanctioned hookSpecificOutput.additionalContext envelope. */
function contextOf(stdout: string): string {
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  return parsed.hookSpecificOutput.additionalContext;
}

interface VoiceLine {
  ts: number;
  actor: string;
  hookEvent: string;
  outcome: 'spoke' | 'silent' | 'suppressed';
  reason?: string;
  counts?: Record<string, number>;
  bytes?: number;
  classes?: string[];
  droppedClasses?: string[];
  emittedBytes?: number;
}

/** Every VoiceLog line written so far, oldest first. */
function voiceLines(path = VOICE_LOG): VoiceLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as VoiceLine);
}

/** The most recent VoiceLog line — what the invocation under test just wrote. */
function lastVoice(path = VOICE_LOG): VoiceLine {
  const lines = voiceLines(path);
  expect(lines.length).toBeGreaterThan(0);
  return lines[lines.length - 1];
}

const isoNow = () => new Date().toISOString();
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Burn the once-per-interval plan-directive nag for an actor.
 *
 * The standing directive is deliberately shown on an actor's FIRST turn (a fresh
 * agent has never been told), so any test about genuine silence has to get past
 * that first turn. Doing it with a real invocation rather than by hand-writing
 * the state file keeps the test black-box.
 */
function burnNag(actor?: string): void {
  runHook({ actor });
}

describe('pd-hook-prompt — the quiet harness', () => {
  test('a turn with nothing new emits ZERO bytes and exits 0', () => {
    setKey('PD_UNRELATED_KEY', 'not a projected class');
    burnNag('agent-alpha');

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('the plan directive is suppressed on a quiet turn and returns when content exists', () => {
    // Turn 1: fresh actor, empty matrix → the directive fires once (the nag).
    const first = runHook({ actor: 'agent-alpha' });
    expect(first.status).toBe(0);
    expect(contextOf(first.stdout)).toContain('maintain an active pd plan');

    // Turn 2: nothing changed, nag interval not elapsed → total silence.
    const second = runHook({ actor: 'agent-alpha' });
    expect(second.stdout).toBe('');

    // Turn 3: real content arrives → the directive rides along with it.
    setKey('PD_ALERT_STEER_1', `STEERING: rebase before you refactor | ts:${isoNow()}`);
    const third = runHook({ actor: 'agent-alpha' });
    const ctx = contextOf(third.stdout);
    expect(ctx).toContain('maintain an active pd plan');
    expect(ctx).toContain('rebase before you refactor');
  });

  test('an elapsed nag interval re-shows the directive even with an empty matrix', () => {
    burnNag('agent-alpha');
    expect(runHook({ actor: 'agent-alpha' }).stdout).toBe('');

    const r = runHook({
      actor: 'agent-alpha',
      env: { PD_SQUID_PLAN_NAG_INTERVAL_SECONDS: '0' },
    });
    expect(r.status).toBe(0);
    expect(contextOf(r.stdout)).toContain('maintain an active pd plan');
  });

  test('the nag timer is per-actor: burning it for A does not silence B', () => {
    burnNag('agent-alpha');
    expect(runHook({ actor: 'agent-alpha' }).stdout).toBe('');

    const b = runHook({ actor: 'agent-beta' });
    expect(contextOf(b.stdout)).toContain('maintain an active pd plan');
  });
});

describe('pd-hook-prompt — the voice log', () => {
  test('a fresh alert produces output AND a spoke line naming the class and bytes', () => {
    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack before any edit | ts:${isoNow()}`);

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.status).toBe(0);
    const ctx = contextOf(r.stdout);
    expect(ctx).toContain('stop and ack before any edit');

    const line = lastVoice();
    expect(line.outcome).toBe('spoke');
    expect(line.actor).toBe('agent-alpha'); // RAW id, not actorKey()-normalized
    expect(line.hookEvent).toBe('UserPromptSubmit');
    expect(line.classes).toContain('ALERT');
    expect(line.counts).toEqual({ ALERT: 1 });
    // `bytes` on a spoke line is what actually went out — the envelope body.
    expect(line.bytes).toBe(Buffer.byteLength(ctx));
    expect(line.ts).toBeGreaterThan(0);
  });

  test('an over-TTL entry emits NOTHING and logs suppressed / ttl-expired', () => {
    burnNag('agent-alpha');
    setKey('PD_ALERT_ANCIENT', `STEERING: yesterday's news | ts:${isoAgo(40 * 60_000)}`);

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(''); // the whole point: it said nothing

    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('ttl-expired');
    expect(line.counts).toEqual({ ALERT: 1 }); // what it HELD
    expect(line.droppedClasses).toEqual(['ALERT']);
    expect(line.emittedBytes).toBe(0);
    expect(line.bytes).toBeGreaterThan(0); // what it WANTED to say
  });

  test('a pheromone from another project logs suppressed / not-relevant-to-cwd', () => {
    burnNag('agent-alpha');
    setKey(
      'PD_PHEROMONE_NEIGHBOR_1',
      `${WORKSPACE}-copy/src/nope.ts | wrong-project | ts:${isoNow()}`,
    );

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.stdout).toBe('');
    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('not-relevant-to-cwd');
    expect(line.counts).toEqual({ PHEROMONE: 1 });
  });

  test('more entries than the cap logs suppressed / over-entry-cap while still speaking', () => {
    const ts = isoNow();
    for (let i = 0; i < 14; i++) {
      setKey(`PD_PHEROMONE_FRESH_${i}`, `${WORKSPACE}/src/f-${i}.ts | note-${i} | ts:${ts}`);
    }

    const r = runHook({ actor: 'agent-alpha', env: { PD_SQUID_PROMPT_MAX_ENTRIES: '12' } });
    const ctx = contextOf(r.stdout);
    const entries = ctx.split('\n').filter((l) => l.startsWith('- ') && !l.includes('pd plan'));
    expect(entries).toHaveLength(12);

    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('over-entry-cap');
    expect(line.counts).toEqual({ PHEROMONE: 14 });
    expect(line.droppedClasses).toEqual(['PHEROMONE']);
    expect(line.emittedBytes).toBeGreaterThan(0); // it spoke, just not all of it
  });

  test('a byte-capped envelope logs suppressed / over-budget', () => {
    const ts = isoNow();
    const filler = 'x'.repeat(300);
    for (let i = 0; i < 6; i++) {
      setKey(`PD_PHEROMONE_BIG_${i}`, `${WORKSPACE}/src/b-${i}.ts | ${filler} | ts:${ts}`);
    }

    const r = runHook({ actor: 'agent-alpha', env: { PD_SQUID_PROMPT_MAX_BYTES: '512' } });
    const ctx = contextOf(r.stdout);
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(512);

    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('over-budget');
    expect(line.emittedBytes).toBeLessThanOrEqual(512);
    expect(line.bytes).toBeGreaterThan(512);
  });

  test('a stale reconcile heartbeat fails OPEN: no coordination context, suppressed / stale-matrix', () => {
    burnNag('agent-alpha');
    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack | ts:${isoNow()}`);
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(Date.now() - RECONCILE_STALE_AFTER_MS - 5_000));

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('stale-matrix');
    expect(line.counts).toEqual({ ALERT: 1 });
  });

  test('a FRESH reconcile heartbeat does not suppress anything', () => {
    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack | ts:${isoNow()}`);
    setKey(PD_RECON_HEARTBEAT_TS_KEY, String(Date.now()));

    const r = runHook({ actor: 'agent-alpha' });
    expect(contextOf(r.stdout)).toContain('stop and ack');
    expect(lastVoice().outcome).toBe('spoke');
  });

  test('an absent matrix logs silent / matrix-absent', () => {
    burnNag('agent-alpha');
    rmSync(MATRIX, { force: true });

    const r = runHook({ actor: 'agent-alpha' });
    expect(r.stdout).toBe('');
    const line = lastVoice();
    expect(line.outcome).toBe('silent');
    expect(line.reason).toBe('matrix-absent');
  });

  test('exactly ONE log line is appended per invocation', () => {
    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack | ts:${isoNow()}`);
    for (let i = 0; i < 4; i++) runHook({ actor: 'agent-alpha' });
    expect(voiceLines()).toHaveLength(4);
  });

  test('the log is byte-bounded and rotates tail-first instead of growing forever', () => {
    // Pre-fill well past the cap with recognizable filler lines.
    const filler = `${'{"outcome":"filler","pad":"'}${'p'.repeat(400)}"}\n`;
    writeFileSync(VOICE_LOG, filler.repeat(60)); // ~25 KB
    expect(readFileSync(VOICE_LOG, 'utf8').length).toBeGreaterThan(8192);

    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack | ts:${isoNow()}`);
    const r = runHook({ actor: 'agent-alpha', env: { PD_SQUID_VOICE_LOG_MAX_BYTES: '8192' } });
    expect(r.status).toBe(0);

    const raw = readFileSync(VOICE_LOG, 'utf8');
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(8192);
    // Rotation keeps the TAIL: the newest line (ours) must have survived.
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(JSON.parse(lines[lines.length - 1]).outcome).toBe('spoke');
    // And no line was left half-written by the byte-wise cut.
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  test('an unwritable log path still exits 0 with correct stdout', () => {
    // PD_HOME nested under a REGULAR FILE — `mkdir -p` can never succeed here,
    // for any uid, so both the voice log and the nag state file are unwritable.
    const blocker = join(SCRATCH, 'blocker');
    writeFileSync(blocker, 'this is a file, not a directory\n');
    const deadHome = join(blocker, 'pd-home');

    setKey('PD_ALERT_STEER_1', `STEERING: stop and ack before any edit | ts:${isoNow()}`);
    const r = runHook({ actor: 'agent-alpha', home: deadHome, matrix: MATRIX });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const ctx = contextOf(r.stdout);
    expect(ctx).toContain('stop and ack before any edit');
    expect(existsSync(join(deadHome, 'squid-voice-log.jsonl'))).toBe(false);
  });
});

describe('pd-hook-prompt — per-actor addressing', () => {
  test("actor A sees its own inbox; actor B never sees A's mail", () => {
    const ts = isoNow();
    setKey(inboxKey('agent-alpha', 'm1'), `tube: alpha, the migration is yours | ts:${ts}`);
    setKey(inboxKey('agent-beta', 'm2'), `tube: beta, review PR 412 | ts:${ts}`);

    const alpha = contextOf(runHook({ actor: 'agent-alpha' }).stdout);
    expect(alpha).toContain('FOR YOU');
    expect(alpha).toContain('the migration is yours');
    expect(alpha).not.toContain('review PR 412');

    const beta = contextOf(runHook({ actor: 'agent-beta' }).stdout);
    expect(beta).toContain('review PR 412');
    expect(beta).not.toContain('the migration is yours');
  });

  test('parley summonses are addressed the same way', () => {
    const ts = isoNow();
    setKey(parleyKey('agent-alpha', 'conv-7'), `PARLEY: alpha owes conv-7 a reply | ts:${ts}`);

    expect(contextOf(runHook({ actor: 'agent-alpha' }).stdout)).toContain('owes conv-7 a reply');
    const beta = runHook({ actor: 'agent-beta' });
    // Nothing else is seeded, so beta's turn is the directive-only nag at most.
    expect(beta.stdout).not.toContain('owes conv-7 a reply');
  });

  test("the shell's pd_actor_key mirrors the contract's actorKey for a punctuated id", () => {
    // A real session identity, full of characters illegal in a shell env key.
    const actor = 'port-daddy:contrib/squid-1.0';
    expect(actorKey(actor)).toBe('PORT_DADDY_CONTRIB_SQUID_1_0');
    setKey(inboxKey(actor, 'msg-9'), `tube: punctuated identity delivered | ts:${isoNow()}`);

    const ctx = contextOf(runHook({ actor }).stdout);
    expect(ctx).toContain('punctuated identity delivered');
    expect(lastVoice().counts).toMatchObject({ INBOX: 1 });
  });

  test('an agent with NO PD_ACTOR reads no per-actor class at all', () => {
    burnNag(undefined);
    setKey(inboxKey('agent-alpha', 'm1'), `tube: alpha only | ts:${isoNow()}`);

    const r = runHook(); // no PD_ACTOR
    expect(r.stdout).toBe('');
    // It did not even COUNT the mail — an unidentified agent is addressed by nobody.
    const line = lastVoice();
    expect(line.outcome).toBe('silent');
    expect(line.reason).toBe('no-entries');
  });
});

describe('pd-hook-prompt — projection order', () => {
  test('PD_HALT renders first, above everything else', () => {
    const ts = isoNow();
    setKey(inboxKey('agent-alpha', 'm1'), `tube: inbox item | ts:${ts}`);
    setKey(parleyKey('agent-alpha', 'c1'), `PARLEY: summons | ts:${ts}`);
    setKey(PD_ALERT_FLEET_APPROVALS_KEY, `2 spawns awaiting approval | ts:${ts}`);
    setKey(claimKey('/repo/src/auth.ts'), `claim overlap on auth.ts | ts:${ts}`);
    setKey(ciKey('feat/squid'), `required check failing on feat/squid | ts:${ts}`);
    setKey(accomplishmentKey('s9'), `session s9 finished the widget | ts:${ts}`);
    setKey(PD_HALT_KEY, `HALT: operator pulled the cord | ts:${ts}`);
    setKey('PD_PHEROMONE_LOCAL_1', `${WORKSPACE}/src/a.ts | touched | ts:${ts}`);

    const ctx = contextOf(runHook({ actor: 'agent-alpha' }).stdout);
    const lines = ctx.split('\n');
    expect(lines[0]).toBe('[PORT DADDY — HALT]');
    expect(lines[1]).toContain('operator pulled the cord');

    // Every other class still made it in, below the halt.
    for (const needle of [
      'summons',
      'inbox item',
      'awaiting approval',
      'claim overlap',
      'required check failing',
      'finished the widget',
      'touched',
    ]) {
      expect(ctx).toContain(needle);
    }
    expect(ctx.indexOf('[PORT DADDY — HALT]')).toBeLessThan(ctx.indexOf('[PORT DADDY — FOR YOU]'));

    const line = lastVoice();
    expect(line.outcome).toBe('spoke');
    expect(line.counts).toEqual({
      HALT: 1,
      PARLEY: 1,
      FLEET_APPROVALS: 1,
      CLAIM: 1,
      CI: 1,
      INBOX: 1,
      ACCOMPLISHMENT: 1,
      PHEROMONE: 1,
    });
    // Emission order is RECONCILE_PROJECTION_ORDER with the legacy trail last.
    expect(line.classes).toEqual([
      'HALT',
      'PARLEY',
      'FLEET_APPROVALS',
      'CLAIM',
      'CI',
      'INBOX',
      'ACCOMPLISHMENT',
      'PHEROMONE',
    ]);
  });

  test('a HALT is never dropped by the entry cap', () => {
    const ts = isoNow();
    for (let i = 0; i < 20; i++) {
      setKey(`PD_PHEROMONE_NOISE_${i}`, `${WORKSPACE}/src/n-${i}.ts | noise-${i} | ts:${ts}`);
    }
    setKey(PD_HALT_KEY, `HALT: operator pulled the cord | ts:${ts}`);

    const ctx = contextOf(runHook({ actor: 'agent-alpha', env: { PD_SQUID_PROMPT_MAX_ENTRIES: '3' } }).stdout);
    expect(ctx).toContain('operator pulled the cord');
    const line = lastVoice();
    expect(line.counts).toMatchObject({ HALT: 1 });
    expect(line.droppedClasses).toEqual(['PHEROMONE']);
  });
});
