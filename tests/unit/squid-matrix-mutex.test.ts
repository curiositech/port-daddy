/**
 * Regression net for the two blockers that had no owner after the parallel fix
 * round: per-actor address collisions (`actorKey`) and the split lock primitive
 * between the TypeScript and POSIX-sh halves of the Ink Cloud.
 *
 * Both are *isolation* bugs, and both were invisible from inside one language:
 *
 *   - `actorKey()` normalized lossily and truncated after stripping underscores,
 *     so two distinct agent ids could land on ONE matrix address. The daemon
 *     wrote `PD_INBOX_<addr>__` and the shell hook grepped `^PD_INBOX_<addr>__`;
 *     both agreed perfectly, and both delivered agent A's mail to agent B.
 *
 *   - `bin/pd-hook-post-tool` took `flock` on `<matrix>.flock` while every
 *     reconcile tick took `mkdir` on `<matrix>.lock`. Each side held "the lock"
 *     and neither excluded the other, so a pheromone appended inside a tick's
 *     read-modify-rename window was destroyed by the rename — silently, on
 *     exactly the busy fleet the lock exists to protect.
 *
 * The positive direction matters as much as the negative one here: a lock that
 * merely blocks is easy, a lock that blocks *and then lets the write land* is
 * the actual requirement. `concurrent appends survive concurrent ticks` is the
 * test that would fail if someone "fixed" contention by dropping writes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { keySuffix, posixCksum, readMatrix, withLock } from '../../lib/squid/matrix.js';
import {
  ACTOR_KEY_BODY_MAX,
  PER_ACTOR_SEPARATOR,
  actorKey,
  inboxKey,
  parleyKey,
  perActorKeyPrefix,
  reconcileKeyActor,
} from '../../lib/squid/reconcile-contract.js';
import { createReconcileLoop } from '../../lib/squid/reconcile.js';

const SCRATCH = join(tmpdir(), 'pd-squid-mutex', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');
const REPO = process.cwd();
const POST_TOOL = join(REPO, 'bin', 'pd-hook-post-tool');
const PROMPT = join(REPO, 'bin', 'pd-hook-prompt');

const saved = { PD_MATRIX_FILE: process.env.PD_MATRIX_FILE, PD_HOME: process.env.PD_HOME };

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_HOME = SCRATCH;
  process.env.PD_MATRIX_FILE = MATRIX;
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  for (const k of ['PD_MATRIX_FILE', 'PD_HOME'] as const) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Fire one pheromone append through the real POSIX hook. */
function appendPheromone(path: string, actor = 'racer', extraEnv: NodeJS.ProcessEnv = {}): void {
  execFileSync('/bin/sh', [POST_TOOL], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path }, cwd: SCRATCH }),
    env: { ...process.env, PD_ACTOR: actor, ...extraEnv },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

// ─── Blocker: per-actor address collisions ────────────────────────────────────

describe('actorKey addresses are unforgeable in BOTH readers', () => {
  // Each pair normalizes to one body; before the digest they were one mailbox.
  const COLLIDING_PAIRS: ReadonlyArray<readonly [string, string]> = [
    // separator aliasing
    ['agent-one', 'agent.one'],
    ['agent_one', 'agent/one'],
    // truncation aliasing at the body boundary (the 79/80-char corpus)
    [`${'a'.repeat(79)}-x`, 'a'.repeat(79)],
    [`${'a'.repeat(ACTOR_KEY_BODY_MAX)}-x`, 'a'.repeat(ACTOR_KEY_BODY_MAX)],
    [`${'a'.repeat(ACTOR_KEY_BODY_MAX)}-x`, `${'a'.repeat(ACTOR_KEY_BODY_MAX)}-y`],
    // no ASCII alphanumerics: every one of these used to be the literal `X`
    ['你好', 'дневник'],
    ['日本語エージェント', '中文代理'],
    ['---', '___'],
  ];

  test('the colliding corpus gets distinct addresses', () => {
    for (const [a, b] of COLLIDING_PAIRS) {
      expect(actorKey(a)).not.toBe(actorKey(b));
    }
  });

  test('no address is an anchored prefix of another (the grep property)', () => {
    for (const [a, b] of COLLIDING_PAIRS) {
      const mine = perActorKeyPrefix('INBOX', a);
      expect(inboxKey(b, 'secret').startsWith(mine)).toBe(false);
      expect(inboxKey(a, 'secret').startsWith(mine)).toBe(true);
      expect(parleyKey(b, 'c1').startsWith(perActorKeyPrefix('PARLEY', a))).toBe(false);
    }
  });

  test('no address ends in `_`, so the `__` separator stays the true boundary', () => {
    for (const [a, b] of COLLIDING_PAIRS) {
      for (const raw of [a, b]) {
        expect(actorKey(raw).endsWith('_')).toBe(false);
        expect(actorKey(raw)).not.toContain(PER_ACTOR_SEPARATOR);
        expect(reconcileKeyActor(inboxKey(raw, 'm1'))).toBe(actorKey(raw));
      }
    }
  });

  test('the REAL shell hook does not deliver a colliding neighbour\'s parley', () => {
    for (const [victim, neighbour] of COLLIDING_PAIRS) {
      writeFileSync(
        MATRIX,
        `${parleyKey(victim, 'c1')}="PARLEY c1: rotate the prod key | ts:${new Date().toISOString()}"\n`,
      );
      const out = execFileSync('/bin/sh', [PROMPT], {
        input: '{}',
        env: { ...process.env, PD_ACTOR: neighbour },
        encoding: 'utf8',
      });
      expect(out).not.toContain('rotate the prod key');
    }
  });

  test('the REAL shell hook still delivers the owner their own parley', () => {
    for (const [victim] of COLLIDING_PAIRS) {
      writeFileSync(
        MATRIX,
        `${parleyKey(victim, 'c1')}="PARLEY c1: rotate the prod key | ts:${new Date().toISOString()}"\n`,
      );
      const out = execFileSync('/bin/sh', [PROMPT], {
        input: '{}',
        env: { ...process.env, PD_ACTOR: victim },
        encoding: 'utf8',
      });
      expect(out).toContain('rotate the prod key');
    }
  });

  test('keySuffix stays lossy on purpose — pinned so the tradeoff stays visible', () => {
    // Subject aliasing is SAFE (two paths sharing one PD_LOCK_* key over-locks),
    // actor aliasing is not. This asserts the split is deliberate, so nobody
    // "fixes" keySuffix and silently reshapes every lock and pheromone key.
    expect(keySuffix('a-b')).toBe(keySuffix('a.b'));
    expect(keySuffix('你好')).toBe('X');
    expect(actorKey('a-b')).not.toBe(actorKey('a.b'));
  });

  test('posixCksum is the digest, and it is stable for a given id', () => {
    expect(actorKey('agent-one')).toBe(`AGENT_ONE_${posixCksum('agent-one')}`);
    expect(actorKey('agent-one')).toBe(actorKey('agent-one'));
  });

  test('the hook reads NO per-actor class when it cannot compute the digest', () => {
    // `cksum` is POSIX, but "POSIX says so" is not a runtime guarantee. If it
    // is missing the hook must emit no address at all rather than a truncated
    // `BODY_` one — that would end in the character the `__` separator depends
    // on never appearing, so it would miss this agent's own keys AND match a
    // neighbour's anchored prefix. Unaddressable degrades to the same posture
    // as an unset PD_ACTOR: silence.
    const fakeBin = join(SCRATCH, 'nocksum-bin');
    mkdirSync(fakeBin, { recursive: true });
    for (const c of ['cat', 'sed', 'head', 'grep', 'cut', 'tr', 'date', 'jq', 'awk', 'od', 'wc', 'tail', 'sort']) {
      let p = '';
      try {
        p = execFileSync('sh', ['-c', `command -v ${c} || true`], { encoding: 'utf8' }).trim();
      } catch {
        p = '';
      }
      if (p) symlinkSync(p, join(fakeBin, c));
    }
    writeFileSync(
      MATRIX,
      `PD_RECON_HEARTBEAT_TS="${Date.now()}"\n` +
        `${inboxKey('agent-alpha', 'm1')}="tube: SECRETMAIL | ts:${new Date().toISOString()}"\n`,
    );
    const withCksum = execFileSync('/bin/sh', [PROMPT], {
      input: '{}',
      env: { ...process.env, PD_ACTOR: 'agent-alpha' },
      encoding: 'utf8',
    });
    expect(withCksum).toContain('SECRETMAIL');

    const without = execFileSync('/bin/sh', [PROMPT], {
      input: '{}',
      env: { ...process.env, PATH: fakeBin, PD_ACTOR: 'agent-alpha' },
      encoding: 'utf8',
    });
    expect(without).not.toContain('SECRETMAIL');
  });
});

// ─── Blocker: one lock primitive across TS and sh ─────────────────────────────

describe('the matrix lock is ONE primitive across TypeScript and POSIX sh', () => {
  test('pd-hook-post-tool takes no lock object the TS layer does not take', () => {
    // The flock fast path is the bug itself; assert it is gone rather than
    // trusting a comment. `<matrix>.lock` (mkdir) is the shared object.
    // Matched against executable lines only — the prose above the loop names
    // flock deliberately, to say why it is not there.
    const code = readFileSync(POST_TOOL, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\bflock\b/);
    // NOTE: single-quoted on purpose. `${MATRIX}` here is SHELL source text we
    // assert appears verbatim in bin/pd-hook-post-tool — it is not a JS
    // template interpolation. Converting this to a backtick string would
    // silently assert the wrong thing (and static analysers flag it as a
    // suspected typo; it isn't).
    expect(code).toContain('LOCKDIR="${MATRIX}.lock"');
    expect(code).toContain('mkdir "$LOCKDIR"');
  });

  test('a shell append cannot land while the TS layer holds the lock', () => {
    writeFileSync(MATRIX, 'PD_ALERT_SEED="seed"\n');
    const landed = withLock(undefined, () => {
      // A short give-up budget keeps the test quick; the production default
      // (5s) matches DEFAULT_LOCK.timeoutMs and is exercised by the reviewer's
      // evidence file, tests/unit/squid-reconcile-correctness-review.test.ts.
      appendPheromone(join(SCRATCH, 'a.ts'), 'racer', { PD_MATRIX_LOCK_TRIES: '20' });
      return Object.keys(readMatrix()).some((k) => k.startsWith('PD_PHEROMONE_'));
    });
    expect(landed).toBe(false);
  });

  test('the seed key is untouched by a blocked append', () => {
    writeFileSync(MATRIX, 'PD_ALERT_SEED="seed"\n');
    withLock(undefined, () => {
      appendPheromone(join(SCRATCH, 'a.ts'), 'racer', { PD_MATRIX_LOCK_TRIES: '20' });
    });
    expect(readMatrix().PD_ALERT_SEED).toBe('seed');
  });

  test('appends SURVIVE ticks they interleave with — the positive direction', () => {
    // The point of the lock is not to block, it is to let every write land.
    // Serialized-but-lost would pass the negative test above and still be a
    // coordination outage, so this asserts the count, not merely the absence
    // of a race. Ticks are microseconds; a hook that waits ~1ms then appends
    // is the normal case, and all 12 traces must be in the file at the end.
    //
    // `pheromoneTopN` is lifted clear of the sample size on purpose. The loop's
    // default keeps only the freshest 6 — that is deliberate GC, and leaving it
    // in would make this test pass or fail on decay policy while claiming to
    // measure the lock. Isolate the property under test.
    const loop = createReconcileLoop({
      now: () => Date.now(),
      approvals: () => [],
      panic: () => ({ armed: false }),
      pheromoneTopN: 100,
    });
    loop.tick();

    const paths = Array.from({ length: 12 }, (_, i) => join(SCRATCH, `src/f${i}.ts`));
    for (const p of paths) {
      appendPheromone(p);
      loop.tick(); // read-modify-rename the whole file between appends
    }

    const kv = readMatrix();
    const subjects = Object.entries(kv)
      .filter(([k]) => k.startsWith('PD_PHEROMONE_'))
      .map(([, v]) => v.split(' | ')[0]);
    for (const p of paths) {
      expect(subjects).toContain(p);
    }
  });
});
