/**
 * Tests for the v1 transit envelope (ADR-0123 §6, the N1 invariant):
 * sealed or labeled relay_readable, no third state.
 *
 * Three layers are pinned here:
 *   1. schemas/relay/v1/envelope.schema.json accepts both fixture variants and
 *      rejects unclassified / missing-reason / empty-sig instances, via a
 *      hand-rolled fail-closed draft-2020-12 SUBSET validator — the repo ships
 *      no schema library (same posture as tests/unit/agent-harbor-contracts
 *      .test.js and lib/agent-harbor/schema-validate.ts).
 *   2. classifyEnvelope/assertClassified agree with the schema on the same
 *      instances (drift between schema and runtime classifier fails here).
 *   3. Regression pin: the pre-N1 webhook blob — plaintext-as-base64 with no
 *      classification — throws, both as a decoded object and through the
 *      transit codec.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  classifyEnvelope,
  assertClassified,
  EnvelopeClassificationError,
  encodeTransitEnvelope,
  decodeTransitEnvelope,
  tryDecodeTransitEnvelope,
  signEnvelope,
  verifyEnvelopeSig,
  ENVELOPE_SCHEMA_ID,
  canonicalJson,
  envelopeBindingMessage,
  envelopeFrameMismatch,
} from '../src/envelope.js';
import type { RelayReadableEnvelope, SealedEnvelope } from '../src/envelope.js';
import { base64UrlEncode, pubKeyFromPrivKey } from '../src/crypto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(HERE, '../../../schemas/relay/v1');

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, rel), 'utf8')) as Record<string, unknown>;
}

const schema = loadJson('envelope.schema.json');
const sealedFixture = loadJson('fixtures/envelope.sealed.json');
const readableFixture = loadJson('fixtures/envelope.relay-readable.json');

// ── Hand-rolled draft-2020-12 SUBSET validator, fail-closed ──────────────────
// Unknown keywords throw at compile time so a schema edit cannot silently
// weaken validation. Keyword set mirrors the repo-wide frozen subset plus
// oneOf (the union discriminator this schema needs).

const META_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples']);
const SUPPORTED_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'oneOf',
]);

function compileCheck(node: unknown, at: string): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (!META_KEYWORDS.has(key) && !SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`unsupported keyword "${key}" at ${at} — extend the validator or simplify the schema`);
    }
  }
  const s = node as Record<string, unknown>;
  if (s.properties && typeof s.properties === 'object') {
    for (const [name, sub] of Object.entries(s.properties as Record<string, unknown>)) {
      compileCheck(sub, `${at}.properties.${name}`);
    }
  }
  if (s.items) compileCheck(s.items, `${at}.items`);
  if (Array.isArray(s.oneOf)) s.oneOf.forEach((sub, i) => compileCheck(sub, `${at}.oneOf[${i}]`));
}

function typeOk(type: string, value: unknown): boolean {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    default: throw new Error(`unsupported type "${type}"`);
  }
}

function validateNode(s: Record<string, unknown>, value: unknown, at: string, errors: string[]): void {
  if (Array.isArray(s.oneOf)) {
    const matching = s.oneOf.filter((branch) => {
      const branchErrors: string[] = [];
      validateNode(branch as Record<string, unknown>, value, at, branchErrors);
      return branchErrors.length === 0;
    });
    if (matching.length !== 1) errors.push(`${at}: oneOf matched ${matching.length} branches, need exactly 1`);
  }
  if (typeof s.type === 'string' && !typeOk(s.type, value)) {
    errors.push(`${at}: expected type ${s.type}`);
    return;
  }
  if ('const' in s && JSON.stringify(value) !== JSON.stringify(s.const)) {
    errors.push(`${at}: const mismatch`);
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: not in enum`);
  }
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${at}: shorter than minLength`);
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(`${at}: longer than maxLength`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value)) errors.push(`${at}: pattern mismatch`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${at}: below minimum`);
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${at}: above maximum`);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const req of s.required as string[]) {
        if (!(req in obj)) errors.push(`${at}: missing required "${req}"`);
      }
    }
    const props = (s.properties ?? {}) as Record<string, unknown>;
    for (const [name, sub] of Object.entries(props)) {
      if (name in obj) validateNode(sub as Record<string, unknown>, obj[name], `${at}.${name}`, errors);
    }
    if (s.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${at}: additional property "${key}"`);
      }
    }
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) errors.push(`${at}: fewer than minItems`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${at}: more than maxItems`);
    if (s.items && typeof s.items === 'object') {
      value.forEach((item, i) => validateNode(s.items as Record<string, unknown>, item, `${at}[${i}]`, errors));
    }
  }
}

function validate(instance: unknown): string[] {
  const errors: string[] = [];
  validateNode(schema, instance, '$', errors);
  return errors;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// The pre-N1 webhook transit body, exactly as github-webhook.ts wrote it
// before this slice: unlabeled plaintext JSON, base64url, in the ciphertext
// slot.
const OLD_SHAPE = {
  event_type: 'pull_request',
  delivery_id: 'abc-123',
  action: 'opened',
  repository: 'curiositech/port-daddy',
  payload: { action: 'opened' },
};

describe('envelope schema v1 — compiles fail-closed', () => {
  it('uses only supported keywords', () => {
    expect(() => compileCheck(schema, '$')).not.toThrow();
    for (const [i, branch] of (schema.oneOf as unknown[]).entries()) {
      expect(() => compileCheck(branch, `$.oneOf[${i}]`)).not.toThrow();
    }
  });

  it('freezes the discriminator and both required sets (schema<->classifier coupling pin)', () => {
    const branches = schema.oneOf as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(2);
    const byClass = Object.fromEntries(
      branches.map((b) => {
        const props = b.properties as Record<string, { const?: string }>;
        return [props.classification?.const, b.required as string[]];
      })
    );
    expect([...(byClass.sealed ?? [])].sort()).toEqual(
      ['schema', 'v', 'classification', 'harbor', 'channel', 'sender', 'seq', 'iat', 'alg', 'epoch', 'nonce', 'ciphertext', 'sig'].sort()
    );
    expect([...(byClass.relay_readable ?? [])].sort()).toEqual(
      ['schema', 'v', 'classification', 'harbor', 'channel', 'sender', 'seq', 'iat', 'payload', 'reason', 'sig'].sort()
    );
  });
});

describe('envelope schema v1 — accepts both classified variants', () => {
  it('validates the sealed fixture', () => {
    expect(validate(sealedFixture)).toEqual([]);
  });

  it('validates the relay_readable fixture', () => {
    expect(validate(readableFixture)).toEqual([]);
  });

  it('tolerant reader: unknown extra fields do not invalidate', () => {
    const extra = { ...clone(readableFixture), future_field: 'preserved-not-dropped' };
    expect(validate(extra)).toEqual([]);
  });

  it('classifier agrees: both fixtures classify to their variant', () => {
    expect(classifyEnvelope(sealedFixture).classification).toBe('sealed');
    expect(classifyEnvelope(readableFixture).classification).toBe('relay_readable');
  });
});

describe('envelope schema v1 — rejects the third state', () => {
  it('rejects an unclassified instance (classification absent)', () => {
    const un = clone(readableFixture) as Record<string, unknown>;
    delete un.classification;
    expect(validate(un)).not.toEqual([]);
    expect(() => classifyEnvelope(un)).toThrow(EnvelopeClassificationError);
    try {
      classifyEnvelope(un);
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('UNCLASSIFIED');
    }
  });

  it('rejects an unknown classification value', () => {
    const bad = { ...clone(readableFixture), classification: 'plaintext' };
    expect(validate(bad)).not.toEqual([]);
    try {
      classifyEnvelope(bad);
      expect.unreachable('classifyEnvelope must throw');
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('UNCLASSIFIED');
    }
  });

  it('rejects relay_readable with a missing reason', () => {
    const noReason = clone(readableFixture) as Record<string, unknown>;
    delete noReason.reason;
    expect(validate(noReason)).not.toEqual([]);
    try {
      classifyEnvelope(noReason);
      expect.unreachable('classifyEnvelope must throw');
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('MISSING_REASON');
    }
  });

  it('rejects relay_readable with an empty reason', () => {
    const emptyReason = { ...clone(readableFixture), reason: '' };
    expect(validate(emptyReason)).not.toEqual([]);
    try {
      classifyEnvelope(emptyReason);
      expect.unreachable('classifyEnvelope must throw');
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('MISSING_REASON');
    }
  });

  it('rejects an empty sig value on either variant', () => {
    for (const fixture of [sealedFixture, readableFixture]) {
      const emptySig = clone(fixture) as { sig: { value: string } };
      emptySig.sig.value = '';
      expect(validate(emptySig)).not.toEqual([]);
      try {
        classifyEnvelope(emptySig);
        expect.unreachable('classifyEnvelope must throw');
      } catch (e) {
        expect((e as EnvelopeClassificationError).code).toBe('EMPTY_SIG');
      }
    }
  });

  it('rejects a missing sig object entirely', () => {
    const noSig = clone(readableFixture) as Record<string, unknown>;
    delete noSig.sig;
    expect(validate(noSig)).not.toEqual([]);
    expect(() => classifyEnvelope(noSig)).toThrow(EnvelopeClassificationError);
  });

  it('rejects sealed without AEAD structure (missing nonce)', () => {
    const noNonce = clone(sealedFixture) as Record<string, unknown>;
    delete noNonce.nonce;
    expect(validate(noNonce)).not.toEqual([]);
    try {
      classifyEnvelope(noNonce);
      expect.unreachable('classifyEnvelope must throw');
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('BAD_SEALED');
    }
  });
});

describe('assertClassified — regression pin on the pre-N1 shape', () => {
  it('throws on the old unlabeled webhook blob as a decoded object', () => {
    expect(() => assertClassified(OLD_SHAPE)).toThrow(EnvelopeClassificationError);
    expect(() => assertClassified(OLD_SHAPE)).toThrow(/no sealed\|relay_readable classification/);
  });

  it('throws on the old blob through the transit codec (base64url plaintext JSON)', () => {
    const oldTransit = base64UrlEncode(new TextEncoder().encode(JSON.stringify(OLD_SHAPE)));
    expect(() => decodeTransitEnvelope(oldTransit)).toThrow(EnvelopeClassificationError);
    expect(tryDecodeTransitEnvelope(oldTransit)).toBeNull();
  });

  it('treats a bare AEAD blob (not JSON) as unclassified without throwing through tryDecode', () => {
    expect(tryDecodeTransitEnvelope('qqTk3iF9GxbNTkFa_not_json_9uPz')).toBeNull();
  });

  it('refuses to ENCODE anything unclassified (egress gate)', () => {
    expect(() => encodeTransitEnvelope(OLD_SHAPE as never)).toThrow(EnvelopeClassificationError);
  });
});

describe('envelope signing — real signature over the binding', () => {
  const PRIV = '11'.repeat(32);

  function unsignedReadable(): Omit<RelayReadableEnvelope, 'sig'> {
    return {
      schema: ENVELOPE_SCHEMA_ID,
      v: 1,
      classification: 'relay_readable',
      harbor: 'github',
      channel: 'github:webhook:pull_request',
      sender: 'f'.repeat(64),
      seq: 3,
      iat: 1755648000,
      payload: { event_type: 'pull_request', delivery_id: 'd-3' },
      reason: 'github webhook relay: payload is GitHub-public data',
    };
  }

  it('sign -> classify -> verify roundtrip; transit codec preserves the envelope', async () => {
    const unsigned = unsignedReadable();
    const sig = await signEnvelope(PRIV, unsigned);
    expect(sig.alg).toBe('ed25519');
    expect(sig.key_id).toBe(pubKeyFromPrivKey(PRIV));

    const envelope: RelayReadableEnvelope = { ...unsigned, sig };
    assertClassified(envelope);
    expect(validate(envelope)).toEqual([]);
    expect(await verifyEnvelopeSig(envelope)).toBe(true);

    const decoded = decodeTransitEnvelope(encodeTransitEnvelope(envelope));
    expect(decoded).toEqual(envelope);
    expect(await verifyEnvelopeSig(decoded)).toBe(true);
  });

  it('verification fails when a signed binding field is spliced (channel swap)', async () => {
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const spliced = { ...envelope, channel: 'github:webhook:issues' };
    expect(await verifyEnvelopeSig(spliced)).toBe(false);
  });

  it('verification fails when the relay-readable payload is tampered', async () => {
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const tampered = { ...envelope, payload: { event_type: 'pull_request', delivery_id: 'forged' } };
    expect(await verifyEnvelopeSig(tampered)).toBe(false);
  });

  // The three tamper cases below were added because mutation testing showed the
  // suite could not tell whether `sender`, `seq`, and `iat` were bound at all:
  // deleting each from the component list in envelopeBindingMessage left the
  // whole file green. The channel-splice test above is not transitive — it fails
  // for channel because the two channel strings differ, and says nothing about
  // the fields beside it. Each case names the attack the binding is what stops.

  it('verification fails when the sender is swapped (impersonation on the same channel)', async () => {
    // Unbound sender: one member's signature would validate for an envelope
    // attributed to another member on their shared channel.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSig({ ...envelope, sender: 'a'.repeat(64) })).toBe(false);
  });

  it('verification fails when seq is moved (replay at another chain position)', async () => {
    // Unbound seq: a captured envelope could be re-injected at any position in
    // the per-(sender, channel) chain, so the chain would order forgeries.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSig({ ...envelope, seq: unsigned.seq + 1 })).toBe(false);
    expect(await verifyEnvelopeSig({ ...envelope, seq: unsigned.seq - 1 })).toBe(false);
  });

  it('verification fails when iat is moved (replay at another time)', async () => {
    // Unbound iat: any freshness window built on iat would be advisory, because
    // the timestamp could be rewritten without invalidating the signature.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSig({ ...envelope, iat: unsigned.iat + 3600 })).toBe(false);
  });

  it('verification fails when the harbor is swapped (cross-tenant splice)', async () => {
    // Unbound harbor: a signature made in one tenant would validate in another.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSig({ ...envelope, harbor: 'other-harbor' })).toBe(false);
  });

  it('signs and verifies the sealed variant over the AEAD ciphertext', async () => {
    const unsigned: Omit<SealedEnvelope, 'sig'> = {
      schema: ENVELOPE_SCHEMA_ID,
      v: 1,
      classification: 'sealed',
      harbor: 'a'.repeat(64),
      channel: `${'a'.repeat(64)}:ops:deploys`,
      sender: 'f'.repeat(64),
      seq: 9,
      iat: 1755648000,
      alg: 'aes-256-gcm',
      epoch: 1,
      nonce: 'AAAAAAAAAAAAAAAB',
      ciphertext: 'kx3fO2ZQm1sVJb9tYc4hRw7nE8pLdAq6uG5iT0XyBjM',
    };
    const envelope: SealedEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    assertClassified(envelope);
    expect(validate(envelope)).toEqual([]);
    expect(await verifyEnvelopeSig(envelope)).toBe(true);
    expect(await verifyEnvelopeSig({ ...envelope, ciphertext: 'Zm9yZ2Vk' })).toBe(false);
  });
});

// ── Binding-message injectivity + canonicalization ───────────────────────────
//
// These pin two properties that a plain `[...].join('|')` + `JSON.stringify`
// binding did NOT have. Both were established by probing the real function,
// not by reading it, and both fail against the previous implementation.
describe('envelopeBindingMessage — the signature actually binds the tuple', () => {
  const base = {
    classification: 'relay_readable' as const,
    harbor: 'h', channel: 'c', sender: 's', seq: 1, iat: 1000,
  };

  it('SECURITY: an unpaired surrogate cannot forge a different routing tuple', () => {
    // The separator fix below made the framing injective over BYTES. This pins
    // the layer under it: TextEncoder maps every UNPAIRED surrogate to U+FFFD,
    // so channel="ops\uD800" and channel="ops\uFFFD" are distinct strings that
    // encode to the same six bytes and take the same length prefix. Before the
    // well-formedness guard both produced a byte-identical binding message —
    // one signature valid for two routing tuples, the exact cross-channel
    // replay length-prefixing was introduced to end.
    const lone = 'ops\uD800';
    const replacement = 'ops\uFFFD';

    // Premise, pinned independently: these really are distinct strings whose
    // UTF-8 encodings collide. Without this the test could pass for the wrong
    // reason if the encoder ever stopped being lossy.
    expect(lone).not.toBe(replacement);
    const enc = new TextEncoder();
    expect(Array.from(enc.encode(lone))).toEqual(Array.from(enc.encode(replacement)));

    // The binding must now refuse the ill-formed value rather than hash it.
    expect(() =>
      envelopeBindingMessage({ ...base, channel: lone, payload: {} } as never),
    ).toThrow(EnvelopeClassificationError);
    // The well-formed twin still binds normally — the guard rejects ill-formed
    // input, it does not reject U+FFFD or non-ASCII generally.
    expect(
      envelopeBindingMessage({ ...base, channel: replacement, payload: {} } as never),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SECURITY: classification rejects an unpaired surrogate in routing metadata', () => {
    // Fail closed at the boundary too: a lone surrogate survives JSON.parse,
    // so a producer reading routing metadata from a request body can carry one
    // in. It must not reach the signing path at all.
    expect(JSON.parse('{"c":"ops\\ud800"}').c).toBe('ops\uD800');
    for (const field of ['harbor', 'channel', 'sender'] as const) {
      expect(() =>
        classifyEnvelope({
          schema: ENVELOPE_SCHEMA_ID, v: 1, classification: 'relay_readable',
          harbor: 'h', channel: 'c', sender: 's', seq: 1, iat: 1000,
          payload: {}, reason: 'a reason long enough to be a real justification',
          sig: { alg: 'ed25519', key_id: 'k', value: 'v' },
          [field]: 'ops\uD800',
        }),
      ).toThrow(EnvelopeClassificationError);
    }
  });

  it('SECURITY: a separator inside a field cannot forge a different routing tuple', () => {
    // harbor="a|b" channel="c"  vs  harbor="a" channel="b|c".
    // Under an unprefixed join these produce identical bytes, so one signature
    // validates for both — a cross-channel replay. Length prefixing makes the
    // framing injective, so they must differ.
    const shifted = envelopeBindingMessage({ ...base, harbor: 'a|b', channel: 'c', payload: {} } as never);
    const other = envelopeBindingMessage({ ...base, harbor: 'a', channel: 'b|c', payload: {} } as never);
    expect(shifted).not.toBe(other);
  });

  it('SECURITY: the same shifting attack on channel/sender is also blocked', () => {
    const a = envelopeBindingMessage({ ...base, channel: 'x|y', sender: 'z', payload: {} } as never);
    const b = envelopeBindingMessage({ ...base, channel: 'x', sender: 'y|z', payload: {} } as never);
    expect(a).not.toBe(b);
  });

  it('a multi-byte field cannot collide with a shorter one (byte length, not UTF-16 length)', () => {
    const a = envelopeBindingMessage({ ...base, harbor: 'é', payload: {} } as never);
    const b = envelopeBindingMessage({ ...base, harbor: 'ee', payload: {} } as never);
    expect(a).not.toBe(b);
  });

  it('payload key ORDER does not change the binding (cross-implementation verifiability)', () => {
    // A verifier that rebuilt the object differently must still hash the same
    // bytes, or it rejects a valid signature.
    const a = envelopeBindingMessage({ ...base, payload: { x: 1, y: 2 } } as never);
    const b = envelopeBindingMessage({ ...base, payload: { y: 2, x: 1 } } as never);
    expect(a).toBe(b);
  });

  it('nested key order is also normalized, while array order is preserved', () => {
    const a = envelopeBindingMessage({ ...base, payload: { o: { m: 1, n: 2 }, arr: [1, 2] } } as never);
    const b = envelopeBindingMessage({ ...base, payload: { arr: [1, 2], o: { n: 2, m: 1 } } } as never);
    expect(a).toBe(b);
    // Arrays are semantic: reordering them IS a different payload.
    const reordered = envelopeBindingMessage({ ...base, payload: { o: { m: 1, n: 2 }, arr: [2, 1] } } as never);
    expect(reordered).not.toBe(a);
  });

  it('a genuinely different payload value still changes the binding', () => {
    const a = envelopeBindingMessage({ ...base, payload: { x: 1 } } as never);
    const b = envelopeBindingMessage({ ...base, payload: { x: 2 } } as never);
    expect(a).not.toBe(b);
  });

  it('SECURITY: every routing field is bound — changing any one alone changes the binding', () => {
    // A per-field sweep, because the separator tests above are not a substitute
    // for it: each of them varies TWO fields at once, so it still fails if the
    // field it is named for is dropped from the binding entirely. Removing
    // `sender`, `seq`, or `iat` from the component list used to leave the whole
    // suite green — this is the test that notices.
    const reference = envelopeBindingMessage({ ...base, payload: {} } as never);
    const variants: Array<readonly [string, Record<string, unknown>]> = [
      ['harbor', { harbor: 'h2' }],
      ['channel', { channel: 'c2' }],
      ['sender', { sender: 's2' }],
      ['seq', { seq: 2 }],
      ['iat', { iat: 1001 }],
    ];
    for (const [field, override] of variants) {
      expect(
        envelopeBindingMessage({ ...base, payload: {}, ...override } as never),
        `${field} is not bound into the signature`,
      ).not.toBe(reference);
    }
  });

  it('KNOWN ANSWER: the binding digest is the wire contract, schema tag and classification included', () => {
    // Two components cannot be reached by varying inputs: ENVELOPE_SCHEMA_ID is
    // a constant, and `classification` is fixed within each variant. Dropping
    // either from the component list changes these digests and nothing else in
    // the suite, so this is where they are pinned.
    //
    // What each one stops: the schema tag prevents a signature over some other
    // pd binding message of the same arity from being replayed as an envelope
    // signature; `classification` prevents a sealed envelope's signature from
    // validating against a relay_readable envelope with the same routing tuple
    // whose payload happens to hash to the same content digest.
    //
    // These digests are the wire contract, and any verifier — Swift on device,
    // Rust in pd-vault, Python in the chain tools — must reproduce them byte for
    // byte. Changing them is a schema revision (v2), never a refactor: an
    // in-place edit here silently invalidates every signature already written.
    const readable = {
      schema: ENVELOPE_SCHEMA_ID, v: 1, classification: 'relay_readable',
      harbor: 'github', channel: 'github:webhook:pull_request',
      sender: 'f'.repeat(64), seq: 3, iat: 1755648000,
      payload: { event_type: 'pull_request', delivery_id: 'd-3' },
      reason: 'github webhook relay: payload is GitHub-public data',
    };
    expect(envelopeBindingMessage(readable as never)).toBe(
      'ba742248ad168e4ea4ec3bf3eb017d0657d205cd72f9b29281833446b352b916',
    );

    const sealed = {
      schema: ENVELOPE_SCHEMA_ID, v: 1, classification: 'sealed',
      harbor: 'a'.repeat(64), channel: `${'a'.repeat(64)}:ops:deploys`,
      sender: 'f'.repeat(64), seq: 9, iat: 1755648000,
      alg: 'aes-256-gcm', epoch: 1, nonce: 'AAAAAAAAAAAAAAAB',
      ciphertext: 'kx3fO2ZQm1sVJb9tYc4hRw7nE8pLdAq6uG5iT0XyBjM',
    };
    expect(envelopeBindingMessage(sealed as never)).toBe(
      'd83b2945dba250077672737ca7bb12e5b26490589fce0e00b16df6a73ecadf3a',
    );
  });

  it('survives the transit round trip (sign here, verify after parse)', () => {
    const orig = { ...base, payload: { zeta: 1, alpha: { n: [1, 2], m: 'x' } } } as never;
    expect(envelopeBindingMessage(JSON.parse(JSON.stringify(orig)))).toBe(envelopeBindingMessage(orig));
  });
});

describe('envelopeFrameMismatch — the inner tuple must match the frame it travelled in', () => {
  // The envelope type documents harbor/channel/sender/seq/iat as "must equal
  // the outer frame's". Nothing enforced it on any path, so the words were a
  // comment rather than a rule. This is the predicate that makes them a rule.
  //
  // The attack it closes is not forgery — the frame signature covers the
  // encoded envelope, so only the authenticated daemon can put these bytes on
  // the wire. It is disagreement: the envelope carries its own signature over
  // its own routing tuple, so an event delivered on channel C whose envelope
  // says channel D gets filed under C by the relay's chain and under D by every
  // consumer that verifies the envelope. Two signed answers to one question.
  const envelope = {
    schema: ENVELOPE_SCHEMA_ID, v: 1, classification: 'relay_readable' as const,
    harbor: 'h', channel: 'h:ops:deploys', sender: 's'.repeat(64), seq: 4, iat: 1755648000,
    payload: {}, reason: 'a reason long enough to be a real justification',
    sig: { alg: 'ed25519' as const, key_id: 'k', value: 'v' },
  };
  const frame = { channel: 'h:ops:deploys', sender: 's'.repeat(64), seq: 4, iat: 1755648000 };

  it('agrees when the envelope was built from the frame it ships in', () => {
    expect(envelopeFrameMismatch(envelope, frame)).toBeNull();
  });

  it('names each disagreeing field, one at a time', () => {
    expect(envelopeFrameMismatch(envelope, { ...frame, channel: 'h:ops:secrets' })).toBe('channel');
    expect(envelopeFrameMismatch(envelope, { ...frame, sender: 'z'.repeat(64) })).toBe('sender');
    expect(envelopeFrameMismatch(envelope, { ...frame, seq: 5 })).toBe('seq');
    expect(envelopeFrameMismatch(envelope, { ...frame, iat: frame.iat + 1 })).toBe('iat');
  });

  it('does not accept a same-prefix channel — the comparison is the whole string', () => {
    // 'h:ops' is the prefix of 'h:ops:deploys'. A predicate written with
    // startsWith would pass this and let a broader channel claim a narrower
    // one's events.
    expect(envelopeFrameMismatch(envelope, { ...frame, channel: 'h:ops' })).toBe('channel');
    expect(envelopeFrameMismatch({ ...envelope, channel: 'h:ops' }, frame)).toBe('channel');
  });

  it('compares seq and iat as numbers, not as loosely-equal strings', () => {
    // `==` would call '4' equal to 4 and let a string-typed body through a
    // check that is meant to be exact.
    expect(envelopeFrameMismatch(envelope, { ...frame, seq: '4' as unknown as number })).toBe('seq');
    expect(envelopeFrameMismatch(envelope, { ...frame, iat: '1755648000' as unknown as number })).toBe('iat');
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively and is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('preserves array order and handles primitives/null', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('s')).toBe('"s"');
  });
});
