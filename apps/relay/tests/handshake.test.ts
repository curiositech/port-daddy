/**
 * Tests for handleHandshake (ADR-0049, S2/S3/S6).
 *
 * handleHandshake is the subscriber admission gate: a daemon presents a signed
 * harbor card + a ClientHello signature and requests subscriptions. The relay
 * verifies the card, the hello signature, and — per requested channel — the
 * capability (S2: matchCapability) and harbor membership (S6).
 *
 * These tests mint a REAL Ed25519-signed daemon card (kid != relay fp → the
 * daemon-issued branch, which checks harbor_members in D1) and a real
 * ClientHello signature, then assert:
 *   - INSUFFICIENT_CAP: a channel the card's cap does not cover is rejected.
 *   - HARBOR_NOT_MEMBER: a covered channel whose harbor the daemon is not a
 *     member of is rejected.
 *   - accepted: a covered channel whose harbor the daemon IS a member of is
 *     accepted, and a valid ServerHello (signed, with the relay pubkey) is
 *     returned.
 *   - mixed: cap + membership are evaluated per-channel independently.
 *   - pre-verify gates: unknown identity, revoked identity, bad hello sig.
 */

import { describe, it, expect } from 'vitest';
import { handleHandshake } from '../src/handlers.js';
import {
  signEd25519,
  pubKeyFromPrivKey,
  hashHex,
  fromHex,
  toHex,
} from '../src/crypto.js';
import type { Env, CapabilityEntry, ClientHello, ServerHello } from '../src/types.js';

// Wire noble sync hash test-locally (idempotent with crypto.ts).
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

// ── Deterministic keys/fingerprints ───────────────────────────────────────────
const DAEMON_PRIV = '33'.repeat(32);
const DAEMON_PUB = pubKeyFromPrivKey(DAEMON_PRIV);
// daemon_fingerprint = SHA256(pubkey bytes) — matches how the relay derives it.
const DAEMON_FP = toHex(sha256(fromHex(DAEMON_PUB)));

const RELAY_PRIV = '00'.repeat(32);

const HARBOR_A = 'a'.repeat(64);
const HARBOR_B = 'b'.repeat(64);

// ── card minting (mirror handleExchange's JWT construction exactly) ───────────
function b64urlStr(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
function b64urlBytes(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url');
}

/**
 * Mint a real Ed25519-signed harbor card.
 * kid is set to the daemon fingerprint (NOT the relay fp), so handleHandshake
 * takes the daemon-issued branch (harbor_members D1 check). The card is signed
 * by `signerPriv` and must verify under the identity row's pub_key — so the
 * signer must be the daemon key whose pub is registered as the identity.
 */
async function mintCard(opts: {
  signerPriv: string;
  kid: string;
  sub: string;
  iss: string;
  aud: string;
  cap: CapabilityEntry[];
  exp?: number;
  jti?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'EdDSA', kid: opts.kid };
  const payload = {
    hv: 2,
    sub: opts.sub,
    iss: opts.iss,
    aud: opts.aud,
    exp: opts.exp ?? now + 3600,
    iat: now,
    jti: opts.jti ?? 'card-jti-1',
    cap: opts.cap,
  };
  const headerB64 = b64urlStr(JSON.stringify(header));
  const payloadB64 = b64urlStr(JSON.stringify(payload));
  // verifyCard hashes the signing input with SHA256 then verifies the sig over
  // that hash — identical to signEd25519(priv, hashHex(input)).
  const sigHex = await signEd25519(opts.signerPriv, hashHex(`${headerB64}.${payloadB64}`));
  const sigB64 = b64urlBytes(fromHex(sigHex));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// ── ClientHello signature: Ed25519 over SHA256(card + nonce_c) by daemon key ──
async function helloSig(card: string, nonceC: string, daemonPriv: string): Promise<string> {
  return signEd25519(daemonPriv, hashHex(card + nonceC));
}

// ── D1 mock: identities + harbor_members + sessions insert ────────────────────
interface MockState {
  identity: Record<string, unknown> | null;
  // set of harbor fingerprints the daemon is a member of
  memberHarbors: Set<string>;
}

function makeMockD1(state: MockState): { db: D1Database; sessionsInserted: number } {
  let sessionsInserted = 0;
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        if (query.includes('FROM identities')) return state.identity as T | null;
        if (query.includes('FROM harbor_members')) {
          // bound = [daemon_fingerprint, harbor_fingerprint]
          const harborFp = String(bound[1]);
          return (state.memberHarbors.has(harborFp) ? ({ 1: 1 } as unknown as T) : null);
        }
        if (query.includes('FROM chain_heads')) return null; // no prior head
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> { return { results: [] as unknown as T[] }; },
      async run() {
        if (query.includes('INTO sessions')) sessionsInserted++;
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
  return { db, get sessionsInserted() { return sessionsInserted; } } as { db: D1Database; sessionsInserted: number };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    } as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIV,
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

function handshakeReq(hello: ClientHello): Request {
  return new Request('https://relay.example.com/v1/handshake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hello),
  });
}

const NONCE_C = 'c'.repeat(64);

/** Build a fully-signed, internally-consistent ClientHello. */
async function buildHello(opts: {
  cap: CapabilityEntry[];
  cardIss: string;
  cardAud: string;
  subscriptions: string[];
}): Promise<ClientHello> {
  const card = await mintCard({
    signerPriv: DAEMON_PRIV,
    kid: DAEMON_FP, // daemon-issued branch
    sub: DAEMON_FP,
    iss: opts.cardIss,
    aud: opts.cardAud,
    cap: opts.cap,
  });
  const sig = await helloSig(card, NONCE_C, DAEMON_PRIV);
  return {
    v: 1,
    client_hello: true,
    card,
    subscriptions: opts.subscriptions,
    nonce_c: NONCE_C,
    sig,
  };
}

const registeredIdentity = { daemon_fingerprint: DAEMON_FP, pub_key: DAEMON_PUB, revoked: 0 };

describe('handleHandshake — pre-verification gates', () => {
  it('400 MISSING_FIELDS when card/nonce_c/sig absent', async () => {
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set() });
    const res = await handleHandshake(
      handshakeReq({ v: 1, client_hello: true } as unknown as ClientHello),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_FIELDS');
  });

  it('401 UNKNOWN_IDENTITY when the daemon is not registered', async () => {
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: `${HARBOR_A}:*` }],
      cardIss: HARBOR_A, cardAud: HARBOR_A, subscriptions: [`${HARBOR_A}:room`],
    });
    const { db } = makeMockD1({ identity: null, memberHarbors: new Set([HARBOR_A]) });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNKNOWN_IDENTITY');
  });

  it('401 REVOKED when the daemon identity is revoked', async () => {
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: `${HARBOR_A}:*` }],
      cardIss: HARBOR_A, cardAud: HARBOR_A, subscriptions: [`${HARBOR_A}:room`],
    });
    const { db } = makeMockD1({
      identity: { daemon_fingerprint: DAEMON_FP, pub_key: DAEMON_PUB, revoked: 1 },
      memberHarbors: new Set([HARBOR_A]),
    });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('REVOKED');
  });

  it('401 BAD_SIG when the ClientHello signature does not verify', async () => {
    // Card must carry a `sub *` cap so it passes verifyCard and we reach the
    // hello-signature gate (the actual subject of this test).
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: '*' }],
      cardIss: HARBOR_A, cardAud: HARBOR_A, subscriptions: [`${HARBOR_A}:room`],
    });
    hello.sig = await signEd25519(DAEMON_PRIV, hashHex('totally-different-message'));
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set([HARBOR_A]) });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('BAD_SIG');
  });
});

describe('handleHandshake — card capability gate (verifyCard)', () => {
  // IMPORTANT real-behavior note: handleHandshake calls
  //   verifyCard(card, db, key, 'sub', '*')
  // BEFORE the per-channel loop. matchCapability only matches requiredChannel
  // '*' when a cap's channel is itself '*' (or op:'admin' with channel '*').
  // So a card WITHOUT a `sub *` / `admin *` cap is rejected wholesale at card
  // verification with 401 INSUFFICIENT_CAP — it never reaches the per-channel
  // loop. The per-channel INSUFFICIENT_CAP branch (handlers.ts:186) is therefore
  // effectively unreachable today: any card that passes verifyCard necessarily
  // has a `*` cap that matches every channel. We pin the REAL reachable gate
  // here rather than asserting the dead branch. (Finding noted to operator.)
  it('rejects a card lacking a sub:* (or admin:*) capability — INSUFFICIENT_CAP at card verification (401)', async () => {
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: `${HARBOR_A}:allowed:*` }], // no `*` cap
      cardIss: HARBOR_A, cardAud: HARBOR_A,
      subscriptions: [`${HARBOR_A}:room`],
    });
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set([HARBOR_A]) });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('INSUFFICIENT_CAP');
  });
});

describe('handleHandshake — per-channel harbor membership gate', () => {
  it('rejects a channel whose harbor the daemon is not a member of (HARBOR_NOT_MEMBER)', async () => {
    // Card has a `sub *` cap (passes verifyCard), but D1 membership in harbor B
    // is absent → the per-channel harbor gate rejects the subscription.
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: '*' }],
      cardIss: HARBOR_B, cardAud: HARBOR_B,
      subscriptions: [`${HARBOR_B}:room`],
    });
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set() /* no memberships */ });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(200);
    const sh = await res.json() as ServerHello;
    expect(sh.accepted_subs).toHaveLength(0);
    expect(sh.rejected_subs[0]!.reason).toBe('HARBOR_NOT_MEMBER');
  });

  it('accepts a valid daemon card for a harbor it IS a member of (ServerHello with accepted subs)', async () => {
    const channel = `${HARBOR_A}:room-42`;
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: '*' }],
      cardIss: HARBOR_A, cardAud: HARBOR_A,
      subscriptions: [channel],
    });
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set([HARBOR_A]) });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    expect(res.status).toBe(200);
    const sh = await res.json() as ServerHello;

    expect(sh.server_hello).toBe(true);
    expect(sh.rejected_subs).toHaveLength(0);
    expect(sh.accepted_subs).toHaveLength(1);
    expect(sh.accepted_subs[0]!.channel).toBe(channel);
    // No prior chain head → tip is null.
    expect(sh.accepted_subs[0]!.tip_seq).toBeNull();

    // ServerHello is properly formed: echoes nonce_c, includes a fresh session,
    // a relay signature, and the relay pubkey.
    expect(sh.nonce_c).toBe(NONCE_C);
    expect(typeof sh.session_id).toBe('string');
    expect(sh.session_id.length).toBeGreaterThan(0);
    expect(typeof sh.sig).toBe('string');
    expect(sh.relay_pub_key).toBe(pubKeyFromPrivKey(RELAY_PRIV));
  });

  it('evaluates membership per-channel: accepts the member harbor channel, rejects the non-member one', async () => {
    const okChannel = `${HARBOR_A}:room`;     // member → accept
    const memberFail = `${HARBOR_B}:room`;    // not a member → HARBOR_NOT_MEMBER
    const hello = await buildHello({
      cap: [{ op: 'sub', channel: '*' }],     // wildcard cap passes verifyCard + every per-channel cap
      cardIss: HARBOR_A, cardAud: HARBOR_A,
      subscriptions: [okChannel, memberFail],
    });
    const { db } = makeMockD1({ identity: registeredIdentity, memberHarbors: new Set([HARBOR_A]) });
    const res = await handleHandshake(handshakeReq(hello), makeEnv(db));
    const sh = await res.json() as ServerHello;

    expect(sh.accepted_subs.map(s => s.channel)).toEqual([okChannel]);
    const rejByChannel = Object.fromEntries(sh.rejected_subs.map(s => [s.channel, s.reason]));
    expect(rejByChannel[memberFail]).toBe('HARBOR_NOT_MEMBER');
  });
});
