/**
 * Round-trip tests for the daemon capability signer.
 *
 * These live under apps/relay/tests on purpose. The point of the suite is that
 * capabilities minted by `lib/fleetbot-daemon-capability.ts` are verified by
 * `verifyAndConsumeCapability` — Relay's own code, imported through
 * `__fleetbotPublisherTest`, not a second implementation of the same checks. A
 * signer tested against a reimplementation of its verifier proves nothing; that
 * is precisely the parser-difference hazard the contract's header warns about.
 * The root test runner (jest) cannot load apps/relay's `@noble/ed25519`, so the
 * suite belongs to the relay workspace's vitest run.
 *
 * KEYS IN THIS FILE ARE FAKE. The Ed25519 keypair is generated fresh in-process
 * on every run and never leaves it; the `pdu_` strings are literal repeats of
 * one hex byte and authenticate nothing. Nothing here is, or was, a credential.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createHash, sign as cryptoSign } from 'node:crypto';
import {
  buildActionRequest,
  capabilitySpec,
  type CapabilityProvider,
  type CapabilitySpec,
} from '../../../lib/fleetbot-publish-client.js';
import {
  CAPABILITY_MAX_TTL_SECONDS,
  DaemonCapabilityUnavailableError,
  createDaemonCapabilityProvider,
  daemonFingerprintFromPublicKeyHex,
  type DaemonIdentitySigner,
} from '../../../lib/fleetbot-daemon-capability.js';
import {
  fleetbotPublisherCapabilityPreimage,
  type FleetbotActionRequest,
  type FleetbotAuthorship,
} from '../../../lib/github-publisher-contract.js';
import { fromHex, hashBytes, hashHex, toHex } from '../src/crypto.js';
import { __fleetbotPublisherTest as subject } from '../src/github-publisher.js';

// ── Obviously-fake fixtures ──────────────────────────────────────────────────

/** Generated per run, in memory. Not a credential, and never persisted. */
function fakeDaemonIdentity(): DaemonIdentitySigner & { publicKeyHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer)
    .subarray(-32)
    .toString('hex');
  return {
    publicKeyHex,
    // Mirrors lib/harbor-tokens.ts signHex(): signs the hex-DECODED bytes.
    async signHex(msgHex: string): Promise<string> {
      return cryptoSign(null, Buffer.from(msgHex, 'hex'), privateKey).toString('hex');
    },
    phase2PublicKeyHex(): string {
      return publicKeyHex;
    },
  };
}

/** A syntactically valid pdu_ shape made of one repeated byte. Authenticates nothing. */
const FAKE_ACCOUNT_TOKEN = `pdu_${'ab'.repeat(32)}`;
const FAKE_OTHER_ACCOUNT_TOKEN = `pdu_${'cd'.repeat(32)}`;
const ACCOUNT_USER_ID = 'user-round-trip';
const NOW = 2_000_000_000;
const BASE_SHA = '1'.repeat(40);
const HEAD_SHA = '2'.repeat(40);

const AUTHORSHIP: FleetbotAuthorship = {
  actorId: 'actor-round-trip',
  agentId: 'fleetbot-round-trip',
  sessionId: 'session-round-trip',
  purpose: 'Round-trip the daemon capability signer against the relay verifier',
  identityProject: 'port-daddy',
  roadmapItem: 'fleetbot-publisher',
  sidequestReason: null,
  worktreeId: 'worktree-round-trip',
  sourceBranch: 'claude/fleetbot-daemon-capability',
};

function inspectRequest(overrides: {
  repository?: string;
  pullRequestNumber?: number;
  baseBranch?: string;
} = {}): FleetbotActionRequest {
  return buildActionRequest({
    operation: 'pull-request.inspect',
    repository: overrides.repository ?? 'curiositech/port-daddy',
    sessionId: AUTHORSHIP.sessionId,
    authorship: AUTHORSHIP,
    payload: {
      baseBranch: overrides.baseBranch ?? 'main',
      baseSha: BASE_SHA,
      pullRequestNumber: overrides.pullRequestNumber ?? 10_129,
      expectedGithubHeadSha: HEAD_SHA,
    },
  });
}

function scopeFor(request: FleetbotActionRequest, over: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    ...capabilitySpec(request, { baseBranch: 'main', baseSha: BASE_SHA, headSha: HEAD_SHA }),
    ...over,
  };
}

// ── The relay's authority store, mocked only where D1 would be ───────────────
//
// Everything the capability check reasons about — identity liveness, generation,
// nonce consumption — is Relay's own logic; only the storage is a stub. The
// nonce table is modelled faithfully, including INSERT OR IGNORE, because
// exact-retry versus replay is one of the behaviours under test.

function authorityDb(options: {
  publicKeyHex: string;
  generation?: number;
  revoked?: number;
  expiresAt?: number | null;
  unknownIdentity?: boolean;
} ) {
  const uses = new Map<string, Record<string, unknown>>();
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first() {
          if (sql.includes('FROM identities')) {
            if (options.unknownIdentity) return null;
            return {
              pub_key: options.publicKeyHex,
              expires_at: options.expiresAt === undefined ? NOW + 1_000 : options.expiresAt,
              revoked: options.revoked ?? 0,
              key_generation: options.generation ?? 1,
            };
          }
          if (sql.includes('FROM github_publisher_capability_uses')) {
            return uses.get(`${String(args[0])}|${String(args[1])}|${String(args[2])}`) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO github_publisher_capability_uses')) {
            const pk = `${String(args[0])}|${String(args[1])}|${String(args[2])}`;
            if (!uses.has(pk)) {
              uses.set(pk, {
                account_user_id: args[3],
                account_token_hash: args[4],
                request_hash: args[5],
                idempotency_key: args[6],
              });
            }
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

/**
 * Put a minted capability on the envelope, hand the whole thing to Relay's
 * parser, and run Relay's capability verification over the result.
 */
async function admit(
  request: FleetbotActionRequest,
  minted: { capability: unknown; capabilitySignature: string },
  db: D1Database,
  over: { accountToken?: string; now?: number } = {},
) {
  const envelope = {
    ...request,
    capability: minted.capability,
    capabilitySignature: minted.capabilitySignature,
  };
  const parsed = subject.parseRequest(JSON.parse(JSON.stringify(envelope)));
  await subject.verifyAndConsumeCapability(
    { DB: db } as never,
    parsed.capability,
    parsed.capabilitySignature,
    parsed.request,
    parsed.payload,
    parsed.requestHash,
    hashHex(over.accountToken ?? FAKE_ACCOUNT_TOKEN),
    ACCOUNT_USER_ID,
    over.now ?? NOW,
  );
}

async function failureCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return String((err as { code?: string }).code ?? (err as Error).name);
  }
  throw new Error('expected a refusal, but the call resolved');
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('daemon capability signer — round trip through the relay verifier', () => {
  let identity: ReturnType<typeof fakeDaemonIdentity>;
  let provider: CapabilityProvider;
  let db: D1Database;

  beforeEach(() => {
    identity = fakeDaemonIdentity();
    provider = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
    db = authorityDb({ publicKeyHex: identity.publicKeyHex });
  });

  it('mints a capability the relay admits', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    await expect(admit(request, minted, db)).resolves.toBeUndefined();
  });

  it('computes the same daemon fingerprint the relay recomputes from the registered key', async () => {
    const relaySide = toHex(hashBytes(fromHex(identity.publicKeyHex)));
    expect(daemonFingerprintFromPublicKeyHex(identity.publicKeyHex)).toBe(relaySide);
    const minted = await provider.mint(scopeFor(inspectRequest()));
    expect(minted.capability.daemonFingerprint).toBe(relaySide);
  });

  it('signs the digest bytes, not the digest text — the hex-text variant is rejected', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    const digestHex = hashHex(fleetbotPublisherCapabilityPreimage(minted.capability));

    // What a signer that misread verifyEd25519 would produce.
    const overText = cryptoSign(
      null,
      Buffer.from(digestHex, 'utf8'),
      generateKeyPairSync('ed25519').privateKey,
    ).toString('hex');
    expect(overText).not.toBe(minted.capabilitySignature);

    expect(await failureCode(() =>
      admit(request, { capability: minted.capability, capabilitySignature: overText }, db),
    )).toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('emits exactly the fourteen fields the relay parser allows', async () => {
    const minted = await provider.mint(scopeFor(inspectRequest()));
    expect(Object.keys(minted.capability).sort()).toEqual([
      'accountTokenHash', 'baseBranch', 'baseSha', 'daemonFingerprint', 'expiresAt',
      'headSha', 'issuedAt', 'nonce', 'operation', 'repository', 'requestHash',
      'schema', 'sessionId', 'signingKeyGeneration',
    ]);
  });

  it('bounds the lifetime inside the window the relay accepts', async () => {
    const minted = await provider.mint(scopeFor(inspectRequest()));
    const ttl = minted.capability.expiresAt - minted.capability.issuedAt;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CAPABILITY_MAX_TTL_SECONDS);
  });
});

describe('scope binding — a capability for one action does not authorize another', () => {
  let identity: ReturnType<typeof fakeDaemonIdentity>;
  let provider: CapabilityProvider;
  let db: D1Database;

  beforeEach(() => {
    identity = fakeDaemonIdentity();
    provider = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
    db = authorityDb({ publicKeyHex: identity.publicKeyHex });
  });

  it('refuses a capability minted for a different repository', async () => {
    const minted = await provider.mint(scopeFor(inspectRequest({ repository: 'curiositech/other-repo' }), {
      repository: 'curiositech/other-repo',
    }));
    expect(await failureCode(() => admit(inspectRequest(), minted, db)))
      .toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a capability minted for a different operation', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request, { operation: 'pull-request.ready' }));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a capability minted for a different base branch', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request, { baseBranch: 'release' }));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a capability minted for a different head commit', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request, { headSha: '9'.repeat(40) }));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a capability minted for a different session', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request, { sessionId: 'session-somebody-else' }));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a capability whose request hash names another action', async () => {
    const mine = inspectRequest();
    const theirs = inspectRequest({ pullRequestNumber: 99_999 });
    const minted = await provider.mint(scopeFor(theirs));
    expect(await failureCode(() => admit(mine, minted, db))).toBe('CAPABILITY_SCOPE_MISMATCH');
  });

  it('refuses a payload swapped after the capability was minted', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    const tampered = {
      ...request,
      payload: { ...request.payload, pullRequestNumber: 1 },
    } as FleetbotActionRequest;
    // Idempotency key left as minted: the relay recomputes it and refuses first.
    expect(await failureCode(() => admit(tampered, minted, db))).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('refuses a capability bound to a different account bearer', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    expect(await failureCode(() =>
      admit(request, minted, db, { accountToken: FAKE_OTHER_ACCOUNT_TOKEN }),
    )).toBe('CAPABILITY_SCOPE_MISMATCH');
  });
});

describe('one-logical-use — replay is refused, an exact retry is not', () => {
  let identity: ReturnType<typeof fakeDaemonIdentity>;
  let db: D1Database;

  function fixedNonceProvider(nonce: string): CapabilityProvider {
    return createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
      nonceHex: () => nonce,
    });
  }

  beforeEach(() => {
    identity = fakeDaemonIdentity();
    db = authorityDb({ publicKeyHex: identity.publicKeyHex });
  });

  it('refuses a replayed nonce carrying a different action', async () => {
    const nonce = '3'.repeat(64);
    const first = inspectRequest();
    await admit(first, await fixedNonceProvider(nonce).mint(scopeFor(first)), db);

    const second = inspectRequest({ pullRequestNumber: 4_242 });
    expect(await failureCode(async () =>
      admit(second, await fixedNonceProvider(nonce).mint(scopeFor(second)), db),
    )).toBe('CAPABILITY_REPLAY');
  });

  it('admits a byte-identical retry under the same nonce', async () => {
    const nonce = '4'.repeat(64);
    const request = inspectRequest();
    const minted = await fixedNonceProvider(nonce).mint(scopeFor(request));
    await admit(request, minted, db);
    await expect(admit(request, minted, db)).resolves.toBeUndefined();
  });

  it('draws a fresh nonce for every mint by default', async () => {
    const provider = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
    const request = inspectRequest();
    const a = await provider.mint(scopeFor(request));
    const b = await provider.mint(scopeFor(request));
    expect(a.capability.nonce).not.toBe(b.capability.nonce);
    expect(a.capability.nonce).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tampering and expiry', () => {
  let identity: ReturnType<typeof fakeDaemonIdentity>;
  let provider: CapabilityProvider;
  let db: D1Database;

  beforeEach(() => {
    identity = fakeDaemonIdentity();
    provider = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
    db = authorityDb({ publicKeyHex: identity.publicKeyHex });
  });

  it('refuses a capability field edited after signing', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    const stretched = { ...minted.capability, expiresAt: minted.capability.expiresAt + 60 };
    expect(await failureCode(() =>
      admit(request, { capability: stretched, capabilitySignature: minted.capabilitySignature }, db),
    )).toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses a flipped signature', async () => {
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    const flipped = `${minted.capabilitySignature.slice(0, -1)}${minted.capabilitySignature.endsWith('a') ? 'b' : 'a'}`;
    expect(await failureCode(() =>
      admit(request, { capability: minted.capability, capabilitySignature: flipped }, db),
    )).toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses a capability signed by a key the relay does not hold', async () => {
    const stranger = fakeDaemonIdentity();
    const strangerProvider = createDaemonCapabilityProvider({
      signer: stranger,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
    const request = inspectRequest();
    const minted = await strangerProvider.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, db)))
      .toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses a capability whose signing key generation is not the live one', async () => {
    const rotated = authorityDb({ publicKeyHex: identity.publicKeyHex, generation: 2 });
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, rotated)))
      .toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses a capability from a revoked daemon identity', async () => {
    const revoked = authorityDb({ publicKeyHex: identity.publicKeyHex, revoked: 1 });
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, revoked)))
      .toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses a capability from an unregistered daemon identity', async () => {
    const unknown = authorityDb({ publicKeyHex: identity.publicKeyHex, unknownIdentity: true });
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, unknown)))
      .toBe('CAPABILITY_SIGNATURE_INVALID');
  });

  it('refuses an expired capability', async () => {
    const stale = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      ttlSeconds: 60,
      nowSeconds: () => NOW - 3_600,
    });
    const request = inspectRequest();
    const minted = await stale.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_EXPIRED');
  });

  it('refuses a capability issued beyond the relay clock-skew allowance', async () => {
    const ahead = createDaemonCapabilityProvider({
      signer: identity,
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW + 600,
    });
    const request = inspectRequest();
    const minted = await ahead.mint(scopeFor(request));
    expect(await failureCode(() => admit(request, minted, db))).toBe('CAPABILITY_EXPIRED');
  });
});

describe('key custody — absence and malformation are refusals, never a quiet fallback', () => {
  const goodIdentity = () => fakeDaemonIdentity();

  it('refuses when no daemon signer is wired', () => {
    expect(() => createDaemonCapabilityProvider({ signer: null, accountToken: FAKE_ACCOUNT_TOKEN }))
      .toThrow(DaemonCapabilityUnavailableError);
    try {
      createDaemonCapabilityProvider({ signer: undefined, accountToken: FAKE_ACCOUNT_TOKEN });
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('DAEMON_IDENTITY_MISSING');
    }
  });

  it('refuses when the daemon identity was never initialized', () => {
    const uninitialized: DaemonIdentitySigner = {
      async signHex() { throw new Error('unreachable'); },
      phase2PublicKeyHex() { throw new Error('initDaemonIdentity() must be called before phase2PublicKeyHex()'); },
    };
    try {
      createDaemonCapabilityProvider({ signer: uninitialized, accountToken: FAKE_ACCOUNT_TOKEN });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('DAEMON_IDENTITY_UNINITIALIZED');
    }
  });

  it('refuses a malformed daemon public key', () => {
    const malformed: DaemonIdentitySigner = {
      async signHex() { return '0'.repeat(128); },
      phase2PublicKeyHex() { return 'not-a-key'; },
    };
    try {
      createDaemonCapabilityProvider({ signer: malformed, accountToken: FAKE_ACCOUNT_TOKEN });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('DAEMON_KEY_MALFORMED');
    }
  });

  it('refuses when the private half cannot sign', async () => {
    const identity = goodIdentity();
    const denied: DaemonIdentitySigner = {
      async signHex() { throw new Error('keychain access denied'); },
      phase2PublicKeyHex: identity.phase2PublicKeyHex,
    };
    const provider = createDaemonCapabilityProvider({ signer: denied, accountToken: FAKE_ACCOUNT_TOKEN });
    expect(await failureCode(() => provider.mint(scopeFor(inspectRequest()))))
      .toBe('DAEMON_SIGNATURE_FAILED');
  });

  it('refuses a signer that returns something that is not an Ed25519 signature', async () => {
    const identity = goodIdentity();
    const wrong: DaemonIdentitySigner = {
      async signHex() { return 'ok'; },
      phase2PublicKeyHex: identity.phase2PublicKeyHex,
    };
    const provider = createDaemonCapabilityProvider({ signer: wrong, accountToken: FAKE_ACCOUNT_TOKEN });
    expect(await failureCode(() => provider.mint(scopeFor(inspectRequest()))))
      .toBe('DAEMON_SIGNATURE_MALFORMED');
  });

  it('refuses a signer whose key disagrees with the public key it reports', async () => {
    const reported = goodIdentity();
    const actual = goodIdentity();
    const mismatched: DaemonIdentitySigner = {
      signHex: actual.signHex,
      phase2PublicKeyHex: reported.phase2PublicKeyHex,
    };
    const provider = createDaemonCapabilityProvider({ signer: mismatched, accountToken: FAKE_ACCOUNT_TOKEN });
    expect(await failureCode(() => provider.mint(scopeFor(inspectRequest()))))
      .toBe('DAEMON_SIGNATURE_UNVERIFIABLE');
  });

  it('refuses a lifetime longer than the relay will accept', () => {
    try {
      createDaemonCapabilityProvider({
        signer: goodIdentity(),
        accountToken: FAKE_ACCOUNT_TOKEN,
        ttlSeconds: CAPABILITY_MAX_TTL_SECONDS + 1,
      });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('CAPABILITY_TTL_INVALID');
    }
  });

  it('refuses a weak nonce source', async () => {
    const provider = createDaemonCapabilityProvider({
      signer: goodIdentity(),
      accountToken: FAKE_ACCOUNT_TOKEN,
      nonceHex: () => 'deadbeef',
    });
    expect(await failureCode(() => provider.mint(scopeFor(inspectRequest())))).toBe('NONCE_UNUSABLE');
  });
});

describe('account binding — the capability must commit to the bearer that will be presented', () => {
  it('refuses when no account binding is supplied', () => {
    try {
      createDaemonCapabilityProvider({ signer: fakeDaemonIdentity() });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('ACCOUNT_BINDING_MISSING');
    }
  });

  it('refuses a GitHub token offered in place of the pdu_ bearer', () => {
    try {
      createDaemonCapabilityProvider({
        signer: fakeDaemonIdentity(),
        // Obviously-fake, non-functional placeholder in a GitHub-ish shape.
        accountToken: `ghp_${'0'.repeat(36)}`,
      });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('ACCOUNT_BINDING_MALFORMED');
    }
  });

  it('refuses an account token hash that is not a SHA-256 digest', () => {
    try {
      createDaemonCapabilityProvider({ signer: fakeDaemonIdentity(), accountTokenHash: 'abc' });
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as DaemonCapabilityUnavailableError).code).toBe('ACCOUNT_BINDING_MALFORMED');
    }
  });

  it('accepts a precomputed hash so the provider need never hold the bearer', async () => {
    const identity = fakeDaemonIdentity();
    const provider = createDaemonCapabilityProvider({
      signer: identity,
      accountTokenHash: createHash('sha256').update(FAKE_ACCOUNT_TOKEN, 'utf8').digest('hex'),
      nowSeconds: () => NOW,
    });
    const request = inspectRequest();
    const minted = await provider.mint(scopeFor(request));
    await expect(admit(request, minted, authorityDb({ publicKeyHex: identity.publicKeyHex })))
      .resolves.toBeUndefined();
  });

  it('never puts the bearer or a fragment of it into a refusal report', () => {
    let report = '';
    try {
      createDaemonCapabilityProvider({
        signer: fakeDaemonIdentity(),
        accountToken: `ghp_${'0'.repeat(36)}`,
      });
    } catch (err) {
      report = (err as DaemonCapabilityUnavailableError).report();
    }
    expect(report).not.toContain('ghp_');
    expect(report).not.toContain('0'.repeat(8));
    expect(report).toContain('missing:');
  });
});

describe('scope validation — nothing unbounded ever reaches the signer', () => {
  let provider: CapabilityProvider;

  beforeEach(() => {
    provider = createDaemonCapabilityProvider({
      signer: fakeDaemonIdentity(),
      accountToken: FAKE_ACCOUNT_TOKEN,
      nowSeconds: () => NOW,
    });
  });

  it('refuses a scope with no canonical request hash', async () => {
    const request = inspectRequest();
    expect(await failureCode(() => provider.mint(scopeFor(request, { requestHash: '' }))))
      .toBe('CAPABILITY_SCOPE_INVALID');
  });

  it('refuses a scope that does not pin an exact commit', async () => {
    const request = inspectRequest();
    expect(await failureCode(() => provider.mint(scopeFor(request, { headSha: 'HEAD' }))))
      .toBe('CAPABILITY_SCOPE_INVALID');
  });

  it('refuses a scope whose repository is not lowercase owner/repo', async () => {
    const request = inspectRequest();
    expect(await failureCode(() => provider.mint(scopeFor(request, { repository: 'Curiositech/Port-Daddy' }))))
      .toBe('CAPABILITY_SCOPE_INVALID');
  });

  it('refuses a scope carrying the wrong schema', async () => {
    const request = inspectRequest();
    expect(await failureCode(() =>
      provider.mint(scopeFor(request, { schema: 'port-daddy.something-else.v1' } as never)),
    )).toBe('CAPABILITY_SCOPE_INVALID');
  });

  it('refuses a scope with no base branch', async () => {
    const request = inspectRequest();
    expect(await failureCode(() => provider.mint(scopeFor(request, { baseBranch: '' }))))
      .toBe('CAPABILITY_SCOPE_INVALID');
  });
});
