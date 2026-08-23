/**
 * Port Daddy Relay — Transit envelope v1 (ADR-0123 §6, the N1 invariant)
 *
 * Every event crossing the relay is either AEAD-sealed under a key from the
 * account-KMS hierarchy or explicitly labeled `relay_readable` with a reason.
 * There is no third state: plaintext-as-base64 sitting in a field the trust
 * story calls ciphertext is abolished.
 *
 * The envelope is the transit BODY of the ADR-0049 chain frame: it serializes
 * (Base64URL JSON) into the frame's opaque `ciphertext` slot. computeEventHash
 * and skills/pd-relay-zero-trust/scripts/chain_verify.py are unchanged — the
 * chain commits the envelope bytes as an opaque string, so prev_hash/this_hash
 * live on the frame, never inside the envelope (this_hash is computed over the
 * serialized envelope and cannot appear in it).
 *
 * Routing metadata (harbor, channel, sender, seq, iat) is duplicated into the
 * envelope and covered by `sig`, so a valid envelope for one (channel, seq)
 * cannot be spliced into another — proxies are untrusted plumbing (ADR-0096).
 *
 * Mirrors schemas/relay/v1/envelope.schema.json; the schema wins on any
 * disagreement. tests/envelope.test.ts pins schema/classifier parity.
 */

import {
  base64UrlDecode,
  base64UrlEncode,
  hashHex,
  pubKeyFromPrivKey,
  signEd25519,
  verifyEd25519,
} from './crypto.js';

export const ENVELOPE_SCHEMA_ID = 'pd.relay.envelope.v1';

export const ENVELOPE_CLASSIFICATIONS = ['sealed', 'relay_readable'] as const;
export type EnvelopeClassification = (typeof ENVELOPE_CLASSIFICATIONS)[number];

export const ENVELOPE_SIG_ALGS = ['ed25519', 'hmac-sha256'] as const;
export type EnvelopeSigAlg = (typeof ENVELOPE_SIG_ALGS)[number];

export interface EnvelopeSig {
  alg: EnvelopeSigAlg;
  /**
   * ed25519: signer public key (hex). hmac-sha256: shared-secret binding id
   * (interim until pd-vault key ids).
   *
   * Written by the producer, so on its own it names a key rather than proving
   * anything about one — it is the lookup hint a verifier resolves against a
   * roster, not the key a verifier trusts. It is covered by the signature
   * (envelopeBindingMessage) and checked against the caller's accepted set
   * (verifyEnvelopeSignedBy); neither makes it an authority by itself.
   */
  key_id: string;
  /** hex signature over envelopeBindingMessage(). Non-empty — an empty sig is unclassified-grade invalid. */
  value: string;
}

interface EnvelopeCommon {
  schema: typeof ENVELOPE_SCHEMA_ID;
  v: 1;
  /** Harbor fingerprint prefix of the channel — the routing tenant. */
  harbor: string;
  /** Full channel string including the harbor prefix; must equal the outer frame's channel. */
  channel: string;
  /** Sender fingerprint (hex); must equal the outer frame's sender. */
  sender: string;
  /** Per-(sender, channel) chain seq; must equal the outer frame's seq. */
  seq: number;
  /** Unix timestamp; must equal the outer frame's iat. */
  iat: number;
  sig: EnvelopeSig;
}

export interface SealedEnvelope extends EnvelopeCommon {
  classification: 'sealed';
  /** AEAD algorithm — closed set in v1; additions are schema revisions, never silent. */
  alg: 'aes-256-gcm';
  /** Key epoch under the account-KMS hierarchy: rotation advances the epoch without re-keying history. */
  epoch: number;
  /** Base64URL AEAD nonce, unique per (key, epoch). */
  nonce: string;
  /** Base64URL AEAD ciphertext — the only field of this variant the relay cannot interpret. */
  ciphertext: string;
}

export interface RelayReadableEnvelope extends EnvelopeCommon {
  classification: 'relay_readable';
  /** Structured JSON the relay may read and process. */
  payload: Record<string, unknown>;
  /** REQUIRED human-readable justification for why this event class is relay-readable. */
  reason: string;
}

export type RelayEnvelopeV1 = SealedEnvelope | RelayReadableEnvelope;

export type UnsignedEnvelope =
  | Omit<SealedEnvelope, 'sig'>
  | Omit<RelayReadableEnvelope, 'sig'>;

export class EnvelopeClassificationError extends Error {
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
    this.name = 'EnvelopeClassificationError';
  }
}

function fail(code: EnvelopeClassificationError['code'], message: string): never {
  throw new EnvelopeClassificationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(e: Record<string, unknown>, field: string): void {
  const value = e[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail('BAD_ENVELOPE', `envelope.${field} must be a non-empty string`);
  }
  // Fail closed at the boundary, not deep inside signing: a field carrying an
  // unpaired surrogate has no lossless UTF-8 encoding, and two such fields can
  // share one binding message (see isWellFormedUtf16). lengthPrefixed refuses
  // it too — this is the layer that names the offending field.
  if (!isWellFormedUtf16(value)) {
    fail('BAD_ENVELOPE', `envelope.${field} contains an unpaired surrogate — no lossless UTF-8 encoding`);
  }
}

/**
 * Fail-closed structural validator for the v1 transit envelope. Returns the
 * typed envelope, or throws EnvelopeClassificationError — UNCLASSIFIED when the
 * input carries no sealed|relay_readable label (including every pre-N1 body),
 * a narrower code when the label is present but the variant is malformed.
 */
export function classifyEnvelope(input: unknown): RelayEnvelopeV1 {
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
  // harbor is documented (here and in the schema) as the channel's prefix
  // before the first ':' — the routing tenant. Enforce the derivation instead
  // of trusting the duplicate: both fields sit under the envelope signature, so
  // without this check a producer can sign harbor="X" over channel="Y:…" and
  // hand every envelope-trusting consumer a different tenant than the one the
  // channel routes under — the frame-mismatch problem one field over, and
  // envelopeFrameMismatch cannot catch it because the frame has no harbor
  // field. With this check, envelope.channel === frame.channel (which
  // envelopeFrameMismatch does enforce) transitively pins the harbor too.
  {
    const channel = e.channel as string;
    const colonIdx = channel.indexOf(':');
    const channelHarbor = colonIdx >= 0 ? channel.slice(0, colonIdx) : channel;
    if (e.harbor !== channelHarbor) {
      fail(
        'BAD_ENVELOPE',
        'envelope.harbor must equal the channel prefix before the first ":" — a harbor the channel does not route under is a second signed answer to "whose event is this"'
      );
    }
  }
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) {
    fail('BAD_ENVELOPE', 'envelope.seq must be an integer >= 1');
  }
  if (typeof e.iat !== 'number' || !Number.isInteger(e.iat) || e.iat < 0) {
    fail('BAD_ENVELOPE', 'envelope.iat must be an integer >= 0');
  }

  const sig = e.sig;
  if (!isPlainObject(sig)) {
    fail('EMPTY_SIG', 'envelope.sig is required — an unsigned envelope does not leave the relay');
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
    if (e.alg !== 'aes-256-gcm') {
      fail('BAD_SEALED', 'sealed envelope.alg must be aes-256-gcm (v1 closed set)');
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
  // `.trim()` and not just `.length`: a reason of '   ' is non-empty by length
  // and empty by meaning. The whole point of this field is that a class which
  // cannot state why it transits unencrypted does not ship as relay_readable,
  // and a blank that merely has length defeats that while passing the check.
  // trim() covers Unicode whitespace (NBSP, line/paragraph separators), so a
  // reason cannot be smuggled past this with a non-ASCII blank either.
  if (typeof e.reason !== 'string' || e.reason.trim().length === 0) {
    fail('MISSING_REASON', 'relay_readable envelope.reason is required and must contain a non-whitespace justification — the label is the audit trail, not decoration');
  }
  return e as unknown as RelayReadableEnvelope;
}

/** Egress assertion: unclassified input throws. */
export function assertClassified(input: unknown): asserts input is RelayEnvelopeV1 {
  classifyEnvelope(input);
}

// ── Transit codec — the envelope <-> chain-frame `ciphertext` slot ───────────

/**
 * Serialize a classified envelope into the chain frame's opaque `ciphertext`
 * slot. Asserts classification first: nothing unlabeled leaves a producer.
 */
export function encodeTransitEnvelope(envelope: RelayEnvelopeV1): string {
  assertClassified(envelope);
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(envelope)));
}

/**
 * Decode + classify a chain frame's transit body. A bare AEAD blob or any
 * pre-N1 body throws UNCLASSIFIED.
 */
export function decodeTransitEnvelope(transit: string): RelayEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(transit)));
  } catch {
    fail('UNCLASSIFIED', 'transit body is not Base64URL JSON — sealed|relay_readable label absent');
  }
  return classifyEnvelope(parsed);
}

/** Non-throwing probe for the N1 detect-and-warn window: null = unclassified or malformed. */
export function tryDecodeTransitEnvelope(transit: string): RelayEnvelopeV1 | null {
  try {
    return decodeTransitEnvelope(transit);
  } catch (err) {
    if (err instanceof EnvelopeClassificationError) return null;
    throw err;
  }
}

// ── Envelope signing ─────────────────────────────────────────────────────────
//
// Binding: sha256 over the LENGTH-PREFIXED join of the routing tuple and a
// content hash. Two properties are load-bearing here, and both were found
// false in an earlier draft of this file by direct probe rather than by
// reading:
//
// 1. UNAMBIGUOUS CONCATENATION. A plain `[...].join('|')` is ambiguous the
//    moment any component may contain the separator: harbor="a|b" channel="c"
//    and harbor="a" channel="b|c" produce byte-identical joins, so ONE
//    signature validates for TWO different routing tuples — a cross-channel
//    replay in the very mechanism meant to prevent it. Length-prefixing each
//    component (`<byteLen>:<value>`) makes the encoding injective: the decoder
//    of the framing can only read back the tuple that was written, whatever
//    characters the values contain. This must not depend on a charset
//    restriction elsewhere; a binding is not allowed to be safe by accident.
//
// 2. KEY-ORDER INDEPENDENCE. `JSON.stringify` emits keys in insertion order,
//    so a verifier that rebuilt the payload object differently — a different
//    library, another language, a re-serialized proxy — hashes different bytes
//    and rejects a perfectly good signature. `canonicalJson` sorts object keys
//    recursively so the content hash depends on the payload's VALUE, not on
//    how it was assembled. (Arrays keep their order: it is semantic.)
//
// Byte length, not `.length`: JS string length counts UTF-16 units, so a
// multi-byte character would otherwise let two distinct values share a prefix.

const BINDING_ENCODER = new TextEncoder();

/**
 * True when every UTF-16 surrogate in `value` is properly paired, i.e. the
 * string has a lossless UTF-8 encoding.
 *
 * WHY THIS GUARD EXISTS. `TextEncoder` is not injective over JS strings: it
 * replaces each UNPAIRED surrogate with U+FFFD, so `"ops\uD800"` and
 * `"ops\uFFFD"` — two distinct strings — encode to the same six bytes, take
 * the same length prefix, and produce a byte-identical binding message. That
 * is the cross-channel replay the length-prefixing exists to prevent, arriving
 * one layer further down: the framing is injective over BYTES, but the
 * string→bytes step upstream of it is not. Point 1 above says this must not
 * depend on a charset restriction elsewhere — so the framing enforces its own
 * precondition rather than assuming a caller cleaned the value.
 *
 * A lone surrogate is reachable, not theoretical: `JSON.parse` preserves one
 * verbatim, so any producer whose routing metadata comes from a parsed request
 * body can carry it into the binding.
 */
function isWellFormedUtf16(value: string): boolean {
  // `String.prototype.isWellFormed` (ES2024) where present; the regex covers
  // any runtime without it — a lone high surrogate not followed by a low one,
  // or a low surrogate not preceded by a high one.
  return typeof (value as { isWellFormed?: () => boolean }).isWellFormed === 'function'
    ? (value as unknown as { isWellFormed: () => boolean }).isWellFormed()
    : !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

/**
 * `<utf8ByteLength>:<value>` — the injective framing described above.
 *
 * Throws rather than framing a string with no lossless UTF-8 encoding: a
 * binding message that cannot be computed is a failure, but one computed over
 * lossy bytes is a forged-signature vector.
 */
function lengthPrefixed(value: string): string {
  if (!isWellFormedUtf16(value)) {
    fail(
      'BAD_ENVELOPE',
      'envelope routing metadata contains an unpaired surrogate — it has no lossless UTF-8 encoding, so it cannot be bound injectively',
    );
  }
  return `${BINDING_ENCODER.encode(value).length}:${value}`;
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays left in order.
 * Produces the same bytes for the same value regardless of how the object was
 * built, which is what lets a different implementation verify our signatures.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  // Honor toJSON the way JSON.stringify does, BEFORE recursing. Without this a
  // Date serializes as '{}' here (no own enumerable keys) while the transit
  // codec's JSON.stringify turns it into its ISO string — so the producer signs
  // one content hash and every consumer that decodes the transit bytes computes
  // another, and a perfectly good signature fails verification after one round
  // trip. Recursing into the toJSON result keeps the two serializations
  // describing the same value.
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return canonicalJson((toJSON as (this: unknown) => unknown).call(value));
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * The signing key is itself a component, in the header position JWS gives
 * `kid`. That is what makes the signature commit to WHICH key produced it:
 * without it, a signature is a free-floating proof over the routing tuple, and
 * `sig.key_id` — the only identity-shaped field on the envelope — is a claim
 * the signature does not cover.
 *
 * Verifiers pass the key they independently decided to accept, never the one
 * the envelope asserts. That is the whole reason this parameter exists; see
 * verifyEnvelopeSignedBy.
 */
export function envelopeBindingMessage(
  envelope: UnsignedEnvelope | RelayEnvelopeV1,
  keyIdHex: string
): string {
  // Defense in depth, not the primary gate: classifyEnvelope already rejects an
  // empty sig.key_id on both variants, and the length-prefixed framing below is
  // injective even over an empty component ('0:' cannot alias a non-empty
  // value). But this function is exported and takes the key as a bare
  // parameter, so it enforces its own precondition: a binding computed under no
  // key is a signature that commits to no signer.
  if (keyIdHex.length === 0) {
    fail('EMPTY_SIG', 'binding key id must be non-empty — the signature has to commit to which key made it');
  }
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

/** Ed25519 signature with the relay's (or a daemon's) existing signing key; key_id = the public key, hex. */
export async function signEnvelope(
  privKeyHex: string,
  unsigned: UnsignedEnvelope
): Promise<EnvelopeSig> {
  const keyId = pubKeyFromPrivKey(privKeyHex);
  const value = await signEd25519(privKeyHex, envelopeBindingMessage(unsigned, keyId));
  return { alg: 'ed25519', key_id: keyId, value };
}

/**
 * Verify that this envelope was signed by one of `acceptedKeysHex`.
 *
 * The accepted keys are the caller's to resolve, and the caller must resolve
 * them: an envelope's `sig.key_id` is written by whoever produced the envelope,
 * so verifying against it proves only that the producer held the key they
 * themselves nominated. Anyone can generate a keypair. Passing the envelope's
 * own key_id back in reproduces exactly that, which is why it has to be written
 * out at the call site instead of being this function's default.
 *
 * Both call sites that would want this already hold the right key: a daemon's
 * `identity.pub_key`, read from D1 by authenticated fingerprint, and the
 * relay's own public key derived from RELAY_ED25519_PRIVATE_KEY_HEX. The
 * parameter is a set, not one key, because rotation leaves a sender with
 * several keys valid over a stored corpus and epoch-tagged rotation is the
 * plan — one key would force a caller to guess which epoch signed a given
 * envelope, or to loop and thereby build "try every key" by hand.
 *
 * Resolving key_id to a key set is deliberately NOT done here. That resolution
 * needs the harbor's signed member roster, and the relay holds no harbor key
 * ("phone book, never a key holder"), so a shared module that reached for a
 * roster would be the relay claiming an authority it is not allowed to have.
 * The same split is already shipped for OIDC: verifyOidcToken takes the JWKS
 * its caller fetched rather than fetching one itself.
 *
 * `sig.key_id` must name one of the accepted keys, which is what makes it an
 * authenticated field rather than a rewritable hint: an intermediary that
 * edits it turns a good envelope into a rejected one instead of silently
 * re-attributing it.
 *
 * hmac-sha256 verification needs the shared secret and lives with its holder,
 * so it returns false here rather than pretending.
 */
export async function verifyEnvelopeSignedBy(
  envelope: RelayEnvelopeV1,
  acceptedKeysHex: readonly string[]
): Promise<boolean> {
  if (envelope.sig.alg !== 'ed25519') return false;
  for (const accepted of acceptedKeysHex) {
    if (accepted !== envelope.sig.key_id) continue;
    if (
      await verifyEd25519(accepted, envelopeBindingMessage(envelope, accepted), envelope.sig.value)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The envelope's routing fields are documented above as "must equal the outer
 * frame's" — until now nothing enforced that, on any path.
 *
 * A mismatch is not a forgery: the frame signature covers `this_hash`, which
 * covers the encoded envelope, so only the authenticated daemon can put these
 * bytes on the wire. The problem is what a mismatch means downstream. The
 * envelope carries its OWN signature over its OWN routing tuple, and a consumer
 * that verifies it — iOS, another device, anything replaying from D1 — files
 * the event where the envelope says it belongs. So a daemon publishing on
 * channel C an envelope that says, under a valid signature, that it belongs to
 * channel D gets that event filed under D by every envelope-trusting consumer
 * while the relay's own chain has it under C. Two answers to "where does this
 * event live", both signed.
 *
 * Returns the offending field name, or null when the two agree. `harbor` is not
 * compared: the frame has no harbor field of its own, only the channel prefix
 * the envelope derives it from.
 */
export function envelopeFrameMismatch(
  envelope: RelayEnvelopeV1,
  frame: { channel: string; sender: string; seq: number; iat: number }
): string | null {
  if (envelope.channel !== frame.channel) return 'channel';
  if (envelope.sender !== frame.sender) return 'sender';
  if (envelope.seq !== frame.seq) return 'seq';
  if (envelope.iat !== frame.iat) return 'iat';
  return null;
}
