/**
 * Unit tests for lib/event-envelope.ts
 *
 * Agent-interchange-format quality gates applied to the PD event/relay envelope:
 *   - unique `id`, optional `conversationId`, ISO-8601 `ts`
 *   - discriminated `kind`, explicit `v` (version)
 *   - per-publisher monotonic `seq`
 *   - round-trips: serialize → parse → equals original
 *   - strict validator rejects malformed input without throwing
 *
 * The `seq` + replay guard is the OPERATIONAL closure of the replay gap named in
 * apps/relay/formal/proverif/relay-e2e-secrecy/relay_e2e_secrecy.pv (PR #250): a stateless signed envelope let a
 * malicious relay replay; a per-publisher monotonic sequence makes the
 * subscriber reject stale/duplicate deliveries (injective agreement).
 */

import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
  createReplayGuard,
  EVENT_ENVELOPE_VERSION,
} from '../../lib/event-envelope.js';

const base = {
  kind: 'tube.msg',
  id: 'm-1',
  publisher: 'alice',
  seq: 1,
  ts: '2026-06-05T00:00:00.000Z',
  body: 'hello',
};

describe('event-envelope: construction + quality gates', () => {
  test('makeEnvelope stamps the version and preserves fields', () => {
    const env = makeEnvelope(base);
    expect(env.v).toBe(EVENT_ENVELOPE_VERSION);
    expect(env.kind).toBe('tube.msg');
    expect(env.id).toBe('m-1');
    expect(env.publisher).toBe('alice');
    expect(env.seq).toBe(1);
    expect(env.ts).toBe('2026-06-05T00:00:00.000Z');
  });

  test('makeEnvelope rejects missing required interchange fields', () => {
    for (const missing of ['kind', 'id', 'publisher', 'seq', 'ts', 'body']) {
      const bad = { ...base };
      delete bad[missing];
      expect(() => makeEnvelope(bad)).toThrow();
    }
  });

  test('makeEnvelope rejects a non-ISO timestamp and a negative seq', () => {
    expect(() => makeEnvelope({ ...base, ts: 'yesterday' })).toThrow();
    expect(() => makeEnvelope({ ...base, seq: -1 })).toThrow();
    expect(() => makeEnvelope({ ...base, seq: 1.5 })).toThrow();
  });
});

describe('event-envelope: round-trip (serialize → parse → equals)', () => {
  test('a well-formed envelope round-trips exactly', () => {
    const env = makeEnvelope({ ...base, conversationId: 'c-9', inReplyTo: 'm-0' });
    const wire = serializeEnvelope(env);
    const parsed = parseEnvelope(wire);
    expect(parsed.ok).toBe(true);
    expect(parsed.envelope).toEqual(env);
  });

  test('parseEnvelope rejects malformed input without throwing', () => {
    for (const bad of ['not json', '{}', JSON.stringify({ v: 1 }), '42', 'null']) {
      const r = parseEnvelope(bad);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
    }
  });

  test('parseEnvelope rejects a wrong version (schema drift guard)', () => {
    const wire = JSON.stringify({ ...makeEnvelope(base), v: 999 });
    expect(parseEnvelope(wire).ok).toBe(false);
  });
});

describe('event-envelope: replay guard (per-publisher monotonic seq — closes I2)', () => {
  test('strictly increasing seq is accepted', () => {
    const g = createReplayGuard();
    expect(g.accept(makeEnvelope({ ...base, seq: 1 })).accepted).toBe(true);
    expect(g.accept(makeEnvelope({ ...base, seq: 2 })).accepted).toBe(true);
    expect(g.lastSeq('alice')).toBe(2);
  });

  test('a duplicate seq is rejected as a replay', () => {
    const g = createReplayGuard();
    g.accept(makeEnvelope({ ...base, seq: 5 }));
    const r = g.accept(makeEnvelope({ ...base, seq: 5 }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('replay');
  });

  test('an older seq is rejected as stale (reordered/replayed by the relay)', () => {
    const g = createReplayGuard();
    g.accept(makeEnvelope({ ...base, seq: 5 }));
    const r = g.accept(makeEnvelope({ ...base, seq: 3 }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('stale');
  });

  test('sequences are tracked independently per publisher', () => {
    const g = createReplayGuard();
    expect(g.accept(makeEnvelope({ ...base, publisher: 'alice', seq: 1 })).accepted).toBe(true);
    expect(g.accept(makeEnvelope({ ...base, publisher: 'bob', seq: 1 })).accepted).toBe(true); // not a replay
    expect(g.lastSeq('bob')).toBe(1);
  });

  test('the v6→v7 lesson at the wire layer: a replayed envelope cannot re-deliver', () => {
    const g = createReplayGuard();
    const env = makeEnvelope({ ...base, seq: 7 });
    expect(g.accept(env).accepted).toBe(true);
    // malicious relay re-sends the identical envelope
    expect(g.accept(env).accepted).toBe(false);
  });
});
