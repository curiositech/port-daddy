/**
 * Tests for the cloud squid (src/squid-events.ts): the SIGNED zero-trust
 * /v1/publish dialect (grand-plan DAG node n2-executor-identity).
 *
 * The hard contract under test: silently disabled unless RELAY_PUBLISH_URL,
 * the executor's Ed25519 seed, AND its harbor card are all set AND the tenant
 * repo consented via `squidEvents: true` in pd-fleet.yml; when enabled it
 * produces a correctly chained, correctly signed relay envelope on the
 * per-run channel `<relayFp>:fleet-cloud:<runId>` with the card in the BODY
 * (never an Authorization header — the bearer dialect does not exist); and it
 * NEVER throws — not on a rejected fetch, not on a throwing fetch, not on a
 * misconfigured key/card pair.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  emitSquidEvent,
  publishChainedEvent,
  flushSquidEvents,
  resetSquidChains,
  computeSquidEventHash,
  computeRunReportHash,
  reportRunTotals,
  runReportUrl,
  SQUID_SCHEMA,
  SQUID_CHANNEL_FAMILY,
  ZERO_HASH,
  type SquidRelayEvent,
  type SquidBody,
} from '../src/squid-events.js';

// ── Test identity: a real Ed25519 keypair + a decodable relay-issued card ────
// (the executor never verifies the card's signature — the RELAY does — so a
// placeholder sig is fine; sub/iss must be real for identity derivation).

const toHexT = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHexT = (h: string) =>
  Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const SEED_HEX = '11'.repeat(32);
const PUB = ed.getPublicKey(fromHexT(SEED_HEX)); // sha512Sync wired by the module under test
const FP = toHexT(sha256(PUB));
const RELAY_FP = 'ab'.repeat(32);

function makeCard(sub: string, mutate?: (claims: Record<string, unknown>) => void): string {
  const header = b64url({ alg: 'EdDSA', kid: RELAY_FP });
  const claims: Record<string, unknown> = {
    hv: 2,
    sub,
    iss: RELAY_FP,
    aud: RELAY_FP,
    jti: 'jti-squid-test',
    exp: 9_999_999_999,
    iat: 1,
    cap: [{ op: 'pub', channel: `${RELAY_FP}:fleet-cloud:*`, rate_per_min: 120 }],
  };
  // Identity-rejection tests mutate exactly ONE claim of this valid fixture.
  mutate?.(claims);
  return `${header}.${b64url(claims)}.${Buffer.from('placeholder-sig').toString('base64url')}`;
}

const CARD = makeCard(FP);

const ENV = {
  RELAY_PUBLISH_URL: 'https://relay.example/v1/publish',
  FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: SEED_HEX,
  FLEET_EXECUTOR_HARBOR_CARD: CARD,
  FLEET_DEPLOYMENT: 'staging',
};

const PAYLOAD = { repo: 'o/r', pr: 7, runId: 'run:d-1' };

function stubFetch(impl?: () => Promise<Response>) {
  const fn = vi.fn(impl ?? (async () => new Response('{}', { status: 200 })));
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

interface CapturedPublish {
  card: string;
  event: SquidRelayEvent;
}

beforeEach(() => {
  resetSquidChains();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('emitSquidEvent — enablement gates', () => {
  it('is silently disabled when any of the three env values is missing (zero fetches)', async () => {
    const fn = stubFetch();
    emitSquidEvent({}, 'run-started', PAYLOAD, true);
    emitSquidEvent({ RELAY_PUBLISH_URL: ENV.RELAY_PUBLISH_URL }, 'run-started', PAYLOAD, true);
    emitSquidEvent(
      { RELAY_PUBLISH_URL: ENV.RELAY_PUBLISH_URL, FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: SEED_HEX },
      'run-started', PAYLOAD, true,
    );
    emitSquidEvent(
      { FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: SEED_HEX, FLEET_EXECUTOR_HARBOR_CARD: CARD },
      'run-started', PAYLOAD, true,
    );
    emitSquidEvent(
      { RELAY_PUBLISH_URL: '', FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: '', FLEET_EXECUTOR_HARBOR_CARD: '' },
      'run-started', PAYLOAD, true,
    );
    await flushSquidEvents();
    expect(fn).not.toHaveBeenCalled();
  });

  it('is silently disabled without tenant consent, even fully configured (zero fetches)', async () => {
    const fn = stubFetch();
    emitSquidEvent(ENV, 'run-started', PAYLOAD, false);
    // Strict `=== true` gate: a truthy-but-not-true value is NOT consent.
    emitSquidEvent(ENV, 'run-started', PAYLOAD, 1 as unknown as boolean);
    emitSquidEvent(ENV, 'run-started', PAYLOAD, 'true' as unknown as boolean);
    await flushSquidEvents();
    expect(fn).not.toHaveBeenCalled();
  });

  it('is silently disabled when the card sub does not match the key fingerprint', async () => {
    const fn = stubFetch();
    const wrongCard = makeCard('f'.repeat(64));
    emitSquidEvent({ ...ENV, FLEET_EXECUTOR_HARBOR_CARD: wrongCard }, 'run-started', PAYLOAD, true);
    await flushSquidEvents();
    expect(fn).not.toHaveBeenCalled();
  });

  it('is silently disabled for short or non-hex Ed25519 seeds', async () => {
    const fn = stubFetch();
    emitSquidEvent({ ...ENV, FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: '123' }, 'run-started', PAYLOAD, true);
    emitSquidEvent({ ...ENV, FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: 'g'.repeat(64) }, 'run-started', PAYLOAD, true);
    await flushSquidEvents();
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── deriveSquidIdentity — the forgery gate ───────────────────────────────────
//
// deriveSquidIdentity (src/squid-events.ts) is module-private and is the check
// that decides whether a claimed executor identity may sign cloud-squid events
// at all: it returns null unless the relay-issued card's `sub` equals the
// fingerprint DERIVED FROM THE LOCAL SEED, the JWT body actually decodes, and
// `iss` is a non-empty string.
//
// These drive it through publishChainedEvent — the one entry point that
// reports the null return DIRECTLY (`code: 'disabled'`) instead of only
// implying it by silence. A regression that started accepting forged cards
// would fail here loudly rather than merely changing a fetch count.
//
// Each case mutates exactly ONE field of the valid fixture card, so a failure
// names the specific check that regressed.

describe('deriveSquidIdentity — rejects every card that is not this key’s', () => {
  const PROBE_SUFFIX = 'mediator:identity-probe';

  /** Derive through the awaited transport; report both observable effects. */
  async function deriveWithCard(card: string) {
    const fetchFn = stubFetch();
    const res = await publishChainedEvent(
      { ...ENV, FLEET_EXECUTOR_HARBOR_CARD: card },
      PROBE_SUFFIX,
      { probe: true },
      ENV.RELAY_PUBLISH_URL,
    );
    await flushSquidEvents();
    return { res, fetches: fetchFn.mock.calls.length };
  }

  /** A rejected card must BOTH report `disabled` and put nothing on the wire. */
  async function expectRejected(card: string, why: string) {
    const { res, fetches } = await deriveWithCard(card);
    expect(res.code, why).toBe('disabled');
    expect(res.ok, why).toBe(false);
    expect(fetches, `${why} — a rejected identity must never reach the relay`).toBe(0);
  }

  it('SANITY: the unmutated fixture card DOES derive — the probe distinguishes accept from reject', async () => {
    const { res, fetches } = await deriveWithCard(CARD);
    expect(res.code).toBeNull();
    expect(res.ok).toBe(true);
    expect(res.channel).toBe(`${RELAY_FP}:${SQUID_CHANNEL_FAMILY}:${PROBE_SUFFIX}`);
    expect(fetches).toBe(1);
  });

  // ── 1. The core forgery check: sub must equal the LOCAL key's fingerprint ──

  it('rejects a card minted for a DIFFERENT key (the forgery check)', async () => {
    // The attacker holds seed A but presents a card the relay minted for key B.
    const otherFp = toHexT(sha256(ed.getPublicKey(fromHexT('22'.repeat(32)))));
    expect(otherFp, 'fixture sanity: the second identity must be genuinely different').not.toBe(FP);
    await expectRejected(makeCard(otherFp), 'sub is another key’s fingerprint');
  });

  it('rejects a sub that differs from the fingerprint only in case (strict ===, fails closed)', async () => {
    expect(FP).not.toBe(FP.toUpperCase()); // the fingerprint really is lowercase hex
    await expectRejected(makeCard(FP.toUpperCase()), 'sub differs only in case');
  });

  it('rejects a sub that is a prefix/truncation of the real fingerprint', async () => {
    await expectRejected(makeCard(FP.slice(0, 32)), 'sub is truncated');
    await expectRejected(makeCard(`${FP}00`), 'sub is over-long');
  });

  it('rejects a non-string sub that a loose comparison might have waved through', async () => {
    for (const bogus of [null, 0, false, true, {}, [FP]]) {
      await expectRejected(
        makeCard(FP, (p) => {
          p.sub = bogus;
        }),
        `sub is ${JSON.stringify(bogus)}`,
      );
    }
  });

  // ── 2. Malformed / undecodable JWT bodies ────────────────────────────────
  // NOTE: the empty-string card is deliberately absent — it short-circuits on
  // the env-presence check before derivation, and is covered by the
  // enablement-gate suite above.

  it('rejects a card that is not three dot-separated segments', async () => {
    await expectRejected('not-a-jwt', 'no dots at all');
    await expectRejected(b64url({ hv: 2 }), 'a bare base64url blob, no dots');
    await expectRejected('header-only.', 'trailing dot, empty payload segment');
  });

  it('rejects a card whose payload segment is not decodable base64url', async () => {
    const header = b64url({ alg: 'EdDSA', kid: RELAY_FP });
    const sig = Buffer.from('placeholder-sig').toString('base64url');
    await expectRejected(`${header}.!!!!.${sig}`, 'payload has non-base64url characters');
    await expectRejected(`${header}.${'*'.repeat(8)}.${sig}`, 'payload is all invalid characters');
  });

  it('rejects a card whose payload segment is empty', async () => {
    const header = b64url({ alg: 'EdDSA', kid: RELAY_FP });
    const sig = Buffer.from('placeholder-sig').toString('base64url');
    await expectRejected(`${header}..${sig}`, 'payload segment is empty');
  });

  it('rejects a card whose payload decodes but is not JSON', async () => {
    const header = b64url({ alg: 'EdDSA', kid: RELAY_FP });
    const sig = Buffer.from('placeholder-sig').toString('base64url');
    const raw = (s: string) => `${header}.${Buffer.from(s).toString('base64url')}.${sig}`;
    await expectRejected(raw('not json at all'), 'payload is plain text');
    await expectRejected(raw('{"sub":'), 'payload is truncated JSON');
  });

  it('rejects a card whose payload is JSON but not an object', async () => {
    const header = b64url({ alg: 'EdDSA', kid: RELAY_FP });
    const sig = Buffer.from('placeholder-sig').toString('base64url');
    const json = (s: string) => `${header}.${Buffer.from(s).toString('base64url')}.${sig}`;
    await expectRejected(json('null'), 'payload is JSON null');
    await expectRejected(json(`"${FP}"`), 'payload is a bare JSON string');
    await expectRejected(json('[]'), 'payload is a JSON array');
  });

  // ── 3. Missing claims ────────────────────────────────────────────────────

  it('rejects a card with no sub claim at all', async () => {
    await expectRejected(
      makeCard(FP, (p) => {
        delete p.sub;
      }),
      'sub is absent',
    );
  });

  it('rejects a card with no iss claim at all — even when sub matches', async () => {
    // Isolates the iss check: this card passes the fingerprint comparison.
    await expectRejected(
      makeCard(FP, (p) => {
        delete p.iss;
      }),
      'iss is absent',
    );
  });

  it('rejects an iss that is empty or not a string — even when sub matches', async () => {
    for (const bogus of ['', null, 0, 42, {}, [RELAY_FP]]) {
      await expectRejected(
        makeCard(FP, (p) => {
          p.iss = bogus;
        }),
        `iss is ${JSON.stringify(bogus)}`,
      );
    }
  });

  // ── 4. The memo must not become a confused deputy ────────────────────────

  it('the identity memo is keyed on the card: a good derivation does not license a forged card', async () => {
    const good = await deriveWithCard(CARD);
    expect(good.res.ok, 'precondition: the valid card derives first').toBe(true);
    // Same seed, same isolate, memo now warm — the forged card must still fail.
    const otherFp = toHexT(sha256(ed.getPublicKey(fromHexT('33'.repeat(32)))));
    await expectRejected(makeCard(otherFp), 'forged card presented after a good one');
  });
});

describe('emitSquidEvent — the signed /v1/publish dialect', () => {
  it('publishes a chained, signed squid/1 envelope on the per-run channel with NO bearer auth', async () => {
    const fn = stubFetch();
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'ship-verdict', { ...PAYLOAD, ship: 'code-reviewer', verdict: 'PASS' }, true);
    emitSquidEvent(ENV, 'run-concluded', { ...PAYLOAD, verdict: 'success' }, true);
    await flushSquidEvents();

    expect(fn).toHaveBeenCalledTimes(3);
    const expectedChannel = `${RELAY_FP}:${SQUID_CHANNEL_FAMILY}:${PAYLOAD.runId}`;
    const bodies: CapturedPublish[] = [];
    for (const call of fn.mock.calls) {
      const [url, init] = call as unknown as [string, RequestInit];
      expect(url).toBe(ENV.RELAY_PUBLISH_URL);
      expect(init.method).toBe('POST');
      // The bearer dialect does not exist: no Authorization header, ever.
      expect(Object.keys(init.headers as Record<string, string>)).not.toContain('Authorization');
      bodies.push(JSON.parse(String(init.body)) as CapturedPublish);
    }

    // Card rides in the body; sender is the FINGERPRINT (relay-enforced).
    for (const b of bodies) {
      expect(b.card).toBe(CARD);
      expect(b.event.v).toBe(1);
      expect(b.event.sender).toBe(FP);
      expect(b.event.channel).toBe(expectedChannel);
    }

    // Monotonic seq + linked hash chain from ZERO_HASH.
    expect(bodies.map((b) => b.event.seq)).toEqual([1, 2, 3]);
    expect(bodies[0]!.event.prev_hash).toBe(ZERO_HASH);
    expect(bodies[1]!.event.prev_hash).toBe(bodies[0]!.event.this_hash);
    expect(bodies[2]!.event.prev_hash).toBe(bodies[1]!.event.this_hash);
  });
});

describe('emitSquidEvent — chain verification against the relay formula', () => {
  it('this_hash matches the canonical formula and sig verifies with the executor pubkey', async () => {
    const fn = stubFetch();
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'run-concluded', { ...PAYLOAD, verdict: 'success' }, true);
    await flushSquidEvents();

    for (const call of fn.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      const { event } = JSON.parse(String(init.body)) as CapturedPublish;
      const recomputed = computeSquidEventHash({
        prev_hash: event.prev_hash,
        sender: event.sender,
        channel: event.channel,
        seq: event.seq,
        iat: event.iat,
        ciphertext: event.ciphertext,
      });
      expect(event.this_hash).toBe(recomputed);
      const ok = await ed.verifyAsync(fromHexT(event.sig), fromHexT(event.this_hash), PUB);
      expect(ok).toBe(true);
      // The ciphertext slot decodes to a squid/1 body naming the deployment.
      const body = JSON.parse(Buffer.from(event.ciphertext, 'base64url').toString('utf8')) as SquidBody;
      expect(body.schema).toBe(SQUID_SCHEMA);
      expect(body.sender).toBe('fleet-executor@staging');
      expect(body.payload.runId).toBe(PAYLOAD.runId);
    }
  });

  it('KNOWN-ANSWER VECTOR — shared with the relay suite so the two formulas cannot drift', () => {
    // Same literal inputs asserted against apps/relay/src/crypto.ts
    // computeEventHash in apps/relay/tests/fleet-executor-identity.test.ts.
    expect(
      computeSquidEventHash({
        prev_hash: '0'.repeat(64),
        sender: 'aa',
        channel: 'h:ch',
        seq: 1,
        iat: 1717000000,
        ciphertext: 'aabbcc',
      }),
    ).toBe('276464292b650ab5985097ccdbef76bb4e3eb8842500dd5a05027890b5efa957');
  });

  it('runs are independent chains: a second runId starts again at seq 1', async () => {
    const fn = stubFetch();
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'run-started', { ...PAYLOAD, runId: 'run:d-2' }, true);
    await flushSquidEvents();
    const seqs = fn.mock.calls.map((c) => (JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as CapturedPublish).event.seq);
    expect(seqs).toEqual([1, 1]);
  });
});

describe('emitSquidEvent — never disturbs the run', () => {
  it('never throws when fetch rejects (fire-and-forget)', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });
    expect(() => emitSquidEvent(ENV, 'run-concluded', { ...PAYLOAD, verdict: 'success' }, true)).not.toThrow();
    await flushSquidEvents(); // an unhandled rejection would fail the test
  });

  it('never throws when fetch itself throws synchronously', async () => {
    const fn = vi.fn(() => {
      throw new Error('sync boom');
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    expect(() =>
      emitSquidEvent(ENV, 'pr-stacked', { ...PAYLOAD, ship: 'spark', url: 'https://github.com/x' }, true),
    ).not.toThrow();
    await flushSquidEvents();
  });

  it('a failed send still advances the local chain (a lost event is a lost event)', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('dropped');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'run-concluded', { ...PAYLOAD, verdict: 'success' }, true);
    await flushSquidEvents();
    const second = JSON.parse(String((fn.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as CapturedPublish;
    expect(second.event.seq).toBe(2); // no local retry, no seq reuse
  });
});

// ── Run-concluded reconciliation report (x7-mercy-hooks slice 2) ─────────────

describe('reportRunTotals — the out-of-band claim', () => {
  it('POSTs the signed per-run total to /v1/fleet/run-report AFTER the channel tail drains', async () => {
    const fn = stubFetch();
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'ship-verdict', { ...PAYLOAD, ship: 'purser', verdict: 'APPROVE' }, true);
    emitSquidEvent(ENV, 'run-concluded', { ...PAYLOAD, verdict: 'success' }, true);
    reportRunTotals(ENV, PAYLOAD.runId, true);
    await flushSquidEvents();

    expect(fn).toHaveBeenCalledTimes(4);
    // The report is queued on the channel tail, so it is the LAST call — every
    // in-flight event is counted before the claim is made.
    const [url, init] = fn.mock.calls[3] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.example/v1/fleet/run-report');
    const body = JSON.parse(String(init.body)) as {
      card: string;
      report: { run_id: string; channel: string; events_sent: number; iat: number };
      sig: string;
    };
    expect(body.card).toBe(CARD);
    expect(body.report.run_id).toBe(PAYLOAD.runId);
    expect(body.report.channel).toBe(`${RELAY_FP}:${SQUID_CHANNEL_FAMILY}:${PAYLOAD.runId}`);
    expect(body.report.events_sent).toBe(3);

    // The signature verifies against the executor's public key over the
    // canonical report hash — the relay-side check, run here.
    const hash = computeRunReportHash({
      sender: FP,
      channel: body.report.channel,
      runId: body.report.run_id,
      eventsSent: body.report.events_sent,
      iat: body.report.iat,
    });
    expect(ed.verify(fromHexT(body.sig), fromHexT(hash), PUB)).toBe(true);
  });

  it('counts events the network ATE — the claim is the local chain, not delivery', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('dropped'); // second event never delivered
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    emitSquidEvent(ENV, 'ship-verdict', { ...PAYLOAD, ship: 'purser' }, true);
    reportRunTotals(ENV, PAYLOAD.runId, true);
    await flushSquidEvents();
    const [, init] = fn.mock.calls[2] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { report: { events_sent: number } };
    // Claimed 2 although only 1 arrived — exactly the gap the relay records.
    expect(body.report.events_sent).toBe(2);
  });

  it('is gated exactly like the squid: tenant consent, env presence, and a non-empty channel', async () => {
    const fn = stubFetch();
    reportRunTotals(ENV, PAYLOAD.runId, false); // tenant did not consent
    reportRunTotals({}, PAYLOAD.runId, true); // env missing
    reportRunTotals(ENV, PAYLOAD.runId, true); // nothing was ever sent on this channel
    await flushSquidEvents();
    expect(fn).not.toHaveBeenCalled();
  });

  it('never throws — not on a rejected fetch, not on a throwing fetch', async () => {
    const fn = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    emitSquidEvent(ENV, 'run-started', PAYLOAD, true);
    expect(() => reportRunTotals(ENV, PAYLOAD.runId, true)).not.toThrow();
    await expect(flushSquidEvents()).resolves.toBeUndefined();
  });

  it('derives the report endpoint from the publish endpoint', () => {
    expect(runReportUrl('https://relay.example/v1/publish')).toBe('https://relay.example/v1/fleet/run-report');
    expect(runReportUrl('https://relay.example/v1/publish/')).toBe('https://relay.example/v1/fleet/run-report');
  });

  it('pins the canonical report hash to the known-answer vector shared with the relay suite', () => {
    // The SAME vector is asserted by apps/relay/tests/run-report.test.ts
    // against runReportHash — drift on either side breaks one of the suites.
    expect(
      computeRunReportHash({
        sender: 'ab'.repeat(32),
        channel: `${'cd'.repeat(32)}:fleet-cloud:run:kat-1`,
        runId: 'run:kat-1',
        eventsSent: 7,
        iat: 1_755_000_000,
      }),
    ).toBe('311980675485f76132a2aa0cb01d9dbdc1af8956c9a6992699c46c06c9284de6');
  });
});

describe('no bearer dialect exists — by construction', () => {
  it('the executor source contains no RELAY_PUBLISH_TOKEN and squid-events sets no Authorization header', () => {
    const srcDir = join(__dirname, '..', 'src');
    for (const f of readdirSync(srcDir)) {
      if (!f.endsWith('.ts')) continue;
      const text = readFileSync(join(srcDir, f), 'utf8');
      expect(text, `${f} must not reference the retired bearer token`).not.toContain('RELAY_PUBLISH_TOKEN');
    }
    const squid = readFileSync(join(srcDir, 'squid-events.ts'), 'utf8');
    expect(squid).not.toMatch(/Authorization:\s*[`'"]/);
  });
});
