/**
 * Daemon seal path — the ONE classification chokepoint for relay-bound events
 * (ADR-0123 §6 N1 at the publisher; A3 slice 1).
 *
 * WHY THIS MODULE EXISTS. The e2e doctrine puts the seal at the PUBLISHER:
 * the daemon seals, the relay only checks structure (invariant I1 — the relay
 * routes ciphertext, never plaintext). For that to be a property rather than
 * a habit, every relay-bound event must pass through exactly one place that
 * decides — and records — its classification: AEAD-sealed under a pd-vault
 * channel key, or explicitly `relay_readable` with a stated reason. There is
 * no third state, and this module is built so an UNCLASSIFIED event cannot
 * reach the wire *by construction*:
 *
 *   1. {@link ClassifiedRelayEvent} has a private brand field and its class
 *      value is not exported, so (TS being structural everywhere else) no
 *      code outside this module can produce a value of the type. The only
 *      mints are {@link sealRelayEvent} and {@link relayReadableEvent}, and
 *      both run the full structural classifier before minting.
 *   2. {@link ClassifiedTransit} — the Base64URL string that rides in the
 *      chain frame's `ciphertext` slot — is a branded string produced only at
 *      the mint. `publishToRelay` (lib/relay-client.ts) types its transit
 *      slot as ClassifiedTransit, so the compiler rejects a raw string at the
 *      only send entry.
 *   3. Belt and suspenders: {@link assertClassifiedTransit} re-decodes and
 *      re-classifies at the send boundary, so even a caller that casts past
 *      the brand fails loudly at runtime before any bytes leave the daemon.
 *
 * PARITY WITH THE RELAY (A1). The envelope shape, the signature binding
 * message, and the canonical-JSON content hash must byte-match
 * `apps/relay/src/envelope.ts` — the Worker cannot import daemon code and the
 * daemon must not import Worker code, so the contract is pinned the ADR-0120
 * way: the schema (schemas/relay/v1/envelope.schema.json) documents the
 * construction, and tests/unit/relay-seal.test.ts asserts the SAME known-
 * answer binding digests the relay suite pins (the `dba03e…` / `c4b649…`
 * vectors). A divergence between the two implementations is a red test on
 * whichever side moved.
 *
 * CRYPTO REUSE, NOT INVENTION. The AEAD is the pd-vault construction via
 * {@link VaultSealProvider} (default: the pure-TS reference held to the
 * pd-vault parity fixture). The envelope signature is the existing Ed25519
 * identity signing the existing binding-message construction. Nothing novel
 * is introduced here — that is a design rule, not an accident.
 */

import { createHash } from 'node:crypto';

import {
  referenceVault,
  NONCE_LEN,
  type SealAad,
  type VaultSealProvider,
} from './pd-vault-ts.js';

/** The envelope schema id — must equal apps/relay/src/envelope.ts. */
export const ENVELOPE_SCHEMA_ID = 'pd.relay.envelope.v1';

/**
 * AEAD algorithms admitted in a sealed envelope. Closed set, mirrored from
 * the schema: `xchacha20-poly1305` is what the daemon seal path emits (it is
 * what pd-vault implements and what the parity vectors pin); `aes-256-gcm`
 * remains admitted structurally because the v1 schema shipped with it.
 * Additions are schema revisions, never silent.
 */
export const SEALED_ALGS = ['xchacha20-poly1305', 'aes-256-gcm'] as const;
export type SealedAlg = (typeof SEALED_ALGS)[number];

export interface EnvelopeSig {
  alg: 'ed25519' | 'hmac-sha256';
  /** Names the signing key (ed25519: signer public key, hex). A lookup hint a verifier resolves against its own accepted set — never an authority by itself. */
  key_id: string;
  /** Hex signature over {@link envelopeBindingMessage}. */
  value: string;
}

interface EnvelopeCommon {
  schema: typeof ENVELOPE_SCHEMA_ID;
  v: 1;
  /** Harbor fingerprint prefix of the channel — the routing tenant. */
  harbor: string;
  /** Full channel string including the harbor prefix; equals the outer frame's channel. */
  channel: string;
  /** Sender fingerprint (hex); equals the outer frame's sender. */
  sender: string;
  /** Per-(sender, channel) chain seq; equals the outer frame's seq. */
  seq: number;
  /** Unix timestamp; equals the outer frame's iat. */
  iat: number;
  sig: EnvelopeSig;
}

export interface SealedEnvelope extends EnvelopeCommon {
  classification: 'sealed';
  alg: SealedAlg;
  /** pd-vault key epoch: rotation advances the epoch without re-keying history. */
  epoch: number;
  /** Base64URL AEAD nonce (24 bytes for xchacha20-poly1305). */
  nonce: string;
  /** Base64URL AEAD ciphertext — the only field of this variant the relay cannot interpret. */
  ciphertext: string;
}

export interface RelayReadableEnvelope extends EnvelopeCommon {
  classification: 'relay_readable';
  /** Structured JSON the relay may read and process. */
  payload: Record<string, unknown>;
  /** REQUIRED human-readable justification for why this event class transits unsealed. */
  reason: string;
}

export type RelayEnvelopeV1 = SealedEnvelope | RelayReadableEnvelope;

export type UnsignedEnvelope =
  | Omit<SealedEnvelope, 'sig'>
  | Omit<RelayReadableEnvelope, 'sig'>;

/**
 * The routing tuple every relay-bound event carries. Duplicated into the
 * envelope and covered by its signature so a valid envelope for one
 * (channel, seq) cannot be spliced into another (proxies are untrusted
 * plumbing, ADR-0096).
 */
export interface RelayRouting {
  harbor: string;
  channel: string;
  sender: string;
  seq: number;
  iat: number;
}

/**
 * The signing identity the chokepoint uses — deliberately an interface, not a
 * key: the daemon's Ed25519 private key stays wherever it lives (harbor token
 * module, keychain), and this module only ever asks it to sign a digest. Same
 * "use without see" posture as the vault itself.
 */
export interface EnvelopeSigner {
  /** The signer's public key, hex — becomes `sig.key_id` and a signed component of the binding. */
  keyIdHex: string;
  /** Sign the hex-decoded bytes of `msgHex` with Ed25519; resolve to the hex signature. */
  signHex(msgHex: string): Promise<string>;
}

/** Classification failures — same code taxonomy as the relay-side classifier. */
export class DaemonEnvelopeError extends Error {
  /**
   * @param code Stable failure class, mirroring apps/relay EnvelopeClassificationError.
   * @param message Human-readable detail naming the offending field.
   */
  constructor(
    public readonly code:
      | 'UNCLASSIFIED'
      | 'BAD_ENVELOPE'
      | 'EMPTY_SIG'
      | 'BAD_SEALED'
      | 'BAD_PAYLOAD'
      | 'MISSING_REASON',
    message: string
  ) {
    super(message);
    this.name = 'DaemonEnvelopeError';
  }
}

/**
 * Throw a typed classification failure. Exists so every refusal in this
 * module carries a stable machine-readable code — the design twin of the
 * relay classifier's fail().
 *
 * @param code The failure class.
 * @param message Human-readable detail.
 * @returns Never — always throws.
 */
function fail(code: DaemonEnvelopeError['code'], message: string): never {
  throw new DaemonEnvelopeError(code, message);
}

// ── Binding message (byte-parity with apps/relay/src/envelope.ts) ────────────

const BINDING_ENCODER = new TextEncoder();

/**
 * True when every UTF-16 surrogate in `value` is properly paired, i.e. the
 * string has a lossless UTF-8 encoding.
 *
 * Why: TextEncoder maps each UNPAIRED surrogate to U+FFFD, so two distinct
 * strings can encode to identical bytes, share a length prefix, and produce
 * one binding message for two routing tuples — the exact splice the framing
 * exists to prevent, one layer down. The framing therefore enforces its own
 * precondition instead of trusting upstream sanitation.
 *
 * @param value The candidate string.
 * @returns True when the string has a lossless UTF-8 encoding.
 */
function isWellFormedUtf16(value: string): boolean {
  return typeof (value as { isWellFormed?: () => boolean }).isWellFormed === 'function'
    ? (value as unknown as { isWellFormed: () => boolean }).isWellFormed()
    : !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

/**
 * `<utf8ByteLength>:<value>` — injective framing for one binding component.
 *
 * Design: the byte-length prefix (NOT `.length`, which counts UTF-16 units)
 * is what makes the joined message parse back to exactly one component list
 * whatever characters the values contain; a bare `join('|')` validates one
 * signature for two routing tuples the moment a field contains the separator.
 *
 * @param value The component to frame.
 * @returns The `<utf8ByteLength>:<value>` framing.
 */
function lengthPrefixed(value: string): string {
  if (!isWellFormedUtf16(value)) {
    fail(
      'BAD_ENVELOPE',
      'envelope routing metadata contains an unpaired surrogate — it has no lossless UTF-8 encoding, so it cannot be bound injectively'
    );
  }
  return `${BINDING_ENCODER.encode(value).length}:${value}`;
}

/**
 * SHA-256 of a UTF-8 string as lowercase hex — the digest primitive the
 * whole binding construction is built on (its purpose is exact byte parity
 * with the relay's hashHex).
 *
 * @param input The string to digest.
 * @returns Lowercase hex SHA-256.
 */
function hashHex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Deterministic JSON for the relay_readable content hash: object keys sorted
 * recursively, arrays left in order, `undefined` entries dropped.
 *
 * WHY IT MUST MATCH THE RELAY'S canonicalJson EXACTLY (and deliberately does
 * NOT reuse lib/merkle-chain.ts's stricter canonicalizer, which throws on
 * `undefined` and is contracted to the Python chain tools instead): the
 * content hash is a signed component, so a daemon and the relay serializing
 * one payload differently means every daemon signature fails relay-side
 * verification. The known-answer binding digests in the unit suite pin the
 * agreement.
 *
 * @param value Any JSON-representable value.
 * @returns The canonical serialization.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * The digest an envelope signature covers — byte-identical to the relay's
 * envelopeBindingMessage (apps/relay/src/envelope.ts), pinned by the shared
 * known-answer vectors.
 *
 * Purpose of each component: the schema tag stops a signature over some other
 * pd binding of the same arity being replayed as an envelope signature;
 * `classification` stops a sealed signature validating for a relay_readable
 * twin; `keyIdHex` (the JWS `kid` position) makes the signature commit to
 * WHICH key produced it; the routing tuple pins the envelope to one
 * (harbor, channel, sender, seq, iat); the content hash commits to the body.
 *
 * @param envelope The envelope (signed or unsigned — `sig` is not a component).
 * @param keyIdHex The key the VERIFIER independently decided to accept, never one the envelope asserts.
 * @returns Hex SHA-256 binding digest.
 */
export function envelopeBindingMessage(
  envelope: UnsignedEnvelope | RelayEnvelopeV1,
  keyIdHex: string
): string {
  const contentHash =
    envelope.classification === 'sealed'
      ? hashHex(envelope.ciphertext)
      : hashHex(canonicalJson(envelope.payload));
  return hashHex(
    [
      ENVELOPE_SCHEMA_ID,
      envelope.classification,
      keyIdHex,
      envelope.harbor,
      envelope.channel,
      envelope.sender,
      String(envelope.seq),
      String(envelope.iat),
      contentHash,
    ]
      .map(lengthPrefixed)
      .join('|')
  );
}

// ── Structural classifier (daemon-side mirror of the relay's) ────────────────

/**
 * Narrow to a plain JSON object. Purpose: the classifier must reject arrays
 * and null where an object is required, and `typeof` alone cannot.
 *
 * @param value The candidate.
 * @returns True for a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Require a non-empty, well-formed string field. Why the surrogate check
 * lives here: this is the layer that can NAME the offending field, so the
 * boundary fails with a usable message instead of deep inside signing.
 *
 * @param e The envelope-shaped object.
 * @param field The field name to check.
 * @returns Nothing — throws BAD_ENVELOPE on violation.
 */
function requireNonEmptyString(e: Record<string, unknown>, field: string): void {
  const value = e[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail('BAD_ENVELOPE', `envelope.${field} must be a non-empty string`);
  }
  if (!isWellFormedUtf16(value)) {
    fail('BAD_ENVELOPE', `envelope.${field} contains an unpaired surrogate — no lossless UTF-8 encoding`);
  }
}

/**
 * Fail-closed structural validator for the v1 transit envelope — the daemon-
 * side twin of the relay's classifyEnvelope, and the single gate both mint
 * paths and the send-boundary assertion run through.
 *
 * Why a daemon copy exists at all: the Worker cannot be imported here, and
 * the publisher must refuse to *produce* what the relay would refuse to
 * *route* — catching a malformed envelope after it crossed the wire would put
 * the enforcement at the wrong end of the trust story.
 *
 * @param input Anything claiming to be a transit envelope.
 * @returns The typed envelope.
 * @throws DaemonEnvelopeError UNCLASSIFIED when no sealed|relay_readable label is present; a narrower code when the label is present but the variant is malformed.
 */
export function classifyDaemonRelayEnvelope(input: unknown): RelayEnvelopeV1 {
  if (!isPlainObject(input)) {
    fail('UNCLASSIFIED', 'transit body is not a JSON object — sealed|relay_readable label absent (ADR-0123 N1: no third state)');
  }
  const e = input;

  const classification = e.classification;
  if (classification !== 'sealed' && classification !== 'relay_readable') {
    fail('UNCLASSIFIED', 'transit body carries no sealed|relay_readable classification (ADR-0123 N1: no third state)');
  }
  if (e.schema !== ENVELOPE_SCHEMA_ID) {
    fail('BAD_ENVELOPE', `envelope.schema must be "${ENVELOPE_SCHEMA_ID}"`);
  }
  if (e.v !== 1) {
    fail('BAD_ENVELOPE', 'envelope.v must be 1');
  }
  requireNonEmptyString(e, 'harbor');
  requireNonEmptyString(e, 'channel');
  requireNonEmptyString(e, 'sender');
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) {
    fail('BAD_ENVELOPE', 'envelope.seq must be an integer >= 1');
  }
  if (typeof e.iat !== 'number' || !Number.isInteger(e.iat) || e.iat < 0) {
    fail('BAD_ENVELOPE', 'envelope.iat must be an integer >= 0');
  }

  const sig = e.sig;
  if (!isPlainObject(sig)) {
    fail('EMPTY_SIG', 'envelope.sig is required — an unsigned envelope does not leave the daemon');
  }
  if (sig.alg !== 'ed25519' && sig.alg !== 'hmac-sha256') {
    fail('EMPTY_SIG', 'envelope.sig.alg must be ed25519 or hmac-sha256');
  }
  if (typeof sig.key_id !== 'string' || sig.key_id.length === 0) {
    fail('EMPTY_SIG', 'envelope.sig.key_id must be a non-empty string');
  }
  if (typeof sig.value !== 'string' || sig.value.length === 0) {
    fail('EMPTY_SIG', 'envelope.sig.value must be a non-empty string');
  }

  if (classification === 'sealed') {
    if (e.alg !== 'xchacha20-poly1305' && e.alg !== 'aes-256-gcm') {
      fail('BAD_SEALED', 'sealed envelope.alg must be xchacha20-poly1305 or aes-256-gcm (v1 closed set)');
    }
    if (typeof e.epoch !== 'number' || !Number.isInteger(e.epoch) || e.epoch < 0) {
      fail('BAD_SEALED', 'sealed envelope.epoch must be an integer >= 0');
    }
    if (typeof e.nonce !== 'string' || e.nonce.length === 0) {
      fail('BAD_SEALED', 'sealed envelope.nonce must be a non-empty string');
    }
    if (typeof e.ciphertext !== 'string' || e.ciphertext.length === 0) {
      fail('BAD_SEALED', 'sealed envelope.ciphertext must be a non-empty string');
    }
    return e as unknown as SealedEnvelope;
  }

  if (!isPlainObject(e.payload)) {
    fail('BAD_PAYLOAD', 'relay_readable envelope.payload must be a JSON object');
  }
  // `.trim()`, not `.length`: a whitespace-only reason has length and no
  // meaning; the field is the audit trail, not decoration.
  if (typeof e.reason !== 'string' || e.reason.trim().length === 0) {
    fail('MISSING_REASON', 'relay_readable envelope.reason is required and must contain a non-whitespace justification');
  }
  return e as unknown as RelayReadableEnvelope;
}

// ── The classified type — mintable only here ─────────────────────────────────

/**
 * Base64URL transit body that has passed classification. Branded so the type
 * has no inhabitants outside this module's mint: `publishToRelay` requires
 * it, which is what makes "unclassified reaches the wire" a compile error
 * rather than a code-review hope.
 */
declare const classifiedTransitBrand: unique symbol;
export type ClassifiedTransit = string & { readonly [classifiedTransitBrand]: 'pd.relay.envelope.v1' };

/**
 * A relay-bound event that has passed the classification chokepoint.
 *
 * The class value is deliberately NOT exported and the `#minted` private
 * field makes the type nominal: no object literal, cast-free, can satisfy it.
 * The only mints are {@link sealRelayEvent} and {@link relayReadableEvent}.
 */
class ClassifiedRelayEventImpl {
  /** Nominal-typing anchor: a private field TS will not match structurally. */
  readonly #minted = true;

  constructor(
    /** The classified, signed envelope. */
    readonly envelope: RelayEnvelopeV1,
    /** The Base64URL serialization that rides in the chain frame's ciphertext slot. */
    readonly transit: ClassifiedTransit
  ) {
    void this.#minted;
  }
}

export type ClassifiedRelayEvent = ClassifiedRelayEventImpl;

/**
 * THE chokepoint. Every mint path funnels through here: classify (fail
 * closed), serialize, brand. Private to the module on purpose — exporting it
 * would let a caller brand an envelope this module never validated.
 *
 * @param envelope The fully built envelope to classify and brand.
 * @returns The minted classified event.
 */
function classifyAndMint(envelope: RelayEnvelopeV1): ClassifiedRelayEvent {
  const classified = classifyDaemonRelayEnvelope(envelope);
  const transit = Buffer.from(JSON.stringify(classified), 'utf8').toString(
    'base64url'
  ) as ClassifiedTransit;
  return new ClassifiedRelayEventImpl(classified, transit);
}

/**
 * Sign an unsigned envelope's binding message with the daemon identity.
 * One helper by design: both mint paths must sign the identical construction.
 *
 * @param unsigned The envelope minus its sig.
 * @param signer The signing identity.
 * @returns The ed25519 EnvelopeSig.
 */
async function signUnsigned(
  unsigned: UnsignedEnvelope,
  signer: EnvelopeSigner
): Promise<EnvelopeSig> {
  const value = await signer.signHex(envelopeBindingMessage(unsigned, signer.keyIdHex));
  return { alg: 'ed25519', key_id: signer.keyIdHex, value };
}

/**
 * Enforce that the channel names its harbor tenant. Why at the publisher:
 * a mislabeled tenancy should be impossible to produce, not merely
 * detectable downstream.
 *
 * @param routing The routing tuple to check.
 * @returns Nothing — throws BAD_ENVELOPE on a prefix mismatch.
 */
function requireRoutingCoherence(routing: RelayRouting): void {
  // The harbor is defined as the channel's tenant prefix (schema: "prefix
  // before the first ':'"). Enforcing it at the publisher means a mislabeled
  // tenancy is impossible to *produce*, not merely detectable downstream.
  if (!routing.channel.startsWith(`${routing.harbor}:`)) {
    fail('BAD_ENVELOPE', `envelope.channel must begin with "<harbor>:" — got channel "${routing.channel}" under harbor "${routing.harbor}"`);
  }
}

/**
 * Seal a relay-bound event: pd-vault AEAD under the (channel, epoch) key,
 * A1 sealed envelope, Ed25519 binding signature — one call, fully classified.
 *
 * Design: the vault is an injected {@link VaultSealProvider} defaulting to
 * the pure-TS reference, so the pd-vault Rust FFI can replace the crypto
 * without touching any caller of this function. The AAD binds
 * (harbor, channel, epoch, seq) so the ciphertext cannot be relabelled into
 * another context even by a holder of the key.
 *
 * @param input.routing The frame routing tuple the envelope duplicates and signs.
 * @param input.plaintext Event body to seal (string = UTF-8).
 * @param input.harborSecret pd-vault input keying material (>= 32 bytes) for channel-key derivation.
 * @param input.epoch pd-vault key epoch in force for the channel.
 * @param input.signer Envelope signing identity (daemon Ed25519).
 * @param input.vault Optional provider override — the Rust FFI seam.
 * @returns The classified event, ready for the send boundary.
 */
export async function sealRelayEvent(input: {
  routing: RelayRouting;
  plaintext: Uint8Array | string;
  harborSecret: Uint8Array;
  epoch: number;
  signer: EnvelopeSigner;
  vault?: VaultSealProvider;
}): Promise<ClassifiedRelayEvent> {
  const vault = input.vault ?? referenceVault;
  const { routing } = input;
  requireRoutingCoherence(routing);

  const plaintext =
    typeof input.plaintext === 'string' ? Buffer.from(input.plaintext, 'utf8') : input.plaintext;
  const key = vault.deriveChannelKey(input.harborSecret, routing.channel, input.epoch);
  const nonce = vault.randomNonce();
  if (nonce.length !== NONCE_LEN) {
    fail('BAD_SEALED', `vault provider produced a ${nonce.length}-byte nonce; xchacha20-poly1305 requires ${NONCE_LEN}`);
  }
  const aad: SealAad = {
    harborId: routing.harbor,
    channelId: routing.channel,
    epoch: input.epoch,
    seq: routing.seq,
  };
  const ciphertext = vault.seal(key, nonce, plaintext, aad);

  const unsigned: Omit<SealedEnvelope, 'sig'> = {
    schema: ENVELOPE_SCHEMA_ID,
    v: 1,
    classification: 'sealed',
    harbor: routing.harbor,
    channel: routing.channel,
    sender: routing.sender,
    seq: routing.seq,
    iat: routing.iat,
    alg: 'xchacha20-poly1305',
    epoch: input.epoch,
    nonce: Buffer.from(nonce).toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url'),
  };
  const sig = await signUnsigned(unsigned, input.signer);
  return classifyAndMint({ ...unsigned, sig });
}

/**
 * Classify an event as relay_readable — the honest label for streams the
 * relay legitimately processes, with the REQUIRED reason that makes the
 * label an audit trail instead of decoration.
 *
 * Why a whole function for "don't encrypt": the alternative is a third,
 * unlabeled state, which is exactly what N1 abolishes. An event class that
 * cannot state why it transits unsealed does not transit.
 *
 * @param input.routing The frame routing tuple.
 * @param input.payload Structured JSON the relay may read.
 * @param input.reason Non-blank human-readable justification.
 * @param input.signer Envelope signing identity.
 * @returns The classified event, ready for the send boundary.
 */
export async function relayReadableEvent(input: {
  routing: RelayRouting;
  payload: Record<string, unknown>;
  reason: string;
  signer: EnvelopeSigner;
}): Promise<ClassifiedRelayEvent> {
  const { routing } = input;
  requireRoutingCoherence(routing);
  const unsigned: Omit<RelayReadableEnvelope, 'sig'> = {
    schema: ENVELOPE_SCHEMA_ID,
    v: 1,
    classification: 'relay_readable',
    harbor: routing.harbor,
    channel: routing.channel,
    sender: routing.sender,
    seq: routing.seq,
    iat: routing.iat,
    payload: input.payload,
    reason: input.reason,
  };
  const sig = await signUnsigned(unsigned, input.signer);
  return classifyAndMint({ ...unsigned, sig });
}

/**
 * Open the sealed body of a classified event — the subscriber-side inverse,
 * used by tests to prove invertibility and by the future inbound path.
 *
 * Fails with the vault's single opaque decryption error on any mismatch of
 * key, nonce, or context; see lib/pd-vault-ts.ts for why the failure is mute.
 *
 * @param envelope A sealed envelope (throws BAD_SEALED for relay_readable).
 * @param harborSecret The harbor secret to derive the channel key from.
 * @param vault Optional provider override — the Rust FFI seam.
 * @returns The recovered plaintext bytes.
 */
export function openSealedRelayEvent(
  envelope: RelayEnvelopeV1,
  harborSecret: Uint8Array,
  vault: VaultSealProvider = referenceVault
): Buffer {
  if (envelope.classification !== 'sealed') {
    fail('BAD_SEALED', 'openSealedRelayEvent requires a sealed envelope');
  }
  const key = vault.deriveChannelKey(harborSecret, envelope.channel, envelope.epoch);
  return vault.open(
    key,
    Buffer.from(envelope.nonce, 'base64url'),
    Buffer.from(envelope.ciphertext, 'base64url'),
    {
      harborId: envelope.harbor,
      channelId: envelope.channel,
      epoch: envelope.epoch,
      seq: envelope.seq,
    }
  );
}

/**
 * Runtime re-check at the send boundary: decode the transit string and run
 * the full classifier again.
 *
 * Motivation: the {@link ClassifiedTransit} brand is a compile-time fence,
 * and TypeScript fences can be climbed with a cast. This assertion makes the
 * climb land on a thrown DaemonEnvelopeError before any bytes reach the
 * relay, so the wire invariant holds against casts, JS callers, and future
 * refactors alike.
 *
 * @param transit The transit body about to be published.
 * @returns The decoded, re-validated envelope.
 */
export function assertClassifiedTransit(transit: string): RelayEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(transit, 'base64url').toString('utf8'));
  } catch {
    fail('UNCLASSIFIED', 'transit body is not Base64URL JSON — sealed|relay_readable label absent');
  }
  return classifyDaemonRelayEnvelope(parsed);
}
