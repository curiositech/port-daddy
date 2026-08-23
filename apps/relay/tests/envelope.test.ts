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
  verifyEnvelopeSignedBy,
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

  it('rejects a reason that is only whitespace — length is not justification', () => {
    // pd-purser authored a test asserting a whitespace-only reason is ACCEPTED,
    // which is what the code did: the check was `.length === 0`, so '   ' passed.
    // That reading makes the field satisfiable without saying anything, and the
    // schema's own description calls the reason the audit trail. Rejecting it.
    for (const blank of ['   ', '\t', '\n', '\u00A0', '\u2028 \u2029']) {
      const e = clone(readableFixture) as Record<string, unknown>;
      e.reason = blank;
      expect(() => classifyEnvelope(e), `reason ${JSON.stringify(blank)} must be rejected`)
        .toThrow(EnvelopeClassificationError);
    }
    // A reason with real content surrounded by whitespace is fine — the rule is
    // "must say something", not "must be pre-trimmed".
    const padded = clone(readableFixture) as Record<string, unknown>;
    padded.reason = '  github webhook relay: payload is GitHub-public data  ';
    expect(() => classifyEnvelope(padded)).not.toThrow();
  });

  it('rejects an empty sig.key_id on either variant', () => {
    for (const fixture of [sealedFixture, readableFixture]) {
      const emptyKeyId = clone(fixture) as { sig: { key_id: string } };
      emptyKeyId.sig.key_id = '';
      expect(validate(emptyKeyId)).not.toEqual([]);
      try {
        classifyEnvelope(emptyKeyId);
        expect.unreachable('classifyEnvelope must throw');
      } catch (e) {
        expect((e as EnvelopeClassificationError).code).toBe('EMPTY_SIG');
      }
    }
  });

  it('SECURITY: rejects an envelope whose harbor is not the channel prefix', async () => {
    // The harbor is documented as the channel's prefix before the first ':'.
    // Both fields sit under the envelope signature, so a producer could sign
    // harbor="X" over channel="Y:…" — the relay's chain routes the event under
    // Y while every envelope-trusting consumer files it under tenant X. Same
    // two-signed-answers hazard the frame-mismatch check closes, one field
    // over — and envelopeFrameMismatch cannot see it, because the frame has no
    // harbor field of its own.
    const priv = '11'.repeat(32);
    const unsigned = {
      schema: ENVELOPE_SCHEMA_ID,
      v: 1 as const,
      classification: 'relay_readable' as const,
      harbor: 'tenant-x',
      channel: 'tenant-y:ops:deploys',
      sender: 'f'.repeat(64),
      seq: 3,
      iat: 1755648000,
      payload: { type: 'run-started' },
      reason: 'test fixture: harbor disagrees with the channel prefix',
    };
    const envelope = { ...unsigned, sig: await signEnvelope(priv, unsigned as never) };

    // Premise 1: the pair really is mismatched, and the same envelope with the
    // coherent harbor classifies cleanly — so the rejection below is about the
    // mismatch, not about some other malformation.
    expect(envelope.channel.split(':')[0]).not.toBe(envelope.harbor);
    const coherent = { ...envelope, harbor: 'tenant-y' };
    expect(classifyEnvelope(coherent).classification).toBe('relay_readable');

    // Premise 2: the frame-mismatch predicate passes this envelope against the
    // frame it would travel in — the frame carries no harbor to compare — so
    // the classifier is the only place the mismatch can be caught.
    expect(
      envelopeFrameMismatch(envelope as never, {
        channel: unsigned.channel, sender: unsigned.sender, seq: unsigned.seq, iat: unsigned.iat,
      }),
    ).toBeNull();

    // The classifier refuses it, on every path.
    try {
      classifyEnvelope(envelope);
      expect.unreachable('classifyEnvelope must throw');
    } catch (e) {
      expect((e as EnvelopeClassificationError).code).toBe('BAD_ENVELOPE');
    }
    expect(() => encodeTransitEnvelope(envelope as never)).toThrow(EnvelopeClassificationError);
    const transit = base64UrlEncode(new TextEncoder().encode(JSON.stringify(envelope)));
    expect(() => decodeTransitEnvelope(transit)).toThrow(EnvelopeClassificationError);
    expect(tryDecodeTransitEnvelope(transit)).toBeNull();
  });

  it('accepts a colonless channel equal to its harbor (the degenerate prefix)', () => {
    // github-webhook.ts derives harbor = channel when the channel has no ':'.
    const e = clone(readableFixture) as Record<string, unknown>;
    e.harbor = 'lonechannel';
    e.channel = 'lonechannel';
    expect(classifyEnvelope(e).classification).toBe('relay_readable');
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

  it('accepts xchacha20-poly1305 — the daemon seal path revision — in schema AND classifier', () => {
    // Premise: the fixture is aes-256-gcm, so this test actually exercises the
    // OTHER member of the closed set rather than revalidating the fixture.
    expect(sealedFixture.alg).toBe('aes-256-gcm');
    const vaultSealed = { ...clone(sealedFixture), alg: 'xchacha20-poly1305' } as Record<string, unknown>;
    expect(validate(vaultSealed)).toEqual([]);
    expect(() => classifyEnvelope(vaultSealed)).not.toThrow();
  });

  it('still rejects any alg outside the closed set (the set widened, it did not open)', () => {
    const unknownAlg = { ...clone(sealedFixture), alg: 'rot13' } as Record<string, unknown>;
    expect(validate(unknownAlg)).not.toEqual([]);
    try {
      classifyEnvelope(unknownAlg);
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
  const PUB = pubKeyFromPrivKey(PRIV);
  // A second, unrelated keypair. Nothing about it is privileged — that is the
  // point: it is what any stranger can mint for themselves in one line.
  const ATTACKER_PRIV = '22'.repeat(32);
  const ATTACKER_PUB = pubKeyFromPrivKey(ATTACKER_PRIV);

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
    expect(await verifyEnvelopeSignedBy(envelope, [PUB])).toBe(true);

    const decoded = decodeTransitEnvelope(encodeTransitEnvelope(envelope));
    expect(decoded).toEqual(envelope);
    expect(await verifyEnvelopeSignedBy(decoded, [PUB])).toBe(true);
  });

  it('verification fails when a signed binding field is spliced (channel swap)', async () => {
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const spliced = { ...envelope, channel: 'github:webhook:issues' };
    expect(await verifyEnvelopeSignedBy(spliced, [PUB])).toBe(false);
  });

  it('verification fails when the relay-readable payload is tampered', async () => {
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const tampered = { ...envelope, payload: { event_type: 'pull_request', delivery_id: 'forged' } };
    expect(await verifyEnvelopeSignedBy(tampered, [PUB])).toBe(false);
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
    expect(await verifyEnvelopeSignedBy({ ...envelope, sender: 'a'.repeat(64) }, [PUB])).toBe(false);
  });

  it('verification fails when seq is moved (replay at another chain position)', async () => {
    // Unbound seq: a captured envelope could be re-injected at any position in
    // the per-(sender, channel) chain, so the chain would order forgeries.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSignedBy({ ...envelope, seq: unsigned.seq + 1 }, [PUB])).toBe(false);
    expect(await verifyEnvelopeSignedBy({ ...envelope, seq: unsigned.seq - 1 }, [PUB])).toBe(false);
  });

  it('verification fails when iat is moved (replay at another time)', async () => {
    // Unbound iat: any freshness window built on iat would be advisory, because
    // the timestamp could be rewritten without invalidating the signature.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSignedBy({ ...envelope, iat: unsigned.iat + 3600 }, [PUB])).toBe(false);
  });

  it('verification fails when the harbor is swapped (cross-tenant splice)', async () => {
    // Unbound harbor: a signature made in one tenant would validate in another.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSignedBy({ ...envelope, harbor: 'other-harbor' }, [PUB])).toBe(false);
  });

  // ── The signer is the caller's to decide ──────────────────────────────────
  //
  // Every tamper case above keeps the victim's signature and edits a field
  // around it, so all of them fail for the same reason: the bytes moved out
  // from under a signature nobody re-made. None of them says anything about an
  // attacker who simply signs their own envelope, and until these tests the
  // suite had no second keypair in it at all. That is the case that matters,
  // because an envelope names its own signing key: verifying against the key
  // the envelope nominates asks "did whoever made this hold the key they chose
  // to write down", which everyone can answer yes to.

  it('SECURITY: an attacker who re-signs with their own key is rejected', async () => {
    const unsigned = unsignedReadable();
    // Not a tampered envelope — a complete, internally consistent one, signed
    // end to end by a key that is simply not ours. Every field is coherent and
    // key_id honestly names the key that signed it.
    const forged: RelayReadableEnvelope = {
      ...unsigned,
      sig: await signEnvelope(ATTACKER_PRIV, unsigned),
    };

    // Premise, pinned so the rejection below cannot pass for the wrong reason:
    // the forgery is well-formed and its signature is real. If this failed,
    // the next assertion would be rejecting a broken envelope rather than an
    // unauthorized signer, and would prove nothing.
    assertClassified(forged);
    expect(validate(forged)).toEqual([]);
    expect(await verifyEnvelopeSignedBy(forged, [ATTACKER_PUB])).toBe(true);

    // The accepted set is the whole difference.
    expect(await verifyEnvelopeSignedBy(forged, [PUB])).toBe(false);
  });

  it('SECURITY: an empty accepted-key set verifies nothing', async () => {
    // A caller whose roster lookup came back empty has resolved no key, and the
    // honest answer to "was this signed by one of the keys I accept" is no.
    // Fail closed: the alternative — treating "no keys" as "any key" — is the
    // shape that turns a lookup miss into an authentication bypass.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    expect(await verifyEnvelopeSignedBy(envelope, [])).toBe(false);
  });

  it('accepts a signature from any key in the set, which is what rotation needs', async () => {
    // Rotation leaves a sender with several keys valid across a stored corpus:
    // envelopes signed before the rotation stay valid, and re-signing history
    // is not on the table. So the set has to admit an old key without the
    // caller knowing which epoch signed which envelope.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const retiredKey = pubKeyFromPrivKey('33'.repeat(32));
    expect(await verifyEnvelopeSignedBy(envelope, [retiredKey, PUB])).toBe(true);
    expect(await verifyEnvelopeSignedBy(envelope, [PUB, retiredKey])).toBe(true);
    // ...and a set of keys that simply does not include the signer still fails,
    // so the loop is not just returning true once it has more than one key.
    expect(await verifyEnvelopeSignedBy(envelope, [retiredKey, ATTACKER_PUB])).toBe(false);
  });

  it('SECURITY: key_id cannot be rewritten in transit to an accepted key', async () => {
    // key_id is the field a verifier would read to decide WHICH key to look up.
    // If it were not covered by the signature it would be editable by anything
    // on the path, and an envelope signed by one accepted key could be
    // re-attributed to another. Both guards are checked here: the rewritten
    // key_id no longer names the key that signed, and the binding message the
    // signature covers no longer matches either.
    const unsigned = unsignedReadable();
    const envelope: RelayReadableEnvelope = { ...unsigned, sig: await signEnvelope(PRIV, unsigned) };
    const relabelled = {
      ...envelope,
      sig: { ...envelope.sig, key_id: ATTACKER_PUB },
    };
    // Both keys are accepted, so the only thing that can reject this is that
    // key_id was edited — not that the attacker's key is unknown to us.
    expect(await verifyEnvelopeSignedBy(relabelled, [PUB, ATTACKER_PUB])).toBe(false);
  });

  it('a Date in the payload survives the transit round trip (toJSON honored in the binding)', async () => {
    // Premise: a Date has no own enumerable keys, so an entries-based
    // canonicalization would emit '{}' for it — while the transit codec's
    // JSON.stringify emits its ISO string. Under that split the producer signs
    // one content hash and every decoder computes another, and a good
    // signature dies on its first round trip.
    const at = new Date(1755648000000);
    expect(Object.keys(at)).toEqual([]);
    expect(JSON.parse(JSON.stringify({ at })).at).toBe(at.toISOString());

    // canonicalJson must agree with JSON.stringify on what a Date IS.
    expect(canonicalJson(at)).toBe(JSON.stringify(at));

    const unsigned = { ...unsignedReadable(), payload: { type: 'run-started', at } };
    const envelope: RelayReadableEnvelope = {
      ...unsigned,
      sig: await signEnvelope(PRIV, unsigned as never),
    } as never;
    const decoded = decodeTransitEnvelope(encodeTransitEnvelope(envelope));
    // The decoded payload carries the ISO string, not a Date — and the
    // signature still verifies, because both sides canonicalized to the same
    // bytes.
    expect((decoded as RelayReadableEnvelope).payload.at).toBe(at.toISOString());
    expect(await verifyEnvelopeSignedBy(decoded, [PUB])).toBe(true);
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
    expect(await verifyEnvelopeSignedBy(envelope, [PUB])).toBe(true);
    expect(await verifyEnvelopeSignedBy({ ...envelope, ciphertext: 'Zm9yZ2Vk' }, [PUB])).toBe(false);
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

  // Every binding is computed under a signing key now, so these tests need one.
  // Its value is arbitrary except that it must be constant: the properties
  // below are about the OTHER components, and a varying key would change every
  // digest for a reason none of them is testing.
  const KEY = 'ab'.repeat(32);

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
      envelopeBindingMessage({ ...base, channel: lone, payload: {} } as never, KEY),
    ).toThrow(EnvelopeClassificationError);
    // The well-formed twin still binds normally — the guard rejects ill-formed
    // input, it does not reject U+FFFD or non-ASCII generally.
    expect(
      envelopeBindingMessage({ ...base, channel: replacement, payload: {} } as never, KEY),
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
    const shifted = envelopeBindingMessage({ ...base, harbor: 'a|b', channel: 'c', payload: {} } as never, KEY);
    const other = envelopeBindingMessage({ ...base, harbor: 'a', channel: 'b|c', payload: {} } as never, KEY);
    expect(shifted).not.toBe(other);
  });

  it('SECURITY: the same shifting attack on channel/sender is also blocked', () => {
    const a = envelopeBindingMessage({ ...base, channel: 'x|y', sender: 'z', payload: {} } as never, KEY);
    const b = envelopeBindingMessage({ ...base, channel: 'x', sender: 'y|z', payload: {} } as never, KEY);
    expect(a).not.toBe(b);
  });

  it('a multi-byte field cannot collide with a shorter one (byte length, not UTF-16 length)', () => {
    const a = envelopeBindingMessage({ ...base, harbor: 'é', payload: {} } as never, KEY);
    const b = envelopeBindingMessage({ ...base, harbor: 'ee', payload: {} } as never, KEY);
    expect(a).not.toBe(b);
  });

  it('payload key ORDER does not change the binding (cross-implementation verifiability)', () => {
    // A verifier that rebuilt the object differently must still hash the same
    // bytes, or it rejects a valid signature.
    const a = envelopeBindingMessage({ ...base, payload: { x: 1, y: 2 } } as never, KEY);
    const b = envelopeBindingMessage({ ...base, payload: { y: 2, x: 1 } } as never, KEY);
    expect(a).toBe(b);
  });

  it('nested key order is also normalized, while array order is preserved', () => {
    const a = envelopeBindingMessage({ ...base, payload: { o: { m: 1, n: 2 }, arr: [1, 2] } } as never, KEY);
    const b = envelopeBindingMessage({ ...base, payload: { arr: [1, 2], o: { n: 2, m: 1 } } } as never, KEY);
    expect(a).toBe(b);
    // Arrays are semantic: reordering them IS a different payload.
    const reordered = envelopeBindingMessage({ ...base, payload: { o: { m: 1, n: 2 }, arr: [2, 1] } } as never, KEY);
    expect(reordered).not.toBe(a);
  });

  it('a list of records binds identically regardless of each record\'s key order', () => {
    // The canonicalJson unit test above pins the serialization; this pins that
    // the BINDING inherits it, which is the property a cross-language verifier
    // actually depends on. A payload shaped like a list of records is the
    // ordinary case — files changed, members, receipts — and it was the one
    // shape no binding test covered.
    const a = envelopeBindingMessage({
      ...base, payload: { items: [{ path: 'a.ts', mode: 'edit' }, { path: 'b.ts', mode: 'add' }] },
    } as never, KEY);
    const b = envelopeBindingMessage({
      ...base, payload: { items: [{ mode: 'edit', path: 'a.ts' }, { mode: 'add', path: 'b.ts' }] },
    } as never, KEY);
    expect(a).toBe(b);
    // Element ORDER is still semantic — reordering the list is a different
    // payload, same as the flat-array case above.
    const swapped = envelopeBindingMessage({
      ...base, payload: { items: [{ path: 'b.ts', mode: 'add' }, { path: 'a.ts', mode: 'edit' }] },
    } as never, KEY);
    expect(swapped).not.toBe(a);
  });

  it('a genuinely different payload value still changes the binding', () => {
    const a = envelopeBindingMessage({ ...base, payload: { x: 1 } } as never, KEY);
    const b = envelopeBindingMessage({ ...base, payload: { x: 2 } } as never, KEY);
    expect(a).not.toBe(b);
  });

  it('SECURITY: every routing field is bound — changing any one alone changes the binding', () => {
    // A per-field sweep, because the separator tests above are not a substitute
    // for it: each of them varies TWO fields at once, so it still fails if the
    // field it is named for is dropped from the binding entirely. Removing
    // `sender`, `seq`, or `iat` from the component list used to leave the whole
    // suite green — this is the test that notices.
    const reference = envelopeBindingMessage({ ...base, payload: {} } as never, KEY);
    const variants: Array<readonly [string, Record<string, unknown>]> = [
      ['harbor', { harbor: 'h2' }],
      ['channel', { channel: 'c2' }],
      ['sender', { sender: 's2' }],
      ['seq', { seq: 2 }],
      ['iat', { iat: 1001 }],
    ];
    for (const [field, override] of variants) {
      expect(
        envelopeBindingMessage({ ...base, payload: {}, ...override } as never, KEY),
        `${field} is not bound into the signature`,
      ).not.toBe(reference);
    }
  });

  it('SECURITY: the signing key is bound — the same tuple under a different key differs', () => {
    // Without this component the signature is a proof over the routing tuple
    // alone, unattached to any key, and `sig.key_id` is a label the signature
    // does not cover. Binding it is what lets a verifier say the signature was
    // made BY a particular key rather than merely that some key made it.
    const otherKey = 'cd'.repeat(32);
    expect(otherKey).not.toBe(KEY);
    expect(envelopeBindingMessage({ ...base, payload: {} } as never, otherKey)).not.toBe(
      envelopeBindingMessage({ ...base, payload: {} } as never, KEY),
    );
  });

  it('refuses to compute a binding under an empty key id', () => {
    // classifyEnvelope already rejects an empty sig.key_id on both variants,
    // and the length-prefixed framing is injective even over an empty
    // component — but envelopeBindingMessage is exported and takes the key as
    // a bare parameter, so it enforces its own precondition: a binding under
    // no key is a signature that commits to no signer.
    try {
      envelopeBindingMessage({ ...base, payload: {} } as never, '');
      expect.unreachable('envelopeBindingMessage must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvelopeClassificationError);
      expect((e as EnvelopeClassificationError).code).toBe('EMPTY_SIG');
    }
  });

  it('KNOWN ANSWER: the binding digest is the wire contract, schema tag and classification included', () => {
    // Two components cannot be reached by varying inputs: ENVELOPE_SCHEMA_ID is
    // a constant, and `classification` is fixed within each variant. Dropping
    // either from the component list changes these digests and nothing else in
    // the suite, so this is where they are pinned.
    //
    // The key below is the ed25519 public key for private key '11' * 32 — the
    // same key the signing tests use — so an implementer in another language
    // can derive it, reproduce these digests, and then check a real signature
    // against them rather than only the digest.
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
    const VECTOR_KEY = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737';
    expect(VECTOR_KEY, 'the vector key must stay derivable from the signing tests\' private key').toBe(
      pubKeyFromPrivKey('11'.repeat(32)),
    );

    expect(envelopeBindingMessage(readable as never, VECTOR_KEY)).toBe(
      'dba03ec1e47df6c683967c20bedad01f4b94d4f013de98132dab089c3a62404c',
    );

    const sealed = {
      schema: ENVELOPE_SCHEMA_ID, v: 1, classification: 'sealed',
      harbor: 'a'.repeat(64), channel: `${'a'.repeat(64)}:ops:deploys`,
      sender: 'f'.repeat(64), seq: 9, iat: 1755648000,
      alg: 'aes-256-gcm', epoch: 1, nonce: 'AAAAAAAAAAAAAAAB',
      ciphertext: 'kx3fO2ZQm1sVJb9tYc4hRw7nE8pLdAq6uG5iT0XyBjM',
    };
    expect(envelopeBindingMessage(sealed as never, VECTOR_KEY)).toBe(
      'c4b649b4985c0150b9d7c4b5c4bcf6776146f13c00a7d980659f977d0c61101c',
    );
  });

  it('survives the transit round trip (sign here, verify after parse)', () => {
    const orig = { ...base, payload: { zeta: 1, alpha: { n: [1, 2], m: 'x' } } } as never;
    expect(envelopeBindingMessage(JSON.parse(JSON.stringify(orig)), KEY)).toBe(
      envelopeBindingMessage(orig, KEY),
    );
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
  it('recurses INTO array elements — an object inside an array is canonicalized too', () => {
    // Every other array in this suite holds primitives ([3,1,2], [1,2]), so
    // nothing pinned what happens to an OBJECT inside one. Replacing the
    // recursive branch with a plain JSON.stringify(value) — which preserves
    // insertion order for keys nested in arrays — left all 866 tests green.
    //
    // The shape this protects is the common one: a payload carrying a LIST OF
    // RECORDS. Without recursion, {items:[{b,a}]} and {items:[{a,b}]} hash
    // differently, so a verifier that rebuilt the list in another key order
    // rejects a valid signature — the exact failure canonicalization exists to
    // prevent, just one level deeper than the existing tests reach.
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
    // Premise, pinned separately: these are genuinely different insertion
    // orders, so the assertion above cannot pass for the wrong reason.
    expect(JSON.stringify([{ b: 1, a: 2 }])).not.toBe(JSON.stringify([{ a: 2, b: 1 }]));
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe(canonicalJson([{ a: 2, b: 1 }]));
    // …and it keeps recursing: object → array → object → array.
    expect(canonicalJson({ z: [{ y: [3, 1], x: 0 }] })).toBe('{"z":[{"x":0,"y":[3,1]}]}');
  });

  it('preserves array order and handles primitives/null', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('s')).toBe('"s"');
  });

  it('honors toJSON like JSON.stringify — a Date is its ISO string, nested included', () => {
    const d = new Date(1755648000000);
    expect(canonicalJson(d)).toBe(JSON.stringify(d));
    expect(canonicalJson({ b: d, a: 1 })).toBe(`{"a":1,"b":${JSON.stringify(d)}}`);
    expect(canonicalJson([d])).toBe(`[${JSON.stringify(d)}]`);
    // The toJSON result is itself canonicalized (keys sorted), so a custom
    // toJSON cannot smuggle insertion-order dependence back in.
    const custom = { toJSON: () => ({ z: 1, y: 2 }) };
    expect(canonicalJson(custom)).toBe('{"y":2,"z":1}');
  });
});
