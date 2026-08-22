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

  it('survives the transit round trip (sign here, verify after parse)', () => {
    const orig = { ...base, payload: { zeta: 1, alpha: { n: [1, 2], m: 'x' } } } as never;
    expect(envelopeBindingMessage(JSON.parse(JSON.stringify(orig)))).toBe(envelopeBindingMessage(orig));
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
