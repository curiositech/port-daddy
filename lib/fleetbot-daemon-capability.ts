/**
 * Daemon-side Ed25519 signer for Fleetbot publisher capabilities.
 *
 * This is the `CapabilityProvider` that `lib/fleetbot-publish-client.ts`
 * declares and deliberately cannot implement: the client assembles the exact
 * scope, this module turns that scope into an authority the Relay will accept.
 * Without it every publish attempt ends in `MissingActuatorError`, which is why
 * no agent has been able to publish as `port-daddy[bot]`.
 *
 * ── What it signs ───────────────────────────────────────────────────────────
 *
 * Exactly the fourteen-field `FleetbotPublisherCapability` from
 * `lib/github-publisher-contract.ts`, canonicalized by that module's
 * `fleetbotPublisherCapabilityPreimage` (stable, key-sorted JSON) and signed as
 * the raw 32 SHA-256 bytes of that string. Relay's `verifyAndConsumeCapability`
 * calls `verifyEd25519(pub_key, hashHex(preimage), signature)`, and that helper
 * hex-DECODES its message argument, so the signed octets are the digest itself
 * and not its hex text. Getting that wrong produces a valid-looking 128-hex
 * signature that fails at the gate; it is asserted by the round-trip test.
 *
 * Canonicalization is imported, never restated. The contract header explains
 * why: a parser difference between the identity gate and the component holding
 * the GitHub App key is exploitable. This file contains no JSON ordering, no
 * field list, and no hash construction of its own.
 *
 * ── Where the key lives ─────────────────────────────────────────────────────
 *
 * Nowhere new. This module mints no key and reads no key file. It borrows the
 * daemon's existing Phase 2 Ed25519 identity — the same key that signs the
 * Relay handshake and Harbor Cards — through the narrow `DaemonIdentitySigner`
 * seam below, which is structurally satisfied by the object
 * `createHarborTokens()` already returns (`signHex`, `phase2PublicKeyHex`).
 * Custody stays inside `lib/harbor-tokens.ts`, whose documented posture is "use
 * without see": callers ask for an operation and receive a result. The private
 * half is in the macOS Keychain under service `port-daddy`, account
 * `harbor-signing-private-v2`, and falls back to a plaintext column in the
 * daemon SQLite database on platforms without a Keychain. That fallback is a
 * real weakness and it is not this module's to fix; it is named here so nobody
 * reading this file believes the key is hardware-protected on Linux.
 *
 * ── Threat model ────────────────────────────────────────────────────────────
 *
 * What a capability signed by this key CAN authorize: one GitHub mutation, on
 * one repository, at one base and one head, for one canonical request body, on
 * behalf of one Port Daddy account token, within a window of at most five
 * minutes, once. Relay recomputes the request hash from the envelope and
 * refuses a mismatch, and burns the nonce on first use.
 *
 * What it CANNOT authorize: anything by itself. The capability is one of three
 * things Relay requires together — an operator `pdu_` bearer on the outer
 * request, that operator's stored GitHub OAuth grant resolved server-side, and
 * this signature. A capability alone reaches nothing, because the account token
 * hash it commits to must equal the hash of the bearer actually presented. It
 * also cannot widen scope: the repository must be one the App installation
 * already covers and the operator's own OAuth grant already reaches, both
 * rechecked by Relay after admission.
 *
 * What an attacker who obtains this key gets: the ability to mint capabilities
 * for any request whose `pdu_` bearer they ALSO hold, because the capability
 * commits to the hash of that bearer. Key alone is not publish authority. The
 * converse is the uncomfortable half and is documented rather than hidden: a
 * stolen `pdu_` bearer plus ANY daemon identity registered with Relay is enough,
 * because Relay checks that the capability is signed by *a* live registered
 * daemon, not by *this operator's* daemon — there is no account-to-fingerprint
 * link in the Relay schema for it to check. So this key is a second factor
 * against a compromised daemon-free attacker, not against an attacker who can
 * enrol a daemon identity of their own. See the module notes at the bottom of
 * this file.
 *
 * ── Absence is a refusal ────────────────────────────────────────────────────
 *
 * There is no unsigned path, no environment-variable key, no ambient GitHub
 * credential, and no "degraded" mode. Every failure to produce a real signature
 * raises `DaemonCapabilityUnavailableError` naming the missing or malformed
 * input. Per `skills/github-app-actuator`'s "Missing actuator" rule,
 * infrastructure absence must not become authorship fraud.
 */

import { createHash, randomBytes, verify as cryptoVerify, createPublicKey } from 'node:crypto';
import {
  FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
  fleetbotPublisherCapabilityPreimage,
  isGitSha,
  isRepository,
  isSafePublisherIdentifier,
  type FleetbotPublisherCapability,
} from './github-publisher-contract.js';
import type { CapabilityProvider, CapabilitySpec } from './fleetbot-publish-client.js';

// ── Relay-enforced bounds, restated as local guards ──────────────────────────
//
// These mirror `CAPABILITY_MAX_TTL_SECONDS` and `CAPABILITY_CLOCK_SKEW_SECONDS`
// in apps/relay/src/github-publisher.ts. They are duplicated as *refusals*, not
// as a second source of truth: signing outside them cannot succeed, so refusing
// locally turns a 401 into an error that names the cause. Nothing here relaxes
// a Relay check.

/** Longest lifetime Relay will accept for a capability (`expiresAt - issuedAt`). */
export const CAPABILITY_MAX_TTL_SECONDS = 5 * 60;

/** Default lifetime. Short enough to be useless if intercepted, long enough for one round trip. */
export const CAPABILITY_DEFAULT_TTL_SECONDS = 120;

/**
 * Signing-key generation asserted when the caller names none.
 *
 * Relay compares this to `identities.key_generation`, whose migration default is
 * 1 and which nothing in this repository ever increments — see the notes at the
 * bottom of this file. Asserting 1 is therefore correct today and wrong the
 * moment generation tracking becomes real, so it is a named constant a caller
 * can override rather than a literal buried in the mint path.
 */
export const DEFAULT_SIGNING_KEY_GENERATION = 1;

const PDU_RE = /^pdu_[0-9a-f]{64}$/i;
const HEX32_RE = /^[0-9a-f]{64}$/i;
const HEX64_RE = /^[0-9a-f]{128}$/i;
/** DER prefix for an Ed25519 SubjectPublicKeyInfo (RFC 8410). */
const ED25519_SPKI_PREFIX = '302a300506032b6570032100';

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Raised whenever a real signature cannot be produced.
 *
 * Distinct from the client's `FleetbotPublishError` because it is a *local*
 * custody fault, not a Relay refusal: nothing was sent and nothing is pending
 * at the other end. The `missing` field names the input so an operator does not
 * have to read this file to find out what to provision.
 */
export class DaemonCapabilityUnavailableError extends Error {
  readonly code: string;
  /** What was absent or malformed, by name — never a value. */
  readonly missing: string;
  readonly remedy: string;

  constructor(input: { code: string; missing: string; message: string; remedy: string }) {
    super(input.message);
    this.name = 'DaemonCapabilityUnavailableError';
    this.code = input.code;
    this.missing = input.missing;
    this.remedy = input.remedy;
  }

  /** Operator-facing block. Deliberately carries no key material. */
  report(): string {
    return [
      `✗ fleetbot-capability: ${this.code}`,
      `  ${this.message}`,
      `  missing: ${this.missing}`,
      '',
      `  ${this.remedy}`,
      '',
      '  Publication stays pending. Do NOT substitute a personal GitHub credential:',
      '  a PR opened with an operator token is authorship fraud, not a workaround.',
    ].join('\n');
  }
}

function unavailable(input: { code: string; missing: string; message: string; remedy: string }): never {
  throw new DaemonCapabilityUnavailableError(input);
}

// ── The custody seam ─────────────────────────────────────────────────────────

/**
 * The two operations this module needs from the daemon's Phase 2 identity.
 *
 * Structurally satisfied by the object `createHarborTokens(db)` returns, so
 * wiring is `createDaemonCapabilityProvider({ signer: harborTokens, ... })` with
 * no adapter. The interface is this narrow on purpose: a signer that could also
 * export, derive, or re-key would put key material one call away from a caller
 * that has no business holding it.
 */
export interface DaemonIdentitySigner {
  /** Sign the hex-DECODED bytes of `msgHex`; return the hex Ed25519 signature. */
  signHex(msgHex: string): Promise<string>;
  /** The daemon's raw 32-byte Ed25519 public key as lowercase hex — Relay's `identities.pub_key`. */
  phase2PublicKeyHex(): string;
}

export interface DaemonCapabilityProviderOptions {
  /** The daemon identity that will sign. Required; there is no default signer. */
  signer: DaemonIdentitySigner | null | undefined;
  /**
   * SHA-256 of the operator `pdu_` bearer that will carry the outer request.
   * Prefer this over `accountToken`: the provider then never holds the secret.
   */
  accountTokenHash?: string;
  /**
   * The operator `pdu_` bearer itself. Hashed once, immediately, and discarded;
   * the token is never retained on the provider and never appears in an error.
   */
  accountToken?: string;
  /** Capability lifetime in seconds. Must be in (0, 300]. Defaults to 120. */
  ttlSeconds?: number;
  /** Relay's `identities.key_generation` for this daemon. Defaults to 1. */
  signingKeyGeneration?: number;
  /** Injected for tests. Seconds since the epoch. */
  nowSeconds?: () => number;
  /** Injected for tests. Must return 32 bytes of hex. */
  nonceHex?: () => string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The fingerprint Relay recomputes from the registered public key:
 * `toHex(hashBytes(fromHex(identity.pub_key)))` — SHA-256 over the raw 32 key
 * bytes, not over their hex text. Relay compares its own recomputation to the
 * value carried here and refuses a mismatch, so this must agree exactly.
 */
export function daemonFingerprintFromPublicKeyHex(publicKeyHex: string): string {
  if (typeof publicKeyHex !== 'string' || !HEX32_RE.test(publicKeyHex)) {
    unavailable({
      code: 'DAEMON_KEY_MALFORMED',
      missing: 'daemon Phase 2 Ed25519 public key (expected 32 raw bytes as hex)',
      message: 'the daemon identity did not return a well-formed raw Ed25519 public key',
      remedy:
        'The daemon identity is not initialized or is corrupt. Ensure the daemon ran '
        + 'initDaemonIdentity() before publishing; if the stored keypair is damaged, re-enrol the '
        + 'daemon identity with Relay rather than editing key storage by hand.',
    });
  }
  return createHash('sha256').update(Buffer.from(publicKeyHex.toLowerCase(), 'hex')).digest('hex');
}

/**
 * Verify our own signature before handing it to a caller.
 *
 * Cheap, and it converts the two failures that look identical from the far side
 * — a signer wired to a different key than `phase2PublicKeyHex()` reports, and a
 * signer that signs the hex TEXT rather than the digest bytes — into a local
 * refusal instead of a `CAPABILITY_SIGNATURE_INVALID` at the gate. Uses the same
 * construction as `verifyEd25519` in apps/relay/src/crypto.ts: hex-decoded
 * message, raw public key, raw signature.
 */
function selfVerify(publicKeyHex: string, digestHex: string, signatureHex: string): boolean {
  try {
    const spki = Buffer.concat([
      Buffer.from(ED25519_SPKI_PREFIX, 'hex'),
      Buffer.from(publicKeyHex.toLowerCase(), 'hex'),
    ]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return cryptoVerify(
      null,
      Buffer.from(digestHex, 'hex'),
      key,
      Buffer.from(signatureHex.toLowerCase(), 'hex'),
    );
  } catch {
    return false;
  }
}

function resolveAccountTokenHash(options: DaemonCapabilityProviderOptions): string {
  const supplied = options.accountTokenHash;
  if (typeof supplied === 'string' && supplied.length > 0) {
    if (!HEX32_RE.test(supplied)) {
      unavailable({
        code: 'ACCOUNT_BINDING_MALFORMED',
        missing: 'accountTokenHash (expected 64 lowercase hex characters, SHA-256 of the pdu_ bearer)',
        message: 'the supplied account token hash is not a SHA-256 digest',
        remedy:
          'Pass the SHA-256 hex digest of the operator pdu_ bearer, or pass the bearer itself as '
          + 'accountToken and let this module hash it.',
      });
    }
    return supplied.toLowerCase();
  }
  const token = options.accountToken;
  if (typeof token !== 'string' || token.length === 0) {
    unavailable({
      code: 'ACCOUNT_BINDING_MISSING',
      missing: 'accountTokenHash or accountToken (the operator Port Daddy pdu_ bearer)',
      message:
        'no account binding was supplied, so the capability could not commit to the bearer that '
        + 'will carry the request',
      remedy:
        'Supply the operator pdu_ account bearer (or its SHA-256 hash). Relay refuses any '
        + 'capability whose accountTokenHash does not equal the hash of the presented bearer. Do '
        + 'not substitute a GitHub PAT, GH_TOKEN, or an ambient gh login.',
    });
  }
  if (!PDU_RE.test(token)) {
    unavailable({
      code: 'ACCOUNT_BINDING_MALFORMED',
      missing: 'accountToken (expected the pdu_ account bearer form)',
      message: 'the supplied account bearer is not a Port Daddy pdu_ account token',
      remedy:
        'Relay authenticates the outer request with a pdu_ account bearer only. A GitHub token '
        + 'in this position is refused here, before any network call, on purpose.',
    });
  }
  // Hashed once, here. The token itself is not captured by the returned closure.
  return sha256Hex(token);
}

// ── The provider ─────────────────────────────────────────────────────────────

/**
 * Build the `CapabilityProvider` the publish client requires.
 *
 * Validation is deliberately split. Everything knowable at construction —
 * the signer, the key, the account binding, the TTL, the generation — is
 * checked here, so a misconfigured daemon fails before an agent has assembled a
 * commit and a PR body. Everything scope-specific is checked in `mint`.
 *
 * @throws {DaemonCapabilityUnavailableError} when the identity or binding is
 *   absent or malformed. There is no partially-working provider.
 */
export function createDaemonCapabilityProvider(
  options: DaemonCapabilityProviderOptions,
): CapabilityProvider {
  if (!options || typeof options !== 'object') {
    unavailable({
      code: 'PROVIDER_UNCONFIGURED',
      missing: 'DaemonCapabilityProviderOptions',
      message: 'createDaemonCapabilityProvider() was called with no configuration',
      remedy: 'Pass at least { signer, accountToken } from the running daemon.',
    });
  }

  const signer = options.signer;
  if (!signer || typeof signer.signHex !== 'function' || typeof signer.phase2PublicKeyHex !== 'function') {
    unavailable({
      code: 'DAEMON_IDENTITY_MISSING',
      missing: 'daemon Phase 2 Ed25519 identity (signHex / phase2PublicKeyHex)',
      message: 'no daemon identity signer was provided, so no publisher capability can be minted',
      remedy:
        'Wire the object returned by createHarborTokens(db) after initDaemonIdentity() has run. '
        + 'This module holds no key of its own and has no unsigned path.',
    });
  }

  // Reading the public key now surfaces "identity not initialized" at wiring
  // time rather than mid-publish. `phase2PublicKeyHex()` throws when the daemon
  // never ran initDaemonIdentity().
  let publicKeyHex: string;
  try {
    publicKeyHex = signer.phase2PublicKeyHex();
  } catch (err) {
    unavailable({
      code: 'DAEMON_IDENTITY_UNINITIALIZED',
      missing: 'initialized daemon Phase 2 identity',
      message: `the daemon identity is not initialized: ${err instanceof Error ? err.message : String(err)}`,
      remedy:
        'Start the Port Daddy daemon (it calls initDaemonIdentity() during boot) before minting '
        + 'a publisher capability.',
    });
  }
  const daemonFingerprint = daemonFingerprintFromPublicKeyHex(publicKeyHex);
  const normalizedPublicKeyHex = publicKeyHex.toLowerCase();

  const accountTokenHash = resolveAccountTokenHash(options);

  const ttlSeconds = options.ttlSeconds ?? CAPABILITY_DEFAULT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > CAPABILITY_MAX_TTL_SECONDS) {
    unavailable({
      code: 'CAPABILITY_TTL_INVALID',
      missing: `ttlSeconds within (0, ${CAPABILITY_MAX_TTL_SECONDS}]`,
      message: `a capability lifetime of ${String(ttlSeconds)}s is outside the bound Relay accepts`,
      remedy:
        `Relay refuses expiresAt - issuedAt > ${CAPABILITY_MAX_TTL_SECONDS}. Choose a shorter TTL; `
        + `the default of ${CAPABILITY_DEFAULT_TTL_SECONDS}s covers one round trip.`,
    });
  }

  const signingKeyGeneration = options.signingKeyGeneration ?? DEFAULT_SIGNING_KEY_GENERATION;
  if (!Number.isSafeInteger(signingKeyGeneration) || signingKeyGeneration < 1) {
    unavailable({
      code: 'SIGNING_KEY_GENERATION_INVALID',
      missing: 'signingKeyGeneration (a positive integer matching Relay identities.key_generation)',
      message: `signing key generation ${String(signingKeyGeneration)} is not a positive integer`,
      remedy:
        'Pass the generation Relay records for this daemon fingerprint, or omit it to assert '
        + `${DEFAULT_SIGNING_KEY_GENERATION}, which is the schema default.`,
    });
  }

  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const nonceHex = options.nonceHex ?? (() => randomBytes(32).toString('hex'));

  return {
    async mint(spec: CapabilitySpec) {
      assertSpec(spec);

      const issuedAt = nowSeconds();
      if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
        unavailable({
          code: 'CLOCK_UNUSABLE',
          missing: 'a sane wall clock (issuedAt in whole seconds since the epoch)',
          message: 'the clock returned a value that cannot be used as a capability timestamp',
          remedy:
            'Relay rejects issuedAt more than 30s in its own future and any expiry not strictly '
            + 'after issuance. Fix the host clock before publishing.',
        });
      }

      const nonce = nonceHex();
      if (typeof nonce !== 'string' || !HEX32_RE.test(nonce)) {
        unavailable({
          code: 'NONCE_UNUSABLE',
          missing: 'a 32-byte random nonce as 64 hex characters',
          message: 'the nonce source did not return 32 bytes of hex',
          remedy:
            'Relay stores the nonce with a length(nonce) = 64 constraint and treats it as the '
            + 'one-use key of the capability. A weak or repeated nonce is a replay, not a retry.',
        });
      }

      // The exact fourteen fields Relay's parseCapability allows, no more:
      // it compares the sorted key list and refuses an extra field outright.
      const capability: FleetbotPublisherCapability = {
        schema: FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
        accountTokenHash,
        daemonFingerprint,
        signingKeyGeneration,
        sessionId: spec.sessionId,
        repository: spec.repository,
        operation: spec.operation,
        baseBranch: spec.baseBranch,
        baseSha: spec.baseSha.toLowerCase(),
        headSha: spec.headSha.toLowerCase(),
        requestHash: spec.requestHash.toLowerCase(),
        issuedAt,
        expiresAt: issuedAt + ttlSeconds,
        nonce: nonce.toLowerCase(),
      };

      // Canonicalization comes from the contract module Relay imports. The
      // digest is signed as bytes, because verifyEd25519 hex-decodes it.
      const digestHex = sha256Hex(fleetbotPublisherCapabilityPreimage(capability));

      let capabilitySignature: string;
      try {
        capabilitySignature = await signer.signHex(digestHex);
      } catch (err) {
        unavailable({
          code: 'DAEMON_SIGNATURE_FAILED',
          missing: 'a usable daemon Phase 2 private key',
          message: `the daemon identity refused to sign: ${err instanceof Error ? err.message : String(err)}`,
          remedy:
            'The private half is unreachable or unusable. On macOS this is usually a Keychain '
            + 'denial for service "port-daddy", account "harbor-signing-private-v2". There is no '
            + 'fallback signer and no unsigned path.',
        });
      }

      if (typeof capabilitySignature !== 'string' || !HEX64_RE.test(capabilitySignature)) {
        unavailable({
          code: 'DAEMON_SIGNATURE_MALFORMED',
          missing: 'a 64-byte Ed25519 signature as 128 hex characters',
          message: 'the daemon identity returned something that is not an Ed25519 signature',
          remedy:
            'Relay refuses any capabilitySignature that is not /^[0-9a-f]{128}$/. Check that the '
            + 'signer is the Phase 2 Ed25519 identity and not another key type.',
        });
      }

      const normalizedSignature = capabilitySignature.toLowerCase();
      if (!selfVerify(normalizedPublicKeyHex, digestHex, normalizedSignature)) {
        unavailable({
          code: 'DAEMON_SIGNATURE_UNVERIFIABLE',
          missing: 'agreement between the daemon signing key and its reported public key',
          message:
            'the signature this daemon produced does not verify under the public key it reports, '
            + 'so Relay would reject it as unsigned by a live identity',
          remedy:
            'The signer and phase2PublicKeyHex() disagree — typically a half-migrated keypair, or '
            + 'a signer that signs the hex text of the digest rather than its bytes. Re-initialize '
            + 'the daemon identity and re-enrol its public key with Relay.',
        });
      }

      return { capability, capabilitySignature: normalizedSignature };
    },
  };
}

/**
 * Refuse a scope that cannot bind a real action.
 *
 * Every field checked here is one Relay compares against the parsed request, so
 * a scope that fails here would have failed at the gate with a generic
 * `CAPABILITY_SCOPE_MISMATCH`. Checking locally is what makes the capability
 * *exact-scope*: there is no code path that signs a spec it has not bounded.
 */
function assertSpec(spec: CapabilitySpec): void {
  const bad = (missing: string, message: string, remedy: string): never =>
    unavailable({ code: 'CAPABILITY_SCOPE_INVALID', missing, message, remedy });

  if (!spec || typeof spec !== 'object') {
    bad('CapabilitySpec', 'mint() was called with no scope', 'Build the scope with capabilitySpec(request, scope).');
  }
  if (spec.schema !== FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA) {
    bad(
      'spec.schema',
      'the scope does not carry the publisher capability schema',
      'Use capabilitySpec() from lib/fleetbot-publish-client.ts rather than assembling the scope by hand.',
    );
  }
  if (!isSafePublisherIdentifier(spec.sessionId)) {
    bad(
      'spec.sessionId',
      'the scope names no usable session',
      'Relay binds the capability to request.sessionId and to authorship.sessionId. Both must be the live session.',
    );
  }
  if (!isRepository(spec.repository) || spec.repository !== spec.repository.toLowerCase()) {
    bad(
      'spec.repository',
      'the scope repository is not a lowercase "owner/repo"',
      'Relay refuses a repository that is not lowercase, before it looks at the signature.',
    );
  }
  if (typeof spec.operation !== 'string' || spec.operation.length === 0) {
    bad('spec.operation', 'the scope names no operation', 'Name one of the contract operations.');
  }
  if (typeof spec.baseBranch !== 'string' || spec.baseBranch.length === 0) {
    bad(
      'spec.baseBranch',
      'the scope names no base branch',
      'Relay compares the capability baseBranch byte-for-byte with the payload baseBranch; it does not normalize either.',
    );
  }
  if (!isGitSha(spec.baseSha) || !isGitSha(spec.headSha)) {
    bad(
      'spec.baseSha / spec.headSha',
      'the scope does not pin an exact base and head commit',
      'A capability that does not pin both commits would authorize a moving target. Supply 40-character SHA-1s.',
    );
  }
  if (typeof spec.requestHash !== 'string' || !HEX32_RE.test(spec.requestHash)) {
    bad(
      'spec.requestHash',
      'the scope carries no canonical request hash',
      'This is the binding that stops a capability minted for one action being replayed for another. '
      + 'Derive it with capabilitySpec(request, scope), which computes it from the contract preimage.',
    );
  }
}

/*
 * ── Notes on what Relay actually checks ──────────────────────────────────────
 *
 * Recorded here because they change how much this signature is worth, and
 * because a reader of this file should not have to re-derive them.
 *
 * 1. Scope binding is genuinely exact. `requestHash` is SHA-256 of
 *    `fleetbotIdempotencyPreimage`, which covers schema, operation, repository,
 *    the entire payload, sessionId and the full authorship block. Relay
 *    recomputes it from the envelope it received and refuses a mismatch, and
 *    separately requires `idempotencyKey === "pd-gh-" + requestHash`. A
 *    capability minted for one action therefore cannot be replayed for another
 *    even before the nonce is considered. This module signs that shape; it does
 *    not sign anything weaker.
 *
 * 2. One-logical-use is enforced, and exact retries still work. The nonce is the
 *    primary key of `github_publisher_capability_uses` together with fingerprint
 *    and generation; Relay INSERTs OR IGNOREs and then reads the row back,
 *    accepting it only when account, token hash, request hash and idempotency
 *    key all match. So re-sending byte-identical bytes is a retry and anything
 *    else with the same nonce is a 409. This matches the contract's own comment
 *    and the request-binding requirement that
 *    `analyses/macaroon_discharge_v2_naive_unsound.pv` exists to justify: a
 *    discharge that is not tied to a specific grant is replayable across grants.
 *
 * 3. `signingKeyGeneration` is currently inert. Relay compares it to
 *    `identities.key_generation`, but the only writer of that column is the
 *    migration's `DEFAULT 1`: `upsertIdentity` in apps/relay/src/db.ts does not
 *    set it, and no code path increments it. Rotating the daemon key changes the
 *    fingerprint (it is SHA-256 of the key), so rotation does separate old from
 *    new — but generation-based revocation, which is what the field is for, is
 *    not implementable today. Asserting 1 is correct now and must be revisited
 *    when a writer appears.
 *
 * 4. Relay does not check that the signing daemon belongs to the account. It
 *    resolves `identities` by the fingerprint the capability names, checks the
 *    identity is live and unrevoked, and verifies the signature — but nothing
 *    ties that fingerprint to the `pdu_` bearer's user, and the schema has no
 *    table that could: there is no account-to-daemon enrolment anywhere in
 *    apps/relay/migrations. The practical consequence is that the daemon
 *    signature proves "some live enrolled daemon consented", not "this
 *    operator's daemon consented". This module cannot fix that from the signing
 *    side and does not pretend to: it signs the shape Relay verifies, and the
 *    gap is reported rather than papered over.
 */
