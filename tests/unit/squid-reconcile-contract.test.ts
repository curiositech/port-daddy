/**
 * Tests for the Reconcile Loop shared contract (lib/squid/reconcile-contract.ts).
 *
 * This module is pure — no I/O, no clock, no daemon — so every assertion here is
 * a real assertion about the contract other agents will code against, not a
 * mock. The three things that MUST be nailed down before anyone builds on it:
 *
 *   1. actorKey() is keySuffix() plus a POSIX-cksum digest, and the POSIX-sh
 *      mirror in the TSDoc (which the hooks embed) computes it identically. If
 *      the two ever diverge, the daemon writes PD_INBOX_ keys the hooks never
 *      find and the failure is silent. The digest half is what makes the
 *      address injective — see the actorKey docblock.
 *   2. isMatrixStale() boundaries, because the fail-open rule hangs off them.
 *   3. The truncation priority ordering, because it is what decides whether a
 *      HALT or an accomplishment note survives a full prompt budget.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { keySuffix, posixCksum } from '../../lib/squid/matrix.js';
import {
  ACTOR_KEY_BODY_MAX,
  PER_ACTOR_SEPARATOR,
  perActorKeyPrefix,
  reconcileKeyActor,
  RECONCILE_DROP_ORDER,
  RECONCILE_INTERVAL_MS,
  RECONCILE_KEY_CLASSES,
  RECONCILE_KEY_CLASS_NAMES,
  RECONCILE_MAX_PROJECTED_ENTRIES,
  RECONCILE_PROJECTION_ORDER,
  RECONCILE_STALE_AFTER_MS,
  RECONCILE_TOTAL_BUDGET_BYTES,
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_HALT_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  accomplishmentKey,
  actorKey,
  ciKey,
  claimKey,
  classifyReconcileKey,
  inboxKey,
  isMatrixStale,
  parleyKey,
  readHeartbeatTs,
} from '../../lib/squid/reconcile-contract.js';
import type { ReconcileKeyClassName, VoiceLogEvent } from '../../lib/squid/reconcile-contract.js';

// Shared corpus: realistic session ids, plus the nasty edges (empty, all
// punctuation, unicode, over-length). Used for BOTH the normalization assertions
// and the keySuffix-parity assertion so parity is proven on the hard cases too.
const ACTOR_CORPUS = [
  'port-daddy:contrib:squid-1',
  'sess_ABC123',
  'agent.node/7',
  'a',
  'Mixed-Case_Actor',
  '  leading and trailing  ',
  '---',
  '___',
  '',
  '你好-agent',
  '2026-08-04T12:00:00.000Z',
  'x'.repeat(200),
  '::::sess::::',
  'a-b_c.d/e f',
];

describe('actorKey — the canonical actor normalizer', () => {
  test('is keySuffix() for the readable body, plus the raw-input cksum digest', () => {
    for (const raw of ACTOR_CORPUS) {
      const body = keySuffix(raw).slice(0, ACTOR_KEY_BODY_MAX).replace(/_+$/g, '') || 'X';
      expect(actorKey(raw)).toBe(`${body}_${posixCksum(raw)}`);
    }
  });

  test('always produces a non-empty key matching /^[A-Za-z0-9_]+$/', () => {
    for (const raw of ACTOR_CORPUS) {
      const k = actorKey(raw);
      expect(k.length).toBeGreaterThan(0);
      expect(k).toMatch(/^[A-Za-z0-9_]+$/);
      // Body (<=64) + '_' + at most 10 digits of CRC.
      expect(k.length).toBeLessThanOrEqual(ACTOR_KEY_BODY_MAX + 11);
    }
  });

  test('applies the documented transformation to the readable body', () => {
    const body = (raw: string): string => actorKey(raw).replace(/_\d+$/, '');
    // 1. runs of non-alphanumerics collapse to a single underscore
    expect(body('port-daddy:contrib:squid-1')).toBe('PORT_DADDY_CONTRIB_SQUID_1');
    expect(body('a---b')).toBe('A_B');
    expect(body('a-b_c.d/e f')).toBe('A_B_C_D_E_F');
    // 2. leading/trailing underscores are stripped
    expect(body('  leading and trailing  ')).toBe('LEADING_AND_TRAILING');
    expect(body('::::sess::::')).toBe('SESS');
    // 3. uppercased
    expect(body('Mixed-Case_Actor')).toBe('MIXED_CASE_ACTOR');
    // 4. body truncated to ACTOR_KEY_BODY_MAX characters
    expect(body('x'.repeat(200))).toBe('X'.repeat(ACTOR_KEY_BODY_MAX));
    // 5. empty body falls back to the literal 'X' — but the DIGEST still
    //    separates these four ids, which is the whole point of carrying one.
    expect(body('')).toBe('X');
    expect(body('---')).toBe('X');
    expect(body('___')).toBe('X');
    expect(body('你好')).toBe('X');
    expect(new Set(['', '---', '___', '你好'].map(actorKey)).size).toBe(4);
  });

  test('is INJECTIVE across the aliases plain normalization collapses', () => {
    // Every group below normalizes to one body. Before the digest they were one
    // address, and the agents in each group read each other's mail.
    const aliases = [
      'agent-one',
      'agent.one',
      'agent_one',
      'agent/one',
      'AGENT ONE',
      // truncation aliases: identical for the first 64 chars
      `${'a'.repeat(64)}-x`,
      `${'a'.repeat(64)}-y`,
      'a'.repeat(64),
      // no ASCII alphanumerics at all — every one of these was the literal `X`
      '你好',
      'дневник',
      '日本語エージェント',
      '---',
      '',
    ];
    expect(new Set(aliases.map(actorKey)).size).toBe(aliases.length);
    // …and no address is a prefix of another, which is the property the
    // anchored `^PD_INBOX_<me>__` grep in bin/pd-hook-prompt actually relies on.
    for (const a of aliases) {
      for (const b of aliases) {
        if (a === b) continue;
        expect(`${actorKey(a)}${PER_ACTOR_SEPARATOR}`.startsWith(`${actorKey(b)}${PER_ACTOR_SEPARATOR}`)).toBe(false);
      }
    }
  });

  test('never emits a body that ends in the separator character', () => {
    // Regression: keySuffix used to truncate AFTER stripping underscores, so a
    // cut landing on an interior `_` left the key ending in one. Appending the
    // `__` separator then produced `___`, and the first `__` in the key sat one
    // character left of the true boundary.
    for (const raw of [...ACTOR_CORPUS, `${'a'.repeat(79)}-x`, `${'a'.repeat(64)}-x`, `${'a'.repeat(63)}-x`]) {
      expect(actorKey(raw).endsWith('_')).toBe(false);
      expect(actorKey(raw)).not.toContain(PER_ACTOR_SEPARATOR);
    }
  });

  test('produces keys legal as a matrix key body (setKey regex)', () => {
    // matrix.setKey enforces /^[A-Za-z_][A-Za-z0-9_]*$/ on the FULL key; the
    // builders below prepend a PD_ prefix, so the suffix only needs to be legal
    // in the tail position.
    for (const raw of ACTOR_CORPUS) {
      expect(`PD_INBOX_${actorKey(raw)}`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });
});

describe('actorKey — the POSIX-sh mirror documented in the TSDoc', () => {
  // Byte-for-byte the snippet in the actorKey docblock. Shell hooks embed this;
  // if it ever disagrees with the TS function, the daemon writes PD_INBOX_ keys
  // the hooks cannot find and an agent silently never hears about its inbox.
  const SH_MIRROR = String.raw`
k=$(printf '%s' "$1" \
  | sed -e 's/[^A-Za-z0-9]\{1,\}/_/g' -e 's/^_\{1,\}//' -e 's/_\{1,\}$//' \
  | tr '[:lower:]' '[:upper:]' \
  | cut -c1-64 \
  | sed -e 's/_\{1,\}$//')
[ -n "$k" ] || k=X
printf '%s_%s' "$k" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
`;

  const shActorKey = (raw: string): string =>
    execFileSync('sh', ['-c', SH_MIRROR, 'sh', raw], { encoding: 'utf8' });

  test('the sh mirror agrees with actorKey() on the whole corpus', () => {
    for (const raw of ACTOR_CORPUS) {
      expect(shActorKey(raw)).toBe(actorKey(raw));
    }
  });

  test('the sh mirror agrees on the alias corpus the digest exists to separate', () => {
    // These are exactly the inputs whose BODIES collide. If `cksum` in the shell
    // and posixCksum() in TS ever disagreed, they would collide in the hook and
    // not in the daemon — an agent reading a neighbour's inbox on one surface
    // only, which is the worst possible way for this to fail.
    for (const raw of [
      'agent-one',
      'agent.one',
      'agent_one',
      `${'a'.repeat(64)}-x`,
      `${'a'.repeat(64)}-y`,
      'a'.repeat(64),
      '你好',
      'дневник',
      '',
      '---',
      'x'.repeat(200),
    ]) {
      expect(shActorKey(raw)).toBe(actorKey(raw));
    }
  });

  test('the sh mirror reproduces the empty-input fallback body', () => {
    expect(shActorKey('')).toBe(`X_${posixCksum('')}`);
    expect(shActorKey('---')).toBe(`X_${posixCksum('---')}`);
    expect(shActorKey('')).not.toBe(shActorKey('---'));
  });

  test('the sh mirror reproduces the body truncation', () => {
    expect(shActorKey('x'.repeat(200))).toBe(
      `${'X'.repeat(ACTOR_KEY_BODY_MAX)}_${posixCksum('x'.repeat(200))}`,
    );
  });

  test('real cksum(1) agrees with posixCksum() — the digest parity gate', () => {
    for (const raw of [...ACTOR_CORPUS, 'a-b', 'a.b', 'a_b', '日本語エージェント', 'ÿ']) {
      const out = execFileSync('sh', ['-c', `printf '%s' "$1" | cksum | cut -d' ' -f1`, 'sh', raw], {
        encoding: 'utf8',
      }).trim();
      expect(out).toBe(String(posixCksum(raw)));
    }
  });
});

describe('isMatrixStale — the fail-open boundary', () => {
  const NOW = 1_800_000_000_000;

  test('fresh: a heartbeat one tick old is not stale', () => {
    expect(isMatrixStale(NOW - RECONCILE_INTERVAL_MS, NOW)).toBe(false);
  });

  test('fresh: a heartbeat written this instant is not stale', () => {
    expect(isMatrixStale(NOW, NOW)).toBe(false);
  });

  test('fresh: one millisecond before the threshold is not stale', () => {
    expect(isMatrixStale(NOW - (RECONCILE_STALE_AFTER_MS - 1), NOW)).toBe(false);
  });

  test('exactly at the threshold IS stale (the comparison is >=)', () => {
    expect(isMatrixStale(NOW - RECONCILE_STALE_AFTER_MS, NOW)).toBe(true);
  });

  test('stale: well past the threshold', () => {
    expect(isMatrixStale(NOW - RECONCILE_STALE_AFTER_MS * 10, NOW)).toBe(true);
  });

  test('undefined heartbeat is stale — absence of evidence, not evidence of absence', () => {
    expect(isMatrixStale(undefined, NOW)).toBe(true);
  });

  test('non-finite heartbeat is stale (NaN / Infinity never read as fresh)', () => {
    expect(isMatrixStale(Number.NaN, NOW)).toBe(true);
    expect(isMatrixStale(Number.POSITIVE_INFINITY, NOW)).toBe(true);
    expect(isMatrixStale(Number.NEGATIVE_INFINITY, NOW)).toBe(true);
  });

  test('a future heartbeat (clock skew) is NOT stale — skew must not mute the fleet', () => {
    expect(isMatrixStale(NOW + 5_000, NOW)).toBe(false);
    expect(isMatrixStale(NOW + RECONCILE_STALE_AFTER_MS * 100, NOW)).toBe(false);
  });

  test('the stale threshold is exactly four missed ticks', () => {
    expect(RECONCILE_STALE_AFTER_MS).toBe(RECONCILE_INTERVAL_MS * 4);
    expect(RECONCILE_INTERVAL_MS).toBe(15_000);
    expect(RECONCILE_STALE_AFTER_MS).toBe(60_000);
  });

  test('three missed ticks is still fresh; four is not', () => {
    expect(isMatrixStale(NOW - RECONCILE_INTERVAL_MS * 3, NOW)).toBe(false);
    expect(isMatrixStale(NOW - RECONCILE_INTERVAL_MS * 4, NOW)).toBe(true);
  });
});

describe('readHeartbeatTs — corrupt heartbeats fail open like missing ones', () => {
  const NOW = 1_800_000_000_000;

  test('reads a well-formed heartbeat', () => {
    expect(readHeartbeatTs({ [PD_RECON_HEARTBEAT_TS_KEY]: String(NOW) })).toBe(NOW);
    expect(readHeartbeatTs({ [PD_RECON_HEARTBEAT_TS_KEY]: `  ${NOW}  ` })).toBe(NOW);
  });

  test('absent key → undefined → stale', () => {
    expect(readHeartbeatTs({})).toBeUndefined();
    expect(isMatrixStale(readHeartbeatTs({}), NOW)).toBe(true);
  });

  test('unparseable value → undefined → stale (no special case at the call site)', () => {
    for (const bad of ['', '   ', 'not-a-number', 'NaN', '12abc']) {
      const kv = { [PD_RECON_HEARTBEAT_TS_KEY]: bad };
      expect(readHeartbeatTs(kv)).toBeUndefined();
      expect(isMatrixStale(readHeartbeatTs(kv), NOW)).toBe(true);
    }
  });
});

describe('truncation priority ordering', () => {
  test('HALT and PARLEY are the two highest priorities, in that order', () => {
    expect(RECONCILE_PROJECTION_ORDER[0]).toBe('HALT');
    expect(RECONCILE_PROJECTION_ORDER[1]).toBe('PARLEY');
  });

  test('ACCOMPLISHMENT is lowest priority — emitted last, dropped first', () => {
    expect(RECONCILE_PROJECTION_ORDER[RECONCILE_PROJECTION_ORDER.length - 1]).toBe(
      'ACCOMPLISHMENT',
    );
    expect(RECONCILE_DROP_ORDER[0]).toBe('ACCOMPLISHMENT');
  });

  test('HALT is dropped last, PARLEY second-to-last', () => {
    expect(RECONCILE_DROP_ORDER[RECONCILE_DROP_ORDER.length - 1]).toBe('HALT');
    expect(RECONCILE_DROP_ORDER[RECONCILE_DROP_ORDER.length - 2]).toBe('PARLEY');
  });

  test('drop order is exactly the reverse of projection order (one ranking, not two)', () => {
    expect([...RECONCILE_DROP_ORDER].reverse()).toEqual([...RECONCILE_PROJECTION_ORDER]);
  });

  test('the full ordering is the documented sequence', () => {
    expect([...RECONCILE_PROJECTION_ORDER]).toEqual([
      'HALT',
      'PARLEY',
      'FLEET_APPROVALS',
      'CLAIM',
      'CI',
      'INBOX',
      'ACCOMPLISHMENT',
    ]);
  });

  test('HEARTBEAT is infrastructure — never projected, never in either ordering', () => {
    expect(RECONCILE_KEY_CLASSES.HEARTBEAT.projectionPriority).toBeNull();
    expect(RECONCILE_PROJECTION_ORDER).not.toContain('HEARTBEAT');
    expect(RECONCILE_DROP_ORDER).not.toContain('HEARTBEAT');
  });

  test('every projected class appears exactly once in each ordering', () => {
    const projected = RECONCILE_KEY_CLASS_NAMES.filter(
      (n) => RECONCILE_KEY_CLASSES[n].projectionPriority !== null,
    );
    expect(RECONCILE_PROJECTION_ORDER).toHaveLength(projected.length);
    expect(new Set(RECONCILE_PROJECTION_ORDER).size).toBe(projected.length);
    expect(new Set(RECONCILE_DROP_ORDER).size).toBe(projected.length);
  });

  test('projection priorities are unique and contiguous from 1', () => {
    const priorities = RECONCILE_KEY_CLASS_NAMES.map(
      (n) => RECONCILE_KEY_CLASSES[n].projectionPriority,
    ).filter((p): p is number => p !== null);
    expect(new Set(priorities).size).toBe(priorities.length);
    expect([...priorities].sort((a, b) => a - b)).toEqual(
      priorities.map((_, i) => i + 1),
    );
  });

  test('a projector dropping by RECONCILE_DROP_ORDER sheds ambience before urgency', () => {
    // Simulate the projector: hold every class, drop from the front of the drop
    // order until the entry budget is met. This is the exact algorithm the
    // reconcile projector must implement.
    const held: ReconcileKeyClassName[] = [...RECONCILE_PROJECTION_ORDER];
    const entries: Record<string, number> = {
      HALT: 1,
      PARLEY: 2,
      FLEET_APPROVALS: 1,
      CLAIM: 4,
      CI: 1,
      INBOX: 3,
      ACCOMPLISHMENT: 2,
    };
    const total = () => held.reduce((n, c) => n + entries[c], 0);
    expect(total()).toBe(14); // the documented over-subscription
    expect(total()).toBeGreaterThan(RECONCILE_MAX_PROJECTED_ENTRIES);

    const dropped: ReconcileKeyClassName[] = [];
    for (const candidate of RECONCILE_DROP_ORDER) {
      if (total() <= RECONCILE_MAX_PROJECTED_ENTRIES) break;
      held.splice(held.indexOf(candidate), 1);
      dropped.push(candidate);
    }
    expect(total()).toBeLessThanOrEqual(RECONCILE_MAX_PROJECTED_ENTRIES);
    expect(dropped).toEqual(['ACCOMPLISHMENT']);
    expect(held).toContain('HALT');
    expect(held).toContain('PARLEY');
  });

  test('budget constants match the pd-hook-prompt defaults they must not exceed', () => {
    expect(RECONCILE_TOTAL_BUDGET_BYTES).toBe(4096); // PD_SQUID_PROMPT_MAX_BYTES default
    expect(RECONCILE_MAX_PROJECTED_ENTRIES).toBe(12); // PD_SQUID_PROMPT_MAX_ENTRIES default
  });
});

describe('key class registry', () => {
  test('key prefixes are unique and no prefix is a prefix of another', () => {
    const prefixes = RECONCILE_KEY_CLASS_NAMES.map((n) => RECONCILE_KEY_CLASSES[n].prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a === b) continue;
        expect(a.startsWith(b)).toBe(false);
      }
    }
  });

  test('every prefix is a legal matrix key stem', () => {
    for (const name of RECONCILE_KEY_CLASS_NAMES) {
      expect(RECONCILE_KEY_CLASSES[name].prefix).toMatch(/^PD_[A-Z0-9_]*$/);
    }
  });

  test('perActor mirrors addressing, and only INBOX/PARLEY are per-actor', () => {
    for (const name of RECONCILE_KEY_CLASS_NAMES) {
      const cls = RECONCILE_KEY_CLASSES[name];
      expect(cls.perActor).toBe(cls.addressing === 'per-actor');
      if (cls.perActor) expect(cls.capScope).toBe('per-actor');
    }
    const perActor = RECONCILE_KEY_CLASS_NAMES.filter((n) => RECONCILE_KEY_CLASSES[n].perActor);
    expect(perActor.sort()).toEqual(['INBOX', 'PARLEY']);
  });

  test('the documented caps hold', () => {
    expect(RECONCILE_KEY_CLASSES.INBOX.entryCap).toBe(3);
    expect(RECONCILE_KEY_CLASSES.INBOX.capScope).toBe('per-actor');
    expect(RECONCILE_KEY_CLASSES.ACCOMPLISHMENT.entryCap).toBe(2);
    expect(RECONCILE_KEY_CLASSES.CI.entryCap).toBe(1);
    expect(RECONCILE_KEY_CLASSES.HALT.entryCap).toBe(1);
    expect(RECONCILE_KEY_CLASSES.FLEET_APPROVALS.entryCap).toBe(1);
    for (const name of RECONCILE_KEY_CLASS_NAMES) {
      expect(RECONCILE_KEY_CLASSES[name].entryCap).toBeGreaterThan(0);
    }
  });

  test('only TTL-bearing GC rules carry a ttlMs, and HEARTBEAT alone is never GC-d', () => {
    for (const name of RECONCILE_KEY_CLASS_NAMES) {
      const cls = RECONCILE_KEY_CLASSES[name];
      const needsTtl = cls.gc === 'ttl' || cls.gc === 'decay-by-age';
      expect(cls.ttlMs !== undefined).toBe(needsTtl);
      if (needsTtl) expect(cls.ttlMs).toBeGreaterThan(0);
    }
    const never = RECONCILE_KEY_CLASS_NAMES.filter((n) => RECONCILE_KEY_CLASSES[n].gc === 'never');
    expect(never).toEqual(['HEARTBEAT']);
  });

  test('every class names a durable source (the matrix is never the last copy)', () => {
    for (const name of RECONCILE_KEY_CLASS_NAMES) {
      expect(RECONCILE_KEY_CLASSES[name].durableSource.length).toBeGreaterThan(10);
    }
  });

  test('the migrated approvals key is byte-identical to fleet-daemon syncApprovalAlert', () => {
    expect(PD_ALERT_FLEET_APPROVALS_KEY).toBe('PD_ALERT_FLEET_APPROVALS');
    expect(PD_HALT_KEY).toBe('PD_HALT');
    expect(PD_RECON_HEARTBEAT_TS_KEY).toBe('PD_RECON_HEARTBEAT_TS');
  });
});

describe('key builders and classification', () => {
  test('builders produce keys legal for matrix.setKey', () => {
    const built = [
      inboxKey('port-daddy:contrib:squid-1', 'msg-42'),
      claimKey('lib/squid/matrix.ts'),
      ciKey('feat/squid-reconcile-loop'),
      parleyKey('sess.7', 'conv/aa-bb'),
      accomplishmentKey('note:9'),
      PD_HALT_KEY,
      PD_ALERT_FLEET_APPROVALS_KEY,
      PD_RECON_HEARTBEAT_TS_KEY,
    ];
    for (const k of built) expect(k).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });

  test('builders produce the documented shapes', () => {
    // Per-actor classes carry the actor's cksum digest after the readable body;
    // the digest is what makes two ids that normalize alike land on two
    // mailboxes. GLOBAL classes are keyed by subject alone and are unchanged —
    // that split is deliberate (see the keySuffix docblock) and is asserted here
    // so a future "consistency" pass cannot quietly reshape every lock key.
    expect(inboxKey('port-daddy:contrib:squid-1', 'msg-42')).toBe(
      `PD_INBOX_PORT_DADDY_CONTRIB_SQUID_1_${posixCksum('port-daddy:contrib:squid-1')}__MSG_42`,
    );
    expect(claimKey('lib/squid/matrix.ts')).toBe('PD_CLAIM_LIB_SQUID_MATRIX_TS');
    expect(ciKey('feat/squid-reconcile-loop')).toBe('PD_CI_FEAT_SQUID_RECONCILE_LOOP');
    expect(parleyKey('sess.7', 'conv/aa-bb')).toBe(
      `PD_PARLEY_SESS_7_${posixCksum('sess.7')}__CONV_AA_BB`,
    );
    expect(accomplishmentKey('note:9')).toBe('PD_ACCOMPLISHMENT_NOTE_9');
  });

  test("an actor's whole inbox is greppable with one anchored prefix", () => {
    const pattern = new RegExp(`^${perActorKeyPrefix('INBOX', 'port-daddy:contrib:squid-1')}`);
    expect(inboxKey('port-daddy:contrib:squid-1', 'm1')).toMatch(pattern);
    expect(inboxKey('port-daddy:contrib:squid-1', 'm2')).toMatch(pattern);
    expect(inboxKey('some-other-agent', 'm1')).not.toMatch(pattern);
  });

  test('classifyReconcileKey round-trips every builder', () => {
    expect(classifyReconcileKey(inboxKey('a', 'b'))).toBe('INBOX');
    expect(classifyReconcileKey(claimKey('lib/x.ts'))).toBe('CLAIM');
    expect(classifyReconcileKey(ciKey('main'))).toBe('CI');
    expect(classifyReconcileKey(parleyKey('a', 'b'))).toBe('PARLEY');
    expect(classifyReconcileKey(accomplishmentKey('z'))).toBe('ACCOMPLISHMENT');
    expect(classifyReconcileKey(PD_HALT_KEY)).toBe('HALT');
    expect(classifyReconcileKey(PD_ALERT_FLEET_APPROVALS_KEY)).toBe('FLEET_APPROVALS');
    expect(classifyReconcileKey(PD_RECON_HEARTBEAT_TS_KEY)).toBe('HEARTBEAT');
  });

  test('classifyReconcileKey does not claim keys owned by other subsystems', () => {
    expect(classifyReconcileKey('PD_LOCK_LIB_FOO_TS')).toBeUndefined();
    expect(classifyReconcileKey('PD_PHEROMONE_LIB_FOO_TS_1')).toBeUndefined();
    expect(classifyReconcileKey('PD_ALERT_SOMETHING_ELSE')).toBeUndefined();
    expect(classifyReconcileKey('PATH')).toBeUndefined();
    expect(classifyReconcileKey('')).toBeUndefined();
  });

  test('singleton classes match exactly, not by prefix', () => {
    expect(classifyReconcileKey('PD_HALTED_AT')).toBeUndefined();
    expect(classifyReconcileKey('PD_HALT_')).toBeUndefined();
    expect(classifyReconcileKey('PD_RECON_HEARTBEAT_TS_OLD')).toBeUndefined();
  });

  test('an addressed prefix with no address is junk, not a zero-length address', () => {
    expect(classifyReconcileKey('PD_INBOX_')).toBeUndefined();
    expect(classifyReconcileKey('PD_CLAIM_')).toBeUndefined();
    expect(classifyReconcileKey('PD_CI_')).toBeUndefined();
  });
});

describe('per-actor addressing is unambiguous (the alpha / alpha-two leak)', () => {
  // REGRESSION. With a single `_` between actor and subject there was no marked
  // boundary, so actor `alpha`'s anchored prefix `PD_INBOX_ALPHA_` also matched
  // actor `alpha-two`'s key `PD_INBOX_ALPHA_TWO_M1` — silent cross-actor
  // delivery that no shell pattern could have fixed.
  const PREFIX_COLLIDERS: ReadonlyArray<readonly [string, string]> = [
    ['alpha', 'alpha-two'],
    ['alpha', 'alpha_two'],
    ['sess', 'sess-7'],
    ['a', 'a-b'],
    ['port-daddy:contrib:squid', 'port-daddy:contrib:squid-1'],
  ];

  test('a shorter actor id never prefix-matches a longer one (INBOX)', () => {
    for (const [mine, theirs] of PREFIX_COLLIDERS) {
      const myPrefix = perActorKeyPrefix('INBOX', mine);
      expect(inboxKey(theirs, 'm1').startsWith(myPrefix)).toBe(false);
      expect(inboxKey(mine, 'm1').startsWith(myPrefix)).toBe(true);
    }
  });

  test('a shorter actor id never prefix-matches a longer one (PARLEY)', () => {
    for (const [mine, theirs] of PREFIX_COLLIDERS) {
      const myPrefix = perActorKeyPrefix('PARLEY', mine);
      expect(parleyKey(theirs, 'c1').startsWith(myPrefix)).toBe(false);
      expect(parleyKey(mine, 'c1').startsWith(myPrefix)).toBe(true);
    }
  });

  test('the separator is one actorKey can never emit', () => {
    for (const raw of ACTOR_CORPUS) {
      expect(actorKey(raw)).not.toContain(PER_ACTOR_SEPARATOR);
    }
  });

  test('reconcileKeyActor recovers exactly the addressed actor', () => {
    for (const [mine, theirs] of PREFIX_COLLIDERS) {
      expect(reconcileKeyActor(inboxKey(mine, 'm1'))).toBe(actorKey(mine));
      expect(reconcileKeyActor(inboxKey(theirs, 'm1'))).toBe(actorKey(theirs));
      expect(reconcileKeyActor(parleyKey(theirs, 'c1'))).toBe(actorKey(theirs));
    }
  });

  test('reconcileKeyActor is undefined for non-per-actor and unaddressed keys', () => {
    expect(reconcileKeyActor(claimKey('lib/x.ts'))).toBeUndefined();
    expect(reconcileKeyActor(PD_HALT_KEY)).toBeUndefined();
    expect(reconcileKeyActor('PD_LOCK_LIB_X_TS')).toBeUndefined();
    // A pre-migration single-underscore key is addressed to NOBODY, not to
    // everybody: fail closed, so a legacy key cannot leak into a new reader.
    expect(reconcileKeyActor('PD_INBOX_ALPHA_M1')).toBeUndefined();
  });

  test('perActorKeyPrefix refuses a class that is not per-actor', () => {
    expect(() => perActorKeyPrefix('CLAIM', 'alpha')).toThrow(/not a per-actor class/);
    expect(() => perActorKeyPrefix('HALT', 'alpha')).toThrow(/not a per-actor class/);
  });
});

describe('bin/pd-hook-prompt is the actorKey mirror in production, not a copy of one', () => {
  // The contract's TSDoc snippet is proven above. That proves the DOCUMENTATION
  // agrees with the TS. This block proves the SHIPPED HOOK does — the function
  // actually executed on every agent turn, extracted from the file on disk.
  const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pd-hook-prompt');
  const hookSource = readFileSync(HOOK, 'utf8');

  /** Slice `pd_actor_key() { ... }` out of the hook exactly as shipped. */
  const extractHookFn = (): string => {
    const start = hookSource.indexOf('pd_actor_key() {');
    expect(start).toBeGreaterThan(-1);
    const end = hookSource.indexOf('\n}\n', start);
    expect(end).toBeGreaterThan(start);
    return hookSource.slice(start, end + 3);
  };

  const hookActorKey = (raw: string): string =>
    execFileSync('sh', ['-c', `${extractHookFn()}\npd_actor_key "$1"`, 'sh', raw], {
      encoding: 'utf8',
    });

  test('the shipped hook function agrees with actorKey() on the whole corpus', () => {
    for (const raw of ACTOR_CORPUS) {
      expect(hookActorKey(raw)).toBe(actorKey(raw));
    }
  });

  test('the shipped hook function agrees on the prefix-collision corpus too', () => {
    for (const raw of ['alpha', 'alpha-two', 'alpha_two', 'sess-7', 'a-b']) {
      expect(hookActorKey(raw)).toBe(actorKey(raw));
    }
  });

  test('the hook greps per-actor classes with the DOUBLE-underscore separator', () => {
    // If this drifts back to a single `_`, the leak returns silently.
    expect(hookSource).toContain('^PD_INBOX_${ACTOR_KEY}__[A-Za-z0-9_]+=');
    expect(hookSource).toContain('^PD_PARLEY_${ACTOR_KEY}__[A-Za-z0-9_]+=');
  });

  test('a key minted by the TS builder is matched by the hook grep for that actor only', () => {
    const mineKey = inboxKey('alpha', 'm1');
    const theirsKey = inboxKey('alpha-two', 'm1');
    const grepFor = (actor: string, key: string): boolean => {
      const ak = hookActorKey(actor);
      const out = execFileSync(
        'sh',
        ['-c', `printf '%s\\n' "$1" | grep -cE "^PD_INBOX_$2__[A-Za-z0-9_]+=" || true`, 'sh', `${key}="x"`, ak],
        { encoding: 'utf8' },
      ).trim();
      return out !== '0';
    };
    expect(grepFor('alpha', mineKey)).toBe(true);
    expect(grepFor('alpha', theirsKey)).toBe(false);
    expect(grepFor('alpha-two', theirsKey)).toBe(true);
  });
});

describe('VoiceLog union shape', () => {
  test('discriminates on `outcome` and narrows to the right fields', () => {
    const events: VoiceLogEvent[] = [
      {
        outcome: 'spoke',
        ts: 1_800_000_000_000,
        actor: 'port-daddy:contrib:squid-1',
        hookEvent: 'UserPromptSubmit',
        counts: { HALT: 1, CLAIM: 2 },
        bytes: 311,
        classes: ['HALT', 'CLAIM'],
      },
      {
        outcome: 'silent',
        ts: 1_800_000_000_001,
        actor: 'port-daddy:contrib:squid-1',
        hookEvent: 'PreToolUse',
        reason: 'no-entries',
      },
      {
        outcome: 'suppressed',
        ts: 1_800_000_000_002,
        actor: 'port-daddy:contrib:squid-1',
        hookEvent: 'UserPromptSubmit',
        reason: 'over-budget',
        counts: { ACCOMPLISHMENT: 2, INBOX: 3 },
        bytes: 5_120,
        droppedClasses: ['ACCOMPLISHMENT', 'INBOX'],
        emittedBytes: 0,
      },
    ];

    const seen: string[] = [];
    for (const ev of events) {
      switch (ev.outcome) {
        case 'spoke':
          seen.push(`spoke:${ev.bytes}:${ev.classes.join('+')}`);
          break;
        case 'silent':
          seen.push(`silent:${ev.reason}`);
          break;
        case 'suppressed':
          seen.push(`suppressed:${ev.reason}:${ev.droppedClasses.length}`);
          break;
      }
    }
    expect(seen).toEqual(['spoke:311:HALT+CLAIM', 'silent:no-entries', 'suppressed:over-budget:2']);
  });

  test('suppressed is distinguishable from silent — the "should still talk" case', () => {
    const silent: VoiceLogEvent = {
      outcome: 'silent',
      ts: 0,
      actor: 'a',
      hookEvent: 'UserPromptSubmit',
      reason: 'no-entries',
    };
    const suppressed: VoiceLogEvent = {
      outcome: 'suppressed',
      ts: 0,
      actor: 'a',
      hookEvent: 'UserPromptSubmit',
      reason: 'stale-matrix',
      counts: { HALT: 1 },
      bytes: 88,
      droppedClasses: ['HALT'],
      emittedBytes: 0,
    };
    // Both emitted nothing; only one of them HAD something to say.
    expect(silent.outcome).not.toBe(suppressed.outcome);
    expect(suppressed.outcome === 'suppressed' && suppressed.counts.HALT).toBe(1);
  });

  test('governor keys built from a VoiceLog stay low-cardinality (responsible-logging)', () => {
    // The key must be the SHAPE of the event, never its instance — actor ids and
    // byte counts belong in meta. This asserts the documented key recipe.
    const governorKey = (ev: VoiceLogEvent): string =>
      ev.outcome === 'suppressed' ? `voicelog_suppressed_${ev.reason}` : `voicelog_${ev.outcome}`;

    const manyActors: VoiceLogEvent[] = Array.from({ length: 50 }, (_, i) => ({
      outcome: 'suppressed' as const,
      ts: i,
      actor: `sess-${i}`,
      hookEvent: 'UserPromptSubmit' as const,
      reason: 'over-budget' as const,
      counts: { INBOX: 3 },
      bytes: 9000 + i,
      droppedClasses: ['ACCOMPLISHMENT' as const],
      emittedBytes: 0,
    }));

    expect(new Set(manyActors.map(governorKey)).size).toBe(1);
    expect(governorKey(manyActors[0])).toBe('voicelog_suppressed_over-budget');
  });
});
